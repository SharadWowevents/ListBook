const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { McpServer, ResourceTemplate } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { z } = require("zod");
const User = require("../models/User");

const router = express.Router();

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Temporary in-memory store for OAuth authorization codes (10 min expiry)
const authCodes = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of authCodes.entries()) {
    if (data.expiresAt < now) authCodes.delete(code);
  }
}, 60000);

// SSE Transports store
const sseTransports = new Map();

// Helper to find a list by name or ID
function findList(board, identifier) {
  if (!board?.lists || !identifier) return null;
  const q = String(identifier).trim().toLowerCase();
  return (
    board.lists.find((l) => l.id === identifier.trim()) ||
    board.lists.find((l) => l.name.toLowerCase() === q) ||
    board.lists.find((l) => l.name.toLowerCase().includes(q)) ||
    null
  );
}

// Helper to format board summary as markdown
function formatBoardSummary(board) {
  if (!board.lists?.length) return "No lists found. You can create one with `create_list`.";
  return board.lists
    .map((l) => {
      const star = l.starred ? " ★" : "";
      const tasks = l.todos?.length
        ? l.todos
            .map(
              (t) =>
                `  - [${t.done ? "x" : " "}] ${t.starred ? "★ " : ""}${t.text} (id: \`${t.id}\`)`
            )
            .join("\n")
        : "  _(No tasks in this list)_";
      return `### ${l.name}${star} (id: \`${l.id}\`)\n${tasks}`;
    })
    .join("\n\n");
}

