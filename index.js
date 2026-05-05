#!/usr/bin/env node

const blessed = require("blessed");
const { v4: uuidv4 } = require("uuid");
const pool = require("./db");
const packageJson = require("./package.json");

const STATUS_ORDER = ["todo", "doing", "done"];
const PRIORITY_ORDER = ["low", "medium", "high"];
const FILTER_MODES = ["active", "high", "overdue", "due-soon", "archived"];
const SORT_MODES = ["manual", "priority", "due", "created"];
const DUE_SOON_DAYS = 3;

const HELP_TEXT = `
Task Manager CLI

Usage:
  task-manager-cli [options]

Options:
  -h, --help       Show help
  -v, --version    Show version

Keyboard Shortcuts:
  ←/→    Switch column
  ↑/↓    Select task
  j/k    Reorder task in manual mode
  Enter  Move task to next status
  a      Add task
  e      Edit title
  i      Task details
  /      Search tasks
  f      Cycle filters
  o      Cycle sort modes
  x      Archive or unarchive
  u      Undo last action
  s      Show stats
  d      Delete task
  q      Quit
`.trim();

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(HELP_TEXT);
  process.exit(0);
}

if (args.includes("-v") || args.includes("--version")) {
  console.log(packageJson.version);
  process.exit(0);
}

if (!process.stdout.isTTY) {
  console.error("This app needs an interactive terminal (TTY).");
  process.exit(1);
}

const ensureSchema = async () => {
  await pool.query(`
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
    )
  `);

  const statements = [
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium'",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[]",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP",
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }
};

const normalizeTask = (task) => ({
  ...task,
  description: task.description || "",
  priority: PRIORITY_ORDER.includes(task.priority) ? task.priority : "medium",
  due_date: normalizeStoredDate(task.due_date),
  tags: Array.isArray(task.tags) ? task.tags.filter(Boolean) : [],
  archived: Boolean(task.archived),
  archived_at: task.archived_at || null,
  completed_at: task.completed_at || null,
  created_at: task.created_at || null,
  updated_at: task.updated_at || null,
});

// ===== DB =====
const getTasks = async () => {
  const res = await pool.query("SELECT * FROM tasks");
  return res.rows.map(normalizeTask);
};

const getNextPosition = async (status) => {
  const res = await pool.query(
    "SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM tasks WHERE status = $1",
    [status]
  );
  return Number(res.rows[0].pos);
};

const addTask = async ({
  title,
  description = "",
  priority = "medium",
  dueDate = null,
  tags = [],
}) => {
  const pos = await getNextPosition("todo");
  const res = await pool.query(
    `INSERT INTO tasks (
      id, title, status, position, description, priority, due_date, tags
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [uuidv4(), title, "todo", pos, description, priority, dueDate, tags]
  );
  return normalizeTask(res.rows[0]);
};

const deleteTask = async (id) => {
  await pool.query("DELETE FROM tasks WHERE id = $1", [id]);
};

const updateTaskFields = async (id, fields) => {
  const mapping = {
    title: "title",
    status: "status",
    position: "position",
    description: "description",
    priority: "priority",
    dueDate: "due_date",
    tags: "tags",
    archived: "archived",
    archivedAt: "archived_at",
    completedAt: "completed_at",
  };

  const sets = [];
  const values = [];

  Object.entries(fields).forEach(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(mapping, key)) return;
    values.push(value);
    sets.push(`${mapping[key]} = $${values.length}`);
  });

  if (!sets.length) return;

  values.push(id);

  await pool.query(
    `UPDATE tasks
     SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${values.length}`,
    values
  );
};

const updateStatus = async (id, status) => {
  const pos = await getNextPosition(status);
  await pool.query(
    `UPDATE tasks
     SET status = $1,
         position = $2,
         completed_at = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [status, pos, status === "done" ? new Date() : null, id]
  );
};

const reorderColumn = async (orderedIds) => {
  for (let i = 0; i < orderedIds.length; i += 1) {
    await pool.query(
      "UPDATE tasks SET position = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [i + 1, orderedIds[i]]
    );
  }
};

const insertTaskSnapshot = async (task) => {
  await pool.query(
    `INSERT INTO tasks (
      id, title, status, position, description, priority, due_date, tags,
      archived, archived_at, completed_at, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13
    )`,
    [
      task.id,
      task.title,
      task.status,
      task.position,
      task.description || "",
      task.priority || "medium",
      task.due_date || null,
      task.tags || [],
      Boolean(task.archived),
      task.archived_at || null,
      task.completed_at || null,
      task.created_at || new Date(),
      task.updated_at || new Date(),
    ]
  );
};

