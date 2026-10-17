import React, { useState, useEffect, useRef, useCallback } from "react";
import { uid, ls, reorderSubset } from "./utils/helpers";
import { apiFetchBoard, apiSaveBoard } from "./utils/api";
import LoginScreen from "./components/LoginScreen";
import Sidebar from "./components/Sidebar";
import MainPane from "./components/MainPane";
import Toast from "./components/Toast";
import "./styles.css";

export default function App() {
  const [board, setBoard] = useState(null);
  const [userName, setUserName] = useState("");
  const [booting, setBooting] = useState(true);
  const [viewing, setViewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toastState, setToastState] = useState(null);

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

  const handleAuthenticated = (token, name, initialBoard) => {
    syncRef.current.token = token;
    ls.set("listbook:session", { token, name });
    ls.set("listbook:cachedBoard", initialBoard);
    setUserName(name);
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

  if (!board) {
    return (
      <>
        <LoginScreen booting={booting} onAuthenticated={handleAuthenticated} />
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
  };

  const handleDeleteList = (id) => {
    setConfirmDelete(false);
    setViewing(false);
    updateBoard((prev) => {
      const remaining = prev.lists.filter((l) => l.id !== id);
      return {
        ...prev,
        lists: remaining,
        activeId: remaining[0] ? remaining[0].id : null,
      };
    });
    showToast("List deleted.");
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
  };

  const handleToggleTodoDone = (todoId) => {
    if (!activeList) return;
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
          onDeleteList={handleDeleteList}
          onAddTodo={handleAddTodo}
          onToggleTodoDone={handleToggleTodoDone}
          onToggleTodoStar={handleToggleTodoStar}
          onDeleteTodo={handleDeleteTodo}
          onEditTodo={handleEditTodo}
          onReorderTodos={handleReorderTodos}
          showToast={showToast}
          composerInputRef={composerInputRef}
        />
      </div>
      <Toast toastState={toastState} />
    </>
  );
}