// Factory to create an McpServer instance scoped to an authenticated user
function createMcpServerForUser(user) {
  const server = new McpServer({
    name: "listbook-mcp",
    version: "1.0.0",
  });

  // 1. get_all_lists
  server.tool(
    "get_all_lists",
    "Read all lists and tasks from ListBook for the authenticated user.",
    {},
    async () => {
      const freshUser = await User.findById(user._id);
      const board = freshUser?.board || { lists: [] };
      return {
        content: [
          {
            type: "text",
            text: `Lists for ${user.displayName}:\n\n${formatBoardSummary(board)}`,
          },
        ],
      };
    }
  );

  // 2. get_list
  server.tool(
    "get_list",
    "Get all tasks from a specific list by its name or ID.",
    {
      listNameOrId: z.string().describe("Name or ID of the list"),
      status: z.enum(["all", "pending", "completed"]).optional().default("all"),
    },
    async ({ listNameOrId, status }) => {
      const freshUser = await User.findById(user._id);
      const board = freshUser?.board || { lists: [] };
      const list = findList(board, listNameOrId);
      if (!list) {
        return {
          isError: true,
          content: [{ type: "text", text: `List "${listNameOrId}" not found.` }],
        };
      }

      let todos = list.todos || [];
      if (status === "pending") todos = todos.filter((t) => !t.done);
      if (status === "completed") todos = todos.filter((t) => t.done);

      const tasks = todos.length
        ? todos
            .map(
              (t) =>
                `- [${t.done ? "x" : " "}] ${t.starred ? "★ " : ""}${t.text} (id: \`${t.id}\`)`
            )
            .join("\n")
        : "No tasks found in this list.";

      return {
        content: [{ type: "text", text: `### ${list.name}${list.starred ? " ★" : ""}\n${tasks}` }],
      };
    }
  );

  // 3. create_list
  server.tool(
    "create_list",
    "Create a new list in ListBook with optional initial tasks.",
    {
      name: z.string().min(1).max(60).describe("Name of the new list"),
      starred: z.boolean().optional().default(false).describe("Whether to star the list"),
      initialTasks: z.array(z.string()).optional().describe("Optional initial tasks array"),
    },
    async ({ name, starred, initialTasks = [] }) => {
      const freshUser = await User.findById(user._id);
      if (!freshUser.board) freshUser.board = { lists: [], activeId: null, updatedAt: Date.now() };

      const newList = {
        id: uid(),
        name: name.trim(),
        starred: Boolean(starred),
        todos: initialTasks.map((t) => ({
          id: uid(),
          text: t.trim(),
          done: false,
          starred: false,
        })),
      };

      freshUser.board.lists.push(newList);
      freshUser.board.activeId = newList.id;
      freshUser.board.updatedAt = Date.now();
      await freshUser.save();

      return {
        content: [
          {
            type: "text",
            text: `✅ Created list "${newList.name}" (ID: \`${newList.id}\`) with ${newList.todos.length} task(s).`,
          },
        ],
      };
    }
  );

  // 4. add_tasks_to_list
  server.tool(
    "add_tasks_to_list",
    "Add one or more tasks to a list (creates the list automatically if missing).",
    {
      listNameOrId: z.string().describe("Target list name or ID"),
      tasks: z
        .array(
          z.object({
            text: z.string().describe("Task description text"),
            starred: z.boolean().optional().describe("Whether to star this task"),
          })
        )
        .min(1)
        .describe("Array of task objects to add"),
    },
    async ({ listNameOrId, tasks }) => {
      const freshUser = await User.findById(user._id);
      if (!freshUser.board) freshUser.board = { lists: [], activeId: null, updatedAt: Date.now() };

      let list = findList(freshUser.board, listNameOrId);
      let wasCreated = false;

      if (!list) {
        list = { id: uid(), name: listNameOrId.trim(), starred: false, todos: [] };
        freshUser.board.lists.push(list);
        wasCreated = true;
      }

      const added = tasks.map((t) => ({
        id: uid(),
        text: t.text.trim(),
        done: false,
        starred: Boolean(t.starred),
      }));

      list.todos.push(...added);
      freshUser.board.activeId = list.id;
      freshUser.board.updatedAt = Date.now();
      await freshUser.save();

      return {
        content: [
          {
            type: "text",
            text: `✅ ${wasCreated ? "Created list and added" : "Added"} ${added.length} task(s) to "${list.name}".`,
          },
        ],
      };
    }
  );

  // 5. update_task
  server.tool(
    "update_task",
    "Update a task's status (done/undone), star status, or text.",
    {
      listNameOrId: z.string().describe("List name or ID"),
      taskTextOrId: z.string().describe("Task text or ID to find"),
      done: z.boolean().optional().describe("Mark done (true) or open (false)"),
      starred: z.boolean().optional().describe("Star or unstar the task"),
      newText: z.string().optional().describe("New text for the task"),
    },
    async ({ listNameOrId, taskTextOrId, done, starred, newText }) => {
      const freshUser = await User.findById(user._id);
      const list = findList(freshUser.board, listNameOrId);
      if (!list) return { isError: true, content: [{ type: "text", text: "List not found." }] };

      const q = taskTextOrId.trim().toLowerCase();
      const todo =
        list.todos.find((t) => t.id === taskTextOrId.trim()) ||
        list.todos.find((t) => t.text.toLowerCase().includes(q));

      if (!todo) return { isError: true, content: [{ type: "text", text: "Task not found." }] };

      if (typeof done === "boolean") todo.done = done;
      if (typeof starred === "boolean") todo.starred = starred;
      if (newText?.trim()) todo.text = newText.trim();

      freshUser.board.updatedAt = Date.now();
      await freshUser.save();

      return {
        content: [
          {
            type: "text",
            text: `✅ Updated task "${todo.text}" (done: ${todo.done}, starred: ${todo.starred}).`,
          },
        ],
      };
    }
  );

  // 6. delete_item
  server.tool(
    "delete_item",
    "Delete a specific task from a list, or delete an entire list.",
    {
      listNameOrId: z.string().describe("List name or ID"),
      taskTextOrId: z.string().optional().describe("Task text/ID to delete (omit to delete entire list)"),
    },
    async ({ listNameOrId, taskTextOrId }) => {
      const freshUser = await User.findById(user._id);
      const list = findList(freshUser.board, listNameOrId);
      if (!list) return { isError: true, content: [{ type: "text", text: "List not found." }] };

      if (taskTextOrId) {
        const q = taskTextOrId.trim().toLowerCase();
        const idx = list.todos.findIndex(
          (t) => t.id === taskTextOrId.trim() || t.text.toLowerCase().includes(q)
        );
        if (idx === -1) return { isError: true, content: [{ type: "text", text: "Task not found." }] };

        const [removed] = list.todos.splice(idx, 1);
        freshUser.board.updatedAt = Date.now();
        await freshUser.save();
        return { content: [{ type: "text", text: `🗑️ Deleted task "${removed.text}".` }] };
      }

      freshUser.board.lists = freshUser.board.lists.filter((l) => l.id !== list.id);
      if (freshUser.board.activeId === list.id) {
        freshUser.board.activeId = freshUser.board.lists[0] ? freshUser.board.lists[0].id : null;
      }
      freshUser.board.updatedAt = Date.now();
      await freshUser.save();
      return { content: [{ type: "text", text: `🗑️ Deleted list "${list.name}".` }] };
    }
  );

  // 7. search_tasks
  server.tool(
    "search_tasks",
    "Search tasks across all lists by keyword.",
    { query: z.string().describe("Search term") },
    async ({ query }) => {
      const freshUser = await User.findById(user._id);
      const q = query.toLowerCase().trim();
      const results = [];

      for (const l of freshUser.board?.lists || []) {
        for (const t of l.todos || []) {
          if (t.text.toLowerCase().includes(q)) {
            results.push({ listName: l.name, todo: t });
          }
        }
      }

      if (!results.length) {
        return { content: [{ type: "text", text: `No tasks found matching "${query}".` }] };
      }

      const lines = results.map(
        (r) =>
          `- **[${r.listName}]** [${r.todo.done ? "x" : " "}] ${r.todo.starred ? "★ " : ""}${r.todo.text} (id: \`${r.todo.id}\`)`
      );
      return {
        content: [{ type: "text", text: `Search results for "${query}":\n\n${lines.join("\n")}` }],
      };
    }
  );

  return server;
}

