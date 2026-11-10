import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import { ageOf, errText, fmtDate } from "../lib/format";
import { useApi } from "../lib/useApi";
import { toast } from "../lib/toast";
import DataTable from "../ui/DataTable";
import Drawer from "../ui/Drawer";
import { Chip, EmptyState, SearchIcon } from "../ui/Bits";

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

function statusChip(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved") return <Chip tone="ok">Approved</Chip>;
  if (value === "rejected") return <Chip tone="danger">Rejected</Chip>;
  if (value === "pending") return <Chip tone="wait">Pending</Chip>;
  return <Chip>{status || "—"}</Chip>;
}

export default function KycPage({ focusId, onDrawerChange }) {
  const [tab, setTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState("");

  const listKey = `${tab}|${term}`;

  const list = useApi(() => {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("status", tab);
    if (term) params.set("search", term);
    params.set("limit", "200");
    return api
      .get(`/admin/kyc/list?${params.toString()}`)
      .then((res) => res.data?.kycs || []);
  }, listKey, "Failed to load KYC submissions");

  const summary = useApi(
    () =>
      api
        .get("/admin/kyc/list?limit=200")
        .then((res) => res.data?.kycs || []),
    `summary-${list.loadedAt}`,
    ""
  );

  const rows = (list.data || []).filter((row) =>
    tab === "all" ? true : String(row.status || "").toLowerCase() === tab
  );
  const counts = useMemo(() => {
    const base = summary.data || [];
    return {
      pending: base.filter((r) => r.status === "pending").length,
      approved: base.filter((r) => r.status === "approved").length,
      rejected: base.filter((r) => r.status === "rejected").length,
      all: base.length,
    };
  }, [summary.data]);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  useEffect(() => {
    onDrawerChange?.(Boolean(selectedId));
  }, [selectedId, onDrawerChange]);

  const selected = (list.data || []).find((row) => row.user_id === selectedId) || null;

  const submitSearch = (event) => {
    event.preventDefault();
    setTerm(search.trim());
  };

  async function act(kind) {
    if (!selected) return;
    const userId = selected.user_id;
    if (kind === "reject") {
      const ok = window.confirm(
        "Reject this KYC application? The user will need to submit new documents."
      );
      if (!ok) return;
    }
    setBusy(kind);
    try {
      if (kind === "approve") {
        await api.post("/admin/kyc/approve", { userId });
        toast("KYC approved", "ok");
      } else {
        await api.post("/admin/kyc/reject", { userId });
        toast("KYC rejected", "ok");
      }
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
      key: "applicant",
      label: "Applicant",
      width: "40%",
      render: (row) => (
        <div className="cellstack">
          <div>
            <div className="cell-title">{row.fullName || "Unnamed applicant"}</div>
            <div className="cell-sub">
              {[row.address, row.dob ? `DOB ${row.dob}` : ""]
                .filter(Boolean)
                .join(" · ") || row.user_id}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "submitted",
      label: "Submitted",
      width: "24%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 11.5 }}>
          {fmtDate(row.created_at)}
        </span>
      ),
    },
    {
      key: "age",
      label: "Age",
      width: "14%",
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
      key: "status",
      label: "Status",
      width: "22%",
      render: (row) => statusChip(row.status),
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>KYC review</h1>
        <p>
          <b>{counts.pending}</b> waiting for a decision · documents are served as temporary
          signed links
        </p>
      </div>

      <div className="toolbar">
        <form className="searchrow" onSubmit={submitSearch}>
          <SearchIcon />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by phone or user ID"
            aria-label="Search KYC by phone or user ID"
          />
        </form>
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
        <div className="tabs__end">
          <span className="tabs__note">Oldest first</span>
        </div>
      </div>

      <div className="tablewrap">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.user_id}
          selectedKey={selectedId}
          onRowClick={(row) => setSelectedId(row.user_id)}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={
            <EmptyState title="No submissions in this view">
              {term ? "Nothing matched that search." : "New applications appear here as they arrive."}
            </EmptyState>
          }
          footer={
            <>
              <span>
                Showing <b>{rows.length}</b> {tab === "all" ? "records" : `${tab} records`}
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
        title={selected?.fullName || "Applicant"}
        subtitle={selected ? `User ${selected.user_id}` : ""}
        meta={
          selected
            ? [
                { k: "Submitted", v: fmtDate(selected.created_at) },
                { k: "Waiting", v: ageOf(selected.created_at).label },
                { k: "Status", v: selected.status || "pending" },
                { k: "Updated", v: fmtDate(selected.updated_at) },
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
                  disabled={busy !== "" || selected.status === "approved"}
                  onClick={() => act("approve")}
                >
                  {busy === "approve" ? "Approving…" : "Approve"}
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
              <div className="hint">
                Decisions are written to the audit log against your admin account.
              </div>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="stack stack--lg">
            <div>
              <div className="sect">Documents</div>
              <div className="docs">
                <a
                  className="doc"
                  href={selected.id_path || undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selected.id_path ? (
                    <img src={selected.id_path} alt="Identity document" loading="lazy" />
                  ) : (
                    <span className="doc__empty">No identity document</span>
                  )}
                  <span className="doc__cap">Identity document</span>
                </a>
                <a
                  className="doc"
                  href={selected.selfie_path || undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selected.selfie_path ? (
                    <img src={selected.selfie_path} alt="Selfie" loading="lazy" />
                  ) : (
                    <span className="doc__empty">No selfie</span>
                  )}
                  <span className="doc__cap">Selfie</span>
                </a>
              </div>
            </div>

            <div>
              <div className="sect">Submitted fields</div>
              <div className="fields">
                <div className="frow">
                  <span>Full name</span>
                  <b>{selected.fullName || "—"}</b>
                </div>
                <div className="frow">
                  <span>Date of birth</span>
                  <b>{selected.dob || "—"}</b>
                </div>
                <div className="frow">
                  <span>Address</span>
                  <b>{selected.address || "—"}</b>
                </div>
                <div className="frow">
                  <span>User ID</span>
                  <b>{selected.user_id}</b>
                </div>
              </div>
            </div>

            <div className="flag">
              <i />
              <div>
                Approving unlocks wallet access for this user. Rejections can be re-submitted — the
                KYC API does not store a rejection reason yet.
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
