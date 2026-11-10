import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { ageOf, errText, fmtAmount, fmtDate, shortAddress } from "../lib/format";
import { useApi } from "../lib/useApi";
import { toast } from "../lib/toast";
import DataTable from "../ui/DataTable";
import Drawer from "../ui/Drawer";
import { Chip, EmptyState } from "../ui/Bits";

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

function statusChip(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved" || value === "completed" || value === "sent")
    return <Chip tone="ok">{status}</Chip>;
  if (value === "rejected" || value === "failed") return <Chip tone="danger">{status}</Chip>;
  if (value === "pending") return <Chip tone="wait">Pending</Chip>;
  return <Chip>{status || "—"}</Chip>;
}

export default function WithdrawalsPage({ focusId, canApprove, onDrawerChange }) {
  const [tab, setTab] = useState("pending");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState("");
  const [reason, setReason] = useState("");

  const list = useApi(
    () =>
      api
        .get(`/admin/crypto/withdrawals?status=${encodeURIComponent(tab)}`)
        .then((res) => res.data?.withdrawals || []),
    tab,
    "Failed to load crypto withdrawals"
  );

  const summary = useApi(
    () =>
      api
        .get("/admin/crypto/withdrawals?status=all")
        .then((res) => res.data?.withdrawals || []),
    `summary-${list.loadedAt}`,
    ""
  );

  const rows = (list.data || []).filter((row) => {
    const status = String(row.status || "").toLowerCase();
    if (tab === "all") return true;
    if (tab === "approved") return ["approved", "completed", "sent"].includes(status);
    if (tab === "rejected") return ["rejected", "failed"].includes(status);
    return status === tab;
  });

  const counts = useMemo(() => {
    const base = summary.data || [];
    return {
      pending: base.filter((r) => String(r.status).toLowerCase() === "pending").length,
      approved: base.filter((r) =>
        ["approved", "completed", "sent"].includes(String(r.status).toLowerCase())
      ).length,
      rejected: base.filter((r) =>
        ["rejected", "failed"].includes(String(r.status).toLowerCase())
      ).length,
      all: base.length,
    };
  }, [summary.data]);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  useEffect(() => {
    onDrawerChange?.(Boolean(selectedId));
  }, [selectedId, onDrawerChange]);

  const selected = (list.data || []).find((row) => String(row.id) === String(selectedId)) || null;

  async function act(kind) {
    if (!selected) return;
    if (kind === "approve") {
      const ok = window.confirm(
        `Approve and send ${fmtAmount(selected.amount, selected.token || "USDT")} on ${
          selected.network || "the network"
        }? This broadcasts an on-chain transfer.`
      );
      if (!ok) return;
    } else if (!reason.trim()) {
      toast("Add a reason before rejecting", "error");
      return;
    }

    setBusy(kind);
    try {
      if (kind === "approve") {
        await api.post(`/admin/crypto/withdrawals/${selected.id}/approve`);
        toast("Withdrawal approved and queued for broadcast", "ok");
      } else {
        await api.post(`/admin/crypto/withdrawals/${selected.id}/reject`, {
          reason: reason.trim(),
        });
        toast("Withdrawal rejected — funds returned to the wallet", "ok");
      }
      setReason("");
      setSelectedId(null);
      await Promise.all([list.reload(true), summary.reload(true)]);
    } catch (err) {
      toast(errText(err, "Action failed"), "error");
    } finally {
      setBusy("");
    }
  }

  const columns = [
    {
      key: "user",
      label: "Payout",
      width: "34%",
      render: (row) => (
        <div className="cellstack">
          <span className="tag tag--pay">{row.network || "chain"}</span>
          <div>
            <div className="cell-title">
              {fmtAmount(row.amount, row.token || "USDT")}
            </div>
            <div className="cell-sub mono">
              {shortAddress(row.to_address)} · user {String(row.user_id || "").slice(0, 8)}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "created",
      label: "Requested",
      width: "22%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 11.5 }}>
          {fmtDate(row.created_at)}
        </span>
      ),
    },
    {
      key: "age",
      label: "Age",
      width: "12%",
      render: (row) => {
        const age = ageOf(row.created_at);
        return (
          <span className={`mono age-${age.level}`} style={{ fontSize: 11.5 }}>
            {age.label}
          </span>
        );
      },
    },
    {
      key: "total",
      label: "Total debit",
      align: "right",
      width: "16%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 12 }}>
          {fmtAmount(row.total_debit ?? row.amount, row.token || "USDT")}
        </span>
      ),
    },
    {
      key: "status",
      label: "State",
      width: "16%",
      render: (row) => statusChip(row.status),
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>Withdrawals</h1>
        <p>
          <b>{counts.pending}</b> pending · approving broadcasts an on-chain transfer and cannot be
          undone
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
          empty={
            <EmptyState title="Nothing in this queue">
              Pending payouts appear here the moment a user requests one.
            </EmptyState>
          }
          footer={
            <>
              <span>
                Showing <b>{rows.length}</b> {tab === "all" ? "payouts" : `${tab} payouts`}
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
        title={selected ? fmtAmount(selected.amount, selected.token || "USDT") : "Payout"}
        subtitle={selected ? `${selected.network || "chain"} · ${shortAddress(selected.to_address)}` : ""}
        meta={
          selected
            ? [
                { k: "Requested", v: fmtDate(selected.created_at) },
                { k: "Waiting", v: ageOf(selected.created_at).label },
                { k: "Fee", v: fmtAmount(selected.fee, selected.token || "USDT") },
                { k: "Total debit", v: fmtAmount(selected.total_debit, selected.token || "USDT") },
              ]
            : []
        }
        footer={
          selected ? (
            <>
              {String(selected.status).toLowerCase() === "pending" && canApprove ? (
                <>
                  <div className="row2">
                    <button
                      type="button"
                      className="btn btn--primary btn--block"
                      disabled={busy !== ""}
                      onClick={() => act("approve")}
                    >
                      {busy === "approve" ? "Sending…" : "Approve & send"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--block"
                      disabled={busy !== ""}
                      onClick={() => act("reject")}
                    >
                      {busy === "reject" ? "Rejecting…" : "Reject"}
                    </button>
                  </div>
                  <div className="hint">Approval sends funds on-chain. Double-check the address.</div>
                </>
              ) : (
                <div className="hint">This payout is already {selected.status}.</div>
              )}
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="stack stack--lg">
            <div>
              <div className="sect">Destination</div>
              <div className="fields">
                <div className="frow">
                  <span>Network</span>
                  <b>{selected.network || "—"}</b>
                </div>
                <div className="frow">
                  <span>Token</span>
                  <b>{selected.token || "USDT"}</b>
                </div>
                <div className="frow">
                  <span>Address</span>
                  <b style={{ whiteSpace: "normal", wordBreak: "break-all" }}>
                    {selected.to_address || "—"}
                  </b>
                </div>
                <div className="frow">
                  <span>Amount</span>
                  <b>{fmtAmount(selected.amount, selected.token || "USDT")}</b>
                </div>
                <div className="frow">
                  <span>Fee</span>
                  <b>{fmtAmount(selected.fee, selected.token || "USDT")}</b>
                </div>
                <div className="frow">
                  <span>Total debit</span>
                  <b>{fmtAmount(selected.total_debit, selected.token || "USDT")}</b>
                </div>
                <div className="frow">
                  <span>Reference</span>
                  <b>{selected.reference || selected.id}</b>
                </div>
                <div className="frow">
                  <span>Tx hash</span>
                  <b style={{ whiteSpace: "normal", wordBreak: "break-all" }}>
                    {selected.tx_hash || "not broadcast yet"}
                  </b>
                </div>
              </div>
            </div>

            <div>
              <div className="sect">Rejection reason</div>
              <textarea
                className="textarea"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Required when rejecting — the user sees this"
              />
            </div>

            <div className="flag">
              <i />
              <div>
                Verify the address against the user&apos;s own request before approving. Sent
                transactions cannot be recalled.
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