// Helper to authenticate request and return User document
async function authenticateRequest(req) {
  const authHeader = req.headers.authorization || "";

  // 1. Bearer Token
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user) return user;
    } catch {}

    // Fallback: Check if token is formatted as "username:pin"
    const sep = token.indexOf(":");
    if (sep !== -1) {
      const u = token.slice(0, sep).trim().toLowerCase();
      const p = token.slice(sep + 1).trim();
      const user = await User.findOne({ usernameKey: u });
      if (user && (await bcrypt.compare(p, user.pinHash))) return user;
    }
  }

  // 2. Query param ?token=... or ?access_token=...
  const queryToken = req.query.token || req.query.access_token;
  if (queryToken) {
    try {
      const decoded = jwt.verify(queryToken, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user) return user;
    } catch {}
  }

  // 3. Basic Auth header
  if (authHeader.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const u = decoded.slice(0, sep).trim().toLowerCase();
        const p = decoded.slice(sep + 1).trim();
        const user = await User.findOne({ usernameKey: u });
        if (user && (await bcrypt.compare(p, user.pinHash))) return user;
      }
    } catch {}
  }

  // 4. Custom headers (x-user-name, x-user-password)
  const headerName = req.headers["x-user-name"];
  const headerPass = req.headers["x-user-password"] || req.headers["x-user-pin"];
  if (headerName && headerPass) {
    const user = await User.findOne({ usernameKey: String(headerName).trim().toLowerCase() });
    if (user && (await bcrypt.compare(String(headerPass).trim(), user.pinHash))) return user;
  }

  return null;
}

// PKCE Verification Helper (RFC 7636)
function verifyPkce(verifier, challenge, method) {
  if (!challenge) return true; // No PKCE requested by client
  if (!verifier) return false;
  if (method === "S256" || !method) {
    const hash = crypto.createHash("sha256").update(verifier).digest();
    const computed = hash
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return computed === challenge;
  }
  if (method === "plain") {
    return verifier === challenge;
  }
  return false;
}

