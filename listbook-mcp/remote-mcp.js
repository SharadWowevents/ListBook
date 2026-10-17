import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

dotenv.config();

const PORT = process.env.MCP_PORT || 5001;
const API_BASE = (process.env.LISTBOOK_API_URL || "http://127.0.0.1:5000/api").replace(/\/$/, "");

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Verify credentials directly against the User DB via the Express Auth API
async function verifyUserInDB(name, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: name.trim(),
      password: password.trim(),
      strictLogin: true, // Rejects if user does not exist or password/PIN is wrong
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Invalid username or password");
  }
  return data; // { token, user: { name, key }, board }
}

// Extract credentials from Basic Auth header, custom headers, or query params
function extractCredentials(req) {
  const authHeader = req.headers.authorization || "";

  // 1. Support ChatGPT's "Token" auth field (Format: "Name:Password", e.g., "Demo:1234")
  if (authHeader.startsWith("Bearer ")) {
    const rawToken = authHeader.slice(7).trim();
    const sepIndex = rawToken.indexOf(":");
    if (sepIndex !== -1) {
      return {
        name: rawToken.slice(0, sepIndex),
        password: rawToken.slice(sepIndex + 1),
      };
    }
  }

  // 2. Support Basic Auth header
  if (authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const sepIndex = decoded.indexOf(":");
    if (sepIndex !== -1) {
      return {
        name: decoded.slice(0, sepIndex),
        password: decoded.slice(sepIndex + 1),
      };
    }
  }

  // 3. Support URL Query Params (?name=Demo&password=1234) or Custom Headers
  const name = req.headers["x-user-name"] || req.query.name;
  const password = req.headers["x-user-password"] || req.query.password || req.query.pin;

  return { name, password };
}

