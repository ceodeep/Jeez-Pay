import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { errText, fmtAmount, fmtDate } from "../lib/format";
import { useApi } from "../lib/useApi";
import { toast } from "../lib/toast";
import DataTable from "../ui/DataTable";
import Drawer from "../ui/Drawer";
import { Chip, EmptyState } from "../ui/Bits";

const TABS = [
  { key: "pending", label: "Waiting" },
  { key: "completed", label: "Completed" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

function statusChip(status) {
  const value = String(status || "").toLowerCase();
  if (value === "completed" || value === "approved") return <Chip tone="ok">{status}</Chip>;
  if (value === "rejected" || value === "failed") return <Chip tone="danger">{status}</Chip>;
  if (value === "pending") return <Chip tone="wait">Waiting</Chip>;
  return <Chip>{status || "—"}</Chip>;
}

export default function ServiceRequestsPage({ focusId, onDrawerChange }) {
  const [tab, setTab] = useState("pending");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const list = useApi(
    () => api.get("/admin/service-requests").then((res) => res.data?.requests || []),
    "service-requests",
    "Failed to load service requests"
  );

  const all = useMemo(() => list.data || [], [list.data]);

  const counts = useMemo(
    () => ({
      pending: all.filter((r) => String(r.status).toLowerCase() === "pending").length,
      completed: all.filter((r) => String(r.status).toLowerCase() === "completed").length,
      rejected: all.filter((r) => String(r.status).toLowerCase() === "rejected").length,
      all: all.length,
    }),
    [all]
  );

  const rows =
    tab === "all" ? all : all.filter((r) => String(r.status).toLowerCase() === tab);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  useEffect(() => {
    onDrawerChange?.(Boolean(selectedId));
  }, [selectedId, onDrawerChange]);

  const selected = all.find((row) => String(row.id) === String(selectedId)) || null;

  async function act(kind) {
    if (!selected) return;
    if (kind === "reject" && !note.trim()) {
      toast("Add a note explaining the rejection", "error");
      return;
    }
    setBusy(kind);
    try {
      await api.patch(`/admin/service-requests/${selected.id}/${kind}`, {
        adminNote: note.trim() || undefined,
      });
      toast(kind === "complete" ? "Request completed" : "Request rejected", "ok");
      setNote("");
      setSelectedId(null);
      await list.reload(true);
    } catch (err) {
      toast(errText(err, "Action failed"), "error");
    } finally {
      setBusy("");
    }
  }

  const columns = [
    {
      key: "type",
      label: "Request",
      width: "34%",
      render: (row) => (
        <div className="cellstack">
          <span className="tag tag--req">SR</span>
          <div>
            <div className="cell-title">{row.service_type || "Service"}</div>
            <div className="cell-sub">{row.provider || row.customer_reference || row.id}</div>
          </div>
        </div>
      ),
    },
    {
      key: "user",
      label: "User",
      width: "18%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>
          {String(row.user_id || "").slice(0, 12)}
        </span>
      ),
    },
    {
      key: "created",
      label: "Received",
      width: "18%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 11 }}>
          {fmtDate(row.created_at)}
        </span>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      width: "15%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 12 }}>
          {row.amount == null ? "—" : fmtAmount(row.amount, row.currency)}
        </span>
      ),
    },
    {
      key: "status",
      label: "State",
      width: "15%",
      render: (row) => statusChip(row.status),
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>Service requests</h1>
        <p>
          <b>{counts.pending}</b> waiting · completed requests debit the user&apos;s wallet
        </p>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
          >
            {item.label} <b>{counts[item.key] ?? 0}</b>
          </button>
        ))}
      </div>

      <div className="tablewrap">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          selectedKey={selectedId}
          onRowClick={(row) => setSelectedId(row.id)}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={<EmptyState title="Nothing in this queue">Requests from merchants and agents land here.</EmptyState>}
          footer={
            <>
              <span>
                Showing <b>{rows.length}</b> requests
              </span>
              <button type="button" className="btn btn--ghost" onClick={() => list.reload()}>
                Refresh
              </button>
            </>
          }
        />
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected?.service_type || "Service request"}
        subtitle={selected ? `${selected.provider || "provider"} · ${selected.id}` : ""}
        meta={
          selected
            ? [
                { k: "Received", v: fmtDate(selected.created_at) },
                { k: "Amount", v: fmtAmount(selected.amount, selected.currency) },
                { k: "Customer ref", v: selected.customer_reference || "—" },
                { k: "State", v: selected.status || "pending" },
              ]
            : []
        }
        footer={
          selected ? (
            <>
              <div className="row2">
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  disabled={busy !== "" || String(selected.status).toLowerCase() !== "pending"}
                  onClick={() => act("complete")}
                >
                  {busy === "complete" ? "Completing…" : "Complete"}
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--block"
                  disabled={busy !== "" || String(selected.status).toLowerCase() !== "pending"}
                  onClick={() => act("reject")}
                >
                  {busy === "reject" ? "Rejecting…" : "Reject"}
                </button>
              </div>
              <div className="hint">Completing debits the wallet and notifies the requester.</div>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="stack stack--lg">
            <div className="fields">
              <div className="frow">
                <span>User</span>
                <b>{selected.user_id}</b>
              </div>
              <div className="frow">
                <span>Provider</span>
                <b>{selected.provider || "—"}</b>
              </div>
              <div className="frow">
                <span>Customer reference</span>
                <b>{selected.customer_reference || "—"}</b>
              </div>
              <div className="frow">
                <span>Amount</span>
                <b>{fmtAmount(selected.amount, selected.currency)}</b>
              </div>
              <div className="frow">
                <span>Request note</span>
                <b style={{ whiteSpace: "normal" }}>{selected.note || "—"}</b>
              </div>
            </div>

            <div>
              <div className="sect">Admin note</div>
              <textarea
                className="textarea"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Required when rejecting — the requester sees this"
              />
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
