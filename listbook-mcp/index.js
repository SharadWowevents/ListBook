#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

// Configuration via Environment Variables
const API_BASE = (process.env.LISTBOOK_API_URL || "https://listbook.wowosapps.com/api").replace(/\/$/, "");
let currentName = process.env.LISTBOOK_NAME || "";
let currentPin = process.env.LISTBOOK_PIN || "";
let authToken = null;

// Helper: Generate Listbook-compatible short IDs
const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Helper: Authenticate with the Listbook Express Backend
async function ensureAuth() {
  if (authToken) return authToken;
  if (!currentName || !currentPin) {
    throw new Error(
      "Missing credentials. Set LISTBOOK_NAME and LISTBOOK_PIN in your MCP environment variables, or call the 'authenticate_user' tool first."
    );
  }

  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: currentName, pin: currentPin }),
  });

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`API returned non-JSON response (HTTP ${res.status}) from ${API_BASE}/auth/login`);
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Authentication failed");

  authToken = data.token;
  return authToken;
}

// Helper: Fetch current board from backend
async function fetchBoard() {
  const token = await ensureAuth();
  let res = await fetch(`${API_BASE}/board`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // If token expired, re-authenticate once
  if (res.status === 401) {
    authToken = null;
    const newToken = await ensureAuth();
    res = await fetch(`${API_BASE}/board`, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch board");
  return data.board; // { lists: [...], activeId, updatedAt }
}

// Helper: Save updated board to backend
async function saveBoard(board) {
  const token = await ensureAuth();
  board.updatedAt = Date.now();

  const res = await fetch(`${API_BASE}/board`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(board),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save board");
  return data.board;
}

// Helper: Find a list by case-insensitive name or exact ID
function findList(board, identifier) {
  const query = identifier.trim().toLowerCase();
  return (
    board.lists.find((l) => l.id === identifier.trim()) ||
    board.lists.find((l) => l.name.toLowerCase() === query) ||
    board.lists.find((l) => l.name.toLowerCase().includes(query))
  );
}

// Helper: Format board nicely for LLM reading
function formatBoardSummary(board) {
  if (!board.lists || board.lists.length === 0) {
    return "No lists found on the board.";
  }
  return board.lists
    .map((list) => {
      const starIcon = list.starred ? "★ " : "";
      const openCount = list.todos.filter((t) => !t.done).length;
      const doneCount = list.todos.filter((t) => t.done).length;
      const tasksText =
        list.todos.length === 0
          ? "  (Empty list)"
          : list.todos
              .map(
                (t) =>
                  `  - [${t.done ? "x" : " "}] ${t.starred ? "★ " : ""}${t.text} (id: ${t.id})`
              )
              .join("\n");
      return `### ${starIcon}${list.name} (id: ${list.id}) — ${openCount} open, ${doneCount} done\n${tasksText}`;
    })
    .join("\n\n");
}

// Initialize MCP Server
const server = new McpServer({
  name: "listbook-mcp",
  version: "1.0.0",
});

// ============================================================================
// MCP RESOURCES (Direct Read Context)
// ============================================================================
server.resource("board", "listbook://board", async (uri) => {
  const board = await fetchBoard();
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: formatBoardSummary(board),
      },
    ],
  };
});

// ============================================================================
// MCP TOOLS (Read & Write Actions)
// ============================================================================

// 1. Optional runtime login/switch user tool
server.tool(
  "authenticate_user",
  "Sign in or switch to a Listbook account using a Name and 4-digit PIN.",
  {
    name: z.string().max(40).describe("User's display name (e.g. Sachin or Demo)"),
    pin: z.string().regex(/^\d{4}$/).describe("4-digit numeric PIN"),
  },
  async ({ name, pin }) => {
    currentName = name.trim();
    currentPin = pin.trim();
    authToken = null;
    await ensureAuth();
    const board = await fetchBoard();
    return {
      content: [
        {
          type: "text",
          text: `Successfully signed in as "${currentName}".\n\n${formatBoardSummary(board)}`,
        },
      ],
    };
  }
);

// 2. Read all lists and tasks
server.tool(
  "get_all_lists",
  "Read all lists and their tasks from Listbook. Use this whenever asked about lists, tasks, or what is on the board.",
  {},
  async () => {
    const board = await fetchBoard();
    return {
      content: [{ type: "text", text: formatBoardSummary(board) }],
    };
  }
);

// 3. Read a specific list
server.tool(
  "get_list",
  "Get all tasks from a specific list by its name or ID.",
  {
    listNameOrId: z.string().describe("The name or ID of the list to read"),
  },
  async ({ listNameOrId }) => {
    const board = await fetchBoard();
    const list = findList(board, listNameOrId);
    if (!list) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `List "${listNameOrId}" not found. Available lists: ${board.lists.map((l) => l.name).join(", ")}`,
          },
        ],
      };
    }

    const tasks =
      list.todos.length === 0
        ? "No tasks in this list."
        : list.todos
            .map(
              (t) =>
                `- [${t.done ? "x" : " "}] ${t.starred ? "★ " : ""}${t.text} (id: ${t.id})`
            )
            .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `### ${list.starred ? "★ " : ""}${list.name} (id: ${list.id})\n${tasks}`,
        },
      ],
    };
  }
);

