#!/usr/bin/env node

const blessed = require("blessed");
const { v4: uuidv4 } = require("uuid");
const pool = require("./db");
const packageJson = require("./package.json");

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
  j/k    Reorder task
  Enter  Move task to next status
  a      Add task
  e      Edit task
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

// ===== DB =====
const getTasks = async () => {
  const res = await pool.query(
    "SELECT * FROM tasks ORDER BY status, position ASC"
  );
  return res.rows;
};

const addTask = async (title) => {
  const res = await pool.query(
    "SELECT COALESCE(MAX(position),0)+1 as pos FROM tasks WHERE status='todo'"
  );
  const pos = res.rows[0].pos;

  await pool.query(
    "INSERT INTO tasks (id, title, status, position) VALUES ($1,$2,$3,$4)",
    [uuidv4(), title, "todo", pos]
  );
};

const updateStatus = async (id, status) => {
  const res = await pool.query(
    "SELECT COALESCE(MAX(position),0)+1 as pos FROM tasks WHERE status=$1",
    [status]
  );
  const pos = res.rows[0].pos;

  await pool.query(
    "UPDATE tasks SET status=$1, position=$2 WHERE id=$3",
    [status, pos, id]
  );
};

const deleteTask = async (id) => {
  await pool.query("DELETE FROM tasks WHERE id=$1", [id]);
};

const updateTitle = async (id, title) => {
  await pool.query("UPDATE tasks SET title=$1 WHERE id=$2", [title, id]);
};

const reorder = async (tasksInColumn) => {
  for (let i = 0; i < tasksInColumn.length; i++) {
    await pool.query(
      "UPDATE tasks SET position=$1 WHERE id=$2",
      [i + 1, tasksInColumn[i].id]
    );
  }
};

// ===== UI =====
const screen = blessed.screen({
  smartCSR: true,
  title: "Task Manager CLI",
});
screen.program.enableMouse();

const createModal = ({ label, width = "50%", height = 10, borderColor }) =>
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
    height: "90%",
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
  content: "{bold}{cyan-fg}Task Manager{/cyan-fg}{/bold} {gray-fg}• Kanban CLI{/gray-fg}",
  style: { fg: "default" },
});

const footer = blessed.box({
  bottom: 0,
  left: 0,
  width: "100%",
  height: 2,
  tags: true,
  align: "center",
  valign: "middle",
  content:
    "{bold}←/→{/bold} Column   {bold}↑/↓{/bold} Select   {bold}J/K{/bold} Reorder   {bold}Enter{/bold} Move   {bold}A{/bold} Add   {bold}E{/bold} Edit   {bold}D{/bold} Delete   {bold}Q{/bold} Quit",
  style: { fg: "gray" },
});

const todoBox = createColumn("📝 To Do (0)", "0%");
const doingBox = createColumn("⚙️ In Progress (0)", "33%");
const doneBox = createColumn("✅ Done (0)", "66%");
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

// ===== helpers =====
const getColumnTasks = () =>
  tasks.filter((t) => t.status === currentColumn);
const isModalOpen = () => activeModal !== null;
const showToast = (text, type = "info", duration = 1.6) => {
  screen.append(toast);
  toast.style.border.fg =
    type === "error" ? "red" : type === "success" ? "green" : "cyan";
  toast.display(text, duration, () => {});
};
const trimValue = (value) => (typeof value === "string" ? value.trim() : "");

