const User = require("../models/User");
const SharedList = require("../models/SharedList");

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

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

// POST /api/board/share-user (Direct share to another registered user)
exports.shareWithUser = async (req, res) => {
  try {
    const { list, targetUsername } = req.body;
    if (!list || !list.name) {
      return res.status(400).json({ error: "Invalid list data." });
    }

    const trimmedTarget = (targetUsername || "").trim().toLowerCase();
    if (!trimmedTarget) {
      return res.status(400).json({ error: "Please enter a username." });
    }

    const sender = await User.findById(req.user.id);
    if (!sender) return res.status(404).json({ error: "Sender not found." });

    if (sender.usernameKey === trimmedTarget) {
      return res.status(400).json({ error: "You cannot share a list with yourself." });
    }

    const recipient = await User.findOne({ usernameKey: trimmedTarget });
    if (!recipient) {
      return res.status(404).json({ error: "User does not exist" });
    }

    if (!recipient.board) {
      recipient.board = { lists: [], activeId: null, updatedAt: Date.now() };
    }

    // Check if recipient already has this exact list
    const existingInRecipient = recipient.board.lists.find((l) => {
      const sameName =
        l.name.trim().toLowerCase() === list.name.trim().toLowerCase();
      if (!sameName) return false;
      const srcTodos = list.todos || [];
      if (l.todos.length !== srcTodos.length) return false;
      return l.todos.every((t, i) => t.text === srcTodos[i]?.text);
    });

    if (existingInRecipient) {
      recipient.board.activeId = existingInRecipient.id;
      recipient.board.updatedAt = Date.now();
      await recipient.save();
      return res.json({
        success: true,
        alreadyHad: true,
        message: `${recipient.displayName} already has this list in their ListBook.`,
        listId: existingInRecipient.id,
      });
    }

    const newListId = uid();
    const clonedList = {
      id: newListId,
      name: list.name,
      starred: Boolean(list.starred),
      todos: (list.todos || []).map((t) => ({
        id: uid(),
        text: t.text,
        done: Boolean(t.done),
        starred: Boolean(t.starred),
      })),
    };

    recipient.board.lists.push(clonedList);
    if (!recipient.board.activeId) {
      recipient.board.activeId = newListId;
    }
    recipient.board.updatedAt = Date.now();
    await recipient.save();

    return res.json({
      success: true,
      alreadyHad: false,
      message: `List "${list.name}" shared with ${recipient.displayName} successfully!`,
      listId: newListId,
    });
  } catch (err) {
    console.error("Share with user error:", err);
    return res.status(500).json({ error: "Failed to share list." });
  }
};

// POST /api/board/share-link (Generate public share link)
exports.createShareLink = async (req, res) => {
  try {
    const { list } = req.body;
    if (!list || !list.name) {
      return res.status(400).json({ error: "Invalid list data." });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found." });

    const shareId = uid();
    await SharedList.create({
      shareId,
      list: {
        name: list.name,
        todos: (list.todos || []).map((t) => ({
          id: uid(),
          text: t.text,
          done: Boolean(t.done),
          starred: Boolean(t.starred),
        })),
        starred: Boolean(list.starred),
      },
      sharedBy: user.displayName,
    });

    return res.json({
      shareId,
    });
  } catch (err) {
    console.error("Create share link error:", err);
    return res.status(500).json({ error: "Failed to generate share link." });
  }
};

// GET /api/board/shared/:shareId (Public - preview shared list metadata and tasks)
exports.getSharedList = async (req, res) => {
  try {
    const { shareId } = req.params;
    const record = await SharedList.findOne({ shareId });
    if (!record) {
      return res.status(404).json({ error: "Shared list not found or link has expired." });
    }

    return res.json({
      shareId: record.shareId,
      list: record.list,
      sharedBy: record.sharedBy,
    });
  } catch (err) {
    console.error("Get shared list error:", err);
    return res.status(500).json({ error: "Failed to load shared list." });
  }
};

// POST /api/board/accept-share (Authenticated user imports shared list to their board)
exports.acceptSharedList = async (req, res) => {
  try {
    const { shareId } = req.body;
    const record = await SharedList.findOne({ shareId });
    if (!record) {
      return res.status(404).json({ error: "Shared list not found or link has expired." });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found." });

    if (!user.board) {
      user.board = { lists: [], activeId: null, updatedAt: Date.now() };
    }

    // Check if user already got this list previously
    const existingList = user.board.lists.find((l) => {
      if (l.sourceShareId && l.sourceShareId === shareId) return true;
      const sameName =
        l.name.trim().toLowerCase() === record.list.name.trim().toLowerCase();
      if (!sameName) return false;
      const recTodos = record.list.todos || [];
      if (l.todos.length !== recTodos.length) return false;
      return l.todos.every((t, i) => t.text === recTodos[i]?.text);
    });

    if (existingList) {
      if (!existingList.sourceShareId) {
        existingList.sourceShareId = shareId;
      }
      user.board.activeId = existingList.id;
      user.board.updatedAt = Date.now();
      await user.save();

      return res.json({
        board: user.board,
        addedList: existingList,
        alreadyAdded: true,
        message: `You already have "${existingList.name}" in your ListBook.`,
      });
    }

    const newListId = uid();
    const clonedList = {
      id: newListId,
      name: record.list.name,
      starred: Boolean(record.list.starred),
      sourceShareId: shareId,
      todos: (record.list.todos || []).map((t) => ({
        id: uid(),
        text: t.text,
        done: Boolean(t.done),
        starred: Boolean(t.starred),
      })),
    };

    user.board.lists.push(clonedList);
    user.board.activeId = newListId;
    user.board.updatedAt = Date.now();
    await user.save();

    return res.json({
      board: user.board,
      addedList: clonedList,
      alreadyAdded: false,
    });
  } catch (err) {
    console.error("Accept shared list error:", err);
    return res.status(500).json({ error: "Failed to add shared list." });
  }
};