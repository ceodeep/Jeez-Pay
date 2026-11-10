import { useMemo, useState } from "react";
import api from "../lib/api";
import { ageOf, fmtAmount, fmtDate, fmtInt, shortAddress } from "../lib/format";
import { useApi } from "../lib/useApi";
import DataTable from "../ui/DataTable";
import { Chip, EmptyState, Stat } from "../ui/Bits";

const TABS = [
  { key: "all", label: "All" },
  { key: "kyc", label: "KYC" },
  { key: "withdrawals", label: "Payouts" },
  { key: "requests", label: "Requests" },
];

function settle(result) {
  return result.status === "fulfilled" ? result.value : null;
}

function stateFor(created) {
  return ageOf(created).level === "danger" ? (
    <Chip tone="danger">Overdue</Chip>
  ) : (
    <Chip tone="wait">Waiting</Chip>
  );
}

export default function TodayPage({ onNavigate, reloadKey }) {
  const [tab, setTab] = useState("all");

  const feed = useApi(async () => {
    const [statsRes, kycRes, wdRes, svcRes] = await Promise.allSettled([
      api.get("/admin/dashboard/stats").then((res) => res.data?.stats || {}),
      api
        .get("/admin/kyc/list?status=pending&limit=100")
        .then((res) => res.data?.kycs || []),
      api
        .get("/admin/crypto/withdrawals?status=pending")
        .then((res) => res.data?.withdrawals || []),
      api.get("/admin/service-requests").then((res) => res.data?.requests || []),
    ]);

    return {
      stats: settle(statsRes) || {},
      kyc: settle(kycRes) || [],
      withdrawals: settle(wdRes) || [],
      requests: (settle(svcRes) || []).filter(
        (row) => String(row.status || "").toLowerCase() === "pending"
      ),
    };
  }, reloadKey, "Failed to load today's queue");

  const data = data0(feed.data);

  const queue = useMemo(() => {
    const items = [];

    data.kyc.forEach((row) => {
      items.push({
        key: `kyc-${row.user_id}`,
        kind: "kyc",
        tag: <span className="tag tag--kyc">KYC</span>,
        title: row.fullName || "Unnamed applicant",
        sub: [row.address, row.dob ? `DOB ${row.dob}` : ""].filter(Boolean).join(" · "),
        reference: row.user_id,
        created: row.created_at,
        amount: null,
        currency: "",
        state: stateFor(row.created_at),
        target: "kyc",
        id: row.user_id,
      });
    });

    data.withdrawals.forEach((row) => {
      items.push({
        key: `wd-${row.id}`,
        kind: "withdrawals",
        tag: <span className="tag tag--pay">{row.network || "chain"}</span>,
        title: fmtAmount(row.amount, row.token || "USDT"),
        sub: shortAddress(row.to_address),
        reference: row.reference || row.id,
        created: row.created_at,
        amount: row.total_debit ?? row.amount,
        currency: row.token || "USDT",
        state: stateFor(row.created_at),
        target: "withdrawals",
        id: row.id,
      });
    });

    data.requests.forEach((row) => {
      items.push({
        key: `sr-${row.id}`,
        kind: "requests",
        tag: <span className="tag tag--req">REQUEST</span>,
        title: row.service_type || row.provider || "Service request",
        sub: [row.provider, row.customer_reference].filter(Boolean).join(" · "),
        reference: row.id,
        created: row.created_at,
        amount: row.amount,
        currency: row.currency || "",
        state: stateFor(row.created_at),
        target: "serviceRequests",
        id: row.id,
      });
    });

    return items.sort((a, b) => new Date(a.created) - new Date(b.created));
  }, [data]);

  const rows = tab === "all" ? queue : queue.filter((item) => item.kind === tab);

  const overdue = useMemo(() => {
    if (!feed.loadedAt) return 0;
    return queue.filter((item) => {
      const t = new Date(item.created).getTime();
      return Number.isFinite(t) && feed.loadedAt - t > 4 * 3600 * 1000;
    }).length;
  }, [queue, feed.loadedAt]);

  const columns = [
    {
      key: "item",
      label: "Item",
      width: "38%",
      render: (row) => (
        <div className="cellstack">
          {row.tag}
          <div>
            <div className="cell-title">{row.title}</div>
            <div className="cell-sub">{row.sub || row.reference}</div>
          </div>
        </div>
      ),
    },
    {
      key: "reference",
      label: "Reference",
      width: "18%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>
          {String(row.reference || "").slice(0, 18)}
        </span>
      ),
    },
    {
      key: "age",
      label: "Age",
      width: "11%",
      render: (row) => {
        const age = ageOf(row.created);
        return (
          <span className={`mono age-${age.level}`} style={{ fontSize: 11.5 }}>
            {age.label}
          </span>
        );
      },
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      width: "18%",
      render: (row) =>
        row.amount == null ? (
          <span className="mono" style={{ color: "var(--faint)" }}>
            —
          </span>
        ) : (
          <span className="mono" style={{ fontSize: 12 }}>
            {fmtAmount(row.amount, row.currency)}
          </span>
        ),
    },
    {
      key: "state",
      label: "State",
      width: "15%",
      render: (row) => row.state,
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>Today</h1>
        <p>
          <b>{queue.length} items</b> waiting · oldest{" "}
          <b>{queue.length ? ageOf(queue[0].created).label : "—"}</b> ·{" "}
          <b>{overdue}</b> past the 4-hour target
        </p>
      </div>

      <div className="stackbar">
        <Stat label="Waiting" value={queue.length} />
        <Stat label="Overdue" value={overdue} hot={overdue > 0} />
        <Stat label="Users" value={fmtInt(data.stats.totalUsers)} />
        <Stat
          label="Volume today"
          value={fmtAmount(data.stats.totalVolumeToday)}
          suffix="SSP"
        />
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
            {item.label}{" "}
            <b>
              {item.key === "all"
                ? queue.length
                : queue.filter((row) => row.kind === item.key).length}
            </b>
          </button>
        ))}
        <div className="tabs__end">
          <span className="tabs__note">Oldest first</span>
        </div>
      </div>

      <div className="tablewrap">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          onRowClick={(row) => onNavigate(row.target, row.id)}
          loading={feed.loading}
          error={feed.error}
          onRetry={feed.reload}
          skeletonRows={8}
          empty={
            <EmptyState title="Queue is clear">
              Nothing is waiting for a decision right now.
            </EmptyState>
          }
          footer={
            <>
              <span>
                Showing <b>{rows.length}</b> of <b>{queue.length}</b> · refreshed{" "}
                {feed.loadedAt ? fmtDate(new Date(feed.loadedAt).toISOString()) : "—"}
              </span>
              <button type="button" className="btn btn--ghost" onClick={() => feed.reload()}>
                Refresh
              </button>
            </>
          }
        />
      </div>
    </>
  );
}

function data0(value) {
  return value || { stats: {}, kyc: [], withdrawals: [], requests: [] };
}