const restoreTaskSnapshot = async (task) => {
  await updateTaskFields(task.id, {
    title: task.title,
    status: task.status,
    position: task.position,
    description: task.description || "",
    priority: task.priority || "medium",
    dueDate: task.due_date || null,
    tags: task.tags || [],
    archived: Boolean(task.archived),
    archivedAt: task.archived_at || null,
    completedAt: task.completed_at || null,
  });
};

// ===== UI =====
const screen = blessed.screen({
  smartCSR: true,
  title: "Task Manager CLI",
});
screen.program.enableMouse();

const createModal = ({
  label,
  width = "50%",
  height = 10,
  borderColor = "cyan",
}) =>
  blessed.box({
    parent: screen,
    label,
    tags: true,
    border: "line",
    width,
    height,
    top: "center",
    left: "center",
    keys: true,
    mouse: true,
    style: {
      fg: "default",
      bg: "default",
      border: { fg: borderColor },
    },
  });

const createModalButton = ({
  parent,
  top,
  left,
  width,
  content,
  borderColor,
}) => {
  const button = blessed.box({
    parent,
    mouse: true,
    clickable: true,
    keyable: true,
    top,
    left,
    width,
    height: 3,
    align: "center",
    valign: "middle",
    content,
    border: "line",
    style: {
      fg: "default",
      bg: "default",
      border: { fg: borderColor },
      focus: {
        fg: "default",
        bg: "default",
        border: { fg: borderColor },
        inverse: true,
      },
    },
  });

  button.on("keypress", (ch, key) => {
    if (key.name === "enter" || key.name === "space") {
      button.emit("press");
    }
  });

  button.on("click", () => {
    button.emit("press");
  });

  return button;
};

const createColumn = (label, left) =>
  blessed.box({
    label,
    tags: true,
    top: 3,
    left,
    width: "33%",
    bottom: 3,
    border: "line",
    style: {
      border: { fg: "gray" },
      fg: "default",
    },
  });

const header = blessed.box({
  top: 0,
  left: 0,
  width: "100%",
  height: 3,
  tags: true,
  align: "center",
  valign: "middle",
  style: { fg: "default" },
});

const footer = blessed.box({
  bottom: 0,
  left: 0,
  width: "100%",
  height: 3,
  tags: true,
  align: "center",
  valign: "middle",
  style: { fg: "gray" },
});

const todoBox = createColumn(" TODO 0 ", "0%");
const doingBox = createColumn(" DOING 0 ", "33%");
const doneBox = createColumn(" DONE 0 ", "66%");
const toast = blessed.message({
  parent: screen,
  border: "line",
  tags: true,
  hidden: true,
  top: "center",
  left: "center",
  width: "50%",
  height: "shrink",
  align: "center",
  valign: "middle",
  style: {
    border: { fg: "cyan" },
    fg: "default",
    bg: "default",
  },
});

screen.append(header);
screen.append(todoBox);
screen.append(doingBox);
screen.append(doneBox);
screen.append(footer);

let tasks = [];
let selectedIndex = 0;
let currentColumn = "todo";
let activeModal = null;
let closeActiveModal = null;
let searchQuery = "";
let filterMode = "active";
let sortMode = "manual";
let undoStack = [];

// ===== helpers =====
const priorityWeight = (priority) => PRIORITY_ORDER.indexOf(priority || "medium");
const getTodayDate = () => new Date().toISOString().slice(0, 10);

function normalizeStoredDate(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}

const normalizeDateInput = (value) => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10) === value ? value : null;
};

const formatTimestamp = (value) => {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toISOString().replace("T", " ").slice(0, 16);
};

const formatDate = (value) => value || "N/A";
const truncate = (value, length = 30) =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value;
const parseTags = (value) =>
  [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];

const cloneTask = (task) => ({
  ...task,
  tags: [...(task.tags || [])],
});

const getFilterLabel = () => {
  switch (filterMode) {
    case "high":
      return "High Priority";
    case "overdue":
      return "Overdue";
    case "due-soon":
      return "Due Soon";
    case "archived":
      return "Archived";
    default:
      return "Active";
  }
};

const getSortLabel = () => {
  switch (sortMode) {
    case "priority":
      return "Priority";
    case "due":
      return "Due Date";
    case "created":
      return "Created";
    default:
      return "Manual";
  }
};

const isOverdue = (task) =>
  Boolean(
    task.due_date &&
      task.due_date < getTodayDate() &&
      task.status !== "done" &&
      !task.archived
  );

