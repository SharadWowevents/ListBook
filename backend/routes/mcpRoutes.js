const express = require("express");
const { McpServer, ResourceTemplate } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { z } = require("zod");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const router = express.Router();

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Active SSE Transports Map
const transports = new Map();

// Helper to resolve user
async function getTargetUser(username) {
  const targetKey = (username || process.env.DEFAULT_USER || "").trim().toLowerCase();

  if (targetKey) {
    let user = await User.findOne({ usernameKey: targetKey });
    if (user) return user;

    const users = await User.find({});
    const matched = users.find(
      (u) =>
        u.displayName.toLowerCase() === targetKey ||
        u.usernameKey.includes(targetKey)
    );
    if (matched) return matched;
  }

  // Look for 'admin' or first user in the database
  let user = await User.findOne({ usernameKey: "admin" });
  if (user) return user;

  user = await User.findOne();
  if (user) return user;

  // If no user exists, create admin user
  const salt = await bcrypt.genSalt(10);
  const pinHash = await bcrypt.hash("0000", salt);
  user = await User.create({
    usernameKey: "admin",
    displayName: "Admin",
    pinHash,
  });
  return user;
}

function findList(board, listIdentifier) {
  if (!board?.lists || !listIdentifier) return null;
  const clean = listIdentifier.trim().toLowerCase();
  return (
    board.lists.find((l) => l.id === listIdentifier.trim()) ||
    board.lists.find((l) => l.name.toLowerCase() === clean) ||
    board.lists.find((l) => l.name.toLowerCase().includes(clean)) ||
    null
  );
}

function findTodo(list, todoIdentifier) {
  if (!list?.todos || !todoIdentifier) return null;
  const clean = todoIdentifier.trim().toLowerCase();
  return (
    list.todos.find((t) => t.id === todoIdentifier.trim()) ||
    list.todos.find((t) => t.text.toLowerCase() === clean) ||
    list.todos.find((t) => t.text.toLowerCase().includes(clean)) ||
    null
  );
}

function formatListMarkdown(list, isActive = false) {
  const star = list.starred ? " ⭐" : "";
  const activeBadge = isActive ? " [ACTIVE]" : "";
  let md = `### ${list.name}${star}${activeBadge} (ID: \`${list.id}\`)\n`;

  if (!list.todos || list.todos.length === 0) {
    return md + `  _(No tasks in this list)_\n`;
  }

  for (const t of list.todos) {
    const box = t.done ? "[x]" : "[ ]";
    const tStar = t.starred ? " ⭐" : "";
    md += `- ${box} ${t.text}${tStar} \`(ID: ${t.id})\`\n`;
  }
  return md;
}

// ==========================================
// INITIALIZE MCP SERVER
// ==========================================
const mcpServer = new McpServer({
  name: "listbook-mcp-server",
  version: "1.0.0",
  description: "MCP server for ListBook with read and write capabilities",
});

