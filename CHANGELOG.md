# Changelog

## 1.1.4 - 2026-05-05

- Added task metadata support: `priority`, `due_date`, `tags`, `description`, archival state, and timestamps.
- Added automatic schema bootstrapping for new and existing PostgreSQL databases.
- Added search, filter modes, sort modes, stats modal, task details modal, and undo support.
- Added archived-task flows and overdue/due-soon task handling.
- Added status pie chart to the stats modal.
- Improved column labels for more stable rendering across terminals.
- Added README screenshot and refreshed project documentation.

## 1.1.3 - 2026-05-05

- Reworked modal flows for add, edit, and delete into custom Blessed dialogs.
- Improved terminal theme compatibility by using default foreground/background colors where possible.
- Replaced hard-coded selected-task colors with inverse highlighting for better light-theme support.
- Added bordered modal inputs and actions with explicit keyboard handling, including `Esc` to close active dialogs.
- Expanded project documentation and usage notes in the README.