const isDueSoon = (task) => {
  if (!task.due_date || task.archived || task.status === "done") return false;
  const today = new Date(`${getTodayDate()}T00:00:00Z`);
  const due = new Date(`${task.due_date}T00:00:00Z`);
  const diff = Math.floor((due - today) / (24 * 60 * 60 * 1000));
  return diff >= 0 && diff <= DUE_SOON_DAYS;
};

const summarizeTask = (task) => {
  const parts = [task.title];

  if (task.priority === "high") parts.push("[H]");
  if (task.priority === "low") parts.push("[L]");
  if (task.due_date) {
    parts.push(isOverdue(task) ? `[OVERDUE ${task.due_date}]` : `[DUE ${task.due_date}]`);
  }
  if (task.tags.length) {
    parts.push(task.tags.slice(0, 2).map((tag) => `#${tag}`).join(" "));
  }
  if (task.archived) {
    parts.push("[ARCHIVED]");
  }

  return truncate(parts.join(" "), 34);
};

const getStatusChartSegments = () => [
  { key: "todo", label: "To Do", color: "cyan" },
  { key: "doing", label: "In Progress", color: "yellow" },
  { key: "done", label: "Done", color: "green" },
];

const buildStatusPieChart = (counts) => {
  const segments = getStatusChartSegments().map((segment) => ({
    ...segment,
    count: counts[segment.key] || 0,
  }));
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);

  if (!total) {
    return "{gray-fg}No active tasks to chart{/gray-fg}";
  }

  const rows = 11;
  const cols = 23;
  const radiusY = rows / 2;
  const radiusX = cols / 2;
  const centerY = (rows - 1) / 2;
  const centerX = (cols - 1) / 2;

  let running = 0;
  const boundaries = segments.map((segment) => {
    running += segment.count / total;
    return running;
  });

  const lines = [];

  for (let y = 0; y < rows; y += 1) {
    let line = "";

    for (let x = 0; x < cols; x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      const distance = dx * dx + dy * dy;

      if (distance > 1) {
        line += "  ";
        continue;
      }

      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const ratio = angle / (Math.PI * 2);
      const index = boundaries.findIndex((boundary) => ratio <= boundary);
      const segment = segments[index === -1 ? segments.length - 1 : index];
      line += `{${segment.color}-fg}@@{/${segment.color}-fg}`;
    }

    lines.push(line);
  }

  const legend = segments
    .map((segment) => {
      const percentage = ((segment.count / total) * 100).toFixed(0);
      return `{${segment.color}-fg}@@{/${segment.color}-fg} ${segment.label}: ${segment.count} (${percentage}%)`;
    })
    .join("\n");

  return `${lines.join("\n")}\n\n${legend}`;
};

const compareStrings = (left, right) => left.localeCompare(right);
const compareDatesAsc = (left, right) => {
  const a = left || "9999-12-31";
  const b = right || "9999-12-31";
  return compareStrings(a, b);
};

const sortTasks = (list) => {
  const sorted = [...list];

  sorted.sort((left, right) => {
    if (sortMode === "priority") {
      const priorityDelta = priorityWeight(right.priority) - priorityWeight(left.priority);
      if (priorityDelta !== 0) return priorityDelta;
      const dueDelta = compareDatesAsc(left.due_date, right.due_date);
      if (dueDelta !== 0) return dueDelta;
    } else if (sortMode === "due") {
      const dueDelta = compareDatesAsc(left.due_date, right.due_date);
      if (dueDelta !== 0) return dueDelta;
      const priorityDelta = priorityWeight(right.priority) - priorityWeight(left.priority);
      if (priorityDelta !== 0) return priorityDelta;
    } else if (sortMode === "created") {
      const leftCreated = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightCreated = right.created_at ? new Date(right.created_at).getTime() : 0;
      if (rightCreated !== leftCreated) return rightCreated - leftCreated;
    }

    return left.position - right.position;
  });

  return sorted;
};

const matchesSearch = (task) => {
  if (!searchQuery) return true;
  const haystack = [
    task.title,
    task.description,
    task.priority,
    task.due_date || "",
    task.tags.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchQuery.toLowerCase());
};

const matchesFilter = (task) => {
  switch (filterMode) {
    case "high":
      return !task.archived && task.priority === "high";
    case "overdue":
      return isOverdue(task);
    case "due-soon":
      return isDueSoon(task);
    case "archived":
      return task.archived;
    default:
      return !task.archived;
  }
};

const getVisibleColumnTasks = (column = currentColumn) =>
  sortTasks(
    tasks.filter(
      (task) =>
        task.status === column && matchesFilter(task) && matchesSearch(task)
    )
  );

const getCurrentTask = () => getVisibleColumnTasks()[selectedIndex];

const canManualReorder = () =>
  sortMode === "manual" && filterMode === "active" && !searchQuery;

