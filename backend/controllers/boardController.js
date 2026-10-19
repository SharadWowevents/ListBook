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
      // Also update sender's sharedWith if not present
      const senderList = sender.board?.lists?.find((l) => l.id === list.id);
      if (senderList) {
        if (!senderList.sharedWith) senderList.sharedWith = [];
        const alreadyInSender = senderList.sharedWith.some(
          (m) => m.username === recipient.usernameKey
        );
        if (!alreadyInSender) {
          senderList.sharedWith.push({
            username: recipient.usernameKey,
            displayName: recipient.displayName,
            sharedAt: Date.now(),
            via: "username",
          });
          sender.board.updatedAt = Date.now();
          await sender.save();
        }
      }

      recipient.board.activeId = existingInRecipient.id;
      recipient.board.updatedAt = Date.now();
      await recipient.save();
      return res.json({
        success: true,
        alreadyHad: true,
        message: `${recipient.displayName} already has this list in their ListBook.`,
        listId: existingInRecipient.id,
        member: {
          username: recipient.usernameKey,
          displayName: recipient.displayName,
          sharedAt: Date.now(),
          via: "username",
        },
      });
    }

    const newListId = uid();
    const clonedList = {
      id: newListId,
      name: list.name,
      starred: Boolean(list.starred),
      originalOwner: sender.displayName,
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

    // Record in sender's list.sharedWith
    const senderList = sender.board?.lists?.find((l) => l.id === list.id);
    if (senderList) {
      if (!senderList.sharedWith) senderList.sharedWith = [];
      const alreadyInSender = senderList.sharedWith.some(
        (m) => m.username === recipient.usernameKey
      );
      if (!alreadyInSender) {
        senderList.sharedWith.push({
          username: recipient.usernameKey,
          displayName: recipient.displayName,
          sharedAt: Date.now(),
          via: "username",
        });
        sender.board.updatedAt = Date.now();
        await sender.save();
      }
    }

    return res.json({
      success: true,
      alreadyHad: false,
      message: `List "${list.name}" shared with ${recipient.displayName} successfully!`,
      listId: newListId,
      member: {
        username: recipient.usernameKey,
        displayName: recipient.displayName,
        sharedAt: Date.now(),
        via: "username",
      },
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
      ownerUserId: user._id,
      ownerListId: list.id,
      claimedBy: [],
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

    // Record user in SharedList.claimedBy
    if (!record.claimedBy) record.claimedBy = [];
    const alreadyClaimed = record.claimedBy.some(
      (c) =>
        String(c.userId) === String(user._id) || c.username === user.usernameKey
    );
    if (!alreadyClaimed) {
      record.claimedBy.push({
        userId: user._id,
        username: user.usernameKey,
        displayName: user.displayName,
        claimedAt: new Date(),
      });
      await record.save();
    }

    // Also record user in original owner's sharedWith if owner exists
    if (record.ownerUserId && String(record.ownerUserId) !== String(user._id)) {
      try {
        const owner = await User.findById(record.ownerUserId);
        if (owner?.board?.lists) {
          const ownerList = owner.board.lists.find(
            (l) =>
              l.id === record.ownerListId ||
              l.name.trim().toLowerCase() === record.list.name.trim().toLowerCase()
          );
          if (ownerList) {
            if (!ownerList.sharedWith) ownerList.sharedWith = [];
            const alreadyInOwner = ownerList.sharedWith.some(
              (m) => m.username === user.usernameKey
            );
            if (!alreadyInOwner) {
              ownerList.sharedWith.push({
                username: user.usernameKey,
                displayName: user.displayName,
                sharedAt: Date.now(),
                via: "link",
              });
              owner.board.updatedAt = Date.now();
              await owner.save();
            }
          }
        }
      } catch (ownerErr) {
        console.warn("Could not update owner sharedWith:", ownerErr);
      }
    }

    if (existingList) {
      if (!existingList.sourceShareId) {
        existingList.sourceShareId = shareId;
      }
      if (!existingList.originalOwner) {
        existingList.originalOwner = record.sharedBy;
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
      originalOwner: record.sharedBy,
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

// GET /api/board/list/:listId/members (Get all users associated with this list)
exports.getListMembers = async (req, res) => {
  try {
    const { listId } = req.params;
    const user = await User.findById(req.user.id);
    if (!user || !user.board)
      return res.status(404).json({ error: "User not found." });

    const targetList = (user.board.lists || []).find((l) => l.id === listId);
    if (!targetList) return res.status(404).json({ error: "List not found." });

    const membersMap = new Map();

    (targetList.sharedWith || []).forEach((m) => {
      membersMap.set(m.username.toLowerCase(), {
        username: m.username,
        displayName: m.displayName,
        sharedAt: m.sharedAt,
        via: m.via || "username",
      });
    });

    // Also include any users who claimed via share link for this list
    const sharedRecords = await SharedList.find({
      ownerUserId: user._id,
      ownerListId: listId,
    });

    for (const rec of sharedRecords) {
      for (const claim of rec.claimedBy || []) {
        const uKey = (claim.username || "").toLowerCase();
        if (uKey && !membersMap.has(uKey)) {
          membersMap.set(uKey, {
            username: claim.username,
            displayName: claim.displayName,
            sharedAt: claim.claimedAt
              ? new Date(claim.claimedAt).getTime()
              : Date.now(),
            via: "link",
          });
        }
      }
    }

    return res.json({
      listId,
      listName: targetList.name,
      originalOwner: targetList.originalOwner || null,
      currentUser: {
        username: user.usernameKey,
        displayName: user.displayName,
      },
      members: Array.from(membersMap.values()),
    });
  } catch (err) {
    console.error("Get list members error:", err);
    return res.status(500).json({ error: "Failed to fetch list members." });
  }
};