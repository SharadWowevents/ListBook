import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

dotenv.config();

const PORT = process.env.MCP_PORT || 5001;
const API_BASE = (process.env.LISTBOOK_API_URL || "http://127.0.0.1:5000/api").replace(/\/$/, "");

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Verify credentials directly against the User DB via Express Auth API
async function verifyUserInDB(name, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: String(name).trim(),
      password: String(password).trim(),
      pin: String(password).trim(), // sends both in case backend checks 'pin'
      strictLogin: true,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Invalid username or password");
  }
  return data; // { token, user: { name, key }, board }
}

function extractCredentials(req) {
  const authHeader = req.headers.authorization || "";

  // 1. Bearer Token (Format: "admin:1012")
  if (authHeader.startsWith("Bearer ")) {
    const raw = authHeader.slice(7).trim();
    const sep = raw.indexOf(":");
    if (sep !== -1) {
      return { name: raw.slice(0, sep), password: raw.slice(sep + 1) };
    }
  }

  // 2. Basic Auth
  if (authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep !== -1) {
      return { name: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
    }
  }

  // 3. URL Query Params (?name=admin&password=1012) or Headers
  const name = req.headers["x-user-name"] || req.query.name || process.env.LISTBOOK_NAME;
  const password =
    req.headers["x-user-password"] ||
    req.query.password ||
    req.query.pin ||
    process.env.LISTBOOK_PIN;

  return { name, password };
}

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

function createAuthenticatedMcpServer(userSession) {
  const { token, user } = userSession;
  const server = new McpServer({
    name: "listbook-mcp",
    version: "1.0.0",
  });

  server.tool(
    "get_all_lists",
    "Read all lists and tasks from Listbook.",
    {},
    async () => {
      const board = await fetchBoard(token);
      return {
        content: [{ type: "text", text: `Lists for ${user.name}:\n\n${formatBoardSummary(board)}` }],
      };
    }
  );

  server.tool(
    "get_list",
    "Get all tasks from a specific list by its name or ID.",
    { listNameOrId: z.string().describe("Name or ID of the list") },
    async ({ listNameOrId }) => {
      const board = await fetchBoard(token);
      const list = findList(board, listNameOrId);
      if (!list) {
        return { isError: true, content: [{ type: "text", text: `List "${listNameOrId}" not found.` }] };
      }
      const tasks = list.todos.length
        ? list.todos.map((t) => `- [${t.done ? "x" : " "}] ${t.starred ? "★ " : ""}${t.text} (id: ${t.id})`).join("\n")
        : "No tasks in this list.";
      return { content: [{ type: "text", text: `### ${list.name}\n${tasks}` }] };
    }
  );

  server.tool(
    "create_list",
    "Create a new list in Listbook with optional initial tasks.",
    {
      name: z.string().min(1).max(60).describe("Name of the new list"),
      starred: z.boolean().optional().default(false).describe("Whether to star the list"),
      initialTasks: z.array(z.string()).optional().describe("Optional initial tasks"),
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
        content: [{ type: "text", text: `Created list "${newList.name}" with ${newList.todos.length} task(s).` }],
      };
    }
  );

  server.tool(
    "add_tasks_to_list",
    "Add tasks to a list (creates the list automatically if it does not exist).",
    {
      listNameOrId: z.string().describe("Target list name or ID"),
      tasks: z
        .array(
          z.object({
            text: z.string().describe("Task text"),
            starred: z.boolean().optional().describe("Star this task"),
          })
        )
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
        content: [{ type: "text", text: `Added ${added.length} task(s) to "${list.name}".` }],
      };
    }
  );

  server.tool(
    "update_task",
    "Mark a task done/undone, star/unstar it, or rename it.",
    {
      listNameOrId: z.string().describe("List name or ID"),
      taskTextOrId: z.string().describe("Task text or ID"),
      done: z.boolean().optional().describe("Mark done (true) or open (false)"),
      starred: z.boolean().optional().describe("Star or unstar task"),
      newText: z.string().optional().describe("New text for the task"),
    },
    async ({ listNameOrId, taskTextOrId, done, starred, newText }) => {
      const board = await fetchBoard(token);
      const list = findList(board, listNameOrId);
      if (!list) return { isError: true, content: [{ type: "text", text: "List not found." }] };
      const q = taskTextOrId.trim().toLowerCase();
      const todo =
        list.todos.find((t) => t.id === taskTextOrId.trim()) ||
        list.todos.find((t) => t.text.toLowerCase().includes(q));
      if (!todo) return { isError: true, content: [{ type: "text", text: "Task not found." }] };

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
      listNameOrId: z.string().describe("List name or ID"),
      taskTextOrId: z.string().optional().describe("Task text/ID to delete (omit to delete entire list)"),
    },
    async ({ listNameOrId, taskTextOrId }) => {
      const board = await fetchBoard(token);
      const list = findList(board, listNameOrId);
      if (!list) return { isError: true, content: [{ type: "text", text: "List not found." }] };

      if (taskTextOrId) {
        const q = taskTextOrId.trim().toLowerCase();
        const idx = list.todos.findIndex(
          (t) => t.id === taskTextOrId.trim() || t.text.toLowerCase().includes(q)
        );
        if (idx === -1) return { isError: true, content: [{ type: "text", text: "Task not found." }] };
        const [removed] = list.todos.splice(idx, 1);
        await saveBoard(token, board);
        return { content: [{ type: "text", text: `Deleted task "${removed.text}".` }] };
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

// Expose mcp-session-id for browser/ChatGPT CORS preflight
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id", "mcp-session-id"],
    allowedHeaders: ["Content-Type", "mcp-session-id", "Mcp-Session-Id", "Authorization", "x-user-name", "x-user-password"],
  })
);