const showToast = (text, type = "info", duration = 1.6) => {
  screen.append(toast);
  toast.style.border.fg =
    type === "error" ? "red" : type === "success" ? "green" : "cyan";
  toast.display(text, duration, () => {});
};

const trimValue = (value) => (typeof value === "string" ? value.trim() : "");
const isModalOpen = () => activeModal !== null;

const setModalState = (modal, closeFn) => {
  activeModal = modal;
  closeActiveModal = closeFn;
  screen.saveFocus();
};

const clearModalState = (modal) => {
  if (!activeModal || activeModal !== modal) return;
  activeModal = null;
  closeActiveModal = null;
  modal.destroy();
  screen.restoreFocus();
  render();
};

const loadTasks = async () => {
  tasks = await getTasks();
};

const pushUndo = (label, undo) => {
  undoStack.push({ label, undo });
  if (undoStack.length > 30) {
    undoStack = undoStack.slice(-30);
  }
};

const undoLastAction = async () => {
  if (!undoStack.length) {
    showToast("Nothing to undo");
    return;
  }

  const entry = undoStack.pop();

  try {
    await entry.undo();
    await loadTasks();
    render();
    showToast(`Undid ${entry.label}`, "success");
  } catch (err) {
    showToast(`Undo failed: ${err.message}`, "error", 2.2);
  }
};

const updateTaskWithUndo = async ({
  taskId,
  fields,
  label,
  successMessage,
}) => {
  const previous = cloneTask(tasks.find((task) => task.id === taskId));
  await updateTaskFields(taskId, fields);
  pushUndo(label, async () => restoreTaskSnapshot(previous));
  await loadTasks();
  render();
  if (successMessage) showToast(successMessage, "success");
};

const openTextModal = ({
  label,
  promptText,
  initialValue = "",
  accent,
  onSubmit,
  allowEmpty = false,
  validate,
}) => {
  if (isModalOpen()) return;

  const modal = createModal({ label, borderColor: accent, height: 11 });
  blessed.box({
    parent: modal,
    top: 1,
    left: 2,
    right: 2,
    height: 1,
    content: promptText,
    style: { fg: "default", bg: "default" },
  });

  const inputFrame = blessed.box({
    parent: modal,
    top: 3,
    left: 2,
    right: 2,
    height: 3,
    border: "line",
    style: {
      fg: "default",
      bg: "default",
      border: { fg: "gray" },
    },
  });

  const input = blessed.textbox({
    parent: inputFrame,
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    inputOnFocus: false,
    keys: true,
    mouse: true,
    style: {
      fg: "default",
      bg: "default",
    },
  });

  const submitButton = createModalButton({
    parent: modal,
    top: 6,
    left: 2,
    width: 10,
    content: " Save ",
    borderColor: accent,
  });

  const cancelButton = createModalButton({
    parent: modal,
    top: 6,
    left: 14,
    width: 12,
    content: " Cancel ",
    borderColor: "gray",
  });

  input.setValue(initialValue);

  const closeModal = () => clearModalState(modal);
  const cancel = () => closeModal();

  const submit = async () => {
    const rawValue = input.getValue();
    const value = trimValue(rawValue);

    if (!allowEmpty && !value) {
      showToast("Value is required", "error");
      return;
    }

    let normalized = value;

    if (validate) {
      const result = validate(value);
      if (result && result.error) {
        showToast(result.error, "error");
        return;
      }
      if (result && Object.prototype.hasOwnProperty.call(result, "value")) {
        normalized = result.value;
      }
    }

    closeModal();

    try {
      await onSubmit(normalized);
    } catch (err) {
      showToast(`${label.trim()} failed: ${err.message}`, "error", 2.2);
    }
  };

  submitButton.on("press", submit);
  cancelButton.on("press", cancel);

  modal.key(["escape"], cancel);
  input.key(["escape"], () => {
    input.cancel();
  });
  input.on("cancel", cancel);
  input.on("submit", submit);

  setModalState(modal, closeModal);
  screen.render();
  input.focus();
  input.readInput();
};

