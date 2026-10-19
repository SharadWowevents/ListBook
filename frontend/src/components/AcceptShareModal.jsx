import React, { useState } from "react";
import { Icons } from "./Icons";
import { apiAcceptSharedList } from "../utils/api";

export default function AcceptShareModal({ sharedInfo, token, onAccepted, onDismiss }) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  if (!sharedInfo?.list) return null;

  const { list, sharedBy, shareId } = sharedInfo;
  const taskCount = list.todos?.length || 0;

  const handleAccept = async () => {
    setImporting(true);
    setError("");
    try {
      const res = await apiAcceptSharedList(token, shareId);
      onAccepted(res.addedList, res.board);
    } catch (err) {
      setError(err.message || "Failed to add shared list.");
      setImporting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <div className="modal-title-wrap">
            <span className="modal-badge">Incoming Shared List</span>
            <h3 className="modal-title">“{list.name}”</h3>
          </div>
          <button className="icon-btn modal-close" onClick={onDismiss} aria-label="Close modal">
            <Icons.X />
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-desc">
            <b>{sharedBy}</b> shared this list with you containing <b>{taskCount}</b> {taskCount === 1 ? "task" : "tasks"}.
          </p>

          {taskCount > 0 && (
            <div className="shared-preview-box">
              <div className="shared-preview-label">Preview Tasks:</div>
              <ul className="shared-preview-list">
                {list.todos.slice(0, 5).map((t, i) => (
                  <li key={t.id || i} className="shared-preview-item">
                    <span>{t.starred ? "★ " : "• "}</span>
                    <span>{t.text}</span>
                  </li>
                ))}
                {taskCount > 5 && (
                  <li className="shared-preview-more">+ {taskCount - 5} more tasks</li>
                )}
              </ul>
            </div>
          )}

          {error && <div className="modal-error">{error}</div>}

          <div className="modal-actions" style={{ marginTop: 18 }}>
            <button
              type="button"
              className="btn secondary"
              onClick={onDismiss}
              disabled={importing}
            >
              Dismiss
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleAccept}
              disabled={importing}
            >
              {importing ? "Adding to Lists..." : "Add to My ListBook"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

