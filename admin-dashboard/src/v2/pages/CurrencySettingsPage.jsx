import { useState } from "react";
import api from "../lib/api";
import { fmtAmount, errText } from "../lib/format";
import { useApi } from "../lib/useApi";
import DataTable from "../ui/DataTable";
import { Chip, EmptyState, Field } from "../ui/Bits";
import { toast } from "../lib/toast";

export default function CurrencySettingsPage() {
  const feed = useApi(
    () => api.get("/admin/settings/currencies").then((res) => res.data?.currencies || []),
    [],
    "Failed to load currency settings"
  );

  const rows = feed.data || [];
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (key) => (value) => setEditing((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.post(`/admin/settings/currencies/${encodeURIComponent(editing.currency)}`, {
        feePercent: Number(editing.feePercent) || 0,
        flatFee: Number(editing.flatFee) || 0,
        minTransfer: Number(editing.minTransfer) || 0,
        maxTransfer: Number(editing.maxTransfer) || 0,
        isEnabled: Boolean(editing.isEnabled),
      });
      toast(`${editing.currency} updated`);
      setEditing(null);
      feed.reload(true);
    } catch (err) {
      setError(errText(err, "Could not save currency settings"));
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    {
      key: "currency",
      label: "Currency",
      width: "18%",
      render: (row) => (
        <span className="mono" style={{ fontWeight: 600 }}>
          {row.currency}
        </span>
      ),
    },
    {
      key: "fee",
      label: "Fee",
      align: "right",
      width: "22%",
      render: (row) => (
        <span className="mono">
          {Number(row.feePercent || 0)}% + {fmtAmount(row.flatFee, row.currency)}
        </span>
      ),
    },
    {
      key: "limits",
      label: "Transfer limits",
      align: "right",
      width: "30%",
      render: (row) => (
        <span className="mono cell-sub">
          {fmtAmount(row.minTransfer, row.currency)} – {fmtAmount(row.maxTransfer, row.currency)}
        </span>
      ),
    },
    {
      key: "state",
      label: "State",
      width: "30%",
      render: (row) => (
        <div className="actions">
          <Chip tone={row.isEnabled ? "ok" : ""}>{row.isEnabled ? "Enabled" : "Disabled"}</Chip>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setError("");
              setEditing({ ...row });
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
        <h1>Currency settings</h1>
        <p>Per-currency fees and transfer limits. Disabling a currency hides it from new operations.</p>
      </div>

      {editing ? (
        <div className="panel" style={{ margin: "0 18px 12px" }}>
          <div className="panel__head">
            <h2>
              <span className="mono">{editing.currency}</span>
            </h2>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>
              Close
            </button>
          </div>
          <div className="formgrid">
            <Field label="Fee percent">
              <input
                value={editing.feePercent}
                onChange={(event) => set("feePercent")(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="mono"
              />
            </Field>
            <Field label="Flat fee">
              <input
                value={editing.flatFee}
                onChange={(event) => set("flatFee")(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="mono"
              />
            </Field>
            <Field label="Minimum transfer">
              <input
                value={editing.minTransfer}
                onChange={(event) => set("minTransfer")(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="mono"
              />
            </Field>
            <Field label="Maximum transfer" hint="0 means no ceiling.">
              <input
                value={editing.maxTransfer}
                onChange={(event) => set("maxTransfer")(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="mono"
              />
            </Field>
            <Field label="Availability">
              <label className="switchrow">
                <input
                  type="checkbox"
                  checked={Boolean(editing.isEnabled)}
                  onChange={(event) => set("isEnabled")(event.target.checked)}
                />
                <span>
                  <b>{editing.isEnabled ? "Enabled" : "Disabled"}</b>
                  <span>Disabled currencies can’t be used for transfers or exchanges.</span>
                </span>
              </label>
            </Field>
          </div>
          {error ? <div className="formnote formnote--warn">{error}</div> : null}
          <div className="actions" style={{ padding: "0 18px 18px" }}>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : `Save ${editing.currency}`}
            </button>
          </div>
        </div>
      ) : null}

      <div className="tablewrap">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.currency}
          loading={feed.loading}
          error={feed.error}
          onRetry={feed.reload}
          empty={<EmptyState title="No currencies configured">Seed them from the API, then tune fees here.</EmptyState>}
          footer={
            <div className="tfoot">
              <span>
                {rows.filter((row) => row.isEnabled).length} of {rows.length} enabled
              </span>
            </div>
          }
        />
      </div>
    </>
  );
}
