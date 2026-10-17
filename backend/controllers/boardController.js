const User = require("../models/User");

// GET /api/board
exports.getBoard = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("board displayName");
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({
      name: user.displayName,
      board: user.board,
    });
  } catch (err) {
    console.error("Get board error:", err);
    return res.status(500).json({ error: "Failed to load board" });
  }
};

// PUT /api/board (Full debounced board sync + drag-and-drop reorder persistence)
exports.saveBoard = async (req, res) => {
  try {
    const { lists, activeId, updatedAt } = req.body;
    if (!Array.isArray(lists)) {
      return res.status(400).json({ error: "Invalid board payload" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.board = {
      lists,
      activeId: activeId || (lists[0] ? lists[0].id : null),
      updatedAt: updatedAt || Date.now(),
    };

    await user.save();
    return res.json({ board: user.board });
  } catch (err) {
    console.error("Save board error:", err);
    return res.status(500).json({ error: "Failed to save board" });
  }
};