const openInfoModal = ({
  label,
  content,
  borderColor = "cyan",
  width = "60%",
  height = 12,
  footerText = "Esc Close",
}) => {
  if (isModalOpen()) return null;

  const modal = createModal({ label, borderColor, width, height });
  const body = blessed.box({
    parent: modal,
    top: 1,
    left: 2,
    right: 2,
    bottom: 3,
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: {
      ch: " ",
      style: {
        inverse: true,
      },
    },
    content,
    style: { fg: "default", bg: "default" },
  });
  blessed.box({
    parent: modal,
    bottom: 1,
    left: 2,
    right: 2,
    height: 1,
    align: "center",
    content: footerText,
    style: { fg: "gray", bg: "default" },
  });

  const closeModal = () => clearModalState(modal);
  modal.key(["escape", "q"], closeModal);
  modal.key(["up", "down", "j", "k"], (_, key) => {
    if (key.name === "up" || key.name === "k") {
      body.scroll(-1);
    } else {
      body.scroll(1);
    }
    screen.render();
  });
  modal.key(["pageup", "pagedown"], (_, key) => {
    body.scroll(key.name === "pageup" ? -5 : 5);
    screen.render();
  });

  setModalState(modal, closeModal);
  screen.render();
  modal.focus();

  return { modal, body, close: closeModal };
};

const openConfirmModal = ({ label, message, accent = "red", onConfirm }) => {
  if (isModalOpen()) return;

  const modal = createModal({
    label,
    borderColor: accent,
    width: "55%",
    height: 9,
  });

  blessed.box({
    parent: modal,
    top: 1,
    left: 2,
    right: 2,
    height: 1,
    content: message,
    style: { fg: "default", bg: "default" },
  });

  const confirmButton = createModalButton({
    parent: modal,
    top: 4,
    left: 2,
    width: 8,
    content: " Yes ",
    borderColor: accent,
  });

  const cancelButton = createModalButton({
    parent: modal,
    top: 4,
    left: 12,
    width: 10,
    content: " No ",
    borderColor: "gray",
  });

  const closeModal = () => clearModalState(modal);
  const cancel = () => closeModal();

  const confirm = async () => {
    closeModal();

    try {
      await onConfirm();
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, "error", 2.2);
    }
  };

  confirmButton.on("press", confirm);
  cancelButton.on("press", cancel);

  modal.key(["escape"], cancel);
  modal.key(["left", "right", "tab", "S-tab"], () => {
    if (screen.focused === confirmButton) {
      cancelButton.focus();
    } else {
      confirmButton.focus();
    }
    screen.render();
  });

  setModalState(modal, closeModal);
  screen.render();
  confirmButton.focus();
};

const openStatsModal = () => {
  const total = tasks.length;
  const active = tasks.filter((task) => !task.archived).length;
  const archived = tasks.filter((task) => task.archived).length;
  const overdue = tasks.filter(isOverdue).length;
  const dueSoon = tasks.filter(isDueSoon).length;
  const activeStatusCounts = {
    todo: tasks.filter((task) => task.status === "todo" && !task.archived).length,
    doing: tasks.filter((task) => task.status === "doing" && !task.archived).length,
    done: tasks.filter((task) => task.status === "done" && !task.archived).length,
  };
  const today = getTodayDate();
  const completedToday = tasks.filter(
    (task) =>
      task.completed_at &&
      new Date(task.completed_at).toISOString().slice(0, 10) === today
  ).length;

  const byStatus = STATUS_ORDER.map((status) => {
    const count = tasks.filter(
      (task) => task.status === status && !task.archived
    ).length;
    return `${status.toUpperCase()}: ${count}`;
  }).join("   ");

  const byPriority = PRIORITY_ORDER.map((priority) => {
    const count = tasks.filter(
      (task) => task.priority === priority && !task.archived
    ).length;
    return `${priority.toUpperCase()}: ${count}`;
  }).join("   ");

  openInfoModal({
    label: " Stats ",
    borderColor: "green",
    width: "70%",
    height: 24,
    content: [
      `{bold}Total{/bold}: ${total}`,
      `{bold}Active{/bold}: ${active}`,
      `{bold}Archived{/bold}: ${archived}`,
      `{bold}Overdue{/bold}: ${overdue}`,
      `{bold}Due Soon{/bold}: ${dueSoon}`,
      `{bold}Completed Today{/bold}: ${completedToday}`,
      "",
      `{bold}By Status{/bold}`,
      byStatus,
      "",
      `{bold}By Priority{/bold}`,
      byPriority,
      "",
      `{bold}Status Pie{/bold}`,
      buildStatusPieChart(activeStatusCounts),
    ].join("\n"),
    footerText: "Up/Down Scroll   PgUp/PgDn Scroll More   Esc Close",
  });
};

