export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const ls = {
  get(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  },
  del(k) {
    try { localStorage.removeItem(k); } catch {}
  },
};

export function starterBoard() {
  return { lists: [], activeId: null, updatedAt: Date.now() };
}

export async function sha(s) {
  try {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
    return "h" + h;
  }
}

export function reorderSubset(arr, ids) {
  const set = new Set(ids);
  const slots = [];
  arr.forEach((x, i) => {
    if (set.has(x.id)) slots.push(i);
  });
  const byId = Object.fromEntries(arr.map((x) => [x.id, x]));
  const out = arr.slice();
  slots.forEach((slot, k) => {
    if (byId[ids[k]]) out[slot] = byId[ids[k]];
  });
  return out;
}