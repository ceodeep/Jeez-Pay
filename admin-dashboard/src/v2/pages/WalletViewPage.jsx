import { useState } from "react";
import api from "../lib/api";
import { fmtAmount } from "../lib/format";
import { useApi } from "../lib/useApi";
import DataTable from "../ui/DataTable";
import { Chip, EmptyState, SearchIcon } from "../ui/Bits";

export default function WalletViewPage() {
  const [term, setTerm] = useState("");
  const [identifier, setIdentifier] = useState("");

  const view = useApi(
    () =>
      identifier
        ? api
            .get(`/admin/wallets/view?identifier=${encodeURIComponent(identifier)}`)
            .then((res) => res.data)
        : Promise.resolve(null),
    identifier,
    "Failed to load wallets"
  );

  const data = view.data;
  const user = data?.user || null;
  const wallets = data?.wallets || [];

  const columns = [
    {
      key: "currency",
      label: "Currency",
      width: "22%",
      render: (row) => <span style={{ fontWeight: 500 }}>{row.currency || "—"}</span>,
    },
    {
      key: "balance",
      label: "Balance",
      align: "right",
      width: "26%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 12.5 }}>
          {fmtAmount(row.balance, row.currency)}
        </span>
      ),
    },
    {
      key: "available",
      label: "Available",
      align: "right",
      width: "26%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 12 }}>
          {row.available == null ? "—" : fmtAmount(row.available, row.currency)}
        </span>
      ),
    },
    {
      key: "state",
      label: "State",
      width: "26%",
      render: (row) =>
        row.is_active === false ? (
          <Chip tone="danger">Frozen</Chip>
        ) : (
          <Chip tone="ok">Active</Chip>
        ),
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>Wallet view</h1>
        <p>Look up an account by phone, user ID or wallet number to see every currency balance.</p>
      </div>

      <div className="toolbar">
        <form
          className="searchrow"
          onSubmit={(event) => {
            event.preventDefault();
            setIdentifier(term.trim());
          }}
        >
          <SearchIcon />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Phone, user ID or wallet number"
            aria-label="Look up a wallet"
          />
        </form>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setIdentifier(term.trim())}
          disabled={!term.trim()}
        >
          Look up
        </button>
      </div>

      <div className="tablewrap" style={{ marginTop: 12 }}>
        {!identifier ? (
          <EmptyState title="Search an account">
            Balances, currency by currency, with the wallet number for support calls.
          </EmptyState>
        ) : view.loading ? (
          <div className="skel" />
        ) : view.error ? (
          <EmptyState title="Lookup failed">{view.error}</EmptyState>
        ) : !user ? (
          <EmptyState title="No account matched">{identifier}</EmptyState>
        ) : (
          <div className="stack stack--lg">
            <div className="fields">
              <div className="frow">
                <span>Phone</span>
                <b>{user.phone || "—"}</b>
              </div>
              <div className="frow">
                <span>Wallet number</span>
                <b>{user.wallet_account_number || "—"}</b>
              </div>
              <div className="frow">
                <span>Role</span>
                <b>{user.role || "user"}</b>
              </div>
              <div className="frow">
                <span>User ID</span>
                <b style={{ whiteSpace: "normal", wordBreak: "break-all" }}>{user.id}</b>
              </div>
            </div>

            <DataTable
              columns={columns}
              rows={wallets}
              rowKey={(row) => row.id || row.currency}
              loading={false}
              empty={<EmptyState title="No wallets">This account has no wallet rows yet.</EmptyState>}
            />
          </div>
        )}
      </div>
    </>
  );
}