const openTaskDetailsModal = (taskId) => {
  const task = tasks.find((item) => item.id === taskId);
  if (!task || isModalOpen()) return;

  const details = openInfoModal({
    label: " Task Details ",
    borderColor: "yellow",
    width: "72%",
    height: 16,
    footerText:
      "T Title   N Notes   P Priority   G Tags   Y Due Date   X Archive   Esc Close",
    content: "",
  });

  if (!details) return;

  const renderDetails = () => {
    const current = tasks.find((item) => item.id === taskId);
    if (!current) {
      details.close();
      return;
    }

    details.body.setContent(
      [
        `{bold}Title{/bold}: ${current.title}`,
        `{bold}Status{/bold}: ${current.status.toUpperCase()}`,
        `{bold}Priority{/bold}: ${current.priority.toUpperCase()}`,
        `{bold}Due{/bold}: ${formatDate(current.due_date)}`,
        `{bold}Tags{/bold}: ${current.tags.length ? current.tags.join(", ") : "None"}`,
        `{bold}Archived{/bold}: ${current.archived ? "Yes" : "No"}`,
        `{bold}Created{/bold}: ${formatTimestamp(current.created_at)}`,
        `{bold}Updated{/bold}: ${formatTimestamp(current.updated_at)}`,
        `{bold}Completed{/bold}: ${formatTimestamp(current.completed_at)}`,
        "",
        `{bold}Notes{/bold}`,
        current.description || "No notes",
      ].join("\n")
    );
    screen.render();
  };

  const closeAndRun = (fn) => {
    details.close();
    fn();
  };

  details.modal.key(["t"], () => {
    closeAndRun(() =>
      openTextModal({
        label: " Edit Title ",
        promptText: "Task title:",
        initialValue: task.title,
        accent: "yellow",
        onSubmit: async (title) => {
          await updateTaskWithUndo({
            taskId,
            fields: { title },
            label: "task title",
            successMessage: "Title updated",
          });
        },
      })
    );
  });

  details.modal.key(["n"], () => {
    closeAndRun(() =>
      openTextModal({
        label: " Edit Notes ",
        promptText: "Notes (empty clears):",
        initialValue: task.description || "",
        accent: "yellow",
        allowEmpty: true,
        onSubmit: async (description) => {
          await updateTaskWithUndo({
            taskId,
            fields: { description },
            label: "task notes",
            successMessage: "Notes updated",
          });
        },
      })
    );
  });

  details.modal.key(["g"], () => {
    closeAndRun(() =>
      openTextModal({
        label: " Edit Tags ",
        promptText: "Comma-separated tags (empty clears):",
        initialValue: task.tags.join(", "),
        accent: "yellow",
        allowEmpty: true,
        onSubmit: async (value) => {
          await updateTaskWithUndo({
            taskId,
            fields: { tags: parseTags(value) },
            label: "task tags",
            successMessage: "Tags updated",
          });
        },
      })
    );
  });

  details.modal.key(["y"], () => {
    closeAndRun(() =>
      openTextModal({
        label: " Edit Due Date ",
        promptText: "Due date YYYY-MM-DD (empty clears):",
        initialValue: task.due_date || "",
        accent: "yellow",
        allowEmpty: true,
        validate: (value) => {
          if (!value) return { value: null };
          const dueDate = normalizeDateInput(value);
          return dueDate
            ? { value: dueDate }
            : { error: "Use YYYY-MM-DD" };
        },
        onSubmit: async (dueDate) => {
          await updateTaskWithUndo({
            taskId,
            fields: { dueDate },
            label: "task due date",
            successMessage: dueDate ? "Due date updated" : "Due date cleared",
          });
        },
      })
    );
  });

  details.modal.key(["p"], async () => {
    const current = tasks.find((item) => item.id === taskId);
    if (!current) return;
    const nextPriority =
      PRIORITY_ORDER[(PRIORITY_ORDER.indexOf(current.priority) + 1) % PRIORITY_ORDER.length];
    await updateTaskWithUndo({
      taskId,
      fields: { priority: nextPriority },
      label: "task priority",
      successMessage: `Priority: ${nextPriority}`,
    });
    renderDetails();
  });

  details.modal.key(["x"], async () => {
    const current = tasks.find((item) => item.id === taskId);
    if (!current) return;

    if (!current.archived && current.status !== "done") {
      showToast("Only done tasks can be archived");
      return;
    }

    await updateTaskWithUndo({
      taskId,
      fields: {
        archived: !current.archived,
        archivedAt: current.archived ? null : new Date(),
      },
      label: current.archived ? "task unarchive" : "task archive",
      successMessage: current.archived ? "Task restored" : "Task archived",
    });
    renderDetails();
  });

  renderDetails();
};

