export function Chip({ tone = "", children }) {
  return (
    <span className={`chip ${tone ? `chip--${tone}` : ""}`}>
      <i />
      {children}
    </span>
  );
}

export function Tag({ tone = "", children }) {
  return <span className={`tag ${tone ? `tag--${tone}` : ""}`}>{children}</span>;
}

export function Stat({ label, value, suffix, hot = false }) {
  return (
    <div className={`stat ${hot ? "stat--hot" : ""}`}>
      <div className="stat__k">{label}</div>
      <div className="stat__v">
        {value}
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      {title ? <b>{title}</b> : null}
      {children}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label ? <label>{label}</label> : null}
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export function SearchIcon({ size = 12 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 14 14" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4.5 6.5a3.5 3.5 0 1 1 7 0c0 2.5 1 3 1 3h-9s1-.5 1-3Z" />
      <path d="M6.7 12a1.4 1.4 0 0 0 2.6 0" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
  );
}
