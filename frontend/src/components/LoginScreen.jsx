import React, { useState, useEffect, useRef } from "react";
import { apiLogin } from "../utils/api";

export default function LoginScreen({ booting, onAuthenticated }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameInputRef = useRef(null);

  useEffect(() => {
    if (!booting) nameInputRef.current?.focus();
  }, [booting]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const trimmedName = name.trim();
    const trimmedPin = pin.trim();

    if (!/^\d{4}$/.test(trimmedPin)) {
      setError("PIN must be 4 digits.");
      return;
    }

    setSubmitting(true);
    try {
      const { token, user, board } = await apiLogin(trimmedName, trimmedPin);
      onAuthenticated(token, user.name, board);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card">
        <div>
          <div className="brand">
            List<span>book</span>
          </div>
        </div>
        <p className="tag">
          Lists and todos in the order you want them. Star what matters and it stays on top.
        </p>

        {booting ? (
          <p className="waiting">Loading your lists…</p>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 16 }}
            autoComplete="off"
          >
            <div className="field">
              <label htmlFor="lname">Name</label>
              <input
                ref={nameInputRef}
                className="input"
                id="lname"
                required
                maxLength={40}
                placeholder="e.g. Sachin"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="lpin">4-digit PIN</label>
              <input
                className="input"
                id="lpin"
                required
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                type="password"
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </div>
            <div className="err">{error}</div>
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
            <p className="login-note">
              New name? A new account is created with that PIN and syncs across your devices.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}