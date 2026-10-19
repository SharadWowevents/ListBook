import React, { useState, useEffect, useRef } from "react";
import { Icons } from "./Icons";
import SortableGroup from "./SortableGroup";
import TodoItem from "./TodoItem";
import Composer from "./Composer";
import LogWindow from "./LogWindow";

export default function MainPane({
  activeList,
  confirmDelete,
  setConfirmDelete,
  onBack,
  onRenameList,
  onToggleStarList,
  onShareList,
  onDeleteList,
  onAddTodo,
  onToggleTodoDone,
  onToggleTodoStar,
  onDeleteTodo,
  onEditTodo,
  onReorderTodos,
  showToast,
  composerInputRef,
  logs = [],
  onClearLogs,
}) {
  const [titleText, setTitleText] = useState(activeList?.name || "");
  const [showDone, setShowDone] = useState(true);
  const [showLogWindow, setShowLogWindow] = useState(true);
  const todosContainerRef = useRef(null);

  useEffect(() => {
    setTitleText(activeList?.name || "");
  }, [activeList?.id, activeList?.name]);

  if (!activeList) {
    return (
      <main className="main">
        <div className="main-head">
          <button
            className="icon-btn back"
            onClick={onBack}
            aria-label="Back to lists"
          >
            <Icons.Back />
          </button>
        </div>
        <p className="empty" style={{ paddingLeft: 24 }}>
          Create a list to get started.
        </p>
      </main>
    );
  }

  const sOpen = activeList.todos.filter((t) => !t.done && t.starred);
  const open = activeList.todos.filter((t) => !t.done && !t.starred);
  const done = activeList.todos.filter((t) => t.done);
  const total = activeList.todos.length;

  const isReadOnly = activeList.permission === "read";
  const canShare = activeList.canShare !== false;
  const isOwner =
    activeList.permission === "owner" || !activeList.originalOwner;

  const handleTitleBlur = () => {
    if (isReadOnly) return;
    const trimmed = titleText.trim();
    if (trimmed && trimmed !== activeList.name) {
      onRenameList(activeList.id, trimmed);
    } else {
      setTitleText(activeList.name);
    }
  };

  const handleAddAndScroll = (text) => {
    if (isReadOnly) return;
    onAddTodo(text);
    setTimeout(() => {
      if (todosContainerRef.current) {
        todosContainerRef.current.scrollTop =
          todosContainerRef.current.scrollHeight;
      }
    }, 0);
  };

  const renderTodo = (t) => (
    <TodoItem
      key={t.id}
      todo={t}
      readOnly={isReadOnly}
      onToggleDone={onToggleTodoDone}
      onToggleStar={onToggleTodoStar}
      onDelete={onDeleteTodo}
      onEdit={onEditTodo}
    />
  );

  return (
    <main className="main">
      <div className="main-head">
        <button
          className="icon-btn back"
          onClick={onBack}
          aria-label="Back to lists"
        >
          <Icons.Back />
        </button>
        <div className="title-wrap">
          <input
            className="title"
            value={titleText}
            aria-label="List name"
            maxLength={60}
            readOnly={isReadOnly}
            onChange={(e) => !isReadOnly && setTitleText(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <div
            className="sub"
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <span>
              {total
                ? `${total - done.length} open · ${done.length} done`
                : "No todos yet"}
            </span>
            {isReadOnly && (
              <span className="view-only-badge">👁 View only</span>
            )}
          </div>
        </div>
        <div className="head-actions">
          {canShare && (
            <button
              className="icon-btn share-btn"
              onClick={() => onShareList(activeList)}
              aria-label={`Share ${activeList.name}`}
              title="Share list"
            >
              <Icons.Share />
            </button>
          )}
          <button
            className={`icon-btn star-btn ${activeList.starred ? "on" : ""}`}
            onClick={() => onToggleStarList(activeList.id)}
            aria-label="Star list"
          >
            <Icons.Star />
          </button>
          <button
            className={`icon-btn log-toggle-btn ${showLogWindow ? "active" : ""}`}
            onClick={() => setShowLogWindow((prev) => !prev)}
            aria-label={showLogWindow ? "Hide activity log" : "Show activity log"}
            title={showLogWindow ? "Hide activity log" : "Show activity log"}
          >
            <Icons.Activity />
          </button>
          <button
            className="icon-btn"
            onClick={() => setConfirmDelete(true)}
            aria-label={isOwner ? "Delete list" : "Leave list"}
            title={isOwner ? "Delete list" : "Leave list"}
          >
            <Icons.Trash />
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="confirm">
          <span>
            {isOwner
              ? `Delete “${activeList.name}” and its ${total} todo${
                  total === 1 ? "" : "s"
                }?`
              : `Leave “${activeList.name}”? You can be re-invited later.`}
          </span>
          <button
            className="pill plain"
            onClick={() => setConfirmDelete(false)}
          >
            Keep
          </button>
          <button
            className="pill danger"
            onClick={() => onDeleteList(activeList.id)}
          >
            {isOwner ? "Delete list" : "Leave list"}
          </button>
        </div>
      )}

      <div className="main-split-wrap">
        <div className="todos-col" ref={todosContainerRef}>
          <div className="todo-inner">
            {!total && (
              <p className="empty">
                {isReadOnly
                  ? "No tasks in this list yet."
                  : "Nothing here yet. Type below or tap the mic and say your first todo."}
              </p>
            )}

            {sOpen.length > 0 && <div className="sec-label">Starred</div>}
            <SortableGroup
              groupName="todo-starred"
              onReorder={isReadOnly ? () => {} : onReorderTodos}
            >
              {sOpen.map(renderTodo)}
            </SortableGroup>

            {sOpen.length > 0 && open.length > 0 && (
              <div className="sec-label">Todos</div>
            )}
            <SortableGroup
              groupName="todo-open"
              onReorder={isReadOnly ? () => {} : onReorderTodos}
            >
              {open.map(renderTodo)}
            </SortableGroup>

            {done.length > 0 && (
              <>
                <button
                  className="done-toggle"
                  onClick={() => setShowDone((prev) => !prev)}
                >
                  {showDone ? <Icons.ChevDown /> : <Icons.Chev />} Done ·{" "}
                  {done.length}
                </button>
                {showDone && (
                  <SortableGroup
                    groupName="todo-done"
                    onReorder={isReadOnly ? () => {} : onReorderTodos}
                  >
                    {done.map(renderTodo)}
                  </SortableGroup>
                )}
              </>
            )}
          </div>
        </div>

        <LogWindow
          list={activeList}
          logs={logs}
          onClearLogs={onClearLogs}
          isOpen={showLogWindow}
          onClose={() => setShowLogWindow(false)}
        />
      </div>

      {!isReadOnly ? (
        <Composer
          onAddTodo={handleAddAndScroll}
          showToast={showToast}
          inputRef={composerInputRef}
        />
      ) : (
        <div
          style={{
            padding: "14px 20px",
            color: "var(--muted)",
            fontSize: "0.88rem",
            borderTop: "1px solid var(--line)",
            background: "var(--panel)",
            textAlign: "center",
          }}
        >
          You have view-only access to this list.
        </div>
      )}
    </main>
  );
}