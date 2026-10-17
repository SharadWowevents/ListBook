#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  connectDB,
  getTargetUser,
  findList,
  findTodo,
  uid,
  User,
} from "./db.js";

const server = new McpServer({
  name: "listbook-mcp-server",
  version: "1.0.0",
  description:
    "MCP server for ListBook with read and write capabilities for lists and tasks",
});

// Helper to format a list and its todos as clean markdown
function formatListMarkdown(list, isActive = false) {
  const star = list.starred ? " ⭐" : "";
  const activeBadge = isActive ? " [ACTIVE]" : "";
  let md = `### ${list.name}${star}${activeBadge} (ID: \`${list.id}\`)\n`;

  if (!list.todos || list.todos.length === 0) {
    md += `  _(No tasks in this list)_\n`;
    return md;
  }

  for (const t of list.todos) {
    const box = t.done ? "[x]" : "[ ]";
    const tStar = t.starred ? " ⭐" : "";
    md += `- ${box} ${t.text}${tStar} \`(ID: ${t.id})\`\n`;
  }
  return md;
}

// Helper to format all lists
function formatBoardMarkdown(board, displayName) {
  let md = `# ListBook Board for ${displayName}\n\n`;
  if (!board.lists || board.lists.length === 0) {
    return md + "No lists found. Use `create_list` to add one.\n";
  }

  for (const list of board.lists) {
    const isActive = board.activeId === list.id;
    md += formatListMarkdown(list, isActive) + "\n";
  }
  return md;
}

// ==========================================
// TOOLS - READ CAPABILITIES
// ==========================================

