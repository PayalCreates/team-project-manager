import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Briefcase,
  CheckCircle2,
  Clock3,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Plus,
  Shield,
  UserPlus,
  Users
} from 'lucide-react';
import './styles.css';

const api = {
  async request(path, options = {}) {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Request failed.');
    return data;
  }
};

const emptyProject = { name: '', description: '', dueDate: '', memberIds: [] };
const emptyTask = { projectId: '', title: '', description: '', assigneeId: '', status: 'todo', priority: 'medium', dueDate: '' };

function App() {
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', role: 'member' });
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [taskForm, setTaskForm] = useState(emptyTask);

  const isAdmin = user?.role === 'admin';

  async function loadApp() {
    if (!user) return;
    setLoading(true);
    setMessage('');
    try {
      const [dashboardData, usersData, projectsData, tasksData] = await Promise.all([
        api.request('/dashboard'),
        user.role === 'admin' ? api.request('/users') : Promise.resolve([]),
        api.request('/projects'),
        api.request('/tasks')
      ]);
      setDashboard(dashboardData);
      setUsers(usersData);
      setProjects(projectsData);
      setTasks(tasksData);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadApp();
  }, [user?.id]);

  const visibleMembers = useMemo(() => users.filter((item) => item.role === 'member'), [users]);
  const availableAssignees = useMemo(() => {
    const project = projects.find((item) => String(item.id) === String(taskForm.projectId));
    return project?.members?.length ? project.members : users;
  }, [projects, taskForm.projectId, users]);

  async function handleAuth(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const payload = authMode === 'login'
        ? { email: authForm.email, password: authForm.password }
        : authForm;
      const data = await api.request(`/auth/${authMode}`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setDashboard(null);
    setProjects([]);
    setTasks([]);
  }

  async function createProject(event) {
    event.preventDefault();
    try {
      await api.request('/projects', {
        method: 'POST',
        body: JSON.stringify({
          ...projectForm,
          memberIds: projectForm.memberIds.map(Number)
        })
      });
      setProjectForm(emptyProject);
      await loadApp();
      setMessage('Project created.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function createTask(event) {
    event.preventDefault();
    try {
      await api.request('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          ...taskForm,
          projectId: Number(taskForm.projectId),
          assigneeId: taskForm.assigneeId ? Number(taskForm.assigneeId) : null
        })
      });
      setTaskForm(emptyTask);
      await loadApp();
      setMessage('Task created.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function updateStatus(taskId, status) {
    try {
      await api.request(`/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await loadApp();
    } catch (error) {
      setMessage(error.message);
    }
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div>
            <div className="brand-row">
              <FolderKanban size={30} />
              <span>Workboard</span>
            </div>
            <h1>Project delivery without the spreadsheet fog.</h1>
            <p>Sign in to manage teams, assign work, and keep progress visible.</p>
          </div>

          <form className="auth-card" onSubmit={handleAuth}>
            <div className="mode-switch">
              <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Login</button>
              <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Signup</button>
            </div>

            {authMode === 'signup' && (
              <>
                <label>
                  Name
                  <input value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} required />
                </label>
                <label>
                  Role
                  <select value={authForm.role} onChange={(e) => setAuthForm({ ...authForm, role: e.target.value })}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              </>
            )}

            <label>
              Email
              <input type="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} required />
            </label>
            <label>
              Password
              <input type="password" minLength="6" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
            </label>
            <button className="primary" disabled={loading}>{loading ? 'Working...' : authMode === 'login' ? 'Login' : 'Create account'}</button>
            {message && <p className="notice">{message}</p>}
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row compact">
          <FolderKanban size={24} />
          <span>Workboard</span>
        </div>
        <nav>
          <a href="#dashboard"><LayoutDashboard size={18} />Dashboard</a>
          <a href="#projects"><Briefcase size={18} />Projects</a>
          <a href="#tasks"><CheckCircle2 size={18} />Tasks</a>
          {isAdmin && <a href="#team"><Users size={18} />Team</a>}
        </nav>
        <div className="profile">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.name}</strong>
            <small><Shield size={13} />{user.role}</small>
          </div>
          <button className="icon-button" onClick={logout} title="Logout"><LogOut size={18} /></button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>Progress dashboard</h1>
            <p>{isAdmin ? 'Manage every project and assignment.' : 'Track the projects and tasks assigned to you.'}</p>
          </div>
          <button className="ghost" onClick={loadApp} disabled={loading}>Refresh</button>
        </header>

        {message && <div className="banner">{message}</div>}

        <section id="dashboard" className="stats-grid">
          <Metric icon={<Briefcase />} label="Projects" value={dashboard?.projects ?? 0} />
          <Metric icon={<CheckCircle2 />} label="Total tasks" value={dashboard?.tasks?.total ?? 0} />
          <Metric icon={<Clock3 />} label="In progress" value={dashboard?.tasks?.in_progress ?? 0} />
          <Metric icon={<Clock3 />} label="Overdue" value={dashboard?.tasks?.overdue ?? 0} tone="danger" />
        </section>

        {isAdmin && (
          <section className="admin-grid">
            <form className="panel" onSubmit={createProject}>
              <h2><Plus size={20} />New project</h2>
              <label>Name<input value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} required /></label>
              <label>Description<textarea value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} /></label>
              <label>Due date<input type="date" value={projectForm.dueDate} onChange={(e) => setProjectForm({ ...projectForm, dueDate: e.target.value })} /></label>
              <label>Members
                <select multiple value={projectForm.memberIds} onChange={(e) => setProjectForm({ ...projectForm, memberIds: [...e.target.selectedOptions].map((option) => option.value) })}>
                  {visibleMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </label>
              <button className="primary">Create project</button>
            </form>

            <form className="panel" onSubmit={createTask}>
              <h2><UserPlus size={20} />New task</h2>
              <label>Project
                <select value={taskForm.projectId} onChange={(e) => setTaskForm({ ...taskForm, projectId: e.target.value, assigneeId: '' })} required>
                  <option value="">Choose project</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label>Title<input value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} required /></label>
              <label>Description<textarea value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} /></label>
              <div className="split">
                <label>Assignee
                  <select value={taskForm.assigneeId} onChange={(e) => setTaskForm({ ...taskForm, assigneeId: e.target.value })}>
                    <option value="">Unassigned</option>
                    {availableAssignees.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </label>
                <label>Priority
                  <select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
              <label>Due date<input type="date" value={taskForm.dueDate} onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })} /></label>
              <button className="primary">Create task</button>
            </form>
          </section>
        )}

        <section id="projects" className="section-block">
          <h2>Projects</h2>
          <div className="project-grid">
            {projects.map((project) => {
              const pct = project.task_count ? Math.round((project.done_count / project.task_count) * 100) : 0;
              return (
                <article className="project-card" key={project.id}>
                  <div>
                    <h3>{project.name}</h3>
                    <p>{project.description || 'No description added.'}</p>
                  </div>
                  <div className="progress-line"><span style={{ width: `${pct}%` }} /></div>
                  <div className="card-meta">
                    <span>{pct}% done</span>
                    <span>{project.members?.length || 0} members</span>
                    <span>{project.due_date ? formatDate(project.due_date) : 'No due date'}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="tasks" className="section-block">
          <h2>Tasks</h2>
          <div className="task-list">
            {tasks.map((task) => (
              <article className={`task-row ${isOverdue(task) ? 'overdue' : ''}`} key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.project_name} - {task.assignee_name || 'Unassigned'} - due {task.due_date ? formatDate(task.due_date) : 'anytime'}</p>
                </div>
                <span className={`priority ${task.priority}`}>{task.priority}</span>
                <select value={task.status} onChange={(e) => updateStatus(task.id, e.target.value)}>
                  <option value="todo">Todo</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                </select>
              </article>
            ))}
          </div>
        </section>

        {isAdmin && (
          <section id="team" className="section-block">
            <h2>Team</h2>
            <div className="team-grid">
              {users.map((member) => (
                <article className="team-card" key={member.id}>
                  <span className="avatar">{member.name.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{member.name}</strong>
                    <p>{member.email}</p>
                  </div>
                  <small>{member.role}</small>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function Metric({ icon, label, value, tone = '' }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </article>
  );
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function isOverdue(task) {
  return task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date(new Date().toDateString());
}

createRoot(document.getElementById('root')).render(<App />);
