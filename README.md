# Task Manager CLI

Interactive Kanban-style task manager for the terminal, backed by PostgreSQL.

## Screenshot

![Task Manager CLI](docs/screenshot.svg)

## Features

- Three-column workflow: `TODO`, `DOING`, `DONE`
- Keyboard-first task movement and selection
- Add, edit, delete, archive, and undo task actions
- Priority, due date, notes, and tags for each task
- Search, filter, sort, and stats views
- Automatic PostgreSQL schema bootstrapping on startup
- Theme-friendly terminal rendering for light and dark shells

## Requirements

- Node.js `18+`
- PostgreSQL
- Interactive terminal with TTY support

## Install

### Global

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

Supported connection methods:

1. `DATABASE_URL`
2. Standard PostgreSQL env vars: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`

Example with `DATABASE_URL`:

```bash
export DATABASE_URL="postgres://admin:admin@localhost:5432/tasks_db"
```

Example with individual env vars:

```bash
export PGHOST=localhost
export PGPORT=5432
export PGUSER=admin
export PGPASSWORD=admin
export PGDATABASE=tasks_db
```

## Schema

The app creates or upgrades the `tasks` table automatically. Current shape:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  position INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  due_date DATE,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## CLI

```bash
task-manager-cli --help
task-manager-cli --version
```

## Controls

- `←/→`: switch column
- `↑/↓`: select task
- `j/k`: reorder task in manual sort mode
- `Enter`: move task to next status
- `a`: add task
- `e`: edit task title
- `i`: open task details
- `/`: search tasks
- `f`: cycle filters
- `o`: cycle sort modes
- `x`: archive or unarchive current task
- `u`: undo last action
- `s`: open stats modal
- `d`: delete task
- `q` or `Ctrl+C`: quit

## Task Details

The details modal supports:

- Title
- Notes
- Priority
- Tags
- Due date
- Archive state

## Filters

- Active
- High priority
- Overdue
- Due soon
- Archived

## Sort Modes

- Manual
- Priority
- Due date
- Created time

## Development

```bash
npm test
```

Current automated verification is syntax checking for the CLI entry points.

## Notes

- The app exits early outside a real TTY.
- Manual reordering is only available in `Active` filter mode with no search query and `Manual` sort selected.
- Archived tasks stay in the database and can be restored later.
