import React, { useState, useEffect, useRef, useCallback } from "react";
import { Icons } from "./Icons";
import { apiShareWithUser, apiCreateShareLink } from "../utils/api";
import { ls } from "../utils/helpers";

export default function ShareModal({ list, token, onClose, showToast }) {
  const [tab, setTab] = useState("user"); // 'user' | 'link'
  const [targetUsername, setTargetUsername] = useState("");
  const [sharingUser, setSharingUser] = useState(false);
  const [userError, setUserError] = useState("");
  const [userSuccess, setUserSuccess] = useState("");

  const [shareLink, setShareLink] = useState("");
  const [loadingLink, setLoadingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkError, setLinkError] = useState("");

  const inputRef = useRef(null);
  const fetchAttemptedRef = useRef(false);

  useEffect(() => {
    if (tab === "user") {
      inputRef.current?.focus();
    }
  }, [tab]);

  const generateLink = useCallback(async () => {
    setLoadingLink(true);
    setLinkError("");
    try {
      const authToken = token || ls.get("listbook:session")?.token;
      if (!authToken) {
        throw new Error("You must be signed in to generate a share link.");
      }
      const res = await apiCreateShareLink(authToken, list);
      const url = `${window.location.origin}/?share=${res.shareId}`;
      setShareLink(url);
    } catch (err) {
      console.error("Generate share link error:", err);
      setLinkError(err.message || "Failed to create share link.");
    } finally {
      setLoadingLink(false);
    }
  }, [token, list]);

  useEffect(() => {
    if (tab === "link" && !shareLink && !fetchAttemptedRef.current) {
      fetchAttemptedRef.current = true;
      generateLink();
    }
  }, [tab, shareLink, generateLink]);

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
      const res = await apiShareWithUser(authToken, list, trimmed);
      setUserSuccess(res.message || `Shared with ${trimmed}!`);
      showToast(res.message || `List "${list.name}" shared with ${trimmed}!`);
      setTimeout(() => {
        onClose();
      }, 1400);
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
      // Fallback
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
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Close modal">
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
        </div>

        {tab === "user" ? (
          <form className="modal-body" onSubmit={handleShareUserSubmit}>
            <p className="modal-desc">
              Send a copy of this list directly into another registered user’s ListBook account.
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
                disabled={sharingUser || Boolean(userSuccess)}
                autoComplete="off"
              />
            </div>

            {userError && <div className="modal-error">{userError}</div>}
            {userSuccess && <div className="modal-success">{userSuccess}</div>}

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
                disabled={sharingUser || !targetUsername.trim() || Boolean(userSuccess)}
              >
                {sharingUser ? "Sharing..." : "Share List"}
              </button>
            </div>
          </form>
        ) : (
          <div className="modal-body">
            <p className="modal-desc">
              Anyone with this link can view and import a copy of “{list.name}” into their ListBook account.
            </p>

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
                  onClick={() => {
                    fetchAttemptedRef.current = true;
                    generateLink();
                  }}
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
        )}
      </div>
    </div>
  );
}

