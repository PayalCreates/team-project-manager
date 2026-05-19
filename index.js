require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { initDb, query } = require('./db');
const { requireAuth, requireAdmin, signToken } = require('./middleware');
const { validateAuth, validateProject, validateTask, statuses } = require('./validators');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

function sendValidation(res, errors) {
  return res.status(400).json({ message: errors.join(' ') });
}

function serializeUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at
  };
}

async function canAccessProject(user, projectId) {
  if (user.role === 'admin') return true;
  const result = await query(
    'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, user.id]
  );
  return result.rowCount > 0;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'workboard-api' });
});

app.post('/api/auth/signup', async (req, res) => {
  const { errors, value } = validateAuth(req.body, 'signup');
  if (errors.length) return sendValidation(res, errors);

  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [value.email]);
    if (existing.rowCount) return res.status(409).json({ message: 'Email is already registered.' });

    const passwordHash = await bcrypt.hash(value.password, 12);
    const result = await query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
      [value.name, value.email, passwordHash, value.role]
    );
    const user = serializeUser(result.rows[0]);
    return res.status(201).json({ user, token: signToken(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Unable to create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { errors, value } = validateAuth(req.body, 'login');
  if (errors.length) return sendValidation(res, errors);

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [value.email]);
    const userRow = result.rows[0];
    if (!userRow) return res.status(401).json({ message: 'Invalid email or password.' });

    const isMatch = await bcrypt.compare(value.password, userRow.password_hash);
    if (!isMatch) return res.status(401).json({ message: 'Invalid email or password.' });

    const user = serializeUser(userRow);
    return res.json({ user, token: signToken(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Unable to sign in.' });
  }
});

app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  const result = await query(
    'SELECT id, name, email, role, created_at FROM users ORDER BY name ASC'
  );
  res.json(result.rows.map(serializeUser));
});

app.get('/api/projects', requireAuth, async (req, res) => {
  const where = req.user.role === 'admin'
    ? ''
    : 'WHERE p.id IN (SELECT project_id FROM project_members WHERE user_id = $1)';
  const params = req.user.role === 'admin' ? [] : [req.user.id];
  const result = await query(
    `
      SELECT
        p.*,
        u.name AS owner_name,
        COUNT(DISTINCT t.id)::int AS task_count,
        COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END)::int AS done_count,
        COALESCE(
          JSON_AGG(DISTINCT JSONB_BUILD_OBJECT('id', m.id, 'name', m.name, 'email', m.email, 'role', m.role))
          FILTER (WHERE m.id IS NOT NULL),
          '[]'
        ) AS members
      FROM projects p
      JOIN users u ON u.id = p.owner_id
      LEFT JOIN project_members pm ON pm.project_id = p.id
      LEFT JOIN users m ON m.id = pm.user_id
      LEFT JOIN tasks t ON t.project_id = p.id
      ${where}
      GROUP BY p.id, u.name
      ORDER BY p.created_at DESC
    `,
    params
  );
  res.json(result.rows);
});

app.post('/api/projects', requireAuth, requireAdmin, async (req, res) => {
  const { errors, value } = validateProject(req.body);
  if (errors.length) return sendValidation(res, errors);

  const client = await require('./db').pool.connect();
  try {
    await client.query('BEGIN');
    const project = await client.query(
      'INSERT INTO projects (name, description, due_date, owner_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [value.name, value.description, value.dueDate, req.user.id]
    );
    const projectId = project.rows[0].id;
    const uniqueMembers = [...new Set([req.user.id, ...value.memberIds])];
    for (const userId of uniqueMembers) {
      await client.query(
        'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [projectId, userId]
      );
    }
    await client.query('COMMIT');
    return res.status(201).json(project.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ message: 'Unable to create project.' });
  } finally {
    client.release();
  }
});

app.put('/api/projects/:id/members', requireAuth, requireAdmin, async (req, res) => {
  const projectId = Number(req.params.id);
  const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(Number).filter(Boolean) : [];
  if (!projectId || !memberIds.length) return res.status(400).json({ message: 'Project and members are required.' });

  const exists = await query('SELECT id FROM projects WHERE id = $1', [projectId]);
  if (!exists.rowCount) return res.status(404).json({ message: 'Project not found.' });

  for (const userId of [...new Set(memberIds)]) {
    await query(
      'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [projectId, userId]
    );
  }
  res.json({ message: 'Members updated.' });
});

app.get('/api/tasks', requireAuth, async (req, res) => {
  const params = [];
  let where = '';
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    where = 'WHERE t.assignee_id = $1 OR t.project_id IN (SELECT project_id FROM project_members WHERE user_id = $1)';
  }
  const result = await query(
    `
      SELECT
        t.*,
        p.name AS project_name,
        a.name AS assignee_name,
        c.name AS creator_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN users a ON a.id = t.assignee_id
      JOIN users c ON c.id = t.created_by
      ${where}
      ORDER BY
        CASE WHEN t.status = 'done' THEN 1 ELSE 0 END,
        t.due_date ASC NULLS LAST,
        t.created_at DESC
    `,
    params
  );
  res.json(result.rows);
});

app.post('/api/tasks', requireAuth, requireAdmin, async (req, res) => {
  const { errors, value } = validateTask(req.body);
  if (errors.length) return sendValidation(res, errors);

  const project = await query('SELECT id FROM projects WHERE id = $1', [value.projectId]);
  if (!project.rowCount) return res.status(404).json({ message: 'Project not found.' });

  if (value.assigneeId) {
    const member = await query(
      'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2',
      [value.projectId, value.assigneeId]
    );
    if (!member.rowCount) return res.status(400).json({ message: 'Assignee must belong to the project.' });
  }

  const result = await query(
    `
      INSERT INTO tasks (project_id, title, description, assignee_id, status, priority, due_date, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      value.projectId,
      value.title,
      value.description,
      value.assigneeId,
      value.status,
      value.priority,
      value.dueDate,
      req.user.id
    ]
  );
  res.status(201).json(result.rows[0]);
});

app.patch('/api/tasks/:id/status', requireAuth, async (req, res) => {
  const taskId = Number(req.params.id);
  const status = typeof req.body.status === 'string' ? req.body.status : '';

  if (!taskId || !statuses.has(status)) {
    return res.status(400).json({ message: 'A valid task status is required.' });
  }

  const taskResult = await query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  const task = taskResult.rows[0];
  if (!task) return res.status(404).json({ message: 'Task not found.' });

  const canEdit = req.user.role === 'admin' || task.assignee_id === req.user.id || await canAccessProject(req.user, task.project_id);
  if (!canEdit) return res.status(403).json({ message: 'You cannot update this task.' });

  const result = await query('UPDATE tasks SET status = $1 WHERE id = $2 RETURNING *', [status, taskId]);
  res.json(result.rows[0]);
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  const params = [];
  let scope = '';
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    scope = 'WHERE t.assignee_id = $1 OR t.project_id IN (SELECT project_id FROM project_members WHERE user_id = $1)';
  }

  const result = await query(
    `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'todo')::int AS todo,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'done')::int AS done,
        COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status != 'done')::int AS overdue
      FROM tasks t
      ${scope}
    `,
    params
  );

  const projects = await query(
    req.user.role === 'admin'
      ? 'SELECT COUNT(*)::int AS count FROM projects'
      : 'SELECT COUNT(*)::int AS count FROM project_members WHERE user_id = $1',
    params
  );

  res.json({
    tasks: result.rows[0],
    projects: projects.rows[0].count
  });
});

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`Workboard server running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });
