import api from "../lib/api";
import { fmtDate } from "../lib/format";
import { useApi } from "../lib/useApi";
import DataTable from "../ui/DataTable";
import { EmptyState } from "../ui/Bits";

function summarize(row) {
  const parts = [];
  if (row.status) parts.push(String(row.status));
  if (row.network) parts.push(String(row.network));
  if (row.message) parts.push(String(row.message).slice(0, 60));
  if (row.error) parts.push(String(row.error).slice(0, 60));
  if (parts.length === 0) {
    const keys = Object.keys(row).filter(
      (key) => !["id", "created_at"].includes(key) && row[key] != null
    );
    return keys
      .slice(0, 3)
      .map((key) => `${key}: ${String(row[key]).slice(0, 32)}`)
      .join(" · ");
  }
  return parts.join(" · ");
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
      render: (row) => <span style={{ fontSize: 11.5 }}>{summarize(row) || "—"}</span>,
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
            <>
              <span>
                Showing <b>{rows.length}</b> events
              </span>
              <button type="button" className="btn btn--ghost" onClick={() => list.reload()}>
                Refresh
              </button>
            </>
          }
        />
      </div>
    </>
  );
}
