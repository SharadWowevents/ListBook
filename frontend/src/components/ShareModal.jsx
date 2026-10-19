import React, { useState, useEffect, useRef, useCallback } from "react";
import { Icons } from "./Icons";
import {
  apiShareWithUser,
  apiCreateShareLink,
  apiGetListMembers,
  apiUpdateMemberPermission,
  apiRemoveMember,
} from "../utils/api";
import { ls } from "../utils/helpers";

export default function ShareModal({ list, token, onClose, showToast }) {
  const [tab, setTab] = useState("user"); // 'user' | 'link' | 'members'
  const [targetUsername, setTargetUsername] = useState("");
  const [userPermission, setUserPermission] = useState("write"); // 'write' | 'read'
  const [userCanShare, setUserCanShare] = useState(true);

  const [sharingUser, setSharingUser] = useState(false);
  const [userError, setUserError] = useState("");
  const [userSuccess, setUserSuccess] = useState("");

  const [linkPermission, setLinkPermission] = useState("write");
  const [linkCanShare, setLinkCanShare] = useState(true);
  const [shareLink, setShareLink] = useState("");
  const [loadingLink, setLoadingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkError, setLinkError] = useState("");

  const [members, setMembers] = useState(list.sharedWith || []);
  const [originalOwner, setOriginalOwner] = useState(list.originalOwner || null);
  const [isOwner, setIsOwner] = useState(
    list.permission === "owner" || !list.originalOwner
  );
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [updatingMember, setUpdatingMember] = useState("");

  const inputRef = useRef(null);

  useEffect(() => {
    if (tab === "user") {
      inputRef.current?.focus();
    }
  }, [tab]);

  // Load associated members on mount
  useEffect(() => {
    let isMounted = true;
    async function loadMembers() {
      try {
        setLoadingMembers(true);
        const authToken = token || ls.get("listbook:session")?.token;
        if (!authToken) return;
        const res = await apiGetListMembers(authToken, list.id);
        if (isMounted) {
          if (Array.isArray(res.members)) setMembers(res.members);
          if (res.originalOwner) setOriginalOwner(res.originalOwner);
          if (res.currentUser) setIsOwner(Boolean(res.currentUser.isOwner));
        }
      } catch (err) {
        console.warn("Could not fetch members:", err);
      } finally {
        if (isMounted) setLoadingMembers(false);
      }
    }
    loadMembers();
    return () => {
      isMounted = false;
    };
  }, [token, list.id]);

  const generateLink = useCallback(
    async (perm = linkPermission, canShare = linkCanShare) => {
      setLoadingLink(true);
      setLinkError("");
      try {
        const authToken = token || ls.get("listbook:session")?.token;
        if (!authToken) {
          throw new Error("You must be signed in to generate a share link.");
        }
        const res = await apiCreateShareLink(authToken, list, perm, canShare);
        const url = `${window.location.origin}/?share=${res.shareId}`;
        setShareLink(url);
      } catch (err) {
        console.error("Generate share link error:", err);
        setLinkError(err.message || "Failed to create share link.");
      } finally {
        setLoadingLink(false);
      }
    },
    [token, list, linkPermission, linkCanShare]
  );

  useEffect(() => {
    if (tab === "link" && !shareLink) {
      generateLink(linkPermission, linkCanShare);
    }
  }, [tab, shareLink, linkPermission, linkCanShare, generateLink]);

  const handleLinkPermChange = (newPerm) => {
    setLinkPermission(newPerm);
    generateLink(newPerm, linkCanShare);
  };

  const handleLinkCanShareChange = (newCanShare) => {
    setLinkCanShare(newCanShare);
    generateLink(linkPermission, newCanShare);
  };

  const handleShareUserSubmit = async (e) => {
    e.preventDefault();
    const trimmed = targetUsername.trim();
    if (!trimmed) {
      setUserError("Please enter a username.");
      return;
    }

    setSharingUser(true);
    setUserError("");
    setUserSuccess("");

    try {
      const authToken = token || ls.get("listbook:session")?.token;
      const res = await apiShareWithUser(
        authToken,
        list,
        trimmed,
        userPermission,
        userCanShare
      );
      setUserSuccess(res.message || `Shared with ${trimmed}!`);
      showToast(res.message || `List "${list.name}" shared with ${trimmed}!`);

      if (res.member) {
        setMembers((prev) => [
          res.member,
          ...prev.filter(
            (m) =>
              m.username.toLowerCase() !== res.member.username.toLowerCase()
          ),
        ]);
      }
      setTargetUsername("");
    } catch (err) {
      const msg = err.message || "";
      if (
        msg.toLowerCase().includes("user does not exist") ||
        msg.toLowerCase().includes("not exist")
      ) {
        setUserError("User does not exist");
      } else {
        setUserError(msg || "Failed to share list.");
      }
    } finally {
      setSharingUser(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setLinkCopied(true);
      showToast("Share link copied to clipboard!");
      setTimeout(() => setLinkCopied(false), 2400);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = shareLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setLinkCopied(true);
      showToast("Share link copied to clipboard!");
      setTimeout(() => setLinkCopied(false), 2400);
    }
  };

  const handleUpdatePermission = async (targetUsername, newPerm, newCanShare) => {
    setUpdatingMember(targetUsername);
    try {
      const authToken = token || ls.get("listbook:session")?.token;
      await apiUpdateMemberPermission(
        authToken,
        list.id,
        targetUsername,
        newPerm,
        newCanShare
      );
      setMembers((prev) =>
        prev.map((m) =>
          m.username.toLowerCase() === targetUsername.toLowerCase()
            ? { ...m, permission: newPerm, canShare: newCanShare }
            : m
        )
      );
      showToast(`Updated permissions for @${targetUsername}.`);
    } catch (err) {
      showToast(err.message || "Failed to update member permission.");
    } finally {
      setUpdatingMember("");
    }
  };

  const handleRemoveMember = async (targetUsername) => {
    if (!window.confirm(`Remove @${targetUsername} from this list?`)) return;
    setUpdatingMember(targetUsername);
    try {
      const authToken = token || ls.get("listbook:session")?.token;
      await apiRemoveMember(authToken, list.id, targetUsername);
      setMembers((prev) =>
        prev.filter((m) => m.username.toLowerCase() !== targetUsername.toLowerCase())
      );
      showToast(`Removed @${targetUsername} from this list.`);
    } catch (err) {
      showToast(err.message || "Failed to remove member.");
    } finally {
      setUpdatingMember("");
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-card">
        <div className="modal-head">
          <div className="modal-title-wrap">
            <span className="modal-badge">Share List</span>
            <h3 className="modal-title">“{list.name}”</h3>
          </div>
          <button
            className="icon-btn modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            <Icons.X />
          </button>
        </div>

        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab ${tab === "user" ? "active" : ""}`}
            onClick={() => {
              setTab("user");
              setUserError("");
            }}
          >
            By Username
          </button>
          <button
            type="button"
            className={`modal-tab ${tab === "link" ? "active" : ""}`}
            onClick={() => setTab("link")}
          >
            By Link
          </button>
          <button
            type="button"
            className={`modal-tab ${tab === "members" ? "active" : ""}`}
            onClick={() => setTab("members")}
          >
            Members {members.length > 0 ? `(${members.length})` : ""}
          </button>
        </div>

        {tab === "user" ? (
          <form className="modal-body" onSubmit={handleShareUserSubmit}>
            <p className="modal-desc">
              Send this list directly into another registered user’s ListBook
              with custom permissions.
            </p>

            <div className="field">
              <label htmlFor="share-username">Recipient's Username</label>
              <input
                ref={inputRef}
                id="share-username"
                className="input"
                placeholder="e.g. alex or demo"
                maxLength={40}
                value={targetUsername}
                onChange={(e) => {
                  setTargetUsername(e.target.value);
                  setUserError("");
                }}
                disabled={sharingUser}
                autoComplete="off"
              />
            </div>

            {/* Permission Selector */}
            <div className="perm-group">
              <div className="perm-group-label">Permissions</div>
              <div className="perm-options">
                <button
                  type="button"
                  className={`perm-btn ${
                    userPermission === "write" ? "active" : ""
                  }`}
                  onClick={() => {
                    setUserPermission("write");
                    setUserCanShare(true);
                  }}
                >
                  <span className="perm-title">Editor</span>
                  <span className="perm-sub">Can view, add, edit & check todos</span>
                </button>
                <button
                  type="button"
                  className={`perm-btn ${
                    userPermission === "read" ? "active" : ""
                  }`}
                  onClick={() => {
                    setUserPermission("read");
                    setUserCanShare(false);
                  }}
                >
                  <span className="perm-title">Viewer</span>
                  <span className="perm-sub">Can only view todos</span>
                </button>
              </div>

              <label className="perm-checkbox-label">
                <input
                  type="checkbox"
                  checked={userCanShare}
                  onChange={(e) => setUserCanShare(e.target.checked)}
                />
                <span>Allow this user to share this list with others</span>
              </label>
            </div>

            {userError && <div className="modal-error">{userError}</div>}
            {userSuccess && <div className="modal-success">{userSuccess}</div>}

            {members.length > 0 && (
              <div
                style={{
                  fontSize: "0.86rem",
                  color: "var(--muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 4,
                }}
              >
                <span>
                  Currently shared with <b>{members.length}</b>{" "}
                  {members.length === 1 ? "user" : "users"}
                </span>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--accent)",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
                  }}
                  onClick={() => setTab("members")}
                >
                  View Members →
                </button>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={onClose}
                disabled={sharingUser}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn"
                disabled={sharingUser || !targetUsername.trim()}
              >
                {sharingUser ? "Sharing..." : "Share List"}
              </button>
            </div>
          </form>
        ) : tab === "link" ? (
          <div className="modal-body">
            <p className="modal-desc">
              Anyone with this link can view or edit “{list.name}” based on the
              permission chosen below.
            </p>

            {/* Link Permissions */}
            <div className="perm-group">
              <div className="perm-group-label">Link Permissions</div>
              <div className="perm-options">
                <button
                  type="button"
                  className={`perm-btn ${
                    linkPermission === "write" ? "active" : ""
                  }`}
                  onClick={() => handleLinkPermChange("write")}
                >
                  <span className="perm-title">Can Edit (Editor)</span>
                  <span className="perm-sub">Recipients can modify tasks</span>
                </button>
                <button
                  type="button"
                  className={`perm-btn ${
                    linkPermission === "read" ? "active" : ""
                  }`}
                  onClick={() => handleLinkPermChange("read")}
                >
                  <span className="perm-title">Can View (Viewer)</span>
                  <span className="perm-sub">Recipients can only view tasks</span>
                </button>
              </div>

              <label className="perm-checkbox-label">
                <input
                  type="checkbox"
                  checked={linkCanShare}
                  onChange={(e) => handleLinkCanShareChange(e.target.checked)}
                />
                <span>Allow link recipients to share this list with others</span>
              </label>
            </div>

            {loadingLink ? (
              <div className="modal-loading">Generating secure link...</div>
            ) : linkError ? (
              <div
                className="modal-error"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <span>{linkError}</span>
                <button
                  type="button"
                  className="btn secondary"
                  style={{
                    width: "auto",
                    padding: "6px 14px",
                    fontSize: "0.85rem",
                  }}
                  onClick={() => generateLink(linkPermission, linkCanShare)}
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="link-copy-box">
                <input
                  className="input link-input"
                  readOnly
                  value={shareLink}
                  onClick={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className={`btn copy-btn ${linkCopied ? "copied" : ""}`}
                  onClick={handleCopyLink}
                >
                  {linkCopied ? (
                    <>
                      <Icons.Check /> Copied!
                    </>
                  ) : (
                    <>
                      <Icons.Copy /> Copy Link
                    </>
                  )}
                </button>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn secondary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <p className="modal-desc">
              Manage collaborators and permissions for <b>“{list.name}”</b>.
            </p>

            {/* Creator / Owner Card */}
            <div className="members-section">
              <div className="members-section-label">Creator / Owner</div>
              <div className="member-row">
                <div className="member-avatar">
                  {(originalOwner || "You").charAt(0).toUpperCase()}
                </div>
                <div className="member-info">
                  <div className="member-name">
                    {originalOwner ? originalOwner : "You"}
                  </div>
                  <div className="member-meta">
                    {originalOwner
                      ? "Original creator (shared with you)"
                      : "List creator & owner"}
                  </div>
                </div>
                <span className="member-tag owner">
                  {originalOwner ? "Creator" : "Owner"}
                </span>
              </div>
            </div>

            {/* Collaborators List */}
            <div className="members-section" style={{ marginTop: 4 }}>
              <div className="members-section-label">
                Shared With ({members.length})
              </div>

              {loadingMembers && members.length === 0 ? (
                <div className="modal-loading">Loading members...</div>
              ) : members.length === 0 ? (
                <div className="members-empty">
                  <span>This list has not been shared with anyone yet.</span>
                  <div className="members-empty-actions">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => setTab("user")}
                    >
                      Share via Username
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setTab("link")}
                    >
                      Get Share Link
                    </button>
                  </div>
                </div>
              ) : (
                <div className="members-list">
                  {members.map((m) => (
                    <div key={m.username} className="member-row">
                      <div className="member-avatar">
                        {(m.displayName || m.username).charAt(0).toUpperCase()}
                      </div>
                      <div className="member-info">
                        <div className="member-name">{m.displayName}</div>
                        <div className="member-meta">
                          @{m.username}
                          {m.sharedAt && (
                            <>
                              {" · "}
                              {new Date(m.sharedAt).toLocaleDateString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                }
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Permissions dropdown & action for Owner */}
                      {isOwner ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <select
                            className="member-perm-select"
                            value={m.permission || "write"}
                            disabled={updatingMember === m.username}
                            onChange={(e) =>
                              handleUpdatePermission(
                                m.username,
                                e.target.value,
                                m.canShare
                              )
                            }
                          >
                            <option value="write">Editor</option>
                            <option value="read">Viewer</option>
                          </select>

                          <button
                            type="button"
                            className="member-remove-btn"
                            title={`Remove @${m.username}`}
                            aria-label={`Remove @${m.username}`}
                            disabled={updatingMember === m.username}
                            onClick={() => handleRemoveMember(m.username)}
                          >
                            <Icons.X />
                          </button>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            gap: 4,
                            alignItems: "center",
                          }}
                        >
                          <span
                            className={`member-tag ${
                              m.permission === "read"
                                ? "via-link"
                                : "via-user"
                            }`}
                          >
                            {m.permission === "read" ? "Viewer" : "Editor"}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
