import { useState } from "react";
import api from "../lib/api";
import { fmtDate } from "../lib/format";
import { useApi } from "../lib/useApi";
import DataTable from "../ui/DataTable";
import { EmptyState, SearchIcon } from "../ui/Bits";

export default function AuditLogsPage() {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");

  const list = useApi(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    const suffix = params.toString();
    return api
      .get(`/admin/audit-logs${suffix ? `?${suffix}` : ""}`)
      .then((res) => res.data?.logs || []);
  }, search, "Failed to load audit logs");

  const rows = list.data || [];

  const columns = [
    {
      key: "when",
      label: "When",
      width: "18%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 11 }}>
          {fmtDate(row.created_at)}
        </span>
      ),
    },
    {
      key: "admin",
      label: "Admin",
      width: "20%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 11 }}>
          {row.admin_phone || row.admin_id || "system"}
        </span>
      ),
    },
    {
      key: "action",
      label: "Action",
      width: "24%",
      render: (row) => <span style={{ fontSize: 12 }}>{row.action || "—"}</span>,
    },
    {
      key: "target",
      label: "Target",
      width: "26%",
      wrap: true,
      render: (row) => (
        <div>
          <div className="cell-title" style={{ fontSize: 11.5 }}>
            {row.target_display || row.target_id || "—"}
          </div>
          <div className="cell-sub">{row.target_type || ""}</div>
        </div>
      ),
    },
    {
      key: "ip",
      label: "IP",
      width: "12%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>
          {row.ip_address || "—"}
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>Audit log</h1>
        <p>
          <b>{rows.length}</b> recorded actions · every admin decision lands here with the operator
          and IP address
        </p>
      </div>

      <div className="toolbar">
        <form
          className="searchrow"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(term.trim());
          }}
        >
          <SearchIcon />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Action, admin phone or target"
            aria-label="Search audit log"
          />
        </form>
      </div>

      <div className="tablewrap" style={{ marginTop: 12 }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={<EmptyState title="No entries">Nothing has been recorded for this filter.</EmptyState>}
          footer={
            <>
              <span>
                Showing <b>{rows.length}</b> entries
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