// Helper to get fully qualified origin with HTTPS forced in production
function getOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.get("host") || "listbook.wowosapps.com";
  const proto =
    req.headers["x-forwarded-proto"] ||
    req.protocol ||
    (host.includes("localhost") ? "http" : "https");

  const finalProto = host.includes("localhost") ? proto : "https";
  return `${finalProto}://${host}`;
}

// Helper to send 401 with standard WWW-Authenticate pointing to metadata
function sendUnauthorized(res, req, message = "Authentication required.") {
  const origin = getOrigin(req);
  res.setHeader(
    "WWW-Authenticate",
    `Bearer realm="ListBook", error="unauthorized", resource_metadata="${origin}/api/mcp/.well-known/oauth-protected-resource"`
  );
  return res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message },
    id: null,
  });
}

// OAuth 2.0 Authorization Server Metadata (RFC 8414 / OpenID Connect Discovery)
function getDiscoveryMetadata(req, res) {
  const origin = getOrigin(req);
  res.setHeader("Content-Type", "application/json");
  return res.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/authorize`,
    token_endpoint: `${origin}/api/mcp/token`,
    registration_endpoint: `${origin}/api/mcp/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
      "none",
    ],
    code_challenge_methods_supported: ["S256", "plain"],
    scopes_supported: ["read", "write"],
  });
}

// OAuth 2.0 Protected Resource Metadata (RFC 9728)
function getProtectedResourceMetadata(req, res) {
  const origin = getOrigin(req);
  res.setHeader("Content-Type", "application/json");
  return res.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin, `${origin}/api/mcp`],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
  });
}

// Dynamic Client Registration (RFC 7591)
function registrationHandler(req, res) {
  const origin = getOrigin(req);
  const clientId = "chatgpt-" + uid();
  const clientSecret = uid() + uid();
  const body = req.body || {};

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris
    : body.redirect_uri
    ? [body.redirect_uri]
    : [];

  const responseData = {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    client_name: body.client_name || "ChatGPT MCP Client",
    redirect_uris: redirectUris,
    grant_types: body.grant_types || ["authorization_code", "refresh_token"],
    response_types: body.response_types || ["code"],
    token_endpoint_auth_method: body.token_endpoint_auth_method || "client_secret_post",
    scope: body.scope || "read write",
  };

  res.setHeader("Content-Type", "application/json");
  return res.status(201).json(responseData);
}

