import React from "react";

export default function Toast({ toastState }) {
  if (!toastState) return null;

  return (
    <div className="toast">
      {toastState.message}
      {toastState.onUndo && (
        <button
          className="link"
          onClick={toastState.onUndo}
          style={{ color: "inherit", marginLeft: 8 }}
        >
          Undo
        </button>
      )}
    </div>
  );
}