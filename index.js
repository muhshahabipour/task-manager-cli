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
      fg: "white",
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
  style: { fg: "white" },
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
    fg: "white",
  },
});

const confirmBox = blessed.question({
  parent: screen,
  border: "line",
  tags: true,
  hidden: true,
  width: "55%",
  height: "shrink",
  top: "center",
  left: "center",
  label: " Confirm Delete ",
  style: {
    border: { fg: "red" },
    fg: "white",
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

// ===== helpers =====
const getColumnTasks = () =>
  tasks.filter((t) => t.status === currentColumn);
const showToast = (text, type = "info", duration = 1.6) => {
  screen.append(toast);
  toast.style.border.fg =
    type === "error" ? "red" : type === "success" ? "green" : "cyan";
  toast.display(text, duration, () => {});
};
const trimValue = (value) => (typeof value === "string" ? value.trim() : "");

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
            ? `{black-fg}{cyan-bg} ❯ ${t.title} {/cyan-bg}{/black-fg}`
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
  const cols = ["todo", "doing", "done"];
  let idx = cols.indexOf(currentColumn);

  if (key.name === "left" && idx > 0) idx--;
  if (key.name === "right" && idx < 2) idx++;

  currentColumn = cols[idx];
  selectedIndex = 0;
  render();
});

screen.key(["up", "down"], (ch, key) => {
  const colTasks = getColumnTasks();

  if (key.name === "up" && selectedIndex > 0) selectedIndex--;
  if (key.name === "down" && selectedIndex < colTasks.length - 1)
    selectedIndex++;

  render();
});

// ===== move status =====
screen.key(["enter"], async () => {
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
  const prompt = blessed.prompt({
    parent: screen,
    border: "line",
    label: " Add Task ",
    tags: true,
    width: "50%",
    height: "shrink",
    top: "center",
    left: "center",
    style: {
      border: { fg: "cyan" },
    },
  });

  prompt.input("Task title:", "", async (_, value) => {
    const title = trimValue(value);
    if (!title) return;

    try {
      await addTask(title);
      tasks = await getTasks();
      render();
      showToast("Task added", "success");
    } catch (err) {
      showToast(`Add failed: ${err.message}`, "error", 2.2);
    }
  });
});

// ===== delete =====
screen.key(["d"], () => {
  const colTasks = getColumnTasks();
  const task = colTasks[selectedIndex];
  if (!task) return;

  const label = task.title.length > 40
    ? `${task.title.slice(0, 40)}...`
    : task.title;
  screen.append(confirmBox);
  confirmBox.ask(`Delete "${label}"?`, async (err, ok) => {
    if (err) {
      render();
      showToast(`Delete failed: ${err.message}`, "error", 2.2);
      return;
    }

    if (!ok) {
      render();
      showToast("Delete cancelled");
      return;
    }

    try {
      await deleteTask(task.id);
      tasks = await getTasks();
      selectedIndex = 0;
      render();
      showToast("Task deleted", "success");
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, "error", 2.2);
    }
  });
});

// ===== edit =====
screen.key(["e"], () => {
  const colTasks = getColumnTasks();
  const task = colTasks[selectedIndex];
  if (!task) return;

  const prompt = blessed.prompt({
    parent: screen,
    border: "line",
    label: " Edit Task ",
    tags: true,
    width: "50%",
    height: "shrink",
    top: "center",
    left: "center",
    style: {
      border: { fg: "yellow" },
    },
  });

  prompt.input("Edit title:", task.title, async (_, value) => {
    const title = trimValue(value);
    if (!title) return;

    try {
      await updateTitle(task.id, title);
      tasks = await getTasks();
      render();
      showToast("Task updated", "success");
    } catch (err) {
      showToast(`Edit failed: ${err.message}`, "error", 2.2);
    }
  });
});

// ===== reorder =====
screen.key(["k", "j"], async (ch, key) => {
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
