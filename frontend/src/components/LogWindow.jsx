import React, { useState } from "react";
import { Icons } from "./Icons";

function formatTimestamp(ts) {
  if (!ts) return "";
  const now = Date.now();
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 45) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  const date = new Date(ts);
  const isToday = new Date().toDateString() === date.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getLogIcon(type) {
  switch (type) {
    case "add":
      return <Icons.Plus />;
    case "complete":
      return <Icons.Check />;
    case "uncomplete":
      return <span className="log-circle-dot" />;
    case "star":
    case "unstar":
      return <Icons.Star />;
    case "edit":
      return <Icons.Edit />;
    case "delete":
      return <Icons.Trash />;
    case "reorder":
      return <Icons.Grip />;
    case "share":
      return <img
        src="/send.png"
        alt=""
        className="share-icon"
      />;
    case "sync":
      return <Icons.Sync />;
    default:
      return <Icons.Activity />;
  }
}

export default function LogWindow({
  list,
  logs = [],
  onClearLogs,
  isOpen = true,
  onClose,
}) {
  const [filter, setFilter] = useState("all"); // 'all' | 'tasks' | 'sync'

  if (!isOpen) return null;

  const filteredLogs = logs.filter((item) => {
    if (!item) return false;
    if (filter === "tasks") {
      return ["add", "complete", "uncomplete", "edit", "delete", "star", "reorder"].includes(item.type);
    }
    if (filter === "sync") {
      return ["sync", "share"].includes(item.type);
    }
    return true;
  });

  return (
    <aside className="log-window" aria-label="Activity Log">
      <div className="log-head">
        <div className="log-title-wrap">
          <div className="log-title">
            <span className="log-icon-badge">
              <Icons.Activity />
            </span>
            <span>Activity Log</span>
            <span className="log-count-pill">{filteredLogs.length}</span>
          </div>
          <span className="log-subtitle">
            Events for “{list?.name || "List"}”
          </span>
        </div>

        <div className="log-actions">
          {logs.length > 0 && onClearLogs && (
            <button
              type="button"
              className="log-btn-ghost"
              onClick={onClearLogs}
              title="Clear activity log"
              aria-label="Clear activity log"
            >
              Clear
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="icon-btn log-close-btn"
              onClick={onClose}
              title="Hide activity log"
              aria-label="Hide activity log"
            >
              <Icons.X />
            </button>
          )}
        </div>
      </div>

      <div className="log-filters">
        <button
          type="button"
          className={`log-filter-btn ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={`log-filter-btn ${filter === "tasks" ? "active" : ""}`}
          onClick={() => setFilter("tasks")}
        >
          Tasks
        </button>
        <button
          type="button"
          className={`log-filter-btn ${filter === "sync" ? "active" : ""}`}
          onClick={() => setFilter("sync")}
        >
          Sync & Share
        </button>
      </div>

      <div className="log-body">
        {filteredLogs.length === 0 ? (
          <div className="log-empty">
            <div className="log-empty-icon">
              <Icons.Activity />
            </div>
            <p className="log-empty-title">No activity logged yet</p>
            <p className="log-empty-desc">
              Task changes, completions, edits, and live sync events will appear
              here in real time.
            </p>
          </div>
        ) : (
          <div className="log-list">
            {filteredLogs.map((item) => (
              <div key={item.id} className={`log-item type-${item.type}`}>
                <div className={`log-badge badge-${item.type}`}>
                  {getLogIcon(item.type)}
                </div>
                <div className="log-content">
                  <div className="log-text">{item.text}</div>
                  <div className="log-meta">
                    <span className="log-time">
                      {formatTimestamp(item.timestamp)}
                    </span>
                    {item.user && (
                      <span className="log-actor">by @{item.user}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="log-foot">
        <span className="log-status-dot" />
        <span>Live activity recording</span>
      </div>
    </aside>
  );
}