const openTextModal = ({ label, promptText, initialValue = "", accent, onSubmit }) => {
  if (isModalOpen()) return;

  const modal = createModal({ label, borderColor: accent, height: 11 });
  const promptLabel = blessed.box({
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
      focus: {
        border: { fg: accent },
      },
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
  activeModal = modal;
  closeActiveModal = null;
  screen.saveFocus();

  const closeModal = () => {
    if (!activeModal || activeModal !== modal) return;
    activeModal = null;
    closeActiveModal = null;
    modal.destroy();
    screen.restoreFocus();
    render();
  };

  closeActiveModal = closeModal;

  const cancel = () => closeModal();
  const submit = async () => {
    const title = trimValue(input.getValue());
    if (!title) return;

    closeModal();

    try {
      await onSubmit(title);
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

  screen.render();
  input.focus();
  input.readInput();
};

const openConfirmModal = ({ label, message, accent = "red", onConfirm }) => {
  if (isModalOpen()) return;

  const modal = createModal({ label, borderColor: accent, width: "55%", height: 9 });
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

  activeModal = modal;
  closeActiveModal = null;
  screen.saveFocus();

  const closeModal = () => {
    if (!activeModal || activeModal !== modal) return;
    activeModal = null;
    closeActiveModal = null;
    modal.destroy();
    screen.restoreFocus();
    render();
  };

  closeActiveModal = closeModal;

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
  modal.key(["left", "right", "tab", "S-tab"], (_, key) => {
    if (screen.focused === confirmButton) {
      cancelButton.focus();
      screen.render();
      return;
    }

    confirmButton.focus();
    screen.render();
  });

  screen.render();
  confirmButton.focus();
};

// ===== render =====
const render = () => {
  const groups = { todo: [], doing: [], done: [] };
  tasks.forEach((t) => groups[t.status].push(t));
  const selectedGroup = groups[currentColumn];
  if (selectedIndex >= selectedGroup.length) {
    selectedIndex = Math.max(0, selectedGroup.length - 1);
  }
  if (selectedIndex < 0) selectedIndex = 0;

  todoBox.setLabel(`📝 To Do (${groups.todo.length})`);
  doingBox.setLabel(`⚙️ In Progress (${groups.doing.length})`);
  doneBox.setLabel(`✅ Done (${groups.done.length})`);

  const draw = (box, list, col) => {
    if (!list.length) {
      box.setContent("\n {gray-fg}No tasks{/gray-fg}");
      box.style.border.fg = currentColumn === col ? "cyan" : "gray";
      return;
    }

    const lines = list
        .map((t, i) =>
          currentColumn === col && selectedIndex === i
            ? `{inverse} ❯ ${t.title} {/inverse}`
            : `   ${t.title}`
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
  const cols = ["todo", "doing", "done"];
  let idx = cols.indexOf(currentColumn);

  if (key.name === "left" && idx > 0) idx--;
  if (key.name === "right" && idx < 2) idx++;

  currentColumn = cols[idx];
  selectedIndex = 0;
  render();
});

screen.key(["up", "down"], (ch, key) => {
  if (isModalOpen()) return;
  const colTasks = getColumnTasks();

  if (key.name === "up" && selectedIndex > 0) selectedIndex--;
  if (key.name === "down" && selectedIndex < colTasks.length - 1)
    selectedIndex++;

  render();
});

// ===== move status =====
screen.key(["enter"], async () => {
  if (isModalOpen()) return;
  const colTasks = getColumnTasks();
  const task = colTasks[selectedIndex];
  if (!task) return;

  try {
    const next =
      currentColumn === "todo"
        ? "doing"
        : currentColumn === "doing"
        ? "done"
        : "todo";

    await updateStatus(task.id, next);
    tasks = await getTasks();
    render();
    showToast(`Moved to ${next.toUpperCase()}`, "success");
  } catch (err) {
    showToast(`Move failed: ${err.message}`, "error", 2.2);
  }
});

// ===== add =====
screen.key(["a"], () => {
  if (isModalOpen()) return;

  openTextModal({
    label: " Add Task ",
    promptText: "Task title:",
    accent: "cyan",
    onSubmit: async (title) => {
      await addTask(title);
      tasks = await getTasks();
      render();
      showToast("Task added", "success");
    },
  });
});

// ===== delete =====
screen.key(["d"], () => {
  if (isModalOpen()) return;
  const colTasks = getColumnTasks();
  const task = colTasks[selectedIndex];
  if (!task) return;

  const label = task.title.length > 40
    ? `${task.title.slice(0, 40)}...`
    : task.title;
  openConfirmModal({
    label: " Confirm Delete ",
    message: `Delete "${label}"?`,
    onConfirm: async () => {
      await deleteTask(task.id);
      tasks = await getTasks();
      selectedIndex = 0;
      render();
      showToast("Task deleted", "success");
    },
  });
});

// ===== edit =====
screen.key(["e"], () => {
  if (isModalOpen()) return;
  const colTasks = getColumnTasks();
  const task = colTasks[selectedIndex];
  if (!task) return;

  openTextModal({
    label: " Edit Task ",
    promptText: "Edit title:",
    initialValue: task.title,
    accent: "yellow",
    onSubmit: async (title) => {
      await updateTitle(task.id, title);
      tasks = await getTasks();
      render();
      showToast("Task updated", "success");
    },
  });
});

// ===== reorder =====
screen.key(["k", "j"], async (ch, key) => {
  if (isModalOpen()) return;
  let colTasks = getColumnTasks();
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

  if (moveUp && selectedIndex > 0) {
    [colTasks[selectedIndex], colTasks[selectedIndex - 1]] = [
      colTasks[selectedIndex - 1],
      colTasks[selectedIndex],
    ];
    selectedIndex--;
  }

  if (moveDown && selectedIndex < colTasks.length - 1) {
    [colTasks[selectedIndex], colTasks[selectedIndex + 1]] = [
      colTasks[selectedIndex + 1],
      colTasks[selectedIndex],
    ];
    selectedIndex++;
  }

  try {
    await reorder(colTasks);
    tasks = await getTasks();
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
  if (closeActiveModal) {
    closeActiveModal();
  }
});

// ===== init =====
(async () => {
  try {
    await pool.query("SELECT 1");
    tasks = await getTasks();
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
