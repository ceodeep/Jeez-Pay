import api from "../lib/api";
import { fmtDate } from "../lib/format";
import { useApi } from "../lib/useApi";
import DataTable from "../ui/DataTable";
import { EmptyState } from "../ui/Bits";

const HIDDEN = new Set(["id", "created_at", "_key", "operation"]);

function renderValue(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserialisable]";
    }
  }
  return String(value);
}

function details(row) {
  return Object.keys(row)
    .filter((key) => !HIDDEN.has(key) && row[key] != null && row[key] !== "")
    .slice(0, 4)
    .map((key) => `${key}: ${renderValue(row[key]).slice(0, 90)}`)
    .join(" · ");
}

export default function ScannerLogsPage() {
  const list = useApi(
    () => api.get("/admin/scanner-logs").then((res) => res.data?.logs || []),
    "scanner-logs",
    "Failed to load scanner logs"
  );

  const rows = (list.data || []).map((row, index) => ({
    ...row,
    _key: row.id || `scan-${index}-${row.created_at || ""}`,
  }));

  const columns = [
    {
      key: "when",
      label: "When",
      width: "22%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 11 }}>
          {fmtDate(row.created_at)}
        </span>
      ),
    },
    {
      key: "summary",
      label: "Event",
      width: "78%",
      wrap: true,
      render: (row) => (
        <div className="cellstack">
          <div className="cell-title mono" style={{ fontSize: 11.5 }}>
            {row.operation || row.status || "event"}
          </div>
          {details(row) ? <div className="cell-sub mono">{details(row)}</div> : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>Scanner logs</h1>
        <p>
          <b>{rows.length}</b> recent events · deposit scanner output, newest first
        </p>
      </div>

      <div className="tablewrap" style={{ marginTop: 12 }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row._key}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={<EmptyState title="No scanner events">The scanner has not logged anything yet.</EmptyState>}
          footer={
            <div className="tfoot">
              <span>
                Showing <b>{rows.length}</b> events
              </span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => list.reload()}>
                Refresh
              </button>
            </div>
          }
        />
      </div>
    </>
  );
}