// Board Helpers bound to a specific authenticated user's JWT token
async function fetchBoard(token) {
  const res = await fetch(`${API_BASE}/board`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch board");
  return data.board;
}

async function saveBoard(token, board) {
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

function findList(board, identifier) {
  const q = identifier.trim().toLowerCase();
  return (
    board.lists.find((l) => l.id === identifier.trim()) ||
    board.lists.find((l) => l.name.toLowerCase() === q) ||
    board.lists.find((l) => l.name.toLowerCase().includes(q))
  );
}

function formatBoardSummary(board) {
  if (!board.lists?.length) return "No lists found.";
  return board.lists
    .map((l) => {
      const tasks = l.todos.length
        ? l.todos
            .map((t) => `  - [${t.done ? "x" : " "}] ${t.starred ? "★ " : ""}${t.text} (id: ${t.id})`)
            .join("\n")
        : "  (Empty)";
      return `### ${l.starred ? "★ " : ""}${l.name} (id: ${l.id})\n${tasks}`;
    })
    .join("\n\n");
}

// Create an isolated MCP server instance scoped to the authenticated user's token
function createAuthenticatedMcpServer(userSession) {
  const { token, user } = userSession;
  const server = new McpServer({
    name: `listbook-mcp (${user.name})`,
    version: "1.0.0",
  });

  server.tool(
    "get_all_lists",
    "Read all lists and tasks for the authenticated user.",
    {},
    async () => {
      const board = await fetchBoard(token);
      return {
        content: [
          {
            type: "text",
            text: `Lists for ${user.name}:\n\n${formatBoardSummary(board)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_list",
    "Get all tasks from a specific list by its name or ID.",
    { listNameOrId: z.string() },
    async ({ listNameOrId }) => {
      const board = await fetchBoard(token);
      const list = findList(board, listNameOrId);
      if (!list) {
        return {
          isError: true,
          content: [{ type: "text", text: `List "${listNameOrId}" not found.` }],
        };
      }
      const tasks = list.todos.length
        ? list.todos
            .map((t) => `- [${t.done ? "x" : " "}] ${t.starred ? "★ " : ""}${t.text} (id: ${t.id})`)
            .join("\n")
        : "No tasks in this list.";
      return {
        content: [{ type: "text", text: `### ${list.name}\n${tasks}` }],
      };
    }
  );

  server.tool(
    "create_list",
    "Create a new list with optional initial tasks.",
    {
      name: z.string().min(1).max(60),
      starred: z.boolean().optional().default(false),
      initialTasks: z.array(z.string()).optional(),
    },
    async ({ name, starred, initialTasks }) => {
      const board = await fetchBoard(token);
      const newList = {
        id: uid(),
        name: name.trim(),
        starred: Boolean(starred),
        todos: (initialTasks || []).map((t) => ({
          id: uid(),
          text: t.trim(),
          done: false,
          starred: false,
        })),
      };
      board.lists.push(newList);
      board.activeId = newList.id;
      await saveBoard(token, board);
      return {
        content: [
          {
            type: "text",
            text: `Created list "${newList.name}" with ${newList.todos.length} task(s).`,
          },
        ],
      };
    }
  );

  server.tool(
    "add_tasks_to_list",
    "Add tasks to a list (creates the list if missing).",
    {
      listNameOrId: z.string(),
      tasks: z
        .array(z.object({ text: z.string(), starred: z.boolean().optional() }))
        .min(1),
    },
    async ({ listNameOrId, tasks }) => {
      const board = await fetchBoard(token);
      let list = findList(board, listNameOrId);
      if (!list) {
        list = { id: uid(), name: listNameOrId.trim(), starred: false, todos: [] };
        board.lists.push(list);
      }
      const added = tasks.map((t) => ({
        id: uid(),
        text: t.text.trim(),
        done: false,
        starred: Boolean(t.starred),
      }));
      list.todos.push(...added);
      board.activeId = list.id;
      await saveBoard(token, board);
      return {
        content: [
          { type: "text", text: `Added ${added.length} task(s) to "${list.name}".` },
        ],
      };
    }
  );

  server.tool(
    "update_task",
    "Mark a task done/undone, star/unstar it, or rename it.",
    {
      listNameOrId: z.string(),
      taskTextOrId: z.string(),
      done: z.boolean().optional(),
      starred: z.boolean().optional(),
      newText: z.string().optional(),
    },
    async ({ listNameOrId, taskTextOrId, done, starred, newText }) => {
      const board = await fetchBoard(token);
      const list = findList(board, listNameOrId);
      if (!list)
        return { isError: true, content: [{ type: "text", text: "List not found." }] };
      const q = taskTextOrId.trim().toLowerCase();
      const todo =
        list.todos.find((t) => t.id === taskTextOrId.trim()) ||
        list.todos.find((t) => t.text.toLowerCase().includes(q));
      if (!todo)
        return { isError: true, content: [{ type: "text", text: "Task not found." }] };

      if (typeof done === "boolean") todo.done = done;
      if (typeof starred === "boolean") todo.starred = starred;
      if (newText?.trim()) todo.text = newText.trim();
      await saveBoard(token, board);
      return { content: [{ type: "text", text: `Updated task "${todo.text}".` }] };
    }
  );

  server.tool(
    "delete_item",
    "Delete a specific task from a list, or delete an entire list.",
    {
      listNameOrId: z.string(),
      taskTextOrId: z.string().optional(),
    },
    async ({ listNameOrId, taskTextOrId }) => {
      const board = await fetchBoard(token);
      const list = findList(board, listNameOrId);
      if (!list)
        return { isError: true, content: [{ type: "text", text: "List not found." }] };

      if (taskTextOrId) {
        const q = taskTextOrId.trim().toLowerCase();
        const idx = list.todos.findIndex(
          (t) => t.id === taskTextOrId.trim() || t.text.toLowerCase().includes(q)
        );
        if (idx === -1)
          return { isError: true, content: [{ type: "text", text: "Task not found." }] };
        const [removed] = list.todos.splice(idx, 1);
        await saveBoard(token, board);
        return {
          content: [{ type: "text", text: `Deleted task "${removed.text}".` }],
        };
      }

      board.lists = board.lists.filter((l) => l.id !== list.id);
      if (board.activeId === list.id) {
        board.activeId = board.lists[0] ? board.lists[0].id : null;
      }
      await saveBoard(token, board);
      return { content: [{ type: "text", text: `Deleted list "${list.name}".` }] };
    }
  );

  return server;
}

const app = express();
app.use(cors());

const transports = {};

// Authenticate against User DB before establishing SSE MCP connection
app.get("/mcp/sse", async (req, res) => {
  try {
    const { name, password } = extractCredentials(req);
    if (!name || !password) {
      return res.status(401).json({
        error: "Authentication required. Provide your Listbook name and password/PIN.",
      });
    }

    // Check MongoDB User collection via Express API
    const userSession = await verifyUserInDB(name, password);

    const transport = new SSEServerTransport("/mcp/messages", res);
    transports[transport.sessionId] = transport;
    res.on("close", () => delete transports[transport.sessionId]);

    const server = createAuthenticatedMcpServer(userSession);
    await server.connect(transport);
  } catch (err) {
    return res.status(401).json({ error: err.message || "Unauthorized" });
  }
});

app.post("/mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) return res.status(400).json({ error: "No active SSE session" });
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () =>
  console.log(`Authenticated Listbook MCP Server running on port ${PORT}`)
);