import React, { useState, useEffect, useRef } from "react";
import { Icons } from "./Icons";
import SortableGroup from "./SortableGroup";
import TodoItem from "./TodoItem";
import Composer from "./Composer";

export default function MainPane({
  activeList,
  confirmDelete,
  setConfirmDelete,
  onBack,
  onRenameList,
  onToggleStarList,
  onDeleteList,
  onAddTodo,
  onToggleTodoDone,
  onToggleTodoStar,
  onDeleteTodo,
  onEditTodo,
  onReorderTodos,
  showToast,
  composerInputRef,
}) {
  const [titleText, setTitleText] = useState(activeList?.name || "");
  const [showDone, setShowDone] = useState(true);
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

  const handleTitleBlur = () => {
    const trimmed = titleText.trim();
    if (trimmed && trimmed !== activeList.name) {
      onRenameList(activeList.id, trimmed);
    } else {
      setTitleText(activeList.name);
    }
  };

  const handleAddAndScroll = (text) => {
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
            onChange={(e) => setTitleText(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <div className="sub">
            {total
              ? `${total - done.length} open · ${done.length} done`
              : "No todos yet"}
          </div>
        </div>
        <div className="head-actions">
          <button
            className={`icon-btn star-btn ${activeList.starred ? "on" : ""}`}
            onClick={() => onToggleStarList(activeList.id)}
            aria-label="Star list"
          >
            <Icons.Star />
          </button>
          <button
            className="icon-btn"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete list"
          >
            <Icons.Trash />
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="confirm">
          <span>
            Delete “{activeList.name}” and its {total} todo
            {total === 1 ? "" : "s"}?
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
            Delete list
          </button>
        </div>
      )}

      <div className="todos" ref={todosContainerRef}>
        <div className="todo-inner">
          {!total && (
            <p className="empty">
              Nothing here yet. Type below or tap the mic and say your first todo.
            </p>
          )}

          {sOpen.length > 0 && <div className="sec-label">Starred</div>}
          <SortableGroup groupName="todo-starred" onReorder={onReorderTodos}>
            {sOpen.map(renderTodo)}
          </SortableGroup>

          {sOpen.length > 0 && open.length > 0 && (
            <div className="sec-label">Todos</div>
          )}
          <SortableGroup groupName="todo-open" onReorder={onReorderTodos}>
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
                <SortableGroup groupName="todo-done" onReorder={onReorderTodos}>
                  {done.map(renderTodo)}
                </SortableGroup>
              )}
            </>
          )}
        </div>
      </div>

      <Composer
        onAddTodo={handleAddAndScroll}
        showToast={showToast}
        inputRef={composerInputRef}
      />
    </main>
  );
}