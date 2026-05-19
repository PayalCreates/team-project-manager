import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, pool, rowsToCamel, toCamel } from './db.js';

const app = express();
const port = process.env.PORT || 3000;
const jwtSecret = process.env.JWT_SECRET || 'local-dev-secret-change-me';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json());

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: '7d' });
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !String(body[field] || '').trim());
  return missing.length ? `${missing.join(', ')} required` : null;
}

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  try {
    req.user = jwt.verify(token, jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function getMembership(projectId, userId) {
  const result = await pool.query(
    'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId],
  );
  return result.rows[0] || null;
}

async function requireProjectMember(req, res, next) {
  const projectId = req.params.projectId || req.params.id;
  const membership = await getMembership(projectId, req.user.id);

  if (!membership) {
    return res.status(403).json({ error: 'You are not a member of this project' });
  }

  req.membership = membership;
  return next();
}

async function requireProjectAdmin(req, res, next) {
  const projectId = req.params.projectId || req.params.id;
  const membership = await getMembership(projectId, req.user.id);

  if (membership?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.membership = membership;
  return next();
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  const missing = requireFields(req.body, ['name', 'email', 'password']);

  if (missing) return res.status(400).json({ error: missing });
  if (!validateEmail(email)) return res.status(400).json({ error: 'Valid email required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, LOWER($2), $3) RETURNING id, name, email, created_at',
      [name.trim(), email.trim(), passwordHash],
    );
    const user = toCamel(result.rows[0]);
    res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email is already registered' });
    res.status(500).json({ error: 'Could not create account' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const missing = requireFields(req.body, ['email', 'password']);

  if (missing) return res.status(400).json({ error: missing });

  const result = await pool.query('SELECT * FROM users WHERE email = LOWER($1)', [email.trim()]);
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const safeUser = toCamel({
    id: user.id,
    name: user.name,
    email: user.email,
    created_at: user.created_at,
  });
  res.json({ token: signToken(safeUser), user: safeUser });
});

app.get('/api/users', auth, async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, email, created_at FROM users WHERE id <> $1 ORDER BY name ASC',
    [req.user.id],
  );
  res.json(rowsToCamel(result.rows));
});

app.get('/api/dashboard', auth, async (req, res) => {
  const result = await pool.query(
    `
      WITH visible_projects AS (
        SELECT p.*
        FROM projects p
        JOIN project_members pm ON pm.project_id = p.id
        WHERE pm.user_id = $1
      ),
      visible_tasks AS (
        SELECT t.*
        FROM tasks t
        JOIN visible_projects p ON p.id = t.project_id
      )
      SELECT
        (SELECT COUNT(*)::INT FROM visible_projects) AS project_count,
        (SELECT COUNT(*)::INT FROM visible_tasks) AS task_count,
        (SELECT COUNT(*)::INT FROM visible_tasks WHERE status = 'TODO') AS todo_count,
        (SELECT COUNT(*)::INT FROM visible_tasks WHERE status = 'IN_PROGRESS') AS in_progress_count,
        (SELECT COUNT(*)::INT FROM visible_tasks WHERE status = 'DONE') AS done_count,
        (SELECT COUNT(*)::INT FROM visible_tasks WHERE due_date < CURRENT_DATE AND status <> 'DONE') AS overdue_count
    `,
    [req.user.id],
  );

  const tasks = await pool.query(
    `
      SELECT t.*, p.name AS project_name, u.name AS assignee_name
      FROM tasks t
      JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = $1
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assigned_to
      ORDER BY t.due_date NULLS LAST, t.created_at DESC
      LIMIT 12
    `,
    [req.user.id],
  );

  res.json({ ...toCamel(result.rows[0]), tasks: rowsToCamel(tasks.rows) });
});

app.get('/api/projects', auth, async (req, res) => {
  const result = await pool.query(
    `
      SELECT p.*, pm.role,
        COUNT(t.id)::INT AS task_count,
        COUNT(t.id) FILTER (WHERE t.status = 'DONE')::INT AS done_count
      FROM projects p
      JOIN project_members pm ON pm.project_id = p.id
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE pm.user_id = $1
      GROUP BY p.id, pm.role
      ORDER BY p.updated_at DESC
    `,
    [req.user.id],
  );
  res.json(rowsToCamel(result.rows));
});

app.post('/api/projects', auth, async (req, res) => {
  const { name, description } = req.body;
  const missing = requireFields(req.body, ['name']);
  if (missing) return res.status(400).json({ error: missing });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const project = await client.query(
      'INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), description?.trim() || null, req.user.id],
    );
    await client.query(
      'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
      [project.rows[0].id, req.user.id, 'ADMIN'],
    );
    await client.query('COMMIT');
    res.status(201).json({ ...toCamel(project.rows[0]), role: 'ADMIN', taskCount: 0, doneCount: 0 });
  } catch {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Could not create project' });
  } finally {
    client.release();
  }
});

app.get('/api/projects/:id', auth, requireProjectMember, async (req, res) => {
  const project = await pool.query(
    'SELECT p.*, pm.role FROM projects p JOIN project_members pm ON pm.project_id = p.id WHERE p.id = $1 AND pm.user_id = $2',
    [req.params.id, req.user.id],
  );
  if (!project.rows[0]) return res.status(404).json({ error: 'Project not found' });

  const members = await pool.query(
    `
      SELECT pm.role, pm.created_at, u.id, u.name, u.email
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1
      ORDER BY pm.role ASC, u.name ASC
    `,
    [req.params.id],
  );

  const tasks = await pool.query(
    `
      SELECT t.*, u.name AS assignee_name, u.email AS assignee_email
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE t.project_id = $1
      ORDER BY t.created_at DESC
    `,
    [req.params.id],
  );

  res.json({ ...toCamel(project.rows[0]), members: rowsToCamel(members.rows), tasks: rowsToCamel(tasks.rows) });
});

app.post('/api/projects/:projectId/members', auth, requireProjectAdmin, async (req, res) => {
  const { email, role = 'MEMBER' } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'Member email required' });
  if (!['ADMIN', 'MEMBER'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const user = await pool.query('SELECT id, name, email FROM users WHERE email = LOWER($1)', [email.trim()]);
  if (!user.rows[0]) return res.status(404).json({ error: 'User must sign up before being added' });

  try {
    const result = await pool.query(
      `
        INSERT INTO project_members (project_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
        RETURNING role, created_at
      `,
      [req.params.projectId, user.rows[0].id, role],
    );
    res.status(201).json({ ...toCamel(user.rows[0]), ...toCamel(result.rows[0]) });
  } catch {
    res.status(500).json({ error: 'Could not add member' });
  }
});

app.post('/api/projects/:projectId/tasks', auth, requireProjectAdmin, async (req, res) => {
  const { title, description, priority = 'MEDIUM', dueDate, assignedTo } = req.body;
  const missing = requireFields(req.body, ['title']);
  if (missing) return res.status(400).json({ error: missing });
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(priority)) return res.status(400).json({ error: 'Invalid priority' });

  if (assignedTo) {
    const member = await getMembership(req.params.projectId, assignedTo);
    if (!member) return res.status(400).json({ error: 'Assignee must be a project member' });
  }

  const result = await pool.query(
    `
      INSERT INTO tasks (project_id, title, description, priority, due_date, assigned_to, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      req.params.projectId,
      title.trim(),
      description?.trim() || null,
      priority,
      dueDate || null,
      assignedTo || null,
      req.user.id,
    ],
  );
  res.status(201).json(toCamel(result.rows[0]));
});

app.patch('/api/projects/:projectId/tasks/:taskId', auth, requireProjectMember, async (req, res) => {
  const { status, priority, assignedTo } = req.body;
  if (status && !['TODO', 'IN_PROGRESS', 'DONE'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (priority && !['LOW', 'MEDIUM', 'HIGH'].includes(priority)) return res.status(400).json({ error: 'Invalid priority' });

  const task = await pool.query('SELECT * FROM tasks WHERE id = $1 AND project_id = $2', [req.params.taskId, req.params.projectId]);
  if (!task.rows[0]) return res.status(404).json({ error: 'Task not found' });

  const isAdmin = req.membership.role === 'ADMIN';
  const isAssignee = task.rows[0].assigned_to === req.user.id;
  if (!isAdmin && !isAssignee) return res.status(403).json({ error: 'Only admins or the assignee can update this task' });

  if ((priority || assignedTo !== undefined) && !isAdmin) {
    return res.status(403).json({ error: 'Only admins can change task assignment or priority' });
  }

  const result = await pool.query(
    `
      UPDATE tasks
      SET status = COALESCE($1, status),
          priority = COALESCE($2, priority),
          assigned_to = CASE WHEN $3::TEXT IS NULL THEN assigned_to ELSE NULLIF($3, '')::UUID END,
          updated_at = NOW()
      WHERE id = $4 AND project_id = $5
      RETURNING *
    `,
    [status || null, priority || null, assignedTo === undefined ? null : assignedTo, req.params.taskId, req.params.projectId],
  );
  res.json(toCamel(result.rows[0]));
});

app.use(express.static(path.join(__dirname, '..', 'dist')));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Workboard running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database', error);
    process.exit(1);
  });
