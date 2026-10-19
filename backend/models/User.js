const mongoose = require("mongoose");

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function createStarterBoard() {
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

const SharedMemberSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    displayName: { type: String, required: true },
    permission: { type: String, enum: ["read", "write"], default: "write" },
    canShare: { type: Boolean, default: true },
    sharedAt: { type: Number, default: () => Date.now() },
    via: { type: String, default: "username" }, // 'username' | 'link'
  },
  { _id: false }
);

const ListSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    starred: { type: Boolean, default: false },
    todos: [TodoSchema],
    sharedListId: { type: String, default: null, index: true },
    sourceShareId: { type: String, default: null },
    ownerUsername: { type: String, default: null },
    originalOwner: { type: String, default: null },
    permission: {
      type: String,
      enum: ["owner", "write", "read"],
      default: "owner",
    },
    canShare: { type: Boolean, default: true },
    sharedWith: { type: [SharedMemberSchema], default: [] },
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

// Populate starter board automatically for newly created users
UserSchema.pre("save", function () {
  if (this.isNew && (!this.board || !this.board.lists)) {
    this.board = createStarterBoard();
  }
});

module.exports = mongoose.model("User", UserSchema);