// HTML Login Page Template
function renderLoginPage({
  errorMessage = "",
  redirect_uri = "",
  state = "",
  client_id = "",
  response_type = "code",
  code_challenge = "",
  code_challenge_method = "",
  scope = "",
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ListBook • MCP Authorization</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@600;700&family=Figtree:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #F5F6F4; --panel: #FFFFFF; --ink: #16191A; --muted: #6B7270;
      --line: #E2E5E2; --accent: #1E6B57; --accent-hover: #155141; --danger: #B4412F;
      --radius: 16px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0F1211; --panel: #171B1A; --ink: #EEF1EF; --muted: #97A09C;
        --line: #2A302E; --accent: #4FB394; --accent-hover: #3ca283; --danger: #E5735F;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg); color: var(--ink);
      font-family: 'Figtree', system-ui, sans-serif;
      min-height: 100vh; display: grid; place-items: center; padding: 24px;
    }
    .card {
      background: var(--panel); border: 1.5px solid var(--line);
      border-radius: var(--radius); padding: 40px 32px; width: 100%; max-width: 440px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.06);
    }
    .brand {
      font-family: 'Familjen Grotesk', sans-serif; font-size: 2.2rem;
      font-weight: 700; letter-spacing: -0.03em; margin-bottom: 6px;
    }
    .brand span { color: var(--accent); }
    .badge {
      display: inline-block; font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; padding: 4px 8px; border-radius: 6px;
      background: var(--line); color: var(--muted); margin-bottom: 16px;
    }
    .desc {
      color: var(--muted); font-size: 0.98rem; line-height: 1.45; margin-bottom: 24px;
    }
    .field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
    .field label {
      font-size: 0.8rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--muted);
    }
    .input {
      width: 100%; font-size: 1.15rem; padding: 14px 16px; border-radius: 12px;
      border: 1.5px solid var(--line); background: var(--bg); color: var(--ink);
      outline: none; transition: border-color 0.15s ease;
    }
    .input:focus { border-color: var(--accent); }
    .btn {
      width: 100%; background: var(--accent); color: #FFFFFF; font-size: 1.1rem;
      font-weight: 600; padding: 15px; border-radius: 12px; border: none;
      cursor: pointer; transition: background-color 0.15s ease; margin-top: 8px;
    }
    .btn:hover { background: var(--accent-hover); }
    .alert {
      background: rgba(180, 65, 47, 0.1); border: 1px solid var(--danger);
      color: var(--danger); padding: 12px 14px; border-radius: 10px;
      font-size: 0.9rem; margin-bottom: 20px;
    }
    .footer {
      margin-top: 24px; text-align: center; font-size: 0.85rem; color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Model Context Protocol • OAuth 2.0</div>
    <div class="brand">List<span>book</span></div>
    <p class="desc">Authenticate with your ListBook account to authorize access for your AI assistant.</p>

    ${errorMessage ? `<div class="alert">${errorMessage}</div>` : ""}

    <form method="POST" action="/api/mcp/authorize">
      <input type="hidden" name="redirect_uri" value="${redirect_uri}">
      <input type="hidden" name="state" value="${state}">
      <input type="hidden" name="client_id" value="${client_id}">
      <input type="hidden" name="response_type" value="${response_type}">
      <input type="hidden" name="code_challenge" value="${code_challenge}">
      <input type="hidden" name="code_challenge_method" value="${code_challenge_method}">
      <input type="hidden" name="scope" value="${scope}">

      <div class="field">
        <label for="name">Username</label>
        <input class="input" type="text" id="name" name="name" placeholder="e.g. admin or demo" required autofocus>
      </div>

      <div class="field">
        <label for="password">Password / 4-Digit PIN</label>
        <input class="input" type="password" id="password" name="password" placeholder="••••" required>
      </div>

      <button type="submit" class="btn">Authorize & Connect</button>
    </form>
    <div class="footer">ListBook AI Security • Access scopes to your private board</div>
  </div>
</body>
</html>`;
}

// Success Confirmation Page Template (Direct Browser Access)
function renderSuccessPage({ user, token, req }) {
  const origin = getOrigin(req);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ListBook • MCP Authorization Granted</title>
  <link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@600;700&family=Figtree:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #F5F6F4; --panel: #FFFFFF; --ink: #16191A; --muted: #6B7270;
      --line: #E2E5E2; --accent: #1E6B57;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0F1211; --panel: #171B1A; --ink: #EEF1EF; --muted: #97A09C;
        --line: #2A302E; --accent: #4FB394;
      }
    }
    body {
      background: var(--bg); color: var(--ink); font-family: 'Figtree', sans-serif;
      min-height: 100vh; display: grid; place-items: center; padding: 24px;
    }
    .card {
      background: var(--panel); border: 1.5px solid var(--line); border-radius: 16px;
      padding: 36px 32px; width: 100%; max-width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.06);
    }
    h2 { font-family: 'Familjen Grotesk', sans-serif; margin-bottom: 8px; }
    p { color: var(--muted); font-size: 0.95rem; margin-bottom: 20px; line-height: 1.45; }
    .box {
      background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
      padding: 12px 14px; font-family: monospace; font-size: 0.85rem; word-break: break-all;
      margin-bottom: 16px;
    }
    .label { font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--muted); margin-bottom: 4px; }
    a.btn {
      display: inline-block; background: var(--accent); color: #FFFFFF; text-decoration: none;
      padding: 12px 20px; border-radius: 10px; font-weight: 600; font-size: 0.95rem; text-align: center;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>✅ Authorized as ${user.displayName}</h2>
    <p>Your account is authenticated for Model Context Protocol (MCP) access.</p>
    
    <div class="label">MCP Endpoint URL:</div>
    <div class="box">${origin}/api/mcp</div>

    <div class="label">Bearer Access Token:</div>
    <div class="box">${token}</div>

    <p style="margin-top: 16px; font-size: 0.85rem;">Use this URL and Bearer token in your MCP client or ChatGPT Custom GPT.</p>
    <a href="/" class="btn">Open ListBook Web App</a>
  </div>
</body>
</html>`;
}

