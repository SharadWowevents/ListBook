const mongoose = require("mongoose");

const SharedListSchema = new mongoose.Schema(
  {
    shareId: {
      type: String,
      required: true,
      unique: true,
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
    claimedBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        username: String,
        displayName: String,
        claimedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("SharedList", SharedListSchema);