// ===== render =====
const render = () => {
  const groups = {
    todo: getVisibleColumnTasks("todo"),
    doing: getVisibleColumnTasks("doing"),
    done: getVisibleColumnTasks("done"),
  };

  const selectedGroup = groups[currentColumn];
  if (selectedIndex >= selectedGroup.length) {
    selectedIndex = Math.max(0, selectedGroup.length - 1);
  }
  if (selectedIndex < 0) selectedIndex = 0;

  todoBox.setLabel(` TODO ${groups.todo.length} `);
  doingBox.setLabel(` DOING ${groups.doing.length} `);
  doneBox.setLabel(` DONE ${groups.done.length} `);

  header.setContent(
    `{bold}{cyan-fg}Task Manager{/cyan-fg}{/bold} {gray-fg}• Filter: ${getFilterLabel()} • Sort: ${getSortLabel()} • Search: ${searchQuery || "None"}{/gray-fg}`
  );

  footer.setContent(
    "{bold}A{/bold} Add  {bold}E{/bold} Edit  {bold}I{/bold} Details  {bold}D{/bold} Delete  {bold}X{/bold} Archive  {bold}U{/bold} Undo  {bold}S{/bold} Stats\n" +
      "{bold}/{/bold} Search  {bold}F{/bold} Filter  {bold}O{/bold} Sort  {bold}Enter{/bold} Move  {bold}J/K{/bold} Reorder  {bold}Q{/bold} Quit"
  );

  const draw = (box, list, col) => {
    if (!list.length) {
      box.setContent("\n {gray-fg}No tasks{/gray-fg}");
      box.style.border.fg = currentColumn === col ? "cyan" : "gray";
      return;
    }

    const lines = list
      .map((task, index) =>
        currentColumn === col && selectedIndex === index
          ? `{inverse} ❯ ${summarizeTask(task)} {/inverse}`
          : `   ${summarizeTask(task)}`
      )
      .join("\n");

    box.setContent(`\n${lines}`);
    box.style.border.fg = currentColumn === col ? "cyan" : "gray";
  };

  draw(todoBox, groups.todo, "todo");
  draw(doingBox, groups.doing, "doing");
  draw(doneBox, groups.done, "done");

  screen.render();
};

// ===== navigation =====
screen.key(["left", "right"], (ch, key) => {
  if (isModalOpen()) return;
  const idx = STATUS_ORDER.indexOf(currentColumn);
  if (key.name === "left" && idx > 0) currentColumn = STATUS_ORDER[idx - 1];
  if (key.name === "right" && idx < STATUS_ORDER.length - 1) {
    currentColumn = STATUS_ORDER[idx + 1];
  }
  selectedIndex = 0;
  render();
});

screen.key(["up", "down"], (ch, key) => {
  if (isModalOpen()) return;
  const colTasks = getVisibleColumnTasks();
  if (key.name === "up" && selectedIndex > 0) selectedIndex -= 1;
  if (key.name === "down" && selectedIndex < colTasks.length - 1) {
    selectedIndex += 1;
  }
  render();
});

// ===== actions =====
screen.key(["enter"], async () => {
  if (isModalOpen()) return;
  const task = getCurrentTask();
  if (!task) return;
  if (task.archived) {
    showToast("Unarchive this task first");
    return;
  }

  const next =
    currentColumn === "todo"
      ? "doing"
      : currentColumn === "doing"
      ? "done"
      : "todo";

  try {
    const previous = cloneTask(task);
    await updateStatus(task.id, next);
    pushUndo("task move", async () => restoreTaskSnapshot(previous));
    await loadTasks();
    render();
    showToast(`Moved to ${next.toUpperCase()}`, "success");
  } catch (err) {
    showToast(`Move failed: ${err.message}`, "error", 2.2);
  }
});

screen.key(["a"], () => {
  if (isModalOpen()) return;

  openTextModal({
    label: " Add Task ",
    promptText: "Task title:",
    accent: "cyan",
    onSubmit: async (title) => {
      const created = await addTask({ title });
      pushUndo("task add", async () => deleteTask(created.id));
      await loadTasks();
      render();
      showToast("Task added", "success");
    },
  });
});

screen.key(["e"], () => {
  if (isModalOpen()) return;
  const task = getCurrentTask();
  if (!task) return;

  openTextModal({
    label: " Edit Title ",
    promptText: "Task title:",
    initialValue: task.title,
    accent: "yellow",
    onSubmit: async (title) => {
      await updateTaskWithUndo({
        taskId: task.id,
        fields: { title },
        label: "task title",
        successMessage: "Task updated",
      });
    },
  });
});

screen.key(["i"], () => {
  if (isModalOpen()) return;
  const task = getCurrentTask();
  if (!task) return;
  openTaskDetailsModal(task.id);
});