// ============================================================================
// OAUTH 2.0 ENDPOINTS
// ============================================================================

// RFC 8414 & RFC 9728 Discovery Endpoints
router.get(
  [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ],
  getDiscoveryMetadata
);
router.get(
  "/.well-known/oauth-protected-resource",
  getProtectedResourceMetadata
);

router.post(["/register", "/api/mcp/register"], registrationHandler);

// GET /api/mcp and /api/mcp/authorize:
// - If browser request without bearer token: renders the Login Form!
// - If MCP client request with Bearer token: routes to MCP handler!
router.get(["/", "/authorize"], async (req, res, next) => {
  const acceptHeader = req.headers.accept || "";
  const isBrowserHtmlRequest = acceptHeader.includes("text/html");
  const isAuthorizeRoute = req.path.includes("authorize") || Boolean(req.query.redirect_uri);

  const user = await authenticateRequest(req);

  if (user && !req.query.redirect_uri) {
    if (isBrowserHtmlRequest) {
      const token = jwt.sign(
        { id: user._id, displayName: user.displayName },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );
      return res.send(renderSuccessPage({ user, token, req }));
    }
    return next();
  }

  // Only render the HTML login page if this is an OAuth redirect flow (/authorize)
  // or a direct browser navigation explicitly requesting text/html
  if (isAuthorizeRoute || isBrowserHtmlRequest) {
    return res.send(
      renderLoginPage({
        redirect_uri: req.query.redirect_uri || "",
        state: req.query.state || "",
        client_id: req.query.client_id || "",
        response_type: req.query.response_type || "code",
        code_challenge: req.query.code_challenge || "",
        code_challenge_method: req.query.code_challenge_method || "",
        scope: req.query.scope || "",
      })
    );
  }

  // For MCP clients probing GET /api/mcp without a token, return 401 + WWW-Authenticate
  return sendUnauthorized(res, req, "Authentication required.");
});

