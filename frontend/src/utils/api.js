const API_BASE =
  import.meta.env?.VITE_API_URL ||
  (typeof window !== "undefined" &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1"
    ? "/api"
    : "http://localhost:5014/api");

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

// Share list with a registered username and permissions
export async function apiShareWithUser(
  token,
  list,
  targetUsername,
  permission = "write",
  canShare = true
) {
  const res = await fetch(`${API_BASE}/board/share-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ list, targetUsername, permission, canShare }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to share list");
  return data;
}

// Generate public share link with default permissions
export async function apiCreateShareLink(
  token,
  list,
  permission = "write",
  canShare = true
) {
  const res = await fetch(`${API_BASE}/board/share-link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ list, permission, canShare }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to create share link");
  return data;
}

// Get public shared list preview
export async function apiGetSharedList(shareId) {
  const res = await fetch(
    `${API_BASE}/board/shared/${encodeURIComponent(shareId)}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to retrieve shared list");
  return data;
}

// Accept and import a shared list
export async function apiAcceptSharedList(token, shareId) {
  const res = await fetch(`${API_BASE}/board/accept-share`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ shareId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to accept shared list");
  return data;
}

// Get members / collaborators associated with a list
export async function apiGetListMembers(token, listId) {
  const res = await fetch(
    `${API_BASE}/board/list/${encodeURIComponent(listId)}/members`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load list members");
  return data;
}

// Update a collaborator's permission
export async function apiUpdateMemberPermission(
  token,
  listId,
  targetUsername,
  permission,
  canShare
) {
  const res = await fetch(
    `${API_BASE}/board/list/${encodeURIComponent(listId)}/member-permission`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetUsername, permission, canShare }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to update permission");
  return data;
}

// Remove a collaborator from a list
export async function apiRemoveMember(token, listId, targetUsername) {
  const res = await fetch(
    `${API_BASE}/board/list/${encodeURIComponent(listId)}/member/${encodeURIComponent(
      targetUsername
    )}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to remove member");
  return data;
}

// Leave a shared list
export async function apiLeaveList(token, listId) {
  const res = await fetch(
    `${API_BASE}/board/list/${encodeURIComponent(listId)}/leave`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to leave list");
  return data;
}