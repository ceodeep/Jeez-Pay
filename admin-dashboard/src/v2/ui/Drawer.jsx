import { useEffect } from "react";

export default function Drawer({
  open,
  onClose,
  title,
  subtitle,
  meta,
  children,
  footer,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-label={title}>
      <div className="drawer__head">
        <div className="drawer__top">
          <div style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="drawer__close"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
        {meta && meta.length > 0 ? (
          <div className="drawer__meta">
            {meta.map((item) => (
              <div key={item.k}>
                {item.k}
                <b>{item.v}</b>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="drawer__body">{children}</div>

      {footer ? <div className="drawer__foot">{footer}</div> : null}
    </aside>
  );
}