screen.key(["d"], () => {
  if (isModalOpen()) return;
  const task = getCurrentTask();
  if (!task) return;

  const label = task.title.length > 40
    ? `${task.title.slice(0, 40)}...`
    : task.title;

  openConfirmModal({
    label: " Confirm Delete ",
    message: `Delete "${label}"?`,
    onConfirm: async () => {
      const previous = cloneTask(task);
      await deleteTask(task.id);
      pushUndo("task delete", async () => insertTaskSnapshot(previous));
      await loadTasks();
      selectedIndex = 0;
      render();
      showToast("Task deleted", "success");
    },
  });
});

screen.key(["x"], async () => {
  if (isModalOpen()) return;
  const task = getCurrentTask();
  if (!task) return;

  if (!task.archived && task.status !== "done") {
    showToast("Only done tasks can be archived");
    return;
  }

  try {
    await updateTaskWithUndo({
      taskId: task.id,
      fields: {
        archived: !task.archived,
        archivedAt: task.archived ? null : new Date(),
      },
      label: task.archived ? "task unarchive" : "task archive",
      successMessage: task.archived ? "Task restored" : "Task archived",
    });
    selectedIndex = 0;
  } catch (err) {
    showToast(`Archive failed: ${err.message}`, "error", 2.2);
  }
});

screen.key(["u"], async () => {
  if (isModalOpen()) return;
  await undoLastAction();
});

screen.key(["s"], () => {
  if (isModalOpen()) return;
  openStatsModal();
});

screen.key(["/"], () => {
  if (isModalOpen()) return;
  openTextModal({
    label: " Search ",
    promptText: "Search query (empty clears):",
    initialValue: searchQuery,
    accent: "cyan",
    allowEmpty: true,
    onSubmit: async (value) => {
      searchQuery = value;
      selectedIndex = 0;
      render();
      showToast(searchQuery ? `Search: ${searchQuery}` : "Search cleared", "success");
    },
  });
});

screen.key(["f"], () => {
  if (isModalOpen()) return;
  const idx = FILTER_MODES.indexOf(filterMode);
  filterMode = FILTER_MODES[(idx + 1) % FILTER_MODES.length];
  selectedIndex = 0;
  render();
  showToast(`Filter: ${getFilterLabel()}`);
});

screen.key(["o"], () => {
  if (isModalOpen()) return;
  const idx = SORT_MODES.indexOf(sortMode);
  sortMode = SORT_MODES[(idx + 1) % SORT_MODES.length];
  selectedIndex = 0;
  render();
  showToast(`Sort: ${getSortLabel()}`);
});

screen.key(["k", "j"], async (ch, key) => {
  if (isModalOpen()) return;

  if (!canManualReorder()) {
    showToast("Reorder needs Active filter, no search, and Manual sort");
    return;
  }

  const colTasks = getVisibleColumnTasks();
  const moveUp = key.name === "up" || key.name === "k";
  const moveDown = key.name === "down" || key.name === "j";

  if (!colTasks.length) {
    showToast("No tasks in this column");
    return;
  }

  if (moveUp && selectedIndex === 0) {
    showToast("Already at top");
    return;
  }

  if (moveDown && selectedIndex === colTasks.length - 1) {
    showToast("Already at bottom");
    return;
  }

  const previousOrder = colTasks.map((task) => cloneTask(task));
  const working = [...colTasks];

  if (moveUp && selectedIndex > 0) {
    [working[selectedIndex - 1], working[selectedIndex]] = [
      working[selectedIndex],
      working[selectedIndex - 1],
    ];
    selectedIndex -= 1;
  }

  if (moveDown && selectedIndex < working.length - 1) {
    [working[selectedIndex + 1], working[selectedIndex]] = [
      working[selectedIndex],
      working[selectedIndex + 1],
    ];
    selectedIndex += 1;
  }

  try {
    await reorderColumn(working.map((task) => task.id));
    pushUndo("task reorder", async () =>
      reorderColumn(previousOrder.map((task) => task.id))
    );
    await loadTasks();
    render();
    showToast("Order updated", "success");
  } catch (err) {
    showToast(`Reorder failed: ${err.message}`, "error", 2.2);
  }
});

// ===== exit =====
const shutdown = async (code = 0) => {
  try {
    await pool.end();
  } catch (err) {
    // Ignore pool shutdown failures during exit.
  }
  process.exit(code);
};

screen.key(["q", "C-c"], () => shutdown(0));
screen.key(["escape"], () => {
  if (closeActiveModal) closeActiveModal();
});

// ===== init =====
(async () => {
  try {
    await ensureSchema();
    await pool.query("SELECT 1");
    await loadTasks();
    render();
  } catch (err) {
    console.error(`Database connection failed: ${err.message}`);
    await shutdown(1);
  }
})();

process.on("unhandledRejection", async (err) => {
  console.error(`Unhandled error: ${err.message}`);
  await shutdown(1);
});
