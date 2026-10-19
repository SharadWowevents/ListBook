import React, { useState, useRef, useEffect } from "react";
import { Icons } from "./Icons";
import SortableGroup from "./SortableGroup";

export default function Sidebar({
  userName,
  lists,
  activeId,
  onSelectList,
  onToggleStarList,
  onShareList,
  onCreateList,
  onReorderLists,
  onSignOut,
}) {
  const [adding, setAdding] = useState(false);
  const [newListName, setNewListName] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    const trimmed = newListName.trim();
    setAdding(false);
    setNewListName("");
    if (trimmed) onCreateList(trimmed);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (adding && !newListName.trim()) {
        setAdding(false);
        setNewListName("");
      }
    }, 150);
  };

  const starredLists = lists.filter((l) => l.starred);
  const otherLists = lists.filter((l) => !l.starred);

  const renderListRow = (l) => {
    const openCount = l.todos.filter((t) => !t.done).length;
    return (
      <div
        key={l.id}
        className={`list-row ${l.id === activeId ? "active" : ""}`}
        data-id={l.id}
      >
        <span className="grip" aria-hidden="true">
          <Icons.Grip />
        </span>
        <button className="list-open" onClick={() => onSelectList(l.id)}>
          <span className="list-name">{l.name}</span>
          <span className="count">{openCount || ""}</span>
        </button>
        {l.canShare !== false && (
          <button
            className="icon-btn share-btn"
            onClick={(e) => {
              e.stopPropagation();
              onShareList(l);
            }}
            aria-label={`Share ${l.name}`}
            title="Share list"
          >
            <Icons.Share />
          </button>
        )}
        <button
          className={`icon-btn star-btn ${l.starred ? "on" : ""}`}
          onClick={() => onToggleStarList(l.id)}
          aria-label={`${l.starred ? "Unstar" : "Star"} ${l.name}`}
        >
          <Icons.Star />
        </button>
      </div>
    );
  };

  return (
    <aside className="side">
      <div className="side-head">
        <div className="side-top">
          <div className="side-brand">
            List<span>book</span>
          </div>
          <div className="who">
            <span className="who-user" title={`Signed in as ${userName}`}>
              <span className="who-avatar">{userName ? userName[0].toUpperCase() : "U"}</span>
              <b>{userName}</b>
            </span>
            <button
              type="button"
              className="signout-btn"
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <Icons.LogOut />
              <span>Sign out</span>
            </button>
          </div>
        </div>

        {adding ? (
          <form
            className="new-list"
            onSubmit={handleCreateSubmit}
            autoComplete="off"
          >
            <input
              ref={inputRef}
              className="input"
              placeholder="List name"
              maxLength={60}
              aria-label="New list name"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setAdding(false);
                  setNewListName("");
                }
              }}
            />
            <button className="send" type="submit" aria-label="Create list">
              <Icons.Plus />
            </button>
          </form>
        ) : (
          <button className="add-list" onClick={() => setAdding(true)}>
            <span className="plus">
              <Icons.Plus />
            </span>
            Add List
          </button>
        )}
      </div>

      <div className="lists">
        {starredLists.length > 0 && <div className="sec-label">Starred</div>}
        <SortableGroup groupName="list-starred" onReorder={onReorderLists}>
          {starredLists.map(renderListRow)}
        </SortableGroup>

        {starredLists.length > 0 && otherLists.length > 0 && (
          <div className="sec-label">Lists</div>
        )}
        <SortableGroup groupName="list-other" onReorder={onReorderLists}>
          {otherLists.map(renderListRow)}
        </SortableGroup>
      </div>
    </aside>
  );
}