import { useState } from "react";
import api from "../lib/api";
import { fmtAmount, fmtDate } from "../lib/format";
import { useApi } from "../lib/useApi";
import DataTable from "../ui/DataTable";
import { Chip, EmptyState, SearchIcon } from "../ui/Bits";

const TYPES = ["all", "credit", "debit"];

export default function TransactionsPage() {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [reference, setReference] = useState("");
  const [type, setType] = useState("all");

  const list = useApi(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (reference) params.set("reference", reference);
    if (type !== "all") params.set("type", type);
    const suffix = params.toString();
    return api
      .get(`/admin/transactions${suffix ? `?${suffix}` : ""}`)
      .then((res) => res.data?.transactions || []);
  }, `${search}|${reference}|${type}`, "Failed to load transactions");

  const rows = list.data || [];

  const columns = [
    {
      key: "date",
      label: "When",
      width: "20%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 11 }}>
          {fmtDate(row.created_at)}
        </span>
      ),
    },
    {
      key: "type",
      label: "Type",
      width: "12%",
      render: (row) => (
        <Chip tone={String(row.type).toLowerCase() === "credit" ? "ok" : "danger"}>
          {row.type || "—"}
        </Chip>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      width: "20%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 12.5 }}>
          {fmtAmount(row.amount, row.wallets?.currency)}
        </span>
      ),
    },
    {
      key: "reference",
      label: "Reference",
      width: "22%",
      render: (row) => (
        <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>
          {row.reference || row.id}
        </span>
      ),
    },
    {
      key: "description",
      label: "Description",
      width: "26%",
      wrap: true,
      render: (row) => <span style={{ fontSize: 11.5 }}>{row.description || "—"}</span>,
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>Transactions</h1>
        <p>
          <b>{rows.length}</b> ledger entries · read-only, every movement is also in the audit log
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
            aria-label="Search transactions by user"
          />
        </form>
        <input
          className="input"
          style={{ width: 190 }}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Reference"
          aria-label="Filter by reference"
        />
        <select
          className="select"
          style={{ width: 130 }}
          value={type}
          onChange={(event) => setType(event.target.value)}
          aria-label="Filter by type"
        >
          {TYPES.map((item) => (
            <option key={item} value={item}>
              {item === "all" ? "All types" : item}
            </option>
          ))}
        </select>
      </div>

      <div className="tablewrap" style={{ marginTop: 12 }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={<EmptyState title="No transactions matched">Adjust the filters and try again.</EmptyState>}
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
