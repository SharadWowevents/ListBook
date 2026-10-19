const mongoose = require("mongoose");

const SharedListSchema = new mongoose.Schema(
  {
    shareId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sharedListId: {
      type: String,
      index: true,
    },
    list: {
      name: { type: String, required: true },
      todos: [
        {
          id: String,
          text: String,
          done: Boolean,
          starred: Boolean,
        },
      ],
      starred: Boolean,
    },
    sharedBy: {
      type: String,
      required: true,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    ownerListId: {
      type: String,
      index: true,
    },
    defaultPermission: {
      type: String,
      enum: ["read", "write"],
      default: "write",
    },
    defaultCanShare: {
      type: Boolean,
      default: true,
    },
    claimedBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        username: String,
        displayName: String,
        permission: { type: String, enum: ["read", "write"], default: "write" },
        canShare: { type: Boolean, default: true },
        claimedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("SharedList", SharedListSchema);
