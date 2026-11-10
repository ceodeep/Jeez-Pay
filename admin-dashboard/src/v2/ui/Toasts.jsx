import { useEffect, useState } from "react";
import { subscribeToasts } from "../lib/toast";

export default function Toasts() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const unsubscribe = subscribeToasts((item) => {
      setItems((prev) => [...prev.slice(-2), item]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      }, 4200);
    });
    return unsubscribe;
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((item) => (
        <div
          key={item.id}
          className={`toast ${item.tone === "error" ? "toast--error" : ""} ${
            item.tone === "ok" ? "toast--ok" : ""
          }`}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
