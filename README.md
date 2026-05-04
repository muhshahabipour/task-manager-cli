# Task Manager CLI

Interactive Kanban-style task manager for terminal users.

## Features

- Three-column workflow: `To Do`, `In Progress`, `Done`
- Keyboard-first navigation
- Add, edit, delete, move, and reorder tasks
- PostgreSQL-backed persistence

## Installation

```bash
npm install
```

## GitHub Setup

```bash
git init
git add .
git commit -m "feat: initial release"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## Configuration

Use one of these approaches:

1. `DATABASE_URL`
2. Standard PG env vars: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

Example:

```bash
export DATABASE_URL="postgres://admin:admin@localhost:5432/tasks_db"
```

## Run

```bash
npm start
```

## CLI

```bash
task-manager-cli --help
task-manager-cli --version
```

## Global Install (Published Package)

```bash
npm install -g @saszorg/task-manager-cli
task-manager-cli
```

## Controls

- `←/→`: switch column
- `↑/↓`: select task
- `j/k`: reorder task
- `Enter`: move task to next status
- `a`: add task
- `e`: edit task
- `d`: delete task
- `q` or `Ctrl+C`: quit
