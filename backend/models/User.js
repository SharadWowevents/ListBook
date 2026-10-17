const mongoose = require("mongoose");

function createStarterBoard() {
  return { lists: [], activeId: null, updatedAt: Date.now() };
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
      lists: { type: [ListSchema], default: () => [] },
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