# ListBook MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server providing seamless read and write capabilities for **ListBook** lists and tasks.

This MCP server enables AI assistants (such as Claude Desktop, Cursor, Antigravity, Cline) to interact directly with your ListBook database to create lists, organize tasks, mark items complete, and retrieve task lists whenever you ask.

---

## Features

### 📖 Read Capabilities
- **`list_all_lists`**: Inspect all lists, see pending vs. completed task counts, and identify starred or active lists.
- **`get_list`**: Retrieve all tasks for a specific list (by name or ID) with status filtering (`all`, `pending`, `completed`).
- **`get_all_tasks`**: Aggregate and view all tasks across all lists with status and star filters.
- **`search_tasks`**: Fuzzy/keyword search for tasks across all lists.
- **`list_users`**: View all registered users in ListBook.

### ✍️ Write Capabilities
- **`create_list`**: Create a new list with an optional set of initial tasks and star priority.
- **`add_task`**: Add a single task to any list (auto-creates the list if it doesn't exist yet).
- **`add_tasks`**: Batch-add multiple tasks in one call.
- **`complete_task`**: Toggle or set a task's completion status (`done: true/false`).
- **`update_task`**: Edit task description, completion status, or star priority.
- **`delete_task`**: Remove a task by ID or description.
- **`rename_list`**: Rename an existing list.
- **`delete_list`**: Remove a list and its associated tasks.
- **`toggle_star_list`**: Star or unstar a list (starred lists stay pinned on top in ListBook).
- **`set_active_list`**: Change the currently active list in ListBook.

### 📦 Resources & Prompts
- **Resources**:
  - `listbook://board`: Full JSON representation of the user's board.
  - `listbook://lists`: Metadata for all lists.
  - `listbook://lists/{listName}`: Individual list details.
- **Prompts**:
  - `daily_overview`: Summarize pending and starred tasks to plan your day.

---

## Quick Start

### 1. Prerequisites
- **Node.js** v18+ (tested on v25)
- **MongoDB** running locally on port 27017 (or configured via `MONGO_URI`)

### 2. Installation
Navigate to the `mcp-server` directory and install dependencies:

```bash
cd mcp-server
npm install
```

### 3. Verify Server
Run the automated test suite to verify all MCP tools and database connectivity:

```bash
node test-mcp.js
```

---

## Configuration & MCP Client Setup

The server automatically loads environment variables from `mcp-server/.env` or falls back to `backend/.env`.

### Environment Variables
| Variable | Description | Default |
| :--- | :--- | :--- |
| `MONGO_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/listbook` |
| `DEFAULT_USER` | Default ListBook user to scope lists to | First user found in database or `"Demo"` |

---

### Configuration Examples

#### 1. Claude Desktop
Add the following to your `claude_desktop_config.json`:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "listbook": {
      "command": "node",
      "args": ["d:/C_lang/Code/Web/WowEvents/ListBook/mcp-server/index.js"],
      "env": {
        "MONGO_URI": "mongodb://127.0.0.1:27017/listbook",
        "DEFAULT_USER": "Demo"
      }
    }
  }
}
```

*(Note: Adjust the path to match your local repository location and use forward slashes `/`).*

#### 2. Cursor (`.cursor/mcp.json`)
Create or edit `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "listbook": {
      "command": "node",
      "args": ["d:/C_lang/Code/Web/WowEvents/ListBook/mcp-server/index.js"],
      "env": {
        "MONGO_URI": "mongodb://127.0.0.1:27017/listbook",
        "DEFAULT_USER": "Demo"
      }
    }
  }
}
```

#### 3. Antigravity / Gemini CLI
Add to your MCP settings or plugin configuration:

```json
{
  "mcpServers": {
    "listbook": {
      "command": "node",
      "args": ["d:/C_lang/Code/Web/WowEvents/ListBook/mcp-server/index.js"]
    }
  }
}
```

---

## Example Interactions with AI

Once connected, you can ask your AI assistant natural language queries such as:

- *"What lists do I have in ListBook?"*
- *"Create a new list called 'Trip to Japan' and add tasks: Book flights, reserve hotels, get JR Pass."*
- *"Show me all pending tasks in 'This Week'."*
- *"Mark 'Confirm venue walkthrough' as done."*
- *"Search for any task mentioning 'presentation'."*
- *"Add 'Buy USB-C cable' to my Ideas list and star it."*