// 4. Search tasks across all lists
server.tool(
  "search_tasks",
  "Search for tasks across all lists matching a keyword or status.",
  {
    query: z.string().optional().describe("Text keyword to search for"),
    onlyStarred: z.boolean().optional().describe("Filter only starred tasks"),
    onlyOpen: z.boolean().optional().describe("Filter only incomplete/open tasks"),
  },
  async ({ query, onlyStarred, onlyOpen }) => {
    const board = await fetchBoard();
    const q = (query || "").trim().toLowerCase();
    const matches = [];

    for (const list of board.lists) {
      for (const todo of list.todos) {
        if (q && !todo.text.toLowerCase().includes(q)) continue;
        if (onlyStarred && !todo.starred) continue;
        if (onlyOpen && todo.done) continue;
        matches.push(
          `[${list.name}] - [${todo.done ? "x" : " "}] ${todo.starred ? "★ " : ""}${todo.text} (taskId: ${todo.id})`
        );
      }
    }

    return {
      content: [
        {
          type: "text",
          text: matches.length
            ? `Found ${matches.length} matching task(s):\n${matches.join("\n")}`
            : "No matching tasks found.",
        },
      ],
    };
  }
);

// 5. Create a new list (with optional initial tasks)
server.tool(
  "create_list",
  "Create a new list in Listbook, optionally starring it or populating it with initial tasks.",
  {
    name: z.string().min(1).max(60).describe("Name of the new list"),
    starred: z.boolean().optional().default(false).describe("Whether to star the list"),
    initialTasks: z
      .array(z.string().max(300))
      .optional()
      .describe("Optional array of initial task strings to add to the new list"),
  },
  async ({ name, starred, initialTasks }) => {
    const board = await fetchBoard();
    const trimmedName = name.trim();

    const newList = {
      id: uid(),
      name: trimmedName,
      starred: Boolean(starred),
      todos: (initialTasks || [])
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text) => ({
          id: uid(),
          text,
          done: false,
          starred: false,
        })),
    };

    board.lists.push(newList);
    board.activeId = newList.id;
    await saveBoard(board);

    return {
      content: [
        {
          type: "text",
          text: `Created list "${newList.name}" (id: ${newList.id}) with ${newList.todos.length} task(s).`,
        },
      ],
    };
  }
);

// 6. Add one or more tasks to a list (auto-creates list if needed)
server.tool(
  "add_tasks_to_list",
  "Add one or multiple tasks/todos to a specified list. If the list does not exist yet, it will automatically be created.",
  {
    listNameOrId: z.string().describe("Target list name or ID"),
    tasks: z
      .array(
        z.object({
          text: z.string().min(1).max(300).describe("Task description"),
          starred: z.boolean().optional().default(false).describe("Star this task so it stays on top"),
        })
      )
      .min(1)
      .describe("List of tasks to add"),
    createListIfMissing: z
      .boolean()
      .optional()
      .default(true)
      .describe("Automatically create the list if it doesn't exist"),
  },
  async ({ listNameOrId, tasks, createListIfMissing }) => {
    const board = await fetchBoard();
    let list = findList(board, listNameOrId);
    let createdNew = false;

    if (!list) {
      if (!createListIfMissing) {
        return {
          isError: true,
          content: [{ type: "text", text: `List "${listNameOrId}" was not found.` }],
        };
      }
      list = {
        id: uid(),
        name: listNameOrId.trim().slice(0, 60),
        starred: false,
        todos: [],
      };
      board.lists.push(list);
      createdNew = true;
    }

    const addedItems = tasks.map((t) => ({
      id: uid(),
      text: t.text.trim(),
      done: false,
      starred: Boolean(t.starred),
    }));

    list.todos.push(...addedItems);
    board.activeId = list.id;
    await saveBoard(board);

    return {
      content: [
        {
          type: "text",
          text: `${createdNew ? `Created new list "${list.name}" and added` : `Added`} ${addedItems.length} task(s) to "${list.name}":\n${addedItems.map((i) => `- ${i.starred ? "★ " : ""}${i.text}`).join("\n")}`,
        },
      ],
    };
  }
);