// Tool: list_all_lists
mcpServer.tool(
  "list_all_lists",
  "Get all lists from ListBook with task counts, starred status, and active list indicator",
  {
    username: z.string().optional().describe("Optional username"),
  },
  async ({ username }) => {
    try {
      const user = await getTargetUser(username);
      const board = user.board || { lists: [] };

      let md = `## 📋 ListBook Lists (${user.displayName})\n\n`;
      if (board.lists.length === 0) {
        md += "No lists found.\n";
      } else {
        for (const l of board.lists) {
          const total = l.todos?.length || 0;
          const completed = l.todos?.filter((t) => t.done).length || 0;
          const pending = total - completed;
          const star = l.starred ? " ⭐" : "";
          const active = board.activeId === l.id ? " **(Active)**" : "";
          md += `- **${l.name}**${star}${active} (ID: \`${l.id}\`) — ${pending} pending / ${total} total\n`;
        }
      }

      return { content: [{ type: "text", text: md.trim() }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: get_list
mcpServer.tool(
  "get_list",
  "Read all tasks and details of a specific list by name or ID",
  {
    list_identifier: z.string().describe("List name or ID"),
    status: z.enum(["all", "pending", "completed"]).optional().default("all"),
    username: z.string().optional(),
  },
  async ({ list_identifier, status, username }) => {
    try {
      const user = await getTargetUser(username);
      const board = user.board || { lists: [] };
      const list = findList(board, list_identifier);

      if (!list) {
        return {
          content: [{ type: "text", text: `List "${list_identifier}" not found.` }],
          isError: true,
        };
      }

      let todos = list.todos || [];
      if (status === "pending") todos = todos.filter((t) => !t.done);
      if (status === "completed") todos = todos.filter((t) => t.done);

      const clone = { ...(list.toObject ? list.toObject() : list), todos };
      return {
        content: [
          {
            type: "text",
            text: formatListMarkdown(clone, board.activeId === list.id).trim(),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: create_list
mcpServer.tool(
  "create_list",
  "Create a new list with optional initial tasks",
  {
    name: z.string().describe("Name of the list"),
    initial_tasks: z.array(z.string()).optional(),
    starred: z.boolean().optional().default(false),
    set_active: z.boolean().optional().default(true),
    username: z.string().optional(),
  },
  async ({ name, initial_tasks = [], starred = false, set_active = true, username }) => {
    try {
      const user = await getTargetUser(username);
      const trimmed = name.trim();
      if (!trimmed) {
        return { content: [{ type: "text", text: "List name is required" }], isError: true };
      }

      const listId = uid();
      const todos = initial_tasks.map((t) => ({
        id: uid(),
        text: t.trim(),
        done: false,
        starred: false,
      }));

      const newList = { id: listId, name: trimmed, starred, todos };
      user.board.lists.push(newList);
      if (set_active || !user.board.activeId) user.board.activeId = listId;
      user.board.updatedAt = Date.now();
      await user.save();

      return {
        content: [
          {
            type: "text",
            text: `✅ Created list **"${trimmed}"** (ID: \`${listId}\`) with ${todos.length} tasks.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: add_task
mcpServer.tool(
  "add_task",
  "Add a task to a list (auto-creates the list if missing)",
  {
    list_identifier: z.string().describe("Target list name or ID"),
    task: z.string().describe("Task description"),
    starred: z.boolean().optional().default(false),
    create_if_missing: z.boolean().optional().default(true),
    username: z.string().optional(),
  },
  async ({ list_identifier, task, starred = false, create_if_missing = true, username }) => {
    try {
      const user = await getTargetUser(username);
      let list = findList(user.board, list_identifier);

      if (!list) {
        if (!create_if_missing) {
          return {
            content: [{ type: "text", text: `List "${list_identifier}" not found.` }],
            isError: true,
          };
        }
        const newListId = uid();
        list = { id: newListId, name: list_identifier.trim(), starred: false, todos: [] };
        user.board.lists.push(list);
      }

      const newTodo = {
        id: uid(),
        text: task.trim(),
        done: false,
        starred,
      };

      list.todos.push(newTodo);
      user.board.updatedAt = Date.now();
      await user.save();

      return {
        content: [
          {
            type: "text",
            text: `✅ Added task to **"${list.name}"**:\n- [ ] ${newTodo.text} \`(ID: ${newTodo.id})\``,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: complete_task
mcpServer.tool(
  "complete_task",
  "Mark a task as done or pending",
  {
    task_identifier: z.string().describe("Task ID or matching task text"),
    list_identifier: z.string().optional().describe("Optional list name/ID"),
    done: z.boolean().optional().default(true),
    username: z.string().optional(),
  },
  async ({ task_identifier, list_identifier, done = true, username }) => {
    try {
      const user = await getTargetUser(username);
      let targetTodo = null;
      let targetList = null;

      if (list_identifier) {
        targetList = findList(user.board, list_identifier);
        if (targetList) targetTodo = findTodo(targetList, task_identifier);
      } else {
        for (const l of user.board.lists) {
          const t = findTodo(l, task_identifier);
          if (t) {
            targetTodo = t;
            targetList = l;
            break;
          }
        }
      }

      if (!targetTodo) {
        return {
          content: [{ type: "text", text: `Task "${task_identifier}" not found.` }],
          isError: true,
        };
      }

      targetTodo.done = done;
      user.board.updatedAt = Date.now();
      await user.save();

      return {
        content: [
          {
            type: "text",
            text: `Marked "${targetTodo.text}" in **"${targetList.name}"** as ${done ? "completed ✅" : "pending ⏳"}.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: search_tasks
mcpServer.tool(
  "search_tasks",
  "Search tasks across all lists by keyword",
  {
    query: z.string().describe("Keyword to search"),
    username: z.string().optional(),
  },
  async ({ query, username }) => {
    try {
      const user = await getTargetUser(username);
      const q = query.toLowerCase().trim();
      const results = [];

      for (const l of user.board.lists) {
        for (const t of l.todos || []) {
          if (t.text.toLowerCase().includes(q)) {
            results.push({ listName: l.name, todo: t });
          }
        }
      }

      let md = `## 🔍 Search Results for "${query}" (${results.length} found)\n\n`;
      for (const r of results) {
        const box = r.todo.done ? "[x]" : "[ ]";
        md += `- **[${r.listName}]** ${box} ${r.todo.text} \`(ID: ${r.todo.id})\`\n`;
      }
      return { content: [{ type: "text", text: md.trim() }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Resource: Full board overview
mcpServer.resource("board", "listbook://board", async (uri) => {
  const user = await getTargetUser();
  return {
    contents: [
      {
        uri: uri.href,
        text: JSON.stringify({ user: user.displayName, board: user.board }, null, 2),
        mimeType: "application/json",
      },
    ],
  };
});

// ==========================================
// EXPRESS ROUTE HANDLERS
// ==========================================

// 1. GET /api/sse - SSE Connection for ChatGPT Developer Mode & MCP Clients
router.get("/sse", async (req, res) => {
  try {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Tell Nginx not to buffer SSE!

    const transport = new SSEServerTransport("/api/messages", res);
    transports.set(transport.sessionId, transport);

    res.on("close", () => {
      transports.delete(transport.sessionId);
    });

    await mcpServer.connect(transport);
  } catch (err) {
    console.error("SSE connection error:", err);
    res.status(500).end("Internal Server Error");
  }
});

// 2. POST /api/messages - Message receiver for SSE session
router.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);

  if (!transport) {
    return res.status(404).send("Session not found");
  }

  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (err) {
    console.error("Post message error:", err);
    res.status(500).end("Internal Server Error");
  }
});

// 3. GET /api/openapi.json - OpenAPI 3.0 specification for Custom GPT Actions
router.get("/openapi.json", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.json({
    openapi: "3.0.0",
    info: {
      title: "ListBook API for ChatGPT",
      description: "Manage ListBook lists and tasks directly from ChatGPT",
      version: "1.0.0",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/lists": {
        get: {
          operationId: "getLists",
          summary: "Get all lists with pending and total task counts",
          responses: { "200": { description: "List of all boards/lists" } },
        },
        post: {
          operationId: "createList",
          summary: "Create a new list with optional initial tasks",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    initial_tasks: { type: "array", items: { type: "string" } },
                    starred: { type: "boolean" },
                  },
                  required: ["name"],
                },
              },
            },
          },
          responses: { "200": { description: "List created" } },
        },
      },
      "/api/lists/{name}": {
        get: {
          operationId: "getListTasks",
          summary: "Get all tasks in a specific list",
          parameters: [
            {
              name: "name",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "List details and tasks" } },
        },
      },
      "/api/tasks": {
        post: {
          operationId: "addTask",
          summary: "Add a task to a list",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    list_name: { type: "string" },
                    task: { type: "string" },
                    starred: { type: "boolean" },
                  },
                  required: ["list_name", "task"],
                },
              },
            },
          },
          responses: { "200": { description: "Task added" } },
        },
      },
      "/api/tasks/complete": {
        post: {
          operationId: "completeTask",
          summary: "Mark a task as done or pending",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    task_identifier: { type: "string" },
                    list_name: { type: "string" },
                    done: { type: "boolean", default: true },
                  },
                  required: ["task_identifier"],
                },
              },
            },
          },
          responses: { "200": { description: "Task completion updated" } },
        },
      },
    },
  });
});

// 4. REST endpoints for Custom GPT Actions
router.get("/lists", async (req, res) => {
  try {
    const user = await getTargetUser();
    const lists = (user.board?.lists || []).map((l) => ({
      id: l.id,
      name: l.name,
      starred: l.starred,
      totalTasks: l.todos?.length || 0,
      pendingTasks: l.todos?.filter((t) => !t.done).length || 0,
    }));
    res.json({ user: user.displayName, lists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/lists", async (req, res) => {
  try {
    const user = await getTargetUser();
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });

    const listId = uid();
    const todos = (req.body.initial_tasks || []).map((t) => ({
      id: uid(),
      text: t.trim(),
      done: false,
      starred: false,
    }));

    const newList = { id: listId, name, starred: !!req.body.starred, todos };
    user.board.lists.push(newList);
    user.board.updatedAt = Date.now();
    await user.save();

    res.status(201).json({ message: `Created list "${name}"`, list: newList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/lists/:name", async (req, res) => {
  try {
    const user = await getTargetUser();
    const list = findList(user.board, req.params.name);
    if (!list) return res.status(404).json({ error: "List not found" });
    res.json({ list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/tasks", async (req, res) => {
  try {
    const user = await getTargetUser();
    let list = findList(user.board, req.body.list_name);
    if (!list) {
      list = { id: uid(), name: req.body.list_name.trim(), starred: false, todos: [] };
      user.board.lists.push(list);
    }
    const newTodo = {
      id: uid(),
      text: (req.body.task || "").trim(),
      done: false,
      starred: !!req.body.starred,
    };
    list.todos.push(newTodo);
    user.board.updatedAt = Date.now();
    await user.save();
    res.status(201).json({ message: "Task added", task: newTodo, list: list.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/tasks/complete", async (req, res) => {
  try {
    const user = await getTargetUser();
    let foundTodo = null;
    let foundList = null;

    for (const l of user.board.lists) {
      const t = findTodo(l, req.body.task_identifier);
      if (t) {
        foundTodo = t;
        foundList = l;
        break;
      }
    }

    if (!foundTodo) return res.status(404).json({ error: "Task not found" });

    foundTodo.done = req.body.done !== undefined ? !!req.body.done : true;
    user.board.updatedAt = Date.now();
    await user.save();

    res.json({
      message: `Task updated to ${foundTodo.done ? "done" : "pending"}`,
      task: foundTodo,
      list: foundList.name,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