// 1. List all lists
server.tool(
  "list_all_lists",
  "Get all lists from ListBook with task counts, starred status, and active list indicator",
  {
    username: z
      .string()
      .optional()
      .describe(
        "Optional username (e.g. 'Demo'). Defaults to the configured default or first user."
      ),
  },
  async ({ username }) => {
    try {
      const user = await getTargetUser(username);
      const board = user.board || { lists: [] };

      const listsSummary = board.lists.map((l) => {
        const total = l.todos?.length || 0;
        const completed = l.todos?.filter((t) => t.done).length || 0;
        const pending = total - completed;
        return {
          id: l.id,
          name: l.name,
          starred: !!l.starred,
          isActive: board.activeId === l.id,
          totalTasks: total,
          pendingTasks: pending,
          completedTasks: completed,
        };
      });

      let md = `## 📋 ListBook Lists (${user.displayName})\n\n`;
      if (listsSummary.length === 0) {
        md += "No lists found. You can create one with `create_list`.\n";
      } else {
        for (const l of listsSummary) {
          const star = l.starred ? " ⭐" : "";
          const active = l.isActive ? " **(Active)**" : "";
          md += `- **${l.name}**${star}${active} (ID: \`${l.id}\`) — ${l.pendingTasks} pending / ${l.totalTasks} total\n`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: md.trim(),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error fetching lists: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 2. Get specific list
server.tool(
  "get_list",
  "Read all tasks and details of a specific list by name or ID, with optional filter by task status",
  {
    list_identifier: z
      .string()
      .describe("The name or ID of the list to read (case-insensitive)"),
    status: z
      .enum(["all", "pending", "completed"])
      .optional()
      .default("all")
      .describe("Filter tasks by status: 'all', 'pending', or 'completed'"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ list_identifier, status, username }) => {
    try {
      const user = await getTargetUser(username);
      const board = user.board || { lists: [] };
      const list = findList(board, list_identifier);

      if (!list) {
        return {
          content: [
            {
              type: "text",
              text: `List "${list_identifier}" not found. Available lists: ${board.lists
                .map((l) => `"${l.name}"`)
                .join(", ")}`,
            },
          ],
          isError: true,
        };
      }

      let filteredTodos = list.todos || [];
      if (status === "pending") {
        filteredTodos = filteredTodos.filter((t) => !t.done);
      } else if (status === "completed") {
        filteredTodos = filteredTodos.filter((t) => t.done);
      }

      const clone = { ...list.toObject ? list.toObject() : list, todos: filteredTodos };
      const md = formatListMarkdown(clone, board.activeId === list.id);

      return {
        content: [
          {
            type: "text",
            text: md.trim(),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error reading list: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 3. Get all tasks across all lists
server.tool(
  "get_all_tasks",
  "Read all tasks across all lists in ListBook, with optional filtering",
  {
    status: z
      .enum(["all", "pending", "completed"])
      .optional()
      .default("all")
      .describe("Filter by completion status"),
    starred_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, only return starred tasks"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ status, starred_only, username }) => {
    try {
      const user = await getTargetUser(username);
      const board = user.board || { lists: [] };

      let md = `## 📋 All Tasks (${user.displayName})\n\n`;
      let totalFound = 0;

      for (const list of board.lists) {
        let todos = list.todos || [];
        if (status === "pending") todos = todos.filter((t) => !t.done);
        if (status === "completed") todos = todos.filter((t) => t.done);
        if (starred_only) todos = todos.filter((t) => t.starred);

        if (todos.length > 0) {
          totalFound += todos.length;
          md += `### ${list.name} (${todos.length})\n`;
          for (const t of todos) {
            const box = t.done ? "[x]" : "[ ]";
            const star = t.starred ? " ⭐" : "";
            md += `- ${box} ${t.text}${star} \`(ID: ${t.id})\`\n`;
          }
          md += `\n`;
        }
      }

      if (totalFound === 0) {
        md += `No tasks found matching filter (status: ${status}, starred_only: ${starred_only}).\n`;
      }

      return {
        content: [{ type: "text", text: md.trim() }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error getting all tasks: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 4. Search tasks across lists
server.tool(
  "search_tasks",
  "Search for tasks matching a query string across all lists",
  {
    query: z.string().describe("Search keyword or phrase to match in task text"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ query, username }) => {
    try {
      const user = await getTargetUser(username);
      const board = user.board || { lists: [] };
      const qLower = query.toLowerCase().trim();

      const results = [];
      for (const list of board.lists) {
        for (const todo of list.todos || []) {
          if (todo.text.toLowerCase().includes(qLower)) {
            results.push({ listName: list.name, listId: list.id, todo });
          }
        }
      }

      let md = `## 🔍 Search Results for "${query}" (${results.length} found)\n\n`;
      if (results.length === 0) {
        md += `No matching tasks found.\n`;
      } else {
        for (const r of results) {
          const box = r.todo.done ? "[x]" : "[ ]";
          const star = r.todo.starred ? " ⭐" : "";
          md += `- **[${r.listName}]** ${box} ${r.todo.text}${star} \`(ID: ${r.todo.id})\`\n`;
        }
      }

      return {
        content: [{ type: "text", text: md.trim() }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Search error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 5. List users
server.tool(
  "list_users",
  "List all registered users in ListBook database",
  {},
  async () => {
    try {
      await connectDB();
      const users = await User.find({}, "displayName usernameKey board.lists.name");
      let md = `## 👥 Registered ListBook Users\n\n`;
      for (const u of users) {
        const listNames = (u.board?.lists || []).map((l) => l.name).join(", ");
        md += `- **${u.displayName}** (\`${u.usernameKey}\`) — Lists: ${listNames || "none"}\n`;
      }
      return {
        content: [{ type: "text", text: md.trim() }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error listing users: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ==========================================
// TOOLS - WRITE CAPABILITIES
// ==========================================

// 6. Create a list
server.tool(
  "create_list",
  "Create a new list in ListBook, optionally with initial tasks",
  {
    name: z.string().describe("The title/name of the new list (max 60 characters)"),
    initial_tasks: z
      .array(z.string())
      .optional()
      .describe("Optional list of task descriptions to populate immediately"),
    starred: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to star this list"),
    set_active: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to make this newly created list the active list"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ name, initial_tasks = [], starred = false, set_active = true, username }) => {
    try {
      const user = await getTargetUser(username);
      const trimmedName = name.trim();
      if (!trimmedName) {
        return {
          content: [{ type: "text", text: "Error: List name cannot be empty." }],
          isError: true,
        };
      }

      // Check if list with this exact name already exists
      const existing = user.board?.lists?.find(
        (l) => l.name.toLowerCase() === trimmedName.toLowerCase()
      );
      if (existing) {
        return {
          content: [
            {
              type: "text",
              text: `A list named "${trimmedName}" already exists (ID: \`${existing.id}\`). Use \`add_tasks\` to add tasks to it, or pick another name.`,
            },
          ],
          isError: true,
        };
      }

      const listId = uid();
      const todos = initial_tasks.map((taskText) => ({
        id: uid(),
        text: taskText.trim(),
        done: false,
        starred: false,
      }));

      const newList = {
        id: listId,
        name: trimmedName,
        starred,
        todos,
      };

      if (!user.board) {
        user.board = { lists: [], activeId: null, updatedAt: Date.now() };
      }
      user.board.lists.push(newList);
      if (set_active || !user.board.activeId) {
        user.board.activeId = listId;
      }
      user.board.updatedAt = Date.now();

      await user.save();

      let md = `✅ Successfully created list **"${trimmedName}"** (ID: \`${listId}\`)`;
      if (todos.length > 0) {
        md += ` with ${todos.length} initial tasks:\n`;
        for (const t of todos) {
          md += `- [ ] ${t.text} \`(ID: ${t.id})\`\n`;
        }
      } else {
        md += `.\n`;
      }

      return {
        content: [{ type: "text", text: md.trim() }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error creating list: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 7. Add single task to list
server.tool(
  "add_task",
  "Add a new task/todo item to a specific list. Automatically creates the list if it doesn't exist yet.",
  {
    list_identifier: z
      .string()
      .describe("Name or ID of the target list (e.g. 'This Week' or 'Work')"),
    task: z.string().describe("The task description text (e.g. 'Review pull request')"),
    starred: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to star this task"),
    create_if_missing: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true, automatically creates the list if it doesn't exist yet"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ list_identifier, task, starred = false, create_if_missing = true, username }) => {
    try {
      const user = await getTargetUser(username);
      if (!user.board) {
        user.board = { lists: [], activeId: null, updatedAt: Date.now() };
      }

      let list = findList(user.board, list_identifier);

      if (!list) {
        if (create_if_missing) {
          const newListId = uid();
          list = {
            id: newListId,
            name: list_identifier.trim(),
            starred: false,
            todos: [],
          };
          user.board.lists.push(list);
          if (!user.board.activeId) user.board.activeId = newListId;
        } else {
          return {
            content: [
              {
                type: "text",
                text: `List "${list_identifier}" not found. Existing lists: ${user.board.lists
                  .map((l) => `"${l.name}"`)
                  .join(", ")}`,
              },
            ],
            isError: true,
          };
        }
      }

      const todoId = uid();
      const newTodo = {
        id: todoId,
        text: task.trim(),
        done: false,
        starred,
      };

      list.todos.push(newTodo);
      user.board.updatedAt = Date.now();
      await user.save();

      const starTag = starred ? " ⭐" : "";
      return {
        content: [
          {
            type: "text",
            text: `✅ Added task to **"${list.name}"**:\n- [ ] ${newTodo.text}${starTag} \`(ID: ${todoId})\``,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error adding task: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 8. Add multiple tasks to list (batch)
server.tool(
  "add_tasks",
  "Add multiple tasks to a list in a single operation. Automatically creates the list if it doesn't exist yet.",
  {
    list_identifier: z
      .string()
      .describe("Name or ID of the target list (e.g. 'Groceries' or 'Project Links')"),
    tasks: z
      .array(z.string())
      .describe("Array of task description strings to add"),
    starred: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to star the newly added tasks"),
    create_if_missing: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true, creates the list if it doesn't exist yet"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ list_identifier, tasks, starred = false, create_if_missing = true, username }) => {
    try {
      const user = await getTargetUser(username);
      if (!user.board) {
        user.board = { lists: [], activeId: null, updatedAt: Date.now() };
      }

      let list = findList(user.board, list_identifier);
      let wasCreated = false;

      if (!list) {
        if (create_if_missing) {
          const newListId = uid();
          list = {
            id: newListId,
            name: list_identifier.trim(),
            starred: false,
            todos: [],
          };
          user.board.lists.push(list);
          if (!user.board.activeId) user.board.activeId = newListId;
          wasCreated = true;
        } else {
          return {
            content: [
              {
                type: "text",
                text: `List "${list_identifier}" not found. Existing lists: ${user.board.lists
                  .map((l) => `"${l.name}"`)
                  .join(", ")}`,
              },
            ],
            isError: true,
          };
        }
      }

      const added = [];
      for (const t of tasks) {
        const trimmed = t.trim();
        if (trimmed) {
          const id = uid();
          const item = { id, text: trimmed, done: false, starred };
          list.todos.push(item);
          added.push(item);
        }
      }

      user.board.updatedAt = Date.now();
      await user.save();

      let md = wasCreated
        ? `✅ Created list **"${list.name}"** and added ${added.length} tasks:\n`
        : `✅ Added ${added.length} tasks to **"${list.name}"**:\n`;

      for (const item of added) {
        const star = item.starred ? " ⭐" : "";
        md += `- [ ] ${item.text}${star} \`(ID: ${item.id})\`\n`;
      }

      return {
        content: [{ type: "text", text: md.trim() }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error adding tasks: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 9. Complete / Uncomplete task
server.tool(
  "complete_task",
  "Mark a task as completed (done) or uncompleted by task ID or matching text",
  {
    task_identifier: z
      .string()
      .describe("Task ID or matching substring of the task text"),
    list_identifier: z
      .string()
      .optional()
      .describe("Optional list name or ID to restrict the search"),
    done: z
      .boolean()
      .optional()
      .default(true)
      .describe("True to mark completed, false to mark pending"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ task_identifier, list_identifier, done = true, username }) => {
    try {
      const user = await getTargetUser(username);
      const board = user.board || { lists: [] };

      let targetList = null;
      let targetTodo = null;

      if (list_identifier) {
        targetList = findList(board, list_identifier);
        if (targetList) {
          targetTodo = findTodo(targetList, task_identifier);
        }
      } else {
        // Search across all lists
        for (const l of board.lists) {
          const found = findTodo(l, task_identifier);
          if (found) {
            targetList = l;
            targetTodo = found;
            break;
          }
        }
      }

      if (!targetTodo) {
        return {
          content: [
            {
              type: "text",
              text: `Task "${task_identifier}" could not be found${
                list_identifier ? ` in list "${list_identifier}"` : ""
              }.`,
            },
          ],
          isError: true,
        };
      }

      targetTodo.done = done;
      board.updatedAt = Date.now();
      await user.save();

      const stateWord = done ? "completed ✅" : "pending ⏳";
      return {
        content: [
          {
            type: "text",
            text: `Marked task "${targetTodo.text}" in list **"${targetList.name}"** as ${stateWord}.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error updating task: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 10. Update task details (text, done status, starred)
server.tool(
  "update_task",
  "Update a task's text, completion status, or starred status",
  {
    task_identifier: z
      .string()
      .describe("Task ID or task text to find"),
    list_identifier: z
      .string()
      .optional()
      .describe("Optional list name or ID to search in"),
    new_text: z.string().optional().describe("New text for the task"),
    done: z.boolean().optional().describe("New completion status"),
    starred: z.boolean().optional().describe("New starred status"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ task_identifier, list_identifier, new_text, done, starred, username }) => {
    try {
      const user = await getTargetUser(username);
      const board = user.board || { lists: [] };

      let targetList = null;
      let targetTodo = null;

      if (list_identifier) {
        targetList = findList(board, list_identifier);
        if (targetList) targetTodo = findTodo(targetList, task_identifier);
      } else {
        for (const l of board.lists) {
          const found = findTodo(l, task_identifier);
          if (found) {
            targetList = l;
            targetTodo = found;
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

      if (typeof new_text === "string" && new_text.trim()) {
        targetTodo.text = new_text.trim();
      }
      if (typeof done === "boolean") {
        targetTodo.done = done;
      }
      if (typeof starred === "boolean") {
        targetTodo.starred = starred;
      }

      board.updatedAt = Date.now();
      await user.save();

      const box = targetTodo.done ? "[x]" : "[ ]";
      const star = targetTodo.starred ? " ⭐" : "";
      return {
        content: [
          {
            type: "text",
            text: `✅ Updated task in list **"${targetList.name}"**:\n${box} ${targetTodo.text}${star} \`(ID: ${targetTodo.id})\``,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error updating task: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 11. Delete task
server.tool(
  "delete_task",
  "Delete a task from a list by task ID or matching text",
  {
    task_identifier: z.string().describe("Task ID or matching task text"),
    list_identifier: z.string().optional().describe("Optional list name or ID"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ task_identifier, list_identifier, username }) => {
    try {
      const user = await getTargetUser(username);
      const board = user.board || { lists: [] };

      let targetList = null;
      let targetIdx = -1;

      if (list_identifier) {
        targetList = findList(board, list_identifier);
        if (targetList) {
          targetIdx = targetList.todos.findIndex(
            (t) =>
              t.id === task_identifier ||
              t.text.toLowerCase().includes(task_identifier.toLowerCase())
          );
        }
      } else {
        for (const l of board.lists) {
          const idx = l.todos.findIndex(
            (t) =>
              t.id === task_identifier ||
              t.text.toLowerCase().includes(task_identifier.toLowerCase())
          );
          if (idx !== -1) {
            targetList = l;
            targetIdx = idx;
            break;
          }
        }
      }

      if (!targetList || targetIdx === -1) {
        return {
          content: [{ type: "text", text: `Task "${task_identifier}" not found.` }],
          isError: true,
        };
      }

      const deleted = targetList.todos.splice(targetIdx, 1)[0];
      board.updatedAt = Date.now();
      await user.save();

      return {
        content: [
          {
            type: "text",
            text: `🗑️ Deleted task "${deleted.text}" from list **"${targetList.name}"**.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error deleting task: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 12. Rename list
server.tool(
  "rename_list",
  "Rename an existing list",
  {
    list_identifier: z.string().describe("Current name or ID of the list"),
    new_name: z.string().describe("New name for the list"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ list_identifier, new_name, username }) => {
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

      const oldName = list.name;
      list.name = new_name.trim();
      board.updatedAt = Date.now();
      await user.save();

      return {
        content: [
          {
            type: "text",
            text: `✅ Renamed list "${oldName}" to **"${list.name}"** (ID: \`${list.id}\`).`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error renaming list: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 13. Delete list
server.tool(
  "delete_list",
  "Delete a list and all of its tasks",
  {
    list_identifier: z.string().describe("Name or ID of the list to delete"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ list_identifier, username }) => {
    try {
      const user = await getTargetUser(username);
      const board = user.board || { lists: [] };
      const idx = board.lists.findIndex(
        (l) =>
          l.id === list_identifier ||
          l.name.toLowerCase() === list_identifier.toLowerCase()
      );

      if (idx === -1) {
        return {
          content: [{ type: "text", text: `List "${list_identifier}" not found.` }],
          isError: true,
        };
      }

      const deleted = board.lists.splice(idx, 1)[0];
      if (board.activeId === deleted.id) {
        board.activeId = board.lists[0] ? board.lists[0].id : null;
      }
      board.updatedAt = Date.now();
      await user.save();

      return {
        content: [
          {
            type: "text",
            text: `🗑️ Deleted list **"${deleted.name}"** and its ${deleted.todos?.length || 0} tasks.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error deleting list: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// 14. Toggle star on a list
server.tool(
  "toggle_star_list",
  "Star or unstar a list (starred lists stay on top in ListBook)",
  {
    list_identifier: z.string().describe("Name or ID of the list"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ list_identifier, username }) => {
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

      list.starred = !list.starred;
      board.updatedAt = Date.now();
      await user.save();

      return {
        content: [
          {
            type: "text",
            text: `List **"${list.name}"** is now ${list.starred ? "starred ⭐" : "unstarred"}.`,
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

// 15. Set active list
server.tool(
  "set_active_list",
  "Set a list as the currently active list in ListBook",
  {
    list_identifier: z.string().describe("Name or ID of the list to activate"),
    username: z.string().optional().describe("Optional username"),
  },
  async ({ list_identifier, username }) => {
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

      board.activeId = list.id;
      board.updatedAt = Date.now();
      await user.save();

      return {
        content: [
          {
            type: "text",
            text: `Set **"${list.name}"** (ID: \`${list.id}\`) as active list.`,
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

// ==========================================
// RESOURCES
// ==========================================

// Resource: Full board overview
server.resource(
  "board",
  "listbook://board",
  async (uri) => {
    const user = await getTargetUser();
    const board = user.board || { lists: [] };
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(
            {
              user: user.displayName,
              board,
            },
            null,
            2
          ),
          mimeType: "application/json",
        },
      ],
    };
  }
);

// Resource: Lists metadata
server.resource(
  "lists",
  "listbook://lists",
  async (uri) => {
    const user = await getTargetUser();
    const board = user.board || { lists: [] };
    const lists = board.lists.map((l) => ({
      id: l.id,
      name: l.name,
      starred: l.starred,
      taskCount: l.todos?.length || 0,
      isActive: board.activeId === l.id,
    }));
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(lists, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  }
);

// Dynamic Resource: Specific list
server.resource(
  "list",
  new ResourceTemplate("listbook://lists/{listName}", { list: undefined }),
  async (uri, { listName }) => {
    const user = await getTargetUser();
    const board = user.board || { lists: [] };
    const list = findList(board, listName);
    if (!list) {
      throw new Error(`List "${listName}" not found`);
    }
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(list, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  }
);

// ==========================================
// PROMPTS
// ==========================================

server.prompt(
  "daily_overview",
  "Summarize all pending tasks and starred items to help organize the day",
  {},
  async () => {
    const user = await getTargetUser();
    const board = user.board || { lists: [] };
    const boardMd = formatBoardMarkdown(board, user.displayName);

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Here is my current ListBook board:\n\n${boardMd}\n\nPlease analyze my lists, highlight the starred and urgent pending tasks, and suggest a prioritized plan for today.`,
          },
        },
      ],
    };
  }
);

// ==========================================
// START SERVER (STDIO TRANSPORT)
// ==========================================

async function main() {
  try {
    await connectDB();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[MCP ListBook] Server started and listening via stdio.");
  } catch (err) {
    console.error("[MCP ListBook] Fatal startup error:", err);
    process.exit(1);
  }
}

export { server, main };

import path from "path";
import { fileURLToPath } from "url";

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() ===
    path.resolve(process.argv[1]).toLowerCase();

if (isDirectRun) {
  main();
}

