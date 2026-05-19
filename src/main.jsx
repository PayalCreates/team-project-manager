import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CheckCircle2,
  Clock3,
  FolderKanban,
  LogOut,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react';
import './styles.css';

const API = '/api';
const emptyAuth = { token: localStorage.getItem('token'), user: JSON.parse(localStorage.getItem('user') || 'null') };

function classNames(...parts) {
  return parts.filter(Boolean).join(' ');
}

function formatDate(value) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function App() {
  const [auth, setAuth] = useState(emptyAuth);
  const [dashboard, setDashboard] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedProject = useMemo(
    () => selected || projects.find((project) => project.id === selectedId),
    [projects, selected, selectedId],
  );

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        ...options.headers,
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  async function load() {
    if (!auth.token) return;
    setLoading(true);
    setError('');
    try {
      const [dashboardData, projectData] = await Promise.all([request('/dashboard'), request('/projects')]);
      setDashboard(dashboardData);
      setProjects(projectData);
      const nextId = selectedId || projectData[0]?.id || null;
      setSelectedId(nextId);
      if (nextId) {
        setSelected(await request(`/projects/${nextId}`));
      } else {
        setSelected(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [auth.token]);

  useEffect(() => {
    async function loadProject() {
      if (!auth.token || !selectedId) return;
      try {
        setSelected(await request(`/projects/${selectedId}`));
      } catch (err) {
        setError(err.message);
      }
    }
    loadProject();
  }, [selectedId]);

  function login(nextAuth) {
    localStorage.setItem('token', nextAuth.token);
    localStorage.setItem('user', JSON.stringify(nextAuth.user));
    setAuth(nextAuth);
  }

  function logout() {
    localStorage.clear();
    setAuth({ token: null, user: null });
    setDashboard(null);
    setProjects([]);
    setSelected(null);
  }

  if (!auth.token) {
    return <AuthScreen onAuth={login} />;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <FolderKanban size={26} />
          <div>
            <strong>Workboard</strong>
            <span>Team Task Manager</span>
          </div>
        </div>

        <button className="new-project" onClick={() => setSelectedId('new')}>
          <Plus size={18} />
          New project
        </button>

        <nav className="project-list" aria-label="Projects">
          {projects.map((project) => (
            <button
              key={project.id}
              className={classNames('project-link', selectedId === project.id && 'active')}
              onClick={() => setSelectedId(project.id)}
            >
              <span>{project.name}</span>
              <small>{project.role}</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p>Signed in as</p>
            <strong>{auth.user?.name}</strong>
          </div>
          <button className="icon-button" onClick={logout} title="Log out" aria-label="Log out">
            <LogOut size={19} />
          </button>
        </header>

        {error && <div className="notice">{error}</div>}

        <Dashboard dashboard={dashboard} loading={loading} />

        {selectedId === 'new' ? (
          <ProjectForm request={request} onCreated={(project) => {
            setProjects([project, ...projects]);
            setSelectedId(project.id);
            load();
          }} />
        ) : selectedProject ? (
          <ProjectDetail project={selectedProject} request={request} refresh={load} />
        ) : (
          <EmptyState onCreate={() => setSelectedId('new')} />
        )}
      </section>
    </main>
  );
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      onAuth(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand auth-brand">
          <FolderKanban size={30} />
          <div>
            <strong>Workboard</strong>
            <span>Projects, people, progress</span>
          </div>
        </div>
        <div className="segmented">
          <button className={mode === 'login' ? 'selected' : ''} onClick={() => setMode('login')}>Login</button>
          <button className={mode === 'signup' ? 'selected' : ''} onClick={() => setMode('signup')}>Signup</button>
        </div>
        <form onSubmit={submit} className="form">
          {mode === 'signup' && (
            <label>
              Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
          )}
          <label>
            Email
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>
            Password
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          </label>
          {error && <div className="notice">{error}</div>}
          <button className="primary" disabled={busy}>{busy ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}</button>
        </form>
      </section>
    </main>
  );
}

function Dashboard({ dashboard, loading }) {
  const stats = [
    ['Projects', dashboard?.projectCount || 0, FolderKanban],
    ['Tasks', dashboard?.taskCount || 0, CheckCircle2],
    ['In progress', dashboard?.inProgressCount || 0, Clock3],
    ['Overdue', dashboard?.overdueCount || 0, ShieldCheck],
  ];

  return (
    <section className="dashboard">
      {stats.map(([label, value, Icon]) => (
        <article className="stat" key={label}>
          <Icon size={20} />
          <span>{label}</span>
          <strong>{loading ? '-' : value}</strong>
        </article>
      ))}
    </section>
  );
}

function ProjectForm({ request, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '' });
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const project = await request('/projects', { method: 'POST', body: JSON.stringify(form) });
      onCreated(project);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="panel">
      <h1>Create project</h1>
      <form className="form grid-form" onSubmit={submit}>
        <label>
          Project name
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label>
          Description
          <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
        {error && <div className="notice">{error}</div>}
        <button className="primary">Create project</button>
      </form>
    </section>
  );
}

function ProjectDetail({ project, request, refresh }) {
  const isAdmin = project.role === 'ADMIN';
  const [memberForm, setMemberForm] = useState({ email: '', role: 'MEMBER' });
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'MEDIUM', dueDate: '', assignedTo: '' });
  const progress = project.tasks?.length ? Math.round((project.tasks.filter((task) => task.status === 'DONE').length / project.tasks.length) * 100) : 0;

  async function addMember(event) {
    event.preventDefault();
    await request(`/projects/${project.id}/members`, { method: 'POST', body: JSON.stringify(memberForm) });
    setMemberForm({ email: '', role: 'MEMBER' });
    refresh();
  }

  async function addTask(event) {
    event.preventDefault();
    await request(`/projects/${project.id}/tasks`, { method: 'POST', body: JSON.stringify(taskForm) });
    setTaskForm({ title: '', description: '', priority: 'MEDIUM', dueDate: '', assignedTo: '' });
    refresh();
  }

  async function updateTask(task, status) {
    await request(`/projects/${project.id}/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    refresh();
  }

  return (
    <section className="project-view">
      <div className="project-heading">
        <div>
          <span className="role-pill">{project.role}</span>
          <h1>{project.name}</h1>
          <p>{project.description || 'No description yet.'}</p>
        </div>
        <div className="progress-ring">
          <strong>{progress}%</strong>
          <span>Done</span>
        </div>
      </div>

      <div className="content-grid">
        <section className="panel">
          <h2>Tasks</h2>
          <div className="task-list">
            {project.tasks?.map((task) => (
              <article className={classNames('task-card', task.status.toLowerCase())} key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.description || 'No description'}</p>
                </div>
                <div className="task-meta">
                  <span>{task.priority}</span>
                  <span>{formatDate(task.dueDate)}</span>
                  <span>{task.assigneeName || 'Unassigned'}</span>
                </div>
                <select value={task.status} onChange={(event) => updateTask(task, event.target.value)}>
                  <option value="TODO">Todo</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="DONE">Done</option>
                </select>
              </article>
            ))}
            {!project.tasks?.length && <p className="muted">No tasks yet.</p>}
          </div>
        </section>

        <aside className="side-stack">
          {isAdmin && (
            <section className="panel">
              <h2>New task</h2>
              <form className="form" onSubmit={addTask}>
                <input placeholder="Task title" value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} />
                <textarea placeholder="Details" value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} />
                <select value={taskForm.assignedTo} onChange={(event) => setTaskForm({ ...taskForm, assignedTo: event.target.value })}>
                  <option value="">Unassigned</option>
                  {project.members?.map((member) => (
                    <option key={member.id} value={member.id}>{member.name}</option>
                  ))}
                </select>
                <div className="two-col">
                  <select value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })}>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                  <input type="date" value={taskForm.dueDate} onChange={(event) => setTaskForm({ ...taskForm, dueDate: event.target.value })} />
                </div>
                <button className="primary">Add task</button>
              </form>
            </section>
          )}

          <section className="panel">
            <h2><Users size={18} /> Team</h2>
            <div className="member-list">
              {project.members?.map((member) => (
                <div className="member" key={member.id}>
                  <span>{member.name}</span>
                  <small>{member.role}</small>
                </div>
              ))}
            </div>
            {isAdmin && (
              <form className="form compact" onSubmit={addMember}>
                <input placeholder="Member email" value={memberForm.email} onChange={(event) => setMemberForm({ ...memberForm, email: event.target.value })} />
                <select value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })}>
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <button>Add member</button>
              </form>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

function EmptyState({ onCreate }) {
  return (
    <section className="empty">
      <FolderKanban size={42} />
      <h1>No projects yet</h1>
      <button className="primary" onClick={onCreate}>Create your first project</button>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
