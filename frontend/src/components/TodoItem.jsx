import React, { useState, useRef, useEffect } from "react";
import { Icons } from "./Icons";

export default function TodoItem({
  todo,
  readOnly = false,
  onToggleDone,
  onToggleStar,
  onDelete,
  onEdit,
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(todo.text);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const commitEdit = (save) => {
    setEditing(false);
    const trimmed = editText.trim();
    if (save && trimmed && trimmed !== todo.text) {
      onEdit(todo.id, trimmed);
    } else {
      setEditText(todo.text);
    }
  };

  return (
    <div className={`todo ${todo.done ? "done" : ""}`} data-id={todo.id}>
      <button
        className="check"
        disabled={readOnly}
        onClick={() => !readOnly && onToggleDone(todo.id)}
        aria-label={todo.done ? "Mark not done" : "Mark done"}
      >
        <span className="box">{todo.done ? <Icons.Check /> : null}</span>
      </button>

      {editing && !readOnly ? (
        <input
          ref={inputRef}
          className="todo-edit"
          value={editText}
          maxLength={300}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={() => commitEdit(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit(true);
            if (e.key === "Escape") commitEdit(false);
          }}
        />
      ) : (
        <span
          className="todo-text"
          onClick={() => {
            if (!readOnly) {
              setEditText(todo.text);
              setEditing(true);
            }
          }}
        >
          {todo.text}
        </span>
      )}

      {!readOnly && (
        <>
          <button
            className={`icon-btn star-btn ${todo.starred ? "on" : ""}`}
            onClick={() => onToggleStar(todo.id)}
            aria-label={todo.starred ? "Unstar" : "Star"}
          >
            <Icons.Star />
          </button>

          <button
            className="icon-btn del"
            onClick={() => onDelete(todo.id)}
            aria-label="Delete todo"
          >
            <Icons.X />
          </button>
        </>
      )}
    </div>
  );
}