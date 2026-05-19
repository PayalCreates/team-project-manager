# Workboard

Full-stack project and task management app with authentication, role-based access control, REST APIs, and PostgreSQL.

## Features

- Signup and login with JWT sessions
- Admin and Member roles
- Admin project creation and team assignment
- Admin task creation, assignment, priority, due date, and status
- Members can view project work and update task status
- Dashboard metrics for projects, task states, and overdue work
- PostgreSQL schema initializes automatically on server startup

## Tech Stack

- React + Vite frontend
- Express REST API
- PostgreSQL database
- JWT auth
- bcrypt password hashing

## Environment Variables

Create these variables locally or in Railway:

```env
DATABASE_URL=postgresql://user:password@host:5432/database
JWT_SECRET=replace-with-a-long-secret
PORT=3000
# Optional for external hosted Postgres that requires SSL:
# PGSSLMODE=require
```

## Local Run

```bash
npm install
npm run build
npm start
```

For frontend-only development:

```bash
npm run dev
```

## Railway Deployment

1. Push this repo to GitHub.
2. Create a Railway project from the GitHub repo.
3. Add a Railway PostgreSQL database.
4. Ensure the app service has `DATABASE_URL` from the PostgreSQL plugin and set `JWT_SECRET`.
5. Railway will run `npm install && npm run build`, then `npm start`.

The server creates all required tables automatically at startup.
