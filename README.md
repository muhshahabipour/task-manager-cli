# Task Manager CLI

Interactive Kanban-style task manager for terminal users.

## Features

- Three-column workflow: `To Do`, `In Progress`, `Done`
- Keyboard-first navigation
- Add, edit, delete, move, and reorder tasks
- PostgreSQL-backed persistence
- Terminal-theme-aware rendering for light and dark shells
- Modal dialogs for add, edit, and delete flows

## Requirements

- Node.js `18+`
- PostgreSQL
- An interactive terminal with TTY support

## Install

### Global install

```bash
npm install -g @saszorg/task-manager-cli
task-manager-cli
```

### Local development

```bash
npm install
npm start
```

## Database Configuration

Use one of these approaches:

1. `DATABASE_URL`
2. Standard PG env vars: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

Example:

```bash
export DATABASE_URL="postgres://admin:admin@localhost:5432/tasks_db"
```

Or:

```bash
export PGHOST=localhost
export PGPORT=5432
export PGUSER=admin
export PGPASSWORD=admin
export PGDATABASE=tasks_db
```

## Expected Schema

The app expects a `tasks` table with these core columns:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  position INTEGER NOT NULL
);
```

## CLI Options

```bash
task-manager-cli --help
task-manager-cli --version
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

## Development

```bash
npm test
```

This currently runs syntax checks for the CLI entry points.

## Notes

- The app requires a real TTY and will exit early in non-interactive environments.
- Task ordering is preserved per column using the `position` field.
- Current persistence is intentionally simple so the TUI remains fast and predictable.
