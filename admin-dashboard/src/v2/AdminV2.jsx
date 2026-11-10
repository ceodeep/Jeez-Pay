import { useCallback, useEffect, useMemo, useState } from "react";
import api from "./lib/api";
import LoginPage from "../pages/LoginPage";
import { allowedPages } from "./lib/nav";
import { useApi } from "./lib/useApi";
import Shell from "./Shell";
import Toasts from "./ui/Toasts";
import TodayPage from "./pages/TodayPage";
import KycPage from "./pages/KycPage";
import WithdrawalsPage from "./pages/WithdrawalsPage";
import ServiceRequestsPage from "./pages/ServiceRequestsPage";
import TransactionsPage from "./pages/TransactionsPage";
import UsersPage from "./pages/UsersPage";
import AuditLogsPage from "./pages/AuditLogsPage";
import ScannerLogsPage from "./pages/ScannerLogsPage";
import "./app.css";

const KNOWN = [
  "dashboard",
  "kyc",
  "withdrawals",
  "serviceRequests",
  "transactions",
  "users",
  "auditLogs",
  "scannerLogs",
];

function pageFromHash() {
  const match = window.location.hash.match(/^#\/v2\/([a-zA-Z]+)/);
  const value = match ? match[1] : "";
  return KNOWN.includes(value) ? value : "dashboard";
}

export default function AdminV2() {
  const [token, setToken] = useState(() => localStorage.getItem("admin_token") || "");
  const [page, setPage] = useState(pageFromHash);
  const [focus, setFocus] = useState({ page: "", id: null });
  const [counts, setCounts] = useState({});
  const [pageDrawer, setPageDrawer] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const handleLogin = useCallback((nextToken) => {
    localStorage.setItem("admin_token", nextToken);
    setToken(nextToken);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("admin_token");
    setToken("");
  }, []);

  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener("admin:unauthorized", onUnauthorized);
    return () => window.removeEventListener("admin:unauthorized", onUnauthorized);
  }, [logout]);

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const me = useApi(
    () =>
      token
        ? api.get("/admin/me/permissions").then((res) => res.data)
        : Promise.resolve(null),
    token ? "me" : "",
    "Failed to load admin permissions"
  );

  const permissions = useMemo(() => me.data?.permissions || [], [me.data]);
  const admin = me.data?.admin || null;
  const allowed = useMemo(() => allowedPages(permissions), [permissions]);

  /* the requested page may fall outside this admin's permissions */
  const activePage =
    me.data && allowed.size > 0 && !allowed.has(page)
      ? KNOWN.find((key) => allowed.has(key)) || page
      : page;

  const canManageUsers = permissions.includes("*") || permissions.includes("users.role.update");
  const canApproveWithdrawals =
    permissions.includes("*") || permissions.includes("crypto.withdrawals.approve");

  const navigate = useCallback((nextPage, focusId = null) => {
    const target = KNOWN.includes(nextPage) ? nextPage : "dashboard";
    setPage(target);
    setPageDrawer(Boolean(focusId));
    setFocus({ page: target, id: focusId });
    window.history.replaceState(null, "", `#/v2/${target}`);
    window.scrollTo(0, 0);
  }, []);

  const reportDrawer = useCallback((open) => setPageDrawer(Boolean(open)), []);

  /* queue badges: refreshed on route change and every 90s */
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;

    const load = async () => {
      const [kyc, wd, sr] = await Promise.allSettled([
        api.get("/admin/kyc/list?status=pending&limit=200").then((res) => res.data?.kycs || []),
        api
          .get("/admin/crypto/withdrawals?status=pending")
          .then((res) => res.data?.withdrawals || []),
        api.get("/admin/service-requests").then((res) => res.data?.requests || []),
      ]);
      if (cancelled) return;
      const kycRows = kyc.status === "fulfilled" ? kyc.value : [];
      const wdRows = wd.status === "fulfilled" ? wd.value : [];
      const srRows = sr.status === "fulfilled" ? sr.value : [];
      const srPending = srRows.filter(
        (row) => String(row.status || "").toLowerCase() === "pending"
      );
      setCounts({
        kyc: kycRows.length,
        withdrawals: wdRows.length,
        requests: srPending.length,
        queue: kycRows.length + wdRows.length + srPending.length,
      });
    };

    load();
    const timer = window.setInterval(load, 90000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token, activePage, me.loadedAt]);

  if (!token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const drawerOpen =
    pageDrawer || (Boolean(focus.id) && focus.page === activePage);

  const focusId = focus.page === activePage ? focus.id : null;

  const closeDrawer = () => {
    setFocus({ page: "", id: null });
    setPageDrawer(false);
  };

  return (
    <>
      <Shell
        page={activePage}
        onNavigate={(next) => navigate(next)}
        allowed={allowed}
        counts={counts}
        admin={admin}
        drawerOpen={drawerOpen}
        onCloseDrawer={closeDrawer}
        onSearch={(value) => {
          setUserSearch(value);
          navigate("users");
        }}
      >
        {me.error && !me.data ? (
          <div style={{ padding: 24 }}>
            <div className="empty">
              <b>Couldn&apos;t load your permissions</b>
              {me.error}
              <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center" }}>
                <button type="button" className="btn btn--ghost" onClick={() => me.reload()}>
                  Retry
                </button>
                <button type="button" className="btn btn--primary" onClick={logout}>
                  Sign out
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activePage === "dashboard" ? (
          <TodayPage onNavigate={navigate} reloadKey={counts.queue ?? "boot"} />
        ) : null}
        {activePage === "kyc" ? <KycPage focusId={focusId} onDrawerChange={reportDrawer} /> : null}
        {activePage === "withdrawals" ? (
          <WithdrawalsPage
            focusId={focusId}
            canApprove={canApproveWithdrawals}
            onDrawerChange={reportDrawer}
          />
        ) : null}
        {activePage === "serviceRequests" ? (
          <ServiceRequestsPage focusId={focusId} onDrawerChange={reportDrawer} />
        ) : null}
        {activePage === "transactions" ? <TransactionsPage /> : null}
        {activePage === "users" ? (
          <UsersPage
            focusId={focusId}
            canManageUsers={canManageUsers}
            onDrawerChange={reportDrawer}
            initialSearch={userSearch}
          />
        ) : null}
        {activePage === "auditLogs" ? <AuditLogsPage /> : null}
        {activePage === "scannerLogs" ? <ScannerLogsPage /> : null}
      </Shell>
      <Toasts />
    </>
  );
}
