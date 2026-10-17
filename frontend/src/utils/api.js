const API_BASE = import.meta.env?.VITE_API_URL || "http://localhost:5014/api";

export async function apiLogin(name, pin) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, pin }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sign in failed");
  return data; // { token, user, board }
}

export async function apiFetchBoard(token) {
  const res = await fetch(`${API_BASE}/board`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch board");
  return data; // { name, board }
}

export async function apiSaveBoard(token, board) {
  const res = await fetch(`${API_BASE}/board`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(board),
    keepalive: true, // Ensures saves complete even when tab closes
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to save board");
  return data;
}