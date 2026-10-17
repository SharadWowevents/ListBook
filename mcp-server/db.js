import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from current directory if present, or fallback to ../backend/.env
const localEnv = path.resolve(__dirname, ".env");
const backendEnv = path.resolve(__dirname, "../backend/.env");

if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
} else if (fs.existsSync(backendEnv)) {
  dotenv.config({ path: backendEnv });
} else {
  dotenv.config();
}

export const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/listbook";
export const DEFAULT_USER = process.env.DEFAULT_USER || process.env.LISTBOOK_USER;

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function createStarterBoard() {
  const t = (s) => ({ id: uid(), text: s, done: false, starred: false });
  const l1 = {
    id: uid(),
    name: "Project Links",
    starred: false,
    todos: [
      t("Live Tracker Link"),
      t("Online Project File Link"),
      t("Presentation Deck Link"),
    ],
  };
  const l2 = {
    id: uid(),
    name: "This Week",
    starred: false,
    todos: [t("Confirm venue walkthrough"), t("Send vendor shortlist")],
  };
  const l3 = { id: uid(), name: "Ideas", starred: false, todos: [] };
  return { lists: [l1, l2, l3], activeId: l1.id, updatedAt: Date.now() };
}

const TodoSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true, trim: true, maxlength: 300 },
    done: { type: Boolean, default: false },
    starred: { type: Boolean, default: false },
  },
  { _id: false }
);

const ListSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    starred: { type: Boolean, default: false },
    todos: [TodoSchema],
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    usernameKey: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    pinHash: {
      type: String,
      required: true,
    },
    board: {
      lists: { type: [ListSchema], default: undefined },
      activeId: { type: String, default: null },
      updatedAt: { type: Number, default: () => Date.now() },
    },
  },
  { timestamps: true }
);

UserSchema.pre("save", function () {
  if (this.isNew && (!this.board || !this.board.lists)) {
    this.board = createStarterBoard();
  }
});

export const User =
  mongoose.models.User || mongoose.model("User", UserSchema);

let isConnected = false;

export async function connectDB() {
  if (isConnected || mongoose.connection.readyState === 1) {
    isConnected = true;
    return;
  }
  try {
    await mongoose.connect(MONGO_URI);
    isConnected = true;
    console.error(`[MCP ListBook] Connected to MongoDB at ${MONGO_URI}`);
  } catch (err) {
    console.error(`[MCP ListBook] MongoDB connection error:`, err.message);
    throw err;
  }
}

/**
 * Resolve user by requested username, DEFAULT_USER, or the first existing user.
 * If database is completely empty, creates a starter "Demo" user.
 */
export async function getTargetUser(username) {
  await connectDB();

  let targetKey = (username || DEFAULT_USER || "").trim().toLowerCase();

  if (targetKey) {
    let user = await User.findOne({ usernameKey: targetKey });
    if (user) return user;

    // If requested username not found, try fuzzy or fallback
    const users = await User.find({});
    const matched = users.find(
      (u) =>
        u.displayName.toLowerCase() === targetKey ||
        u.usernameKey.includes(targetKey)
    );
    if (matched) return matched;

    // Create a new user with default PIN 0000 if explicitly requested
    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash("0000", salt);
    const displayName =
      username.trim().charAt(0).toUpperCase() + username.trim().slice(1);
    user = await User.create({
      usernameKey: targetKey,
      displayName,
      pinHash,
      board: createStarterBoard(),
    });
    console.error(`[MCP ListBook] Created new user: ${displayName} (PIN: 0000)`);
    return user;
  }

  // No specific user requested: get first existing user
  let user = await User.findOne();
  if (user) return user;

  // DB has zero users, create default Demo user
  const salt = await bcrypt.genSalt(10);
  const pinHash = await bcrypt.hash("0000", salt);
  user = await User.create({
    usernameKey: "demo",
    displayName: "Demo",
    pinHash,
    board: createStarterBoard(),
  });
  console.error(`[MCP ListBook] Initialized default user 'Demo' with starter board.`);
  return user;
}

/**
 * Find list by ID or Name (case-insensitive)
 */
export function findList(board, listIdentifier) {
  if (!board?.lists || !listIdentifier) return null;
  const cleanId = listIdentifier.trim();
  const lower = cleanId.toLowerCase();

  // 1. Exact ID match
  let found = board.lists.find((l) => l.id === cleanId);
  if (found) return found;

  // 2. Exact Name match (case-insensitive)
  found = board.lists.find((l) => l.name.toLowerCase() === lower);
  if (found) return found;

  // 3. Substring match
  found = board.lists.find((l) => l.name.toLowerCase().includes(lower));
  return found || null;
}

/**
 * Find todo by ID or Text match
 */
export function findTodo(list, todoIdentifier) {
  if (!list?.todos || !todoIdentifier) return null;
  const clean = todoIdentifier.trim();
  const lower = clean.toLowerCase();

  // 1. Exact ID
  let found = list.todos.find((t) => t.id === clean);
  if (found) return found;

  // 2. Exact Text (case-insensitive)
  found = list.todos.find((t) => t.text.toLowerCase() === lower);
  if (found) return found;

  // 3. Substring match
  found = list.todos.find((t) => t.text.toLowerCase().includes(lower));
  return found || null;
}

