export default function DataTable({
  columns,
  rows,
  rowKey,
  selectedKey,
  onRowClick,
  loading = false,
  error = "",
  onRetry,
  empty,
  footer,
  skeletonRows = 6,
}) {
  if (error) {
    return (
      <div className="empty">
        <b>Couldn&apos;t load this list</b>
        {error}
        {onRetry ? (
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn--ghost" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (loading && (!rows || rows.length === 0)) {
    return (
      <div aria-busy="true">
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <div className="skel" key={i} />
        ))}
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return empty || <div className="empty">Nothing here right now.</div>;
  }

  return (
    <>
      <table className="grid">
        <colgroup>
          {columns.map((col) => (
            <col key={col.key} style={col.width ? { width: col.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.align === "right" ? "r" : ""}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = selectedKey != null && String(selectedKey) === String(key);
            return (
              <tr
                key={key}
                aria-selected={selected ? "true" : "false"}
                onClick={() => onRowClick && onRowClick(row)}
                onKeyDown={(event) => {
                  if (!onRowClick) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(row);
                  }
                }}
                tabIndex={0}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    data-label={col.label}
                    className={[
                      col.align === "right" ? "r" : "",
                      col.wrap ? "wrap" : "",
                      col.className || "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer ? <div className="tfoot">{footer}</div> : null}
    </>
  );
}
