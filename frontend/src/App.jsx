import React, { useState, useEffect, useRef, useCallback } from "react";
import { uid, ls, reorderSubset } from "./utils/helpers";
import {
  apiFetchBoard,
  apiSaveBoard,
  apiGetSharedList,
  apiAcceptSharedList,
  apiLeaveList,
} from "./utils/api";
import LoginScreen from "./components/LoginScreen";
import Sidebar from "./components/Sidebar";
import MainPane from "./components/MainPane";
import Toast from "./components/Toast";
import ShareModal from "./components/ShareModal";
import AcceptShareModal from "./components/AcceptShareModal";
import "./styles.css";

export default function App() {
  const [board, setBoard] = useState(null);
  const [userName, setUserName] = useState("");
  const [booting, setBooting] = useState(true);
  const [viewing, setViewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toastState, setToastState] = useState(null);
  const [sharingList, setSharingList] = useState(null);
  const [sharedInfo, setSharedInfo] = useState(null);
  const [logs, setLogs] = useState(() => ls.get("listbook:activity_logs") || []);

  const addLog = useCallback(
    (listId, type, text, detail = "") => {
      if (!listId) return;
      setLogs((prev) => {
        const entry = {
          id: uid(),
          listId,
          type,
          text,
          detail,
          timestamp: Date.now(),
          user: userName || "You",
        };
        const next = [entry, ...(prev || [])].slice(0, 150);
        ls.set("listbook:activity_logs", next);
        return next;
      });
    },
    [userName]
  );

  const handleClearLogs = useCallback((listId) => {
    setLogs((prev) => {
      const remaining = listId ? prev.filter((l) => l.listId !== listId) : [];
      ls.set("listbook:activity_logs", remaining);
      return remaining;
    });
  }, []);

  const syncRef = useRef({
    token: null,
    dirty: false,
    saving: false,
    saveTimer: null,
  });
  const boardRef = useRef(null);
  boardRef.current = board;

  const toastTimerRef = useRef(null);
  const composerInputRef = useRef(null);

  const showToast = useCallback((message, ms = 3200, onUndo = null) => {
    setToastState({ message, onUndo });
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastState(null), ms);
  }, []);

  const flush = useCallback(async () => {
    const S = syncRef.current;
    if (!S.dirty || S.saving || !S.token || !boardRef.current) return;
    S.saving = true;
    S.dirty = false;
    try {
      await apiSaveBoard(S.token, boardRef.current);
    } catch {
      showToast(
        "Couldn't reach the server. Changes are cached on this device."
      );
    }
    S.saving = false;
    if (S.dirty) flush();
  }, [showToast]);

  const updateBoard = useCallback(
    (updater) => {
      setBoard((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        const stamped = { ...next, updatedAt: Date.now() };
        boardRef.current = stamped;

        ls.set("listbook:cachedBoard", stamped);
        const S = syncRef.current;
        S.dirty = true;
        clearTimeout(S.saveTimer);
        S.saveTimer = setTimeout(flush, 400);

        return stamped;
      });
    },
    [flush]
  );

  const cleanShareUrl = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("share");
      if (url.hash && url.hash.includes("share")) {
        url.hash = "";
      }
      window.history.replaceState(
        {},
        document.title,
        url.pathname + (url.search ? url.search : "")
      );
    } catch {
      // Ignore URL manipulation failures
    }
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    let shareId = searchParams.get("share");
    if (!shareId && window.location.hash) {
      const hash = window.location.hash.replace(/^#/, "");
      const hashParams = new URLSearchParams(
        hash.includes("?") ? hash.slice(hash.indexOf("?")) : hash
      );
      shareId =
        hashParams.get("share") ||
        (hash.startsWith("share=") ? hash.replace("share=", "") : null);
    }

    if (shareId) {
      apiGetSharedList(shareId)
        .then((data) => {
          setSharedInfo(data);
        })
        .catch((err) => {
          console.warn("Shared link error:", err);
          showToast(err.message || "Shared list link is invalid or expired.");
          cleanShareUrl();
        });
    }
  }, [cleanShareUrl, showToast]);

  const handleAuthenticated = async (token, name, initialBoard) => {
    syncRef.current.token = token;
    ls.set("listbook:session", { token, name });
    setUserName(name);

    if (sharedInfo?.shareId) {
      try {
        const res = await apiAcceptSharedList(token, sharedInfo.shareId);
        const updatedBoard = res.board;
        ls.set("listbook:cachedBoard", updatedBoard);
        setBoard(updatedBoard);
        setViewing(true);
        if (res.alreadyAdded) {
          showToast(
            `Opened "${res.addedList?.name || sharedInfo.list?.name}" (already in your lists)`
          );
        } else {
          showToast(
            `List "${res.addedList?.name || sharedInfo.list?.name}" added to your ListBook!`
          );
        }
        cleanShareUrl();
        setSharedInfo(null);
        return;
      } catch (err) {
        console.error("Failed to auto-accept share:", err);
        showToast("Couldn't add shared list automatically: " + err.message);
      }
    }

    ls.set("listbook:cachedBoard", initialBoard);
    setBoard(initialBoard);
  };

  const signOut = () => {
    flush();
    clearTimeout(syncRef.current.saveTimer);
    syncRef.current = { token: null, dirty: false, saving: false, saveTimer: null };
    ls.del("listbook:session");
    ls.del("listbook:cachedBoard");
    setBoard(null);
    setUserName("");
  };

  useEffect(() => {
    let mounted = true;
    async function bootSession() {
      const sess = ls.get("listbook:session");
      if (!sess?.token) {
        if (mounted) setBooting(false);
        return;
      }

      syncRef.current.token = sess.token;
      setUserName(sess.name || "");

      const cached = ls.get("listbook:cachedBoard");
      if (cached && mounted) {
        setBoard(cached);
        setBooting(false);
      }

      try {
        const { name, board: remoteBoard } = await apiFetchBoard(sess.token);
        if (mounted) {
          setUserName(name);
          if (!cached || (remoteBoard.updatedAt || 0) >= (cached.updatedAt || 0)) {
            setBoard(remoteBoard);
            ls.set("listbook:cachedBoard", remoteBoard);
          }
        }
      } catch (err) {
        if (err.message.includes("Unauthorized")) {
          ls.del("listbook:session");
          syncRef.current.token = null;
          if (mounted) setBoard(null);
        } else if (mounted && cached) {
          showToast("Working offline with cached lists.");
        }
      } finally {
        if (mounted) setBooting(false);
      }
    }

    bootSession();

    const handleVisibility = () => {
      if (document.hidden) flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [flush, showToast]);

  // Live sync: poll for collaborator updates every 2.8s when active and not busy saving
  useEffect(() => {
    if (!board) return;

    const interval = setInterval(async () => {
      const S = syncRef.current;
      // Skip polling if document is hidden, user is actively editing/saving, or not authenticated
      if (document.hidden || S.dirty || S.saving || !S.token) return;

      try {
        const { board: remoteBoard } = await apiFetchBoard(S.token);
        if (!remoteBoard || !Array.isArray(remoteBoard.lists)) return;

        const currentUpdated = boardRef.current?.updatedAt || 0;
        const remoteUpdated = remoteBoard.updatedAt || 0;

        // Apply if remote board has newer updates from collaborators or permission changes
        if (remoteUpdated > currentUpdated) {
          const currentActiveId = boardRef.current?.activeId;
          const activeStillExists = remoteBoard.lists.some(
            (l) => l.id === currentActiveId
          );
          const nextBoard = {
            ...remoteBoard,
            activeId: activeStillExists
              ? currentActiveId
              : remoteBoard.activeId || remoteBoard.lists[0]?.id || null,
          };
          boardRef.current = nextBoard;
          ls.set("listbook:cachedBoard", nextBoard);
          setBoard(nextBoard);
        }
      } catch {
        // Silently ignore background polling errors
      }
    }, 2800);

    return () => clearInterval(interval);
  }, [board !== null]);

  if (!board) {
    return (
      <>
        <LoginScreen
          booting={booting}
          onAuthenticated={handleAuthenticated}
          sharedInfo={sharedInfo}
        />
        <Toast toastState={toastState} />
      </>
    );
  }

  const activeList =
    board.lists.find((l) => l.id === board.activeId) || board.lists[0] || null;

  const handleSelectList = (id) => {
    setViewing(true);
    setConfirmDelete(false);
    updateBoard((prev) => ({ ...prev, activeId: id }));
  };

  const handleToggleStarList = (id) => {
    updateBoard((prev) => ({
      ...prev,
      lists: prev.lists.map((l) =>
        l.id === id ? { ...l, starred: !l.starred } : l
      ),
    }));
  };

  const handleCreateList = (name) => {
    const newList = { id: uid(), name, starred: false, todos: [] };
    setViewing(true);
    updateBoard((prev) => ({
      ...prev,
      lists: [...prev.lists, newList],
      activeId: newList.id,
    }));
    addLog(newList.id, "add", `Created list "${name}"`);
    setTimeout(() => composerInputRef.current?.focus(), 0);
  };

  const handleReorderLists = (ids) => {
    updateBoard((prev) => ({
      ...prev,
      lists: reorderSubset(prev.lists, ids),
    }));
  };

  const handleRenameList = (id, name) => {
    updateBoard((prev) => ({
      ...prev,
      lists: prev.lists.map((l) => (l.id === id ? { ...l, name } : l)),
    }));
    addLog(id, "edit", `Renamed list to "${name}"`);
  };

  const handleDeleteList = async (id) => {
    setConfirmDelete(false);
    setViewing(false);
    const target = board?.lists?.find((l) => l.id === id);
    const isCollaborator =
      target &&
      (target.permission === "read" ||
        (target.permission === "write" && target.ownerUsername) ||
        target.originalOwner);

    if (isCollaborator && syncRef.current.token) {
      try {
        await apiLeaveList(syncRef.current.token, id);
      } catch (err) {
        console.warn("Could not notify server on leave list:", err);
      }
    }

    addLog(id, "delete", `Deleted list "${target?.name || id}"`);

    updateBoard((prev) => {
      const remaining = prev.lists.filter((l) => l.id !== id);
      return {
        ...prev,
        lists: remaining,
        activeId: remaining[0] ? remaining[0].id : null,
      };
    });
    showToast(isCollaborator ? "Left shared list." : "List deleted.");
  };

  const handleAddTodo = (text) => {
    if (!activeList) return;
    const newTodo = { id: uid(), text, done: false, starred: false };
    updateBoard((prev) => ({
      ...prev,
      lists: prev.lists.map((l) =>
        l.id === activeList.id ? { ...l, todos: [...l.todos, newTodo] } : l
      ),
    }));
    addLog(activeList.id, "add", `Added: "${text}"`);
  };

  const handleToggleTodoDone = (todoId) => {
    if (!activeList) return;
    const targetTodo = activeList.todos.find((t) => t.id === todoId);
    if (targetTodo) {
      const willBeDone = !targetTodo.done;
      addLog(
        activeList.id,
        willBeDone ? "complete" : "uncomplete",
        willBeDone
          ? `Completed "${targetTodo.text}"`
          : `Marked "${targetTodo.text}" as open`
      );
    }
    updateBoard((prev) => ({
      ...prev,
      lists: prev.lists.map((l) =>
        l.id === activeList.id
          ? {
              ...l,
              todos: l.todos.map((t) =>
                t.id === todoId ? { ...t, done: !t.done } : t
              ),
            }
          : l
      ),
    }));
  };

  const handleToggleTodoStar = (todoId) => {
    if (!activeList) return;
    const targetTodo = activeList.todos.find((t) => t.id === todoId);
    if (targetTodo) {
      const willBeStarred = !targetTodo.starred;
      addLog(
        activeList.id,
        willBeStarred ? "star" : "unstar",
        willBeStarred
          ? `Starred "${targetTodo.text}"`
          : `Unstarred "${targetTodo.text}"`
      );
    }
    updateBoard((prev) => ({
      ...prev,
      lists: prev.lists.map((l) =>
        l.id === activeList.id
          ? {
              ...l,
              todos: l.todos.map((t) =>
                t.id === todoId ? { ...t, starred: !t.starred } : t
              ),
            }
          : l
      ),
    }));
  };

  const handleEditTodo = (todoId, text) => {
    if (!activeList) return;
    const targetTodo = activeList.todos.find((t) => t.id === todoId);
    if (targetTodo && targetTodo.text !== text) {
      addLog(activeList.id, "edit", `Edited: "${text}"`);
    }
    updateBoard((prev) => ({
      ...prev,
      lists: prev.lists.map((l) =>
        l.id === activeList.id
          ? {
              ...l,
              todos: l.todos.map((t) =>
                t.id === todoId ? { ...t, text } : t
              ),
            }
          : l
      ),
    }));
  };

  const handleDeleteTodo = (todoId) => {
    if (!activeList) return;
    const listId = activeList.id;
    const idx = activeList.todos.findIndex((t) => t.id === todoId);
    if (idx === -1) return;
    const deletedTodo = activeList.todos[idx];

    addLog(listId, "delete", `Deleted: "${deletedTodo.text}"`);

    updateBoard((prev) => ({
      ...prev,
      lists: prev.lists.map((l) =>
        l.id === listId
          ? { ...l, todos: l.todos.filter((t) => t.id !== todoId) }
          : l
      ),
    }));

    showToast("Todo deleted.", 5000, () => {
      updateBoard((prev) => ({
        ...prev,
        lists: prev.lists.map((l) => {
          if (l.id !== listId) return l;
          const nextTodos = [...l.todos];
          nextTodos.splice(idx, 0, deletedTodo);
          return { ...l, todos: nextTodos };
        }),
      }));
      setToastState(null);
    });
  };

  const handleReorderTodos = (ids) => {
    if (!activeList) return;
    addLog(activeList.id, "reorder", "Reordered tasks in list");
    updateBoard((prev) => ({
      ...prev,
      lists: prev.lists.map((l) =>
        l.id === activeList.id
          ? { ...l, todos: reorderSubset(l.todos, ids) }
          : l
      ),
    }));
  };

  return (
    <>
      <div className={`app ${viewing ? "viewing" : ""}`}>
        <Sidebar
          userName={userName}
          lists={board.lists}
          activeId={activeList?.id}
          onSelectList={handleSelectList}
          onToggleStarList={handleToggleStarList}
          onShareList={(list) => setSharingList(list)}
          onCreateList={handleCreateList}
          onReorderLists={handleReorderLists}
          onSignOut={signOut}
        />
        <MainPane
          activeList={activeList}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          onBack={() => {
            setViewing(false);
            setConfirmDelete(false);
          }}
          onRenameList={handleRenameList}
          onToggleStarList={handleToggleStarList}
          onShareList={(list) => setSharingList(list || activeList)}
          onDeleteList={handleDeleteList}
          onAddTodo={handleAddTodo}
          onToggleTodoDone={handleToggleTodoDone}
          onToggleTodoStar={handleToggleTodoStar}
          onDeleteTodo={handleDeleteTodo}
          onEditTodo={handleEditTodo}
          onReorderTodos={handleReorderTodos}
          showToast={showToast}
          composerInputRef={composerInputRef}
          logs={logs.filter((l) => l.listId === activeList?.id)}
          onClearLogs={() => handleClearLogs(activeList?.id)}
        />
      </div>

      {sharingList && (
        <ShareModal
          list={sharingList}
          token={syncRef.current.token}
          onClose={() => setSharingList(null)}
          showToast={showToast}
        />
      )}

      {sharedInfo && (
        <AcceptShareModal
          sharedInfo={sharedInfo}
          token={syncRef.current.token}
          board={board}
          onAccepted={(addedList, updatedBoard, alreadyAdded) => {
            setBoard(updatedBoard);
            ls.set("listbook:cachedBoard", updatedBoard);
            setViewing(true);
            cleanShareUrl();
            setSharedInfo(null);
            if (alreadyAdded) {
              showToast(
                `Opened "${addedList?.name || sharedInfo.list?.name}" (already in your lists)`
              );
            } else {
              showToast(
                `List "${addedList?.name || sharedInfo.list?.name}" added to your ListBook!`
              );
            }
          }}
          onDismiss={() => {
            cleanShareUrl();
            setSharedInfo(null);
          }}
        />
      )}

      <Toast toastState={toastState} />
    </>
  );
}