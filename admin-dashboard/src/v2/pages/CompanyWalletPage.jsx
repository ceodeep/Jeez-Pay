import { useMemo } from "react";
import api from "../lib/api";
import { fmtAmount, fmtDate, downloadCsv } from "../lib/format";
import { useApi } from "../lib/useApi";
import DataTable from "../ui/DataTable";
import { EmptyState, Stat } from "../ui/Bits";
import { toast } from "../lib/toast";

export default function CompanyWalletPage() {
  const feed = useApi(
    () => api.get("/admin/company-wallet").then((res) => res.data),
    [],
    "Failed to load the company wallet"
  );

  const data = feed.data || {};
  const balances = useMemo(() => {
    const raw = data.balances;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") {
      return Object.entries(raw).map(([currency, balance]) => ({ currency, balance }));
    }
    return [];
  }, [data.balances]);

  const fees = useMemo(() => {
    const raw = data.recentFeeSummary;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") return Object.entries(raw).map(([k, v]) => ({ label: k, value: v }));
    return [];
  }, [data.recentFeeSummary]);

  const txRows = data.recentTransactions || [];

  const columns = [
    {
      key: "when",
      label: "When",
      width: "20%",
      render: (row) => <span className="cell-sub">{fmtDate(row.created_at)}</span>,
    },
    {
      key: "type",
      label: "Type",
      width: "14%",
      render: (row) => <span className="tag">{row.type || "—"}</span>,
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      width: "22%",
      render: (row) => (
        <span className="mono" style={{ fontWeight: 500 }}>
          {fmtAmount(row.amount, row.currency || row.wallets?.currency)}
        </span>
      ),
    },
    {
      key: "ref",
      label: "Reference",
      width: "22%",
      render: (row) => <span className="mono cell-sub">{row.reference || "—"}</span>,
    },
    {
      key: "note",
      label: "Description",
      width: "22%",
      render: (row) => <span className="cell-sub">{row.description || "—"}</span>,
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>Company wallet</h1>
        <p>Fees collected and network costs — read-only, straight from the ledger.</p>
      </div>

      <div className="stackbar">
        {balances.length === 0 ? (
          <Stat label="Balances" value="—" hint="no wallet rows" />
        ) : (
          balances.slice(0, 4).map((row) => (
            <Stat
              key={row.currency}
              label={(row.currency || "Balance").toUpperCase()}
              value={fmtAmount(row.balance ?? row.amount, row.currency)}
              hint="company treasury"
            />
          ))
        )}
      </div>

      {fees.length > 0 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel__head">
            <h2>Recent fees</h2>
            <span className="panel__hint">last 30 days</span>
          </div>
          <div className="fields">
            {fees.map((row) => (
              <div className="frow" key={row.label || row.currency}>
                <span>{row.label || row.currency}</span>
                <b className="mono">{fmtAmount(row.value ?? row.total ?? row.amount, row.currency)}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 12, padding: 0 }}>
        <div className="panel__head" style={{ padding: "14px 16px 0" }}>
          <h2>Recent activity</h2>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={txRows.length === 0}
            onClick={() => {
              downloadCsv("company-wallet.csv", [
                ["when", "type", "amount", "currency", "reference", "description"],
                ...txRows.map((row) => [
                  row.created_at,
                  row.type,
                  row.amount,
                  row.currency || row.wallets?.currency,
                  row.reference,
                  row.description,
                ]),
              ]);
              toast("CSV downloaded");
            }}
          >
            Export CSV
          </button>
        </div>
        <DataTable
          columns={columns}
          rows={txRows}
          rowKey={(row) => row.id || row.reference || row.created_at}
          loading={feed.loading}
          error={feed.error}
          onRetry={feed.reload}
          empty={<EmptyState title="No movement yet">Company wallet transactions will appear here.</EmptyState>}
          footer={
            <div className="tfoot">
              <span>
                Showing <b>{txRows.length}</b> recent entries
              </span>
            </div>
          }
        />
      </div>
    </>
  );
}
