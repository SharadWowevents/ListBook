const User = require("../models/User");
const SharedList = require("../models/SharedList");

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// GET /api/board
exports.getBoard = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "board displayName usernameKey"
    );
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({
      name: user.displayName,
      username: user.usernameKey,
      board: user.board,
    });
  } catch (err) {
    console.error("Get board error:", err);
    return res.status(500).json({ error: "Failed to load board" });
  }
};

// PUT /api/board (Debounced board sync + collaborator sync across all users)
exports.saveBoard = async (req, res) => {
  try {
    const { lists, activeId, updatedAt } = req.body;
    if (!Array.isArray(lists)) {
      return res.status(400).json({ error: "Invalid board payload" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const existingMap = new Map((user.board?.lists || []).map((l) => [l.id, l]));
    const sanitizedLists = [];
    const sharedListsToSync = [];

    for (const list of lists) {
      const existing = existingMap.get(list.id);
      const perm = existing?.permission || list.permission || "owner";
      const canShare =
        existing ? existing.canShare !== false : list.canShare !== false;
      const sharedListId =
        existing?.sharedListId || list.sharedListId || null;
      const originalOwner =
        existing?.originalOwner || list.originalOwner || null;
      const ownerUsername =
        existing?.ownerUsername || list.ownerUsername || null;
      const sharedWith = existing?.sharedWith || list.sharedWith || [];
      const sourceShareId =
        existing?.sourceShareId || list.sourceShareId || null;

      if (perm === "read" && existing) {
        // Read-only / Viewer: do not allow modifying tasks or title
        sanitizedLists.push({
          ...list,
          name: existing.name,
          todos: existing.todos,
          permission: "read",
          canShare,
          sharedListId,
          sourceShareId,
          originalOwner,
          ownerUsername,
          sharedWith,
        });
      } else {
        // Editor or Owner
        const sanitized = {
          ...list,
          permission: perm,
          canShare,
          sharedListId,
          sourceShareId,
          originalOwner,
          ownerUsername,
          sharedWith,
        };
        sanitizedLists.push(sanitized);

        // If list is shared across users, queue task sync
        if (sharedListId) {
          sharedListsToSync.push({
            sharedListId,
            name: list.name,
            todos: list.todos || [],
          });
        }
      }
    }

    user.board = {
      lists: sanitizedLists,
      activeId: activeId || (sanitizedLists[0] ? sanitizedLists[0].id : null),
      updatedAt: updatedAt || Date.now(),
    };

    await user.save();

    // Propagate task changes to all other users with this sharedListId
    for (const item of sharedListsToSync) {
      try {
        await User.updateMany(
          {
            _id: { $ne: user._id },
            "board.lists.sharedListId": item.sharedListId,
          },
          {
            $set: {
              "board.lists.$[elem].name": item.name,
              "board.lists.$[elem].todos": item.todos,
              "board.updatedAt": Date.now(),
            },
          },
          {
            arrayFilters: [{ "elem.sharedListId": item.sharedListId }],
          }
        );

        await SharedList.updateMany(
          { sharedListId: item.sharedListId },
          {
            $set: {
              "list.name": item.name,
              "list.todos": item.todos,
            },
          }
        );
      } catch (syncErr) {
        console.error(
          "Error syncing tasks across collaborators for:",
          item.sharedListId,
          syncErr
        );
      }
    }

    return res.json({ board: user.board });
  } catch (err) {
    console.error("Save board error:", err);
    return res.status(500).json({ error: "Failed to save board" });
  }
};

// POST /api/board/share-user (Direct share to another registered user with permissions)
exports.shareWithUser = async (req, res) => {
  try {
    const { list, targetUsername, permission, canShare } = req.body;
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
      return res
        .status(400)
        .json({ error: "You cannot share a list with yourself." });
    }

    const senderList = sender.board?.lists?.find((l) => l.id === list.id);
    if (senderList) {
      if (senderList.permission === "read" || senderList.canShare === false) {
        return res
          .status(403)
          .json({ error: "You do not have permission to share this list." });
      }
    }

    const recipient = await User.findOne({ usernameKey: trimmedTarget });
    if (!recipient) {
      return res.status(404).json({ error: "User does not exist" });
    }

    if (!recipient.board) {
      recipient.board = { lists: [], activeId: null, updatedAt: Date.now() };
    }

    // Determine target permissions
    const assignedPerm = permission === "read" ? "read" : "write";
    const assignedCanShare =
      canShare !== undefined ? Boolean(canShare) : assignedPerm === "write";

    // Ensure list has a global sharedListId
    const sharedListId =
      senderList?.sharedListId || list.sharedListId || uid();
    if (senderList && !senderList.sharedListId) {
      senderList.sharedListId = sharedListId;
      senderList.permission = senderList.permission || "owner";
      senderList.ownerUsername =
        senderList.ownerUsername || sender.usernameKey;
    }

    // Check if recipient already has this list
    const existingInRecipient = recipient.board.lists.find(
      (l) =>
        (l.sharedListId && l.sharedListId === sharedListId) ||
        (l.name.trim().toLowerCase() === list.name.trim().toLowerCase() &&
          l.todos.length === (list.todos || []).length &&
          l.todos.every((t, i) => t.text === list.todos[i]?.text))
    );

    if (existingInRecipient) {
      existingInRecipient.sharedListId = sharedListId;
      existingInRecipient.permission = assignedPerm;
      existingInRecipient.canShare = assignedCanShare;
      existingInRecipient.originalOwner =
        senderList?.originalOwner || sender.displayName;
      existingInRecipient.ownerUsername =
        senderList?.ownerUsername || sender.usernameKey;
      recipient.board.activeId = existingInRecipient.id;
      recipient.board.updatedAt = Date.now();
      await recipient.save();

      // Update in sender's sharedWith
      if (senderList) {
        if (!senderList.sharedWith) senderList.sharedWith = [];
        const memberIdx = senderList.sharedWith.findIndex(
          (m) => m.username === recipient.usernameKey
        );
        const memberObj = {
          username: recipient.usernameKey,
          displayName: recipient.displayName,
          permission: assignedPerm,
          canShare: assignedCanShare,
          sharedAt: Date.now(),
          via: "username",
        };
        if (memberIdx !== -1) {
          senderList.sharedWith[memberIdx] = memberObj;
        } else {
          senderList.sharedWith.push(memberObj);
        }
        sender.board.updatedAt = Date.now();
        await sender.save();
      }

      return res.json({
        success: true,
        alreadyHad: true,
        message: `${recipient.displayName} already has this list in their ListBook (permissions updated).`,
        listId: existingInRecipient.id,
        member: {
          username: recipient.usernameKey,
          displayName: recipient.displayName,
          permission: assignedPerm,
          canShare: assignedCanShare,
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
      sharedListId,
      ownerUsername: senderList?.ownerUsername || sender.usernameKey,
      originalOwner: senderList?.originalOwner || sender.displayName,
      permission: assignedPerm,
      canShare: assignedCanShare,
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
    if (senderList) {
      if (!senderList.sharedWith) senderList.sharedWith = [];
      const memberIdx = senderList.sharedWith.findIndex(
        (m) => m.username === recipient.usernameKey
      );
      const memberObj = {
        username: recipient.usernameKey,
        displayName: recipient.displayName,
        permission: assignedPerm,
        canShare: assignedCanShare,
        sharedAt: Date.now(),
        via: "username",
      };
      if (memberIdx !== -1) {
        senderList.sharedWith[memberIdx] = memberObj;
      } else {
        senderList.sharedWith.push(memberObj);
      }
      sender.board.updatedAt = Date.now();
      await sender.save();
    }

    return res.json({
      success: true,
      alreadyHad: false,
      message: `List "${list.name}" shared with ${recipient.displayName} (${
        assignedPerm === "write" ? "Editor" : "Viewer"
      })!`,
      listId: newListId,
      member: {
        username: recipient.usernameKey,
        displayName: recipient.displayName,
        permission: assignedPerm,
        canShare: assignedCanShare,
        sharedAt: Date.now(),
        via: "username",
      },
    });
  } catch (err) {
    console.error("Share with user error:", err);
    return res.status(500).json({ error: "Failed to share list." });
  }
};

// POST /api/board/share-link (Generate public share link with permissions)
exports.createShareLink = async (req, res) => {
  try {
    const { list, permission, canShare } = req.body;
    if (!list || !list.name) {
      return res.status(400).json({ error: "Invalid list data." });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found." });

    const userList = user.board?.lists?.find((l) => l.id === list.id);
    if (userList) {
      if (userList.permission === "read" || userList.canShare === false) {
        return res
          .status(403)
          .json({ error: "You do not have permission to share this list." });
      }
    }

    const assignedPerm = permission === "read" ? "read" : "write";
    const assignedCanShare =
      canShare !== undefined ? Boolean(canShare) : assignedPerm === "write";

    // Ensure list has a global sharedListId
    const sharedListId =
      userList?.sharedListId || list.sharedListId || uid();
    if (userList && !userList.sharedListId) {
      userList.sharedListId = sharedListId;
      userList.permission = userList.permission || "owner";
      userList.ownerUsername =
        userList.ownerUsername || user.usernameKey;
      await user.save();
    }

    const shareId = uid();
    await SharedList.create({
      shareId,
      sharedListId,
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
      defaultPermission: assignedPerm,
      defaultCanShare: assignedCanShare,
      claimedBy: [],
    });

    return res.json({
      shareId,
      sharedListId,
      permission: assignedPerm,
      canShare: assignedCanShare,
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
      return res
        .status(404)
        .json({ error: "Shared list not found or link has expired." });
    }

    return res.json({
      shareId: record.shareId,
      sharedListId: record.sharedListId,
      list: record.list,
      sharedBy: record.sharedBy,
      defaultPermission: record.defaultPermission || "write",
      defaultCanShare: record.defaultCanShare !== false,
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
      return res
        .status(404)
        .json({ error: "Shared list not found or link has expired." });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found." });

    if (!user.board) {
      user.board = { lists: [], activeId: null, updatedAt: Date.now() };
    }

    const targetPerm = record.defaultPermission || "write";
    const targetCanShare = record.defaultCanShare !== false;
    const sharedListId = record.sharedListId || record.shareId;

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
        permission: targetPerm,
        canShare: targetCanShare,
        claimedAt: new Date(),
      });
      await record.save();
    }

    // Also update owner's sharedWith if owner exists
    if (record.ownerUserId && String(record.ownerUserId) !== String(user._id)) {
      try {
        const owner = await User.findById(record.ownerUserId);
        if (owner?.board?.lists) {
          const ownerList = owner.board.lists.find(
            (l) =>
              l.id === record.ownerListId ||
              (l.sharedListId && l.sharedListId === sharedListId) ||
              l.name.trim().toLowerCase() === record.list.name.trim().toLowerCase()
          );
          if (ownerList) {
            if (!ownerList.sharedWith) ownerList.sharedWith = [];
            const idx = ownerList.sharedWith.findIndex(
              (m) => m.username === user.usernameKey
            );
            const memberObj = {
              username: user.usernameKey,
              displayName: user.displayName,
              permission: targetPerm,
              canShare: targetCanShare,
              sharedAt: Date.now(),
              via: "link",
            };
            if (idx !== -1) {
              ownerList.sharedWith[idx] = memberObj;
            } else {
              ownerList.sharedWith.push(memberObj);
            }
            owner.board.updatedAt = Date.now();
            await owner.save();
          }
        }
      } catch (ownerErr) {
        console.warn("Could not update owner sharedWith:", ownerErr);
      }
    }

    // Check if user already got this list previously
    const existingList = user.board.lists.find((l) => {
      if (l.sharedListId && l.sharedListId === sharedListId) return true;
      if (l.sourceShareId && l.sourceShareId === shareId) return true;
      const sameName =
        l.name.trim().toLowerCase() === record.list.name.trim().toLowerCase();
      if (!sameName) return false;
      const recTodos = record.list.todos || [];
      if (l.todos.length !== recTodos.length) return false;
      return l.todos.every((t, i) => t.text === recTodos[i]?.text);
    });

    if (existingList) {
      existingList.sharedListId = sharedListId;
      existingList.sourceShareId = shareId;
      existingList.permission = targetPerm;
      existingList.canShare = targetCanShare;
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
      sharedListId,
      sourceShareId: shareId,
      originalOwner: record.sharedBy,
      permission: targetPerm,
      canShare: targetCanShare,
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

    const isOwner =
      targetList.permission === "owner" ||
      !targetList.originalOwner ||
      targetList.ownerUsername === user.usernameKey;

    const membersMap = new Map();

    (targetList.sharedWith || []).forEach((m) => {
      membersMap.set(m.username.toLowerCase(), {
        username: m.username,
        displayName: m.displayName,
        permission: m.permission || "write",
        canShare: m.canShare !== false,
        sharedAt: m.sharedAt,
        via: m.via || "username",
      });
    });

    if (targetList.sharedListId || targetList.id) {
      const sharedRecords = await SharedList.find({
        $or: [
          { ownerUserId: user._id, ownerListId: listId },
          { sharedListId: targetList.sharedListId },
        ],
      });

      for (const rec of sharedRecords) {
        for (const claim of rec.claimedBy || []) {
          const uKey = (claim.username || "").toLowerCase();
          if (uKey && uKey !== user.usernameKey && !membersMap.has(uKey)) {
            membersMap.set(uKey, {
              username: claim.username,
              displayName: claim.displayName,
              permission: claim.permission || rec.defaultPermission || "write",
              canShare:
                claim.canShare !== undefined
                  ? claim.canShare
                  : rec.defaultCanShare !== false,
              sharedAt: claim.claimedAt
                ? new Date(claim.claimedAt).getTime()
                : Date.now(),
              via: "link",
            });
          }
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
        permission: targetList.permission || "owner",
        canShare: targetList.canShare !== false,
        isOwner,
      },
      members: Array.from(membersMap.values()),
    });
  } catch (err) {
    console.error("Get list members error:", err);
    return res.status(500).json({ error: "Failed to fetch list members." });
  }
};

// PUT /api/board/list/:listId/member-permission (Owner updates member permission)
exports.updateMemberPermission = async (req, res) => {
  try {
    const { listId } = req.params;
    const { targetUsername, permission, canShare } = req.body;
    if (!targetUsername) {
      return res.status(400).json({ error: "Target username is required." });
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.board)
      return res.status(404).json({ error: "User not found." });

    const ownerList = user.board.lists?.find((l) => l.id === listId);
    if (!ownerList) return res.status(404).json({ error: "List not found." });

    const isOwner =
      ownerList.permission === "owner" ||
      !ownerList.originalOwner ||
      ownerList.ownerUsername === user.usernameKey;
    if (!isOwner) {
      return res
        .status(403)
        .json({ error: "Only the list owner can modify permissions." });
    }

    const assignedPerm = permission === "read" ? "read" : "write";
    const assignedCanShare = Boolean(canShare);

    // 1. Update in owner's sharedWith
    if (ownerList.sharedWith) {
      const mIdx = ownerList.sharedWith.findIndex(
        (m) => m.username.toLowerCase() === targetUsername.toLowerCase()
      );
      if (mIdx !== -1) {
        ownerList.sharedWith[mIdx].permission = assignedPerm;
        ownerList.sharedWith[mIdx].canShare = assignedCanShare;
        user.board.updatedAt = Date.now();
        await user.save();
      }
    }

    // 2. Update directly in recipient's list
    if (ownerList.sharedListId) {
      await User.updateOne(
        {
          usernameKey: targetUsername.toLowerCase(),
          "board.lists.sharedListId": ownerList.sharedListId,
        },
        {
          $set: {
            "board.lists.$[elem].permission": assignedPerm,
            "board.lists.$[elem].canShare": assignedCanShare,
            "board.updatedAt": Date.now(),
          },
        },
        {
          arrayFilters: [{ "elem.sharedListId": ownerList.sharedListId }],
        }
      );
    }

    return res.json({
      success: true,
      message: `Permissions updated for @${targetUsername}.`,
      member: {
        username: targetUsername,
        permission: assignedPerm,
        canShare: assignedCanShare,
      },
    });
  } catch (err) {
    console.error("Update member permission error:", err);
    return res.status(500).json({ error: "Failed to update permissions." });
  }
};

// DELETE /api/board/list/:listId/member/:targetUsername (Owner revokes member access)
exports.removeMember = async (req, res) => {
  try {
    const { listId, targetUsername } = req.params;
    const user = await User.findById(req.user.id);
    if (!user || !user.board)
      return res.status(404).json({ error: "User not found." });

    const ownerList = user.board.lists?.find((l) => l.id === listId);
    if (!ownerList) return res.status(404).json({ error: "List not found." });

    const isOwner =
      ownerList.permission === "owner" ||
      !ownerList.originalOwner ||
      ownerList.ownerUsername === user.usernameKey;
    if (!isOwner) {
      return res
        .status(403)
        .json({ error: "Only the list owner can remove members." });
    }

    // 1. Remove from owner's sharedWith
    if (ownerList.sharedWith) {
      ownerList.sharedWith = ownerList.sharedWith.filter(
        (m) => m.username.toLowerCase() !== targetUsername.toLowerCase()
      );
      user.board.updatedAt = Date.now();
      await user.save();
    }

    // 2. Remove the list from recipient's board
    if (ownerList.sharedListId) {
      await User.updateOne(
        { usernameKey: targetUsername.toLowerCase() },
        {
          $pull: {
            "board.lists": { sharedListId: ownerList.sharedListId },
          },
          $set: { "board.updatedAt": Date.now() },
        }
      );
    }

    return res.json({
      success: true,
      message: `Removed @${targetUsername} from list.`,
    });
  } catch (err) {
    console.error("Remove member error:", err);
    return res.status(500).json({ error: "Failed to remove member." });
  }
};

// POST /api/board/list/:listId/leave (Collaborator leaves a shared list)
exports.leaveList = async (req, res) => {
  try {
    const { listId } = req.params;
    const user = await User.findById(req.user.id);
    if (!user || !user.board)
      return res.status(404).json({ error: "User not found." });

    const targetList = user.board.lists?.find((l) => l.id === listId);
    if (!targetList) return res.status(404).json({ error: "List not found." });

    const sharedListId = targetList.sharedListId;

    // Remove list from current user's board
    user.board.lists = user.board.lists.filter((l) => l.id !== listId);
    if (user.board.activeId === listId) {
      user.board.activeId = user.board.lists[0] ? user.board.lists[0].id : null;
    }
    user.board.updatedAt = Date.now();
    await user.save();

    // Remove user from owner's sharedWith
    if (sharedListId) {
      await User.updateMany(
        { "board.lists.sharedListId": sharedListId },
        {
          $pull: {
            "board.lists.$[elem].sharedWith": {
              username: user.usernameKey,
            },
          },
        },
        {
          arrayFilters: [{ "elem.sharedListId": sharedListId }],
        }
      );
    }

    return res.json({
      success: true,
      board: user.board,
      message: "You have left the list.",
    });
  } catch (err) {
    console.error("Leave list error:", err);
    return res.status(500).json({ error: "Failed to leave list." });
  }
};