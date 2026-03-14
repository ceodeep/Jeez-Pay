import { useEffect, useState } from "react";
import api from "./lib/api";
import LoginPage from "./pages/LoginPage";

function StatusBadge({ value }) {
  const normalized = String(value || "").toLowerCase();

  const styles = {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    textTransform: "capitalize",
  };

  if (
    normalized === "approved" ||
    normalized === "credit" ||
    normalized === "active"
  ) {
    return (
      <span style={{ ...styles, background: "#e8f7ee", color: "#18794e" }}>
        {value}
      </span>
    );
  }

  if (normalized === "pending") {
    return (
      <span style={{ ...styles, background: "#fff7e6", color: "#b26a00" }}>
        {value}
      </span>
    );
  }

  if (
    normalized === "rejected" ||
    normalized === "debit" ||
    normalized === "suspended"
  ) {
    return (
      <span style={{ ...styles, background: "#fdecec", color: "#c0392b" }}>
        {value}
      </span>
    );
  }

  return (
    <span style={{ ...styles, background: "#eef2f7", color: "#475569" }}>
      {value}
    </span>
  );
}

function Card({ title, value }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div style={{ fontSize: 14, color: "#64748b", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#0f172a" }}>
        {value}
      </div>
    </div>
  );
}

function AppShell({ onLogout }) {
  const [page, setPage] = useState("dashboard");
  const [loading, setLoading] = useState(false);

  const [kycs, setKycs] = useState([]);
  const [users, setUsers] = useState([]);
  const [transactions, setTransactions] = useState([]);

  const [stats, setStats] = useState({
    totalUsers: 0,
    pendingKyc: 0,
    suspendedUsers: 0,
    totalTransactionsToday: 0,
    totalVolumeToday: 0,
    totalAgents: 0,
    totalMerchants: 0,
  });

  const [kycStatusFilter, setKycStatusFilter] = useState("all");
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [txTypeFilter, setTxTypeFilter] = useState("all");

  const [adjustForm, setAdjustForm] = useState({
    userId: "",
    currency: "USDT",
    amount: "",
    type: "credit",
    description: "",
  });

  const [message, setMessage] = useState("");

  async function loadDashboardStats() {
    setLoading(true);
    setMessage("");
    try {
      const res = await api.get("/admin/dashboard/stats");
      setStats(
        res.data.stats || {
          totalUsers: 0,
          pendingKyc: 0,
          suspendedUsers: 0,
          totalTransactionsToday: 0,
          totalVolumeToday: 0,
          totalAgents: 0,
          totalMerchants: 0,
        }
      );
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to load dashboard stats"
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadKycs() {
    setLoading(true);
    setMessage("");
    try {
      const url =
        kycStatusFilter === "all"
          ? "/admin/kyc/list"
          : `/admin/kyc/list?status=${kycStatusFilter}`;

      const res = await api.get(url);
      setKycs(res.data.kycs || []);
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to load KYC list");
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    setLoading(true);
    setMessage("");
    try {
      const url =
        userRoleFilter === "all"
          ? "/admin/users"
          : `/admin/users?role=${userRoleFilter}`;

      const res = await api.get(url);
      setUsers(res.data.users || []);
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function loadTransactions() {
    setLoading(true);
    setMessage("");
    try {
      const url =
        txTypeFilter === "all"
          ? "/admin/transactions"
          : `/admin/transactions?type=${txTypeFilter}`;

      const res = await api.get(url);
      setTransactions(res.data.transactions || []);
    } catch (err) {
      setMessage(
        err?.response?.data?.message || "Failed to load transactions"
      );
    } finally {
      setLoading(false);
    }
  }

  async function approveKyc(userId) {
    try {
      await api.post("/admin/kyc/approve", { userId });
      setMessage("KYC approved successfully");
      loadKycs();
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to approve KYC");
    }
  }

  async function rejectKyc(userId) {
    try {
      await api.post("/admin/kyc/reject", { userId });
      setMessage("KYC rejected successfully");
      loadKycs();
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to reject KYC");
    }
  }

  async function suspendUser(userId) {
    try {
      await api.post("/admin/user/suspend", { userId });
      setMessage("User suspended successfully");
      loadUsers();
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to suspend user");
    }
  }

  async function activateUser(userId) {
    try {
      await api.post("/admin/user/activate", { userId });
      setMessage("User activated successfully");
      loadUsers();
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to activate user");
    }
  }

  async function adjustWallet(e) {
    e.preventDefault();
    try {
      await api.post("/admin/wallet/adjust", {
        userId: adjustForm.userId,
        currency: adjustForm.currency,
        amount: Number(adjustForm.amount),
        type: adjustForm.type,
        description: adjustForm.description,
      });

      setMessage("Wallet adjusted successfully");
      setAdjustForm({
        userId: "",
        currency: "USDT",
        amount: "",
        type: "credit",
        description: "",
      });
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to adjust wallet");
    }
  }

  useEffect(() => {
    if (page === "dashboard") {
      loadDashboardStats();
    }

    if (page === "kyc") loadKycs();
    if (page === "users") loadUsers();
    if (page === "transactions") loadTransactions();
  }, [page, kycStatusFilter, userRoleFilter, txTypeFilter]);

  const kycCounts = {
    all: kycs.length,
    pending: kycs.filter((k) => k.status === "pending").length,
    approved: kycs.filter((k) => k.status === "approved").length,
    rejected: kycs.filter((k) => k.status === "rejected").length,
  };

  function formatDate(value) {
  if (!value) return "-";

  const d = new Date(value);

  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

  function openFile(path) {
    if (!path) return;
    window.open(path, "_blank");
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          minHeight: "100vh",
        }}
      >
        <aside
          style={{
            background: "#ffffff",
            borderRight: "1px solid #e2e8f0",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            minHeight: "100vh",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 24 }}>
            JeezPay Admin
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {[
              ["dashboard", "Dashboard"],
              ["kyc", "KYC Review"],
              ["users", "Users"],
              ["transactions", "Transactions"],
              ["wallet", "Wallet Adjust"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPage(key)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "none",
                  cursor: "pointer",
                  background: page === key ? "#0f172a" : "#f1f5f9",
                  color: page === key ? "#fff" : "#0f172a",
                  fontWeight: 600,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <button
            onClick={onLogout}
            style={{
              width: "100%",
              marginTop: 24,
              padding: "12px 14px",
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              background: "#fee2e2",
              color: "#b91c1c",
              fontWeight: 700,
            }}
          >
            Logout
          </button>
        </aside>

        <main style={{ padding: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <div>
              <h1 style={{ margin: 0, fontSize: 28 }}>
                {page === "dashboard" && "Dashboard"}
                {page === "kyc" && "KYC Review"}
                {page === "users" && "Users"}
                {page === "transactions" && "Transactions"}
                {page === "wallet" && "Wallet Adjustment"}
              </h1>
              <p style={{ margin: "6px 0 0", color: "#64748b" }}>
                Admin operations panel for JeezPay.
              </p>
            </div>
          </div>

          {message ? (
            <div
              style={{
                background: "#eff6ff",
                color: "#1d4ed8",
                padding: 12,
                borderRadius: 12,
                marginBottom: 16,
              }}
            >
              {message}
            </div>
          ) : null}

          {page === "dashboard" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 16,
              }}
            >
              <Card title="Total Users" value={String(stats.totalUsers)} />
              <Card title="Pending KYC" value={String(stats.pendingKyc)} />
              <Card
                title="Suspended Users"
                value={String(stats.suspendedUsers)}
              />
              <Card
                title="Transactions Today"
                value={String(stats.totalTransactionsToday)}
              />
            </div>
          )}

          {page === "kyc" && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 16,
                  flexWrap: "wrap",
                }}
              >
                {[
                  ["all", `All (${kycCounts.all})`],
                  ["pending", `Pending (${kycCounts.pending})`],
                  ["approved", `Approved (${kycCounts.approved})`],
                  ["rejected", `Rejected (${kycCounts.rejected})`],
                ].map(([status, label]) => (
                  <button
                    key={status}
                    onClick={() => setKycStatusFilter(status)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      background:
                        kycStatusFilter === status ? "#0f172a" : "#e2e8f0",
                      color: kycStatusFilter === status ? "#fff" : "#0f172a",
                      fontWeight: 600,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {loading ? (
                <p>Loading...</p>
              ) : kycs.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    padding: 24,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                    color: "#64748b",
                  }}
                >
                  No KYC submissions found.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {kycs.map((item) => {
                    const status = String(item.status || "").toLowerCase();
                    const isPending = status === "pending";

                    return (
                      <div
                        key={item.user_id}
                        style={{
                          background: "#fff",
                          padding: 18,
                          borderRadius: 16,
                          boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 16,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>
                            {item.full_name || "-"}
                          </div>

                          <div
                            style={{
                              color: "#64748b",
                              marginTop: 6,
                              lineHeight: 1.6,
                              fontSize: 14,
                            }}
                          >
                            <div>Address: {item.address || "-"}</div>
                            <div>DOB: {item.dob || "-"}</div>
                            <div>Submitted: {formatDate(item.created_at)}</div>
                            <div>User ID: {item.user_id}</div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              marginTop: 12,
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              onClick={() => openFile(item.id_path)}
                              disabled={!item.id_path}
                              style={{
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: "1px solid #cbd5e1",
                                background: item.id_path ? "#fff" : "#f8fafc",
                                color: "#0f172a",
                                cursor: item.id_path
                                  ? "pointer"
                                  : "not-allowed",
                              }}
                            >
                              View ID
                            </button>

                            <button
                              onClick={() => openFile(item.selfie_path)}
                              disabled={!item.selfie_path}
                              style={{
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: "1px solid #cbd5e1",
                                background: item.selfie_path
                                  ? "#fff"
                                  : "#f8fafc",
                                color: "#0f172a",
                                cursor: item.selfie_path
                                  ? "pointer"
                                  : "not-allowed",
                              }}
                            >
                              View Selfie
                            </button>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flexWrap: "wrap",
                          }}
                        >
                          <StatusBadge value={item.status} />

                          {isPending && (
                            <>
                              <button
                                onClick={() => approveKyc(item.user_id)}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: 10,
                                  border: "none",
                                  background: "#dcfce7",
                                  color: "#166534",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                }}
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => rejectKyc(item.user_id)}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: 10,
                                  border: "none",
                                  background: "#fee2e2",
                                  color: "#b91c1c",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                }}
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {page === "users" && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 16,
                  flexWrap: "wrap",
                }}
              >
                {["all", "user", "agent", "merchant", "admin"].map((role) => (
                  <button
                    key={role}
                    onClick={() => setUserRoleFilter(role)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      background:
                        userRoleFilter === role ? "#0f172a" : "#e2e8f0",
                      color: userRoleFilter === role ? "#fff" : "#0f172a",
                      fontWeight: 600,
                    }}
                  >
                    {role}
                  </button>
                ))}
              </div>

              {loading ? (
                <p>Loading...</p>
              ) : users.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    padding: 24,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                    color: "#64748b",
                  }}
                >
                  No users found.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {users
                    .filter((item) => item.phone !== "COMPANY")
                    .map((item) => {
                      const isActive = item.is_active !== false;
                      const kycStatus = item.kyc_profiles?.[0]?.status || "none";

                      return (
                        <div
                          key={item.id}
                          style={{
                            background: "#fff",
                            padding: 18,
                            borderRadius: 16,
                            boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 16,
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 16 }}>
                              {item.phone}
                            </div>
                            <div
                              style={{
                                color: "#64748b",
                                marginTop: 6,
                                lineHeight: 1.6,
                                fontSize: 14,
                              }}
                            >
                              <div>
                                Role: {item.role} • {item.account_type || "-"}
                              </div>
                              <div>
                                Phone verified: {item.phone_verified ? "yes" : "no"}
                              </div>
                              <div>KYC: {kycStatus}</div>
                              <div>User ID: {item.id}</div>
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              flexWrap: "wrap",
                            }}
                          >
                            <StatusBadge value={isActive ? "active" : "suspended"} />
                            <StatusBadge value={kycStatus} />

                            {isActive ? (
                              <button
                                onClick={() => suspendUser(item.id)}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: 10,
                                  border: "none",
                                  background: "#fee2e2",
                                  color: "#b91c1c",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                }}
                              >
                                Suspend
                              </button>
                            ) : (
                              <button
                                onClick={() => activateUser(item.id)}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: 10,
                                  border: "none",
                                  background: "#dcfce7",
                                  color: "#166534",
                                  cursor: "pointer",
                                  fontWeight: 600,
                                }}
                              >
                                Activate
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

                    {page === "transactions" && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 16,
                  flexWrap: "wrap",
                }}
              >
                {["all", "credit", "debit"].map((type) => (
                  <button
                    key={type}
                    onClick={() => setTxTypeFilter(type)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "none",
                      cursor: "pointer",
                      background:
                        txTypeFilter === type ? "#0f172a" : "#e2e8f0",
                      color: txTypeFilter === type ? "#fff" : "#0f172a",
                      fontWeight: 600,
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>

              {loading ? (
                <p>Loading...</p>
              ) : transactions.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    padding: 24,
                    borderRadius: 16,
                    boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                    color: "#64748b",
                  }}
                >
                  No transactions found.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {transactions.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        background: "#fff",
                        padding: 18,
                        borderRadius: 16,
                        boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 16,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>
  {item.description || "No description"}
</div>

<div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
  Ref #{item.reference}
</div>

                        <div
                          style={{
                            color: "#64748b",
                            marginTop: 6,
                            lineHeight: 1.6,
                            fontSize: 14,
                          }}
                        >
                          <div>Reference: {item.reference || "-"}</div>
                          <div>Date: {formatDate(item.created_at)}</div>
                          <div>
                            Currency: {item.wallets?.currency || "-"}
                          </div>
                          <div>
                            User ID: {item.wallets?.user_id || "-"}
                          </div>
                          <div>Wallet ID: {item.wallet_id || "-"}</div>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <StatusBadge value={item.type} />
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 18,
                            color:
                              item.type === "credit" ? "#166534" : "#b91c1c",
                          }}
                        >
                          {item.type === "credit" ? "+" : "-"}
                          {item.amount}{item.wallets?.currency}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {page === "wallet" && (
            <div
              style={{
                background: "#fff",
                padding: 20,
                borderRadius: 16,
                boxShadow: "0 6px 24px rgba(15, 23, 42, 0.06)",
                maxWidth: 600,
              }}
            >
              <form onSubmit={adjustWallet} style={{ display: "grid", gap: 12 }}>
                <input
                  placeholder="User ID"
                  value={adjustForm.userId}
                  onChange={(e) =>
                    setAdjustForm({
                      ...adjustForm,
                      userId: e.target.value,
                    })
                  }
                  style={{ padding: 12 }}
                />
                <input
                  placeholder="Currency"
                  value={adjustForm.currency}
                  onChange={(e) =>
                    setAdjustForm({
                      ...adjustForm,
                      currency: e.target.value.toUpperCase(),
                    })
                  }
                  style={{ padding: 12 }}
                />
                <input
                  placeholder="Amount"
                  value={adjustForm.amount}
                  onChange={(e) =>
                    setAdjustForm({
                      ...adjustForm,
                      amount: e.target.value,
                    })
                  }
                  style={{ padding: 12 }}
                />
                <select
                  value={adjustForm.type}
                  onChange={(e) =>
                    setAdjustForm({
                      ...adjustForm,
                      type: e.target.value,
                    })
                  }
                  style={{ padding: 12 }}
                >
                  <option value="credit">credit</option>
                  <option value="debit">debit</option>
                </select>
                <input
                  placeholder="Description"
                  value={adjustForm.description}
                  onChange={(e) =>
                    setAdjustForm({
                      ...adjustForm,
                      description: e.target.value,
                    })
                  }
                  style={{ padding: 12 }}
                />

                <button
                  type="submit"
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    border: "none",
                    background: "#0f172a",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Submit Adjustment
                </button>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("admin_token") || "");

  function handleLogout() {
    localStorage.removeItem("admin_token");
    setToken("");
  }

  if (!token) {
    return <LoginPage onLogin={setToken} />;
  }

  return <AppShell onLogout={handleLogout} />;
}