// POST /api/mcp/authorize: Handles the login form submission
router.post(["/authorize", "/login"], async (req, res) => {
  try {
    const {
      name,
      password,
      pin,
      redirect_uri,
      state,
      client_id,
      response_type,
      code_challenge,
      code_challenge_method,
      scope,
    } = req.body;
    const trimmedName = (name || "").trim();
    const secret = (password || pin || "").trim();

    if (!trimmedName || !secret) {
      return res.send(
        renderLoginPage({
          errorMessage: "Username and password / PIN are required.",
          redirect_uri,
          state,
          client_id,
          response_type,
          code_challenge,
          code_challenge_method,
          scope,
        })
      );
    }

    const usernameKey = trimmedName.toLowerCase();
    let user = await User.findOne({ usernameKey });

    if (!user) {
      // If user does not exist, support creating with 4-digit PIN
      if (!/^\d{4}$/.test(secret)) {
        return res.send(
          renderLoginPage({
            errorMessage: "User not found. To create a new account, enter a 4-digit PIN.",
            redirect_uri,
            state,
            client_id,
            response_type,
            code_challenge,
            code_challenge_method,
            scope,
          })
        );
      }
      const salt = await bcrypt.genSalt(10);
      const pinHash = await bcrypt.hash(secret, salt);
      user = await User.create({
        usernameKey,
        displayName: trimmedName,
        pinHash,
        board: { lists: [], activeId: null, updatedAt: Date.now() },
      });
    } else {
      const isMatch = await bcrypt.compare(secret, user.pinHash);
      if (!isMatch) {
        return res.send(
          renderLoginPage({
            errorMessage: "Invalid username or password/PIN. Try again.",
            redirect_uri,
            state,
            client_id,
            response_type,
            code_challenge,
            code_challenge_method,
            scope,
          })
        );
      }
    }

    // CASE 1: Standard OAuth Authorization Code Grant (ChatGPT, Claude, etc.)
    if (redirect_uri) {
      const code = uid();
      authCodes.set(code, {
        userId: user._id,
        displayName: user.displayName,
        expiresAt: Date.now() + 10 * 60 * 1000,
        clientId: client_id || "",
        redirectUri: redirect_uri,
        codeChallenge: code_challenge || "",
        codeChallengeMethod: code_challenge_method || "",
        scope: scope || "read write",
      });

      try {
        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set("code", code);
        if (state) redirectUrl.searchParams.set("state", state);
        return res.redirect(redirectUrl.toString());
      } catch {
        const delimiter = redirect_uri.includes("?") ? "&" : "?";
        let target = `${redirect_uri}${delimiter}code=${encodeURIComponent(code)}`;
        if (state) target += `&state=${encodeURIComponent(state)}`;
        return res.redirect(target);
      }
    }

    // CASE 2: Direct browser hit to /api/mcp (Show success & access token)
    const token = jwt.sign(
      { id: user._id, displayName: user.displayName },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.send(renderSuccessPage({ user, token, req }));
  } catch (err) {
    console.error("Authorize error:", err);
    return res.status(500).send("Server error during authorization.");
  }
});

// POST /api/oauth/token and /api/mcp/token: Standard OAuth 2.0 Token Endpoint
const tokenHandler = async (req, res) => {
  try {
    const grantType = req.body.grant_type || req.query.grant_type;

    // Grant 1: Authorization Code
    if (grantType === "authorization_code") {
      const code = req.body.code || req.query.code;
      if (!code || !authCodes.has(code)) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "Invalid or expired authorization code.",
        });
      }

      const codeData = authCodes.get(code);
      authCodes.delete(code); // single-use

      // PKCE verification (RFC 7636)
      const codeVerifier = req.body.code_verifier || req.query.code_verifier;
      if (
        codeData.codeChallenge &&
        !verifyPkce(codeVerifier, codeData.codeChallenge, codeData.codeChallengeMethod)
      ) {
        return res.status(400).json({
          error: "invalid_grant",
          error_description: "PKCE verification failed.",
        });
      }

      const token = jwt.sign(
        { id: codeData.userId, displayName: codeData.displayName },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );

      return res.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 30 * 24 * 60 * 60,
        refresh_token: token,
        scope: codeData.scope || "read write",
      });
    }

    // Grant 2: Refresh token
    if (grantType === "refresh_token") {
      const refreshToken = req.body.refresh_token || req.query.refresh_token;
      if (!refreshToken) {
        return res.status(400).json({ error: "invalid_grant", error_description: "Missing refresh_token." });
      }
      try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) {
          return res.status(400).json({ error: "invalid_grant", error_description: "User not found." });
        }
        const newToken = jwt.sign(
          { id: user._id, displayName: user.displayName },
          process.env.JWT_SECRET,
          { expiresIn: "30d" }
        );
        return res.json({
          access_token: newToken,
          token_type: "Bearer",
          expires_in: 30 * 24 * 60 * 60,
          refresh_token: newToken,
          scope: "read write",
        });
      } catch (err) {
        return res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired refresh token." });
      }
    }

    // Grant 3: Password credentials (convenience fallback)
    if (grantType === "password") {
      const username = req.body.username || req.body.name;
      const password = req.body.password || req.body.pin;
      const user = await User.findOne({ usernameKey: String(username).toLowerCase().trim() });
      if (!user || !(await bcrypt.compare(String(password).trim(), user.pinHash))) {
        return res.status(400).json({ error: "invalid_grant", error_description: "Invalid credentials." });
      }

      const token = jwt.sign(
        { id: user._id, displayName: user.displayName },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );

      return res.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 30 * 24 * 60 * 60,
        refresh_token: token,
        scope: "read write",
      });
    }

    return res.status(400).json({ error: "unsupported_grant_type" });
  } catch (err) {
    console.error("Token endpoint error:", err);
    return res.status(500).json({ error: "server_error" });
  }
};

