const statuses = new Set(['todo', 'in_progress', 'done']);
const priorities = new Set(['low', 'medium', 'high']);
const roles = new Set(['admin', 'member']);

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateAuth(body, mode) {
  const errors = [];
  const name = cleanString(body.name);
  const email = cleanString(body.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const role = cleanString(body.role) || 'member';

  if (mode === 'signup' && name.length < 2) errors.push('Name must be at least 2 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('A valid email is required.');
  if (password.length < 6) errors.push('Password must be at least 6 characters.');
  if (mode === 'signup' && !roles.has(role)) errors.push('Role must be admin or member.');

  return { errors, value: { name, email, password, role } };
}

function validateProject(body) {
  const errors = [];
  const name = cleanString(body.name);
  const description = cleanString(body.description);
  const dueDate = cleanString(body.dueDate) || null;
  const memberIds = Array.isArray(body.memberIds) ? body.memberIds.map(Number).filter(Boolean) : [];

  if (name.length < 3) errors.push('Project name must be at least 3 characters.');
  if (dueDate && Number.isNaN(Date.parse(dueDate))) errors.push('Due date must be valid.');

  return { errors, value: { name, description, dueDate, memberIds } };
}

function validateTask(body) {
  const errors = [];
  const title = cleanString(body.title);
  const description = cleanString(body.description);
  const projectId = Number(body.projectId);
  const assigneeId = body.assigneeId ? Number(body.assigneeId) : null;
  const status = cleanString(body.status) || 'todo';
  const priority = cleanString(body.priority) || 'medium';
  const dueDate = cleanString(body.dueDate) || null;

  if (!Number.isInteger(projectId) || projectId < 1) errors.push('Project is required.');
  if (title.length < 3) errors.push('Task title must be at least 3 characters.');
  if (assigneeId && (!Number.isInteger(assigneeId) || assigneeId < 1)) errors.push('Assignee must be valid.');
  if (!statuses.has(status)) errors.push('Status must be todo, in_progress, or done.');
  if (!priorities.has(priority)) errors.push('Priority must be low, medium, or high.');
  if (dueDate && Number.isNaN(Date.parse(dueDate))) errors.push('Due date must be valid.');

  return { errors, value: { title, description, projectId, assigneeId, status, priority, dueDate } };
}

module.exports = {
  statuses,
  priorities,
  validateAuth,
  validateProject,
  validateTask
};
