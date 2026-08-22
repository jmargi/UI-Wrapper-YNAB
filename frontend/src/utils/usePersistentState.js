import { useEffect, useRef, useState } from 'react';

// useState that survives iOS killing the backgrounded PWA: every change is
// mirrored to localStorage and restored on the next mount. Values must be
// JSON-serializable. `sanitize` (optional) runs on the restored value — use it
// to repair state that was saved mid-action (e.g. a chat message stuck in
// "streaming" when the app was killed).
export default function usePersistentState(key, initialValue, sanitize) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initialValue;
      const parsed = JSON.parse(raw);
      return sanitize ? sanitize(parsed) : parsed;
    } catch {
      return initialValue;
    }
  });

  // Persist on every change. Skip the very first render — nothing new to save.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable (private mode) — app still works, just
      // without persistence.
    }
  }, [key, value]);

  return [value, setValue];
}
