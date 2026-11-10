import { useEffect, useState } from "react";
import api from "../lib/api";
import { fmtAmount, fmtDate, errText } from "../lib/format";
import { useApi } from "../lib/useApi";
import { toast } from "../lib/toast";
import DataTable from "../ui/DataTable";
import Drawer from "../ui/Drawer";
import { Chip, EmptyState, SearchIcon } from "../ui/Bits";

const ROLES = ["all", "user", "agent", "merchant", "admin"];

function kycStatusOf(row) {
  const value = row?.kyc_profiles;
  if (Array.isArray(value)) return value[0]?.status || "none";
  return value?.status || "none";
}

function statusChip(row) {
  if (row.is_active === false) return <Chip tone="danger">Suspended</Chip>;
  return <Chip tone="ok">Active</Chip>;
}

function kycChip(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved") return <Chip tone="ok">Approved</Chip>;
  if (value === "pending") return <Chip tone="wait">Pending</Chip>;
  if (value === "rejected") return <Chip tone="danger">Rejected</Chip>;
  return <Chip>Not started</Chip>;
}

export default function UsersPage({ focusId, canManageUsers, onDrawerChange, initialSearch }) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState("");
  const [nextRole, setNextRole] = useState("");

  const list = useApi(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (role !== "all") params.set("role", role);
    const suffix = params.toString();
    return api
      .get(`/admin/users${suffix ? `?${suffix}` : ""}`)
      .then((res) => res.data?.users || []);
  }, `${search}|${role}`, "Failed to load users");

  const rows = list.data || [];
  const selected = rows.find((row) => row.id === selectedId) || null;

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  useEffect(() => {
    onDrawerChange?.(Boolean(selectedId));
  }, [selectedId, onDrawerChange]);

  useEffect(() => {
    if (initialSearch) {
      setTerm(initialSearch);
      setSearch(initialSearch);
    }
  }, [initialSearch]);

  useEffect(() => {
    if (selected) setNextRole(selected.role || "user");
  }, [selected]);

  const details = useApi(
    () =>
      selected
        ? api
            .get(`/admin/user/details?identifier=${encodeURIComponent(selected.phone || selected.id)}`)
            .then((res) => res.data)
        : Promise.resolve(null),
    selected ? selected.id : "",
    "Failed to load user details"
  );

  async function act(kind) {
    if (!selected) return;
    const userId = selected.id;
    if (kind === "suspend") {
      const ok = window.confirm(`Suspend ${selected.phone}? They will be locked out immediately.`);
      if (!ok) return;
    }
    setBusy(kind);
    try {
      if (kind === "suspend") await api.post("/admin/user/suspend", { userId });
      if (kind === "activate") await api.post("/admin/user/activate", { userId });
      if (kind === "role") await api.post("/admin/user/set-role", { userId, role: nextRole });
      toast(
        kind === "suspend"
          ? "User suspended"
          : kind === "activate"
          ? "User reactivated"
          : `Role set to ${nextRole}`,
        "ok"
      );
      await list.reload(true);
      if (kind === "role") details.reload(true);
    } catch (err) {
      toast(errText(err, "Action failed"), "error");
    } finally {
      setBusy("");
    }
  }

  const columns = [
    {
      key: "phone",
      label: "User",
      width: "32%",
      render: (row) => (
        <div className="cellstack">
          <div className="avatar" style={{ background: "#eef0ea", color: "#4b5045" }}>
            {(row.phone || "?").slice(-2)}
          </div>
          <div>
            <div className="cell-title mono">{row.phone || row.id}</div>
            <div className="cell-sub">
              {row.account_type || "personal"} · {(row.id || "").slice(0, 8)}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      label: "Role",
      width: "16%",
      render: (row) => <span style={{ fontSize: 12 }}>{row.role || "user"}</span>,
    },
    {
      key: "kyc",
      label: "KYC",
      width: "16%",
      render: (row) => kycChip(kycStatusOf(row)),
    },
    {
      key: "status",
      label: "Status",
      width: "16%",
      render: (row) => statusChip(row),
    },
    {
      key: "joined",
      label: "Joined",
      width: "20%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 11 }}>
          {fmtDate(row.created_at)}
        </span>
      ),
    },
  ];

  const detail = details.data;

  return (
    <>
      <div className="page__head">
        <h1>Users</h1>
        <p>
          <b>{rows.length}</b> accounts in this view · search matches phone numbers and user IDs
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
            placeholder="Phone or user ID"
            aria-label="Search users"
          />
        </form>
        <select
          className="select"
          style={{ width: 150 }}
          value={role}
          onChange={(event) => setRole(event.target.value)}
          aria-label="Filter by role"
        >
          {ROLES.map((item) => (
            <option key={item} value={item}>
              {item === "all" ? "All roles" : item}
            </option>
          ))}
        </select>
        {search ? (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              setTerm("");
              setSearch("");
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="tablewrap" style={{ marginTop: 12 }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          selectedKey={selectedId}
          onRowClick={(row) => setSelectedId(row.id)}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={<EmptyState title="No users matched">Try a different phone number or ID.</EmptyState>}
          footer={
            <>
              <span>
                Showing <b>{rows.length}</b> users
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
        title={selected?.phone || "User"}
        subtitle={selected ? `${selected.role || "user"} · ${selected.account_type || "personal"}` : ""}
        meta={
          selected
            ? [
                { k: "Joined", v: fmtDate(selected.created_at) },
                { k: "Wallet no.", v: selected.wallet_account_number || "—" },
                { k: "Phone verified", v: selected.phone_verified ? "yes" : "no" },
                { k: "KYC", v: kycStatusOf(selected) },
              ]
            : []
        }
        footer={
          selected ? (
            <div className="row2">
              {selected.is_active === false ? (
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  disabled={busy !== ""}
                  onClick={() => act("activate")}
                >
                  Reactivate
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--danger btn--block"
                  disabled={busy !== ""}
                  onClick={() => act("suspend")}
                >
                  Suspend
                </button>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--block"
                disabled={busy !== "" || !canManageUsers}
                onClick={() => act("role")}
                title={canManageUsers ? "" : "Super admin only"}
              >
                Apply role
              </button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="stack stack--lg">
            {details.error ? (
              <div className="flag">
                <i />
                <div>{details.error}</div>
              </div>
            ) : null}

            <div>
              <div className="sect">Wallets</div>
              {details.loading ? (
                <div className="skel" />
              ) : (detail?.wallets || []).length > 0 ? (
                <div className="fields">
                  {detail.wallets.map((wallet) => (
                    <div className="frow" key={wallet.id || wallet.currency}>
                      <span>{wallet.currency || "wallet"}</span>
                      <b>{fmtAmount(wallet.balance, wallet.currency)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="fields">
                  <div className="frow">
                    <span>Wallets</span>
                    <b>none on file</b>
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="sect">Role</div>
              <select
                className="select"
                value={nextRole}
                onChange={(event) => setNextRole(event.target.value)}
                disabled={!canManageUsers}
              >
                {ROLES.filter((item) => item !== "all").map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              {!canManageUsers ? (
                <div className="field__hint" style={{ marginTop: 5 }}>
                  Changing roles requires super admin access.
                </div>
              ) : null}
            </div>

            <div>
              <div className="sect">Recent activity</div>
              {details.loading ? (
                <div className="skel" />
              ) : (detail?.recentTransactions || []).length > 0 ? (
                <div className="fields">
                  {detail.recentTransactions.slice(0, 6).map((tx, index) => (
                    <div className="frow" key={tx.id || index}>
                      <span>
                        {fmtDate(tx.created_at)} · {tx.type || "tx"}
                      </span>
                      <b>{fmtAmount(tx.amount, tx.currency)}</b>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="fields">
                  <div className="frow">
                    <span>Transactions</span>
                    <b>none yet</b>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