// Parse JSON bodies for Streamable HTTP POST requests (except legacy /mcp/messages which reads raw stream)
app.use((req, res, next) => {
  if (req.path.endsWith("/messages")) return next();
  express.json()(req, res, next);
});

// ============================================================================
// 1. MODERN STREAMABLE HTTP TRANSPORT (Used by ChatGPT Custom MCP Connectors)
// Works on BOTH /mcp and /mcp/sse
// ============================================================================
const mcpPaths = ["/mcp", "/mcp/", "/mcp/sse", "/sse", "/"];

app.post(mcpPaths, async (req, res) => {
  try {
    const { name, password } = extractCredentials(req);
    if (!name || !password) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Authentication required (name & password)." },
        id: null,
      });
    }

    const userSession = await verifyUserInDB(name, password);
    const server = createAuthenticatedMcpServer(userSession);

    // Stateless Streamable HTTP transport (recommended by OpenAI for ChatGPT MCP)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP POST error:", err.message);
    if (!res.headersSent) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: err.message || "Unauthorized" },
        id: null,
      });
    }
  }
});

// ============================================================================
// 2. LEGACY SSE TRANSPORT FALLBACK (GET /mcp/sse + POST /mcp/messages)
// ============================================================================
const sseTransports = {};

app.get(mcpPaths, async (req, res) => {
  try {
    const { name, password } = extractCredentials(req);
    if (!name || !password) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const userSession = await verifyUserInDB(name, password);
    const transport = new SSEServerTransport("/mcp/messages", res);
    sseTransports[transport.sessionId] = transport;
    res.on("close", () => delete sseTransports[transport.sessionId]);

    const server = createAuthenticatedMcpServer(userSession);
    await server.connect(transport);
  } catch (err) {
    console.error("MCP GET SSE error:", err.message);
    if (!res.headersSent) {
      return res.status(401).json({ error: err.message || "Unauthorized" });
    }
  }
});

app.post(["/mcp/messages", "/messages"], async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports[sessionId];
  if (!transport) return res.status(400).json({ error: "No active SSE session" });
  await transport.handlePostMessage(req, res);
});

app.listen(PORT, () => {
  console.log(`Listbook MCP Server (Streamable HTTP + SSE) listening on port ${PORT}`);
});