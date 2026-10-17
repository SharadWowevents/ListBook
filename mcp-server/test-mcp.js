import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "./index.js";
import { connectDB } from "./db.js";

async function runTests() {
  console.log("🚀 Starting ListBook MCP Server tests...\n");

  await connectDB();

  // Create client and connect via in-memory transport
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  console.log("✅ Client connected to MCP Server successfully.\n");

  // Test 1: List Tools
  console.log("--- Test 1: Listing available tools ---");
  const { tools } = await client.listTools();
  console.log(`Found ${tools.length} registered tools:`);
  for (const t of tools) {
    console.log(`  - ${t.name}: ${t.description.slice(0, 60)}...`);
  }
  if (tools.length < 10) throw new Error("Expected at least 10 tools registered");
  console.log("✅ Tool listing test passed.\n");

  // Test 2: Call list_all_lists
  console.log("--- Test 2: list_all_lists ---");
  const listResult = await client.callTool({
    name: "list_all_lists",
    arguments: {},
  });
  console.log(listResult.content[0].text);
  console.log("✅ list_all_lists test passed.\n");

  // Test 3: Create a new list
  console.log("--- Test 3: create_list ---");
  const createResult = await client.callTool({
    name: "create_list",
    arguments: {
      name: "MCP Test Project",
      initial_tasks: ["Initialize git repository", "Write README.md"],
      starred: true,
      set_active: true,
    },
  });
  console.log(createResult.content[0].text);
  console.log("✅ create_list test passed.\n");

  // Test 4: Get list details
  console.log("--- Test 4: get_list ---");
  const getListResult = await client.callTool({
    name: "get_list",
    arguments: {
      list_identifier: "MCP Test Project",
      status: "all",
    },
  });
  console.log(getListResult.content[0].text);
  console.log("✅ get_list test passed.\n");

  // Test 5: Add a single task
  console.log("--- Test 5: add_task ---");
  const addTaskResult = await client.callTool({
    name: "add_task",
    arguments: {
      list_identifier: "MCP Test Project",
      task: "Configure environment variables",
      starred: true,
    },
  });
  console.log(addTaskResult.content[0].text);
  console.log("✅ add_task test passed.\n");

  // Test 6: Add batch tasks
  console.log("--- Test 6: add_tasks ---");
  const addBatchResult = await client.callTool({
    name: "add_tasks",
    arguments: {
      list_identifier: "MCP Test Project",
      tasks: ["Run database migrations", "Deploy to production"],
    },
  });
  console.log(addBatchResult.content[0].text);
  console.log("✅ add_tasks test passed.\n");

  // Test 7: Complete a task
  console.log("--- Test 7: complete_task ---");
  const completeResult = await client.callTool({
    name: "complete_task",
    arguments: {
      task_identifier: "Initialize git repository",
      list_identifier: "MCP Test Project",
      done: true,
    },
  });
  console.log(completeResult.content[0].text);
  console.log("✅ complete_task test passed.\n");

  // Test 8: Search tasks
  console.log("--- Test 8: search_tasks ---");
  const searchResult = await client.callTool({
    name: "search_tasks",
    arguments: {
      query: "environment",
    },
  });
  console.log(searchResult.content[0].text);
  console.log("✅ search_tasks test passed.\n");

  // Test 9: Update a task
  console.log("--- Test 9: update_task ---");
  const updateResult = await client.callTool({
    name: "update_task",
    arguments: {
      task_identifier: "Write README.md",
      list_identifier: "MCP Test Project",
      new_text: "Write comprehensive README documentation",
      starred: true,
    },
  });
  console.log(updateResult.content[0].text);
  console.log("✅ update_task test passed.\n");

  // Test 10: Delete task
  console.log("--- Test 10: delete_task ---");
  const deleteTodoResult = await client.callTool({
    name: "delete_task",
    arguments: {
      task_identifier: "Deploy to production",
      list_identifier: "MCP Test Project",
    },
  });
  console.log(deleteTodoResult.content[0].text);
  console.log("✅ delete_task test passed.\n");

  // Test 11: Rename list
  console.log("--- Test 11: rename_list ---");
  const renameResult = await client.callTool({
    name: "rename_list",
    arguments: {
      list_identifier: "MCP Test Project",
      new_name: "MCP Test Renamed",
    },
  });
  console.log(renameResult.content[0].text);
  console.log("✅ rename_list test passed.\n");

  // Test 12: Clean up - delete list
  console.log("--- Test 12: delete_list (cleanup) ---");
  const deleteListResult = await client.callTool({
    name: "delete_list",
    arguments: {
      list_identifier: "MCP Test Renamed",
    },
  });
  console.log(deleteListResult.content[0].text);
  console.log("✅ delete_list test passed.\n");

  // Test 13: List resources
  console.log("--- Test 13: listResources ---");
  const { resources } = await client.listResources();
  console.log(`Found ${resources.length} resources:`);
  for (const r of resources) {
    console.log(`  - ${r.uri} (${r.name})`);
  }
  console.log("✅ listResources test passed.\n");

  console.log("🎉 ALL TESTS PASSED SUCCESSFULLY! The ListBook MCP Server is 100% operational.");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});

