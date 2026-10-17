#!/usr/bin/env node

import http from "http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { server } from "./index.js";
import {
  connectDB,
  getTargetUser,
  findList,
  findTodo,
  uid,
  User,
} from "./db.js";

const PORT = process.env.MCP_HTTP_PORT || 3001;
const transports = new Map();

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data, null, 2));
}

// Generate OpenAPI 3.0 specification for Custom GPT Actions
function getOpenApiSpec(baseUrl) {
  return {
    openapi: "3.0.0",
    info: {
      title: "ListBook API for ChatGPT",
      description: "Manage ListBook lists and tasks directly from ChatGPT",
      version: "1.0.0",
    },
    servers: [{ url: baseUrl || `http://localhost:${PORT}` }],
    paths: {
      "/api/lists": {
        get: {
          operationId: "getLists",
          summary: "Get all lists with pending and total task counts",
          responses: {
            "200": {
              description: "List of all boards/lists",
            },
          },
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
                    name: { type: "string", description: "Name of the list" },
                    initial_tasks: {
                      type: "array",
                      items: { type: "string" },
                      description: "Optional tasks to add immediately",
                    },
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
              description: "The name of the list",
            },
          ],
          responses: { "200": { description: "List details and tasks" } },
        },
      },
      "/api/tasks": {
        post: {
          operationId: "addTask",
          summary: "Add a task to a list (auto-creates list if missing)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    list_name: { type: "string", description: "Target list name" },
                    task: { type: "string", description: "Task description text" },
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
                    task_identifier: {
                      type: "string",
                      description: "Task ID or matching task text",
                    },
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
  };
}

const serverHttp = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-session-id"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  // 1. MCP SSE Endpoints (for ChatGPT Developer Mode MCP connection)
  if (req.method === "GET" && pathname === "/sse") {
    try {
      await connectDB();
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);

      res.on("close", () => {
        transports.delete(transport.sessionId);
        console.error(`[MCP SSE] Session ${transport.sessionId} disconnected.`);
      });

      console.error(`[MCP SSE] New client connected. Session: ${transport.sessionId}`);
      await server.connect(transport);
    } catch (err) {
      console.error("[MCP SSE] Error on /sse:", err);
      res.writeHead(500).end("Internal Server Error");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId");
    const transport = transports.get(sessionId);

    if (!transport) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Session not found");
      return;
    }

    try {
      await transport.handlePostMessage(req, res);
    } catch (err) {
      console.error("[MCP SSE] PostMessage error:", err);
      res.writeHead(500).end("Internal Server Error");
    }
    return;
  }

  // 2. Health & Status
  if (pathname === "/" || pathname === "/health") {
    sendJson(res, 200, {
      status: "online",
      name: "ListBook MCP & HTTP Server",
      mcp_sse_endpoint: `${url.origin}/sse`,
      mcp_messages_endpoint: `${url.origin}/messages`,
      openapi_spec: `${url.origin}/openapi.json`,
    });
    return;
  }

  // 3. OpenAPI 3.0 specification for ChatGPT Actions
  if (pathname === "/openapi.json") {
    sendJson(res, 200, getOpenApiSpec(url.origin));
    return;
  }

  // 4. REST Endpoints for Custom GPT Actions
  if (pathname === "/api/lists" && req.method === "GET") {
    try {
      const user = await getTargetUser();
      const lists = (user.board?.lists || []).map((l) => ({
        id: l.id,
        name: l.name,
        starred: l.starred,
        totalTasks: l.todos?.length || 0,
        pendingTasks: l.todos?.filter((t) => !t.done).length || 0,
      }));
      sendJson(res, 200, { user: user.displayName, lists });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === "/api/lists" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const user = await getTargetUser();
      const name = (body.name || "").trim();
      if (!name) return sendJson(res, 400, { error: "List name is required" });

      const listId = uid();
      const todos = (body.initial_tasks || []).map((t) => ({
        id: uid(),
        text: t.trim(),
        done: false,
        starred: false,
      }));

      const newList = { id: listId, name, starred: !!body.starred, todos };
      user.board.lists.push(newList);
      user.board.updatedAt = Date.now();
      await user.save();

      sendJson(res, 201, { message: `Created list "${name}"`, list: newList });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname.startsWith("/api/lists/") && req.method === "GET") {
    try {
      const listName = decodeURIComponent(pathname.replace("/api/lists/", ""));
      const user = await getTargetUser();
      const list = findList(user.board, listName);
      if (!list) return sendJson(res, 404, { error: `List "${listName}" not found` });
      sendJson(res, 200, { list });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === "/api/tasks" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const user = await getTargetUser();
      let list = findList(user.board, body.list_name);

      if (!list) {
        list = { id: uid(), name: body.list_name.trim(), starred: false, todos: [] };
        user.board.lists.push(list);
      }

      const newTodo = {
        id: uid(),
        text: (body.task || "").trim(),
        done: false,
        starred: !!body.starred,
      };

      list.todos.push(newTodo);
      user.board.updatedAt = Date.now();
      await user.save();

      sendJson(res, 201, { message: "Task added", task: newTodo, list: list.name });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === "/api/tasks/complete" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const user = await getTargetUser();
      let foundTodo = null;
      let foundList = null;

      for (const l of user.board.lists) {
        const t = findTodo(l, body.task_identifier);
        if (t) {
          foundTodo = t;
          foundList = l;
          break;
        }
      }

      if (!foundTodo) {
        return sendJson(res, 404, { error: `Task "${body.task_identifier}" not found` });
      }

      foundTodo.done = body.done !== undefined ? !!body.done : true;
      user.board.updatedAt = Date.now();
      await user.save();

      sendJson(res, 200, {
        message: `Task updated to ${foundTodo.done ? "done" : "pending"}`,
        task: foundTodo,
        list: foundList.name,
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Route not found" });
});

async function start() {
  await connectDB();
  serverHttp.listen(PORT, () => {
    console.error(`[ListBook MCP HTTP/SSE] Server running on http://localhost:${PORT}`);
    console.error(`  - MCP SSE endpoint: http://localhost:${PORT}/sse`);
    console.error(`  - OpenAPI spec:     http://localhost:${PORT}/openapi.json`);
  });
}

start();