// 7. Update a task (mark done/undone, star/unstar, or rename)
server.tool(
  "update_task",
  "Update an existing task's status (done/undone), starred state, or text.",
  {
    listNameOrId: z.string().describe("Name or ID of the list containing the task"),
    taskTextOrId: z.string().describe("ID or text of the task to update"),
    done: z.boolean().optional().describe("Set completion status (true = done, false = open)"),
    starred: z.boolean().optional().describe("Set starred status"),
    newText: z.string().max(300).optional().describe("New text for the task"),
  },
  async ({ listNameOrId, taskTextOrId, done, starred, newText }) => {
    const board = await fetchBoard();
    const list = findList(board, listNameOrId);
    if (!list) {
      return {
        isError: true,
        content: [{ type: "text", text: `List "${listNameOrId}" not found.` }],
      };
    }

    const q = taskTextOrId.trim().toLowerCase();
    const todo =
      list.todos.find((t) => t.id === taskTextOrId.trim()) ||
      list.todos.find((t) => t.text.toLowerCase() === q) ||
      list.todos.find((t) => t.text.toLowerCase().includes(q));

    if (!todo) {
      return {
        isError: true,
        content: [{ type: "text", text: `Task "${taskTextOrId}" not found in "${list.name}".` }],
      };
    }

    if (typeof done === "boolean") todo.done = done;
    if (typeof starred === "boolean") todo.starred = starred;
    if (newText && newText.trim()) todo.text = newText.trim();

    await saveBoard(board);

    return {
      content: [
        {
          type: "text",
          text: `Updated task in "${list.name}": [${todo.done ? "x" : " "}] ${todo.starred ? "★ " : ""}${todo.text}`,
        },
      ],
    };
  }
);

// 8. Delete a task or an entire list
server.tool(
  "delete_item",
  "Delete a specific task from a list, or delete an entire list.",
  {
    listNameOrId: z.string().describe("Name or ID of the list"),
    taskTextOrId: z
      .string()
      .optional()
      .describe("If provided, deletes only this task. If omitted, deletes the entire list."),
  },
  async ({ listNameOrId, taskTextOrId }) => {
    const board = await fetchBoard();
    const list = findList(board, listNameOrId);
    if (!list) {
      return {
        isError: true,
        content: [{ type: "text", text: `List "${listNameOrId}" not found.` }],
      };
    }

    if (taskTextOrId) {
      const q = taskTextOrId.trim().toLowerCase();
      const idx = list.todos.findIndex(
        (t) =>
          t.id === taskTextOrId.trim() ||
          t.text.toLowerCase() === q ||
          t.text.toLowerCase().includes(q)
      );
      if (idx === -1) {
        return {
          isError: true,
          content: [{ type: "text", text: `Task "${taskTextOrId}" not found in "${list.name}".` }],
        };
      }
      const [removed] = list.todos.splice(idx, 1);
      await saveBoard(board);
      return {
        content: [
          { type: "text", text: `Deleted task "${removed.text}" from "${list.name}".` },
        ],
      };
    }

    // Delete the entire list
    board.lists = board.lists.filter((l) => l.id !== list.id);
    if (board.activeId === list.id) {
      board.activeId = board.lists[0] ? board.lists[0].id : null;
    }
    await saveBoard(board);
    return {
      content: [{ type: "text", text: `Deleted entire list "${list.name}".` }],
    };
  }
);

// Start the server over stdio
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Listbook MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal MCP Server error:", err);
  process.exit(1);
});