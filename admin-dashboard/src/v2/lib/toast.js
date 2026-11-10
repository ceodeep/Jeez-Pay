const listeners = new Set();
let seq = 0;

export function toast(message, tone = "info") {
  const item = { id: ++seq, message: String(message || ""), tone };
  listeners.forEach((fn) => fn(item));
}

export function subscribeToasts(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
