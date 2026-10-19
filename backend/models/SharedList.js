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
  },
  { timestamps: true }
);

module.exports = mongoose.model("SharedList", SharedListSchema);

