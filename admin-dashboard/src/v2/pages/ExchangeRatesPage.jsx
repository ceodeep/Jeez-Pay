import { useState } from "react";
import api from "../lib/api";
import { fmtAmount, fmtRate, errText } from "../lib/format";
import { useApi } from "../lib/useApi";
import DataTable from "../ui/DataTable";
import { Chip, EmptyState, Field } from "../ui/Bits";
import { toast } from "../lib/toast";

const BLANK = {
  from_currency: "SSP",
  to_currency: "USD",
  rate: "",
  fee_percent: "0",
  flat_fee: "0",
  min_amount: "0",
  max_amount: "0",
  is_enabled: true,
};

export default function ExchangeRatesPage() {
  const feed = useApi(
    () => api.get("/admin/exchange-rates").then((res) => res.data?.rates || []),
    [],
    "Failed to load exchange rates"
  );

  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rates = feed.data || [];
  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.post("/admin/exchange-rates", {
        fromCurrency: String(form.from_currency).trim().toUpperCase(),
        toCurrency: String(form.to_currency).trim().toUpperCase(),
        rate: Number(form.rate) || 0,
        feePercent: Number(form.fee_percent) || 0,
        flatFee: Number(form.flat_fee) || 0,
        minAmount: Number(form.min_amount) || 0,
        maxAmount: Number(form.max_amount) || 0,
        isEnabled: Boolean(form.is_enabled),
      });
      toast("Exchange rate saved");
      setForm(null);
      feed.reload(true);
    } catch (err) {
      setError(errText(err, "Could not save the rate"));
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    {
      key: "pair",
      label: "Pair",
      width: "22%",
      render: (row) => (
        <span className="mono" style={{ fontWeight: 500 }}>
          {row.from_currency} → {row.to_currency}
        </span>
      ),
    },
    {
      key: "rate",
      label: "Rate",
      align: "right",
      width: "18%",
      render: (row) => <span className="mono">{fmtRate(row.rate)}</span>,
    },
    {
      key: "fee",
      label: "Fee",
      align: "right",
      width: "20%",
      render: (row) => (
        <span className="mono cell-sub">
          {Number(row.fee_percent || 0)}% + {fmtAmount(row.flat_fee, row.to_currency)}
        </span>
      ),
    },
    {
      key: "limits",
      label: "Min / Max",
      align: "right",
      width: "22%",
      render: (row) => (
        <span className="mono cell-sub">
          {fmtAmount(row.min_amount)} / {fmtAmount(row.max_amount)}
        </span>
      ),
    },
    {
      key: "state",
      label: "State",
      width: "18%",
      render: (row) => (
        <div className="actions">
          <Chip tone={row.is_enabled ? "ok" : ""}>{row.is_enabled ? "Live" : "Off"}</Chip>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setError("");
              setForm({ ...BLANK, ...row });
            }}
          >
            Edit
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>Exchange rates</h1>
        <p>Quote and fee per currency pair. Saving an existing pair overwrites it.</p>
      </div>

      <div className="toolbar">
        <span className="hint">{rates.length} configured pairs</span>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setError("");
            setForm({ ...BLANK });
          }}
        >
          New rate
        </button>
      </div>

      {form ? (
        <div className="panel" style={{ margin: "12px 18px 0" }}>
          <div className="panel__head">
            <h2>{rates.some((row) => row.from_currency === form.from_currency && row.to_currency === form.to_currency) ? "Update pair" : "Add pair"}</h2>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm(null)}>
              Close
            </button>
          </div>
          <div className="formgrid">
            <Field label="From">
              <input
                value={form.from_currency}
                onChange={(event) => set("from_currency")(event.target.value.toUpperCase())}
                maxLength={6}
                className="mono"
              />
            </Field>
            <Field label="To">
              <input
                value={form.to_currency}
                onChange={(event) => set("to_currency")(event.target.value.toUpperCase())}
                maxLength={6}
                className="mono"
              />
            </Field>
            <Field label="Rate" hint="Units of “to” per 1 “from”.">
              <input
                value={form.rate}
                onChange={(event) => set("rate")(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="mono"
              />
            </Field>
            <Field label="Fee percent">
              <input
                value={form.fee_percent}
                onChange={(event) => set("fee_percent")(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="mono"
              />
            </Field>
            <Field label="Flat fee">
              <input
                value={form.flat_fee}
                onChange={(event) => set("flat_fee")(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="mono"
              />
            </Field>
            <Field label="Min amount">
              <input
                value={form.min_amount}
                onChange={(event) => set("min_amount")(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="mono"
              />
            </Field>
            <Field label="Max amount" hint="0 means no ceiling.">
              <input
                value={form.max_amount}
                onChange={(event) => set("max_amount")(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="mono"
              />
            </Field>
            <Field label="Visibility">
              <label className="switchrow">
                <input
                  type="checkbox"
                  checked={Boolean(form.is_enabled)}
                  onChange={(event) => set("is_enabled")(event.target.checked)}
                />
                <span>
                  <b>{form.is_enabled ? "Visible to users" : "Hidden"}</b>
                  <span>Hidden pairs stay saved but can’t be quoted.</span>
                </span>
              </label>
            </Field>
          </div>
          {error ? <div className="formnote formnote--warn">{error}</div> : null}
          <div className="actions" style={{ padding: "0 18px 18px" }}>
            <button type="button" className="btn btn--primary" disabled={busy || !form.rate} onClick={save}>
              {busy ? "Saving…" : "Save pair"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setForm(BLANK)}>
              Reset
            </button>
          </div>
        </div>
      ) : null}

      <div className="tablewrap" style={{ marginTop: 12 }}>
        <DataTable
          columns={columns}
          rows={rates}
          rowKey={(row) => `${row.from_currency}-${row.to_currency}`}
          loading={feed.loading}
          error={feed.error}
          onRetry={feed.reload}
          empty={<EmptyState title="No rates yet">Add the first pair to start quoting exchanges.</EmptyState>}
          footer={
            <div className="tfoot">
              <span>
                {rates.filter((row) => row.is_enabled).length} live of {rates.length}
              </span>
            </div>
          }
        />
      </div>
    </>
  );
}