router.post(["/token", "/api/mcp/token", "/api/oauth/token"], tokenHandler);

// ============================================================================
// MCP SERVER TRANSPORTS (Streamable HTTP & SSE)
// ============================================================================

// 1. STREAMABLE HTTP TRANSPORT (POST /api/mcp)
router.post("/", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return sendUnauthorized(res, req, "Unauthorized. Please authenticate with OAuth or Bearer token.");
    }

    // Ensure accept header allows text/event-stream per Streamable HTTP spec
    if (req.headers.accept && !req.headers.accept.includes("text/event-stream")) {
      req.headers.accept = `${req.headers.accept}, text/event-stream`;
    } else if (!req.headers.accept) {
      req.headers.accept = "application/json, text/event-stream";
    }

    const server = createMcpServerForUser(user);
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
    console.error("MCP Streamable HTTP error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ jsonrpc: "2.0", error: { code: -32000, message: err.message }, id: null });
    }
  }
});

// 2. SSE TRANSPORT (GET /api/mcp/sse)
router.get("/sse", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return sendUnauthorized(res, req, "Unauthorized. Bearer token required.");
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const transport = new SSEServerTransport("/api/mcp/messages", res);
    sseTransports.set(transport.sessionId, transport);
    res.on("close", () => sseTransports.delete(transport.sessionId));

    const server = createMcpServerForUser(user);
    await server.connect(transport);
  } catch (err) {
    console.error("MCP SSE error:", err);
    res.status(500).end("Internal Server Error");
  }
});

// 3. SSE MESSAGES HANDLER (POST /api/mcp/messages)
router.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports.get(sessionId);
  if (!transport) return res.status(404).send("Session not found");
  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (err) {
    res.status(500).end("Error handling message");
  }
});

// ============================================================================
// OPENAPI 3.0 SPECIFICATION WITH OAUTH 2.0 (For ChatGPT Actions)
// ============================================================================
router.get("/openapi.json", (req, res) => {
  const origin = getOrigin(req);
  res.json({
    openapi: "3.0.0",
    info: {
      title: "ListBook MCP API with OAuth 2.0",
      description: "Manage ListBook lists and tasks via OAuth-secured MCP actions",
      version: "1.0.0",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/board": {
        get: {
          operationId: "getBoard",
          summary: "Get current user lists and todos",
          security: [{ OAuth2: ["read"] }],
          responses: { "200": { description: "User board data" } },
        },
        put: {
          operationId: "saveBoard",
          summary: "Save and update board lists",
          security: [{ OAuth2: ["write"] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { "200": { description: "Board saved" } },
        },
      },
    },
    components: {
      securitySchemes: {
        OAuth2: {
          type: "oauth2",
          description: "ListBook OAuth 2.0 Authentication",
          flows: {
            authorizationCode: {
              authorizationUrl: `${origin}/api/mcp/authorize`,
              tokenUrl: `${origin}/api/mcp/token`,
              scopes: {
                read: "Read your lists and tasks",
                write: "Create and update lists and tasks",
              },
            },
          },
        },
      },
    },
  });
});

router.discoveryHandler = getDiscoveryMetadata;
router.protectedResourceHandler = getProtectedResourceMetadata;
router.registrationHandler = registrationHandler;
router.tokenHandler = tokenHandler;

module.exports = router;
