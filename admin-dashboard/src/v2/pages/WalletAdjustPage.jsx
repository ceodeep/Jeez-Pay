import { useEffect, useState } from "react";
import api from "../lib/api";
import { fmtAmount, errText } from "../lib/format";
import { useApi } from "../lib/useApi";
import { toast } from "../lib/toast";
import { Chip, Field } from "../ui/Bits";

const FALLBACK_CURRENCIES = ["SSP", "USD", "USDT"];

export default function WalletAdjustPage() {
  const [form, setForm] = useState({
    identifier: "",
    type: "credit",
    amount: "",
    currency: "SSP",
    description: "",
  });
  const [current, setCurrent] = useState(null);
  const [looking, setLooking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const currencyFeed = useApi(
    () => api.get("/admin/settings/currencies").then((res) => res.data?.currencies || []),
    "adjust-currencies",
    ""
  );
  const codes =
    currencyFeed.data && currencyFeed.data.length > 0
      ? currencyFeed.data.filter((row) => row.isEnabled !== false).map((row) => row.currency)
      : FALLBACK_CURRENCIES;

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    const identifier = form.identifier.trim();
    if (!identifier) {
      setCurrent(null);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setLooking(true);
      try {
        const res = await api.get(`/admin/wallets/view?identifier=${encodeURIComponent(identifier)}`);
        if (!alive) return;
        const wallets = res.data?.wallets || [];
        setCurrent({
          phone: res.data?.user?.phone,
          wallet: wallets.find((row) => row.currency === form.currency) || wallets[0] || null,
        });
      } catch (err) {
        if (alive) setCurrent(null);
        void err;
      } finally {
        if (alive) setLooking(false);
      }
    }, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [form.identifier, form.currency]);

  const amount = Number(form.amount);
  const valid =
    form.identifier.trim() &&
    Number.isFinite(amount) &&
    amount > 0 &&
    form.description.trim().length >= 3;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/admin/wallet/adjust", {
        identifier: form.identifier.trim(),
        type: form.type,
        amount,
        currency: form.currency,
        description: form.description.trim(),
      });
      setResult(res.data?.message || "Wallet adjusted");
      toast(`${form.type === "credit" ? "Credited" : "Debited"} ${fmtAmount(amount, form.currency)}`);
      setConfirming(false);
      setForm((prev) => ({ ...prev, amount: "", description: "" }));
    } catch (err) {
      setError(errText(err, "Adjustment failed"));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page__head">
        <h1>Adjust a wallet</h1>
        <p>
          Manual credit or debit. Every adjustment writes an audit entry with your admin account and IP.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 14, maxWidth: 720 }}>
        <div className="formgrid">
          <div className="field field--wide">
            <label htmlFor="adj-id">Account</label>
            <input
              id="adj-id"
              value={form.identifier}
              onChange={(event) => set("identifier")(event.target.value)}
              placeholder="Phone, user ID or wallet number"
              autoComplete="off"
            />
            <span className="hint">
              {looking
                ? "Looking up…"
                : current
                ? `${current.phone || "account"} · ${current.wallet?.currency || "no wallet"} balance ${fmtAmount(current.wallet?.balance, current.wallet?.currency || form.currency)}`
                : "Exact phone number or user ID — partial matches are rejected."}
            </span>
          </div>

          <Field label="Direction">
            <div className="segmented" role="group" aria-label="Adjustment direction">
              {["credit", "debit"].map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`seg ${form.type === type ? "seg--on" : ""}`}
                  onClick={() => set("type")(type)}
                  aria-pressed={form.type === type}
                >
                  {type === "credit" ? "Credit" : "Debit"}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Currency">
            <select value={form.currency} onChange={(event) => set("currency")(event.target.value)}>
              {codes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Amount">
            <input
              value={form.amount}
              onChange={(event) => set("amount")(event.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0.00"
              className="mono"
            />
          </Field>

          <Field label="Reason" hint="Shown to the customer in their statement.">
            <input
              value={form.description}
              onChange={(event) => set("description")(event.target.value)}
              placeholder="e.g. reversed failed transfer"
              maxLength={140}
            />
          </Field>
        </div>

        {error ? <div className="formnote formnote--warn">{error}</div> : null}
        {result && !error ? <div className="formnote">{result}</div> : null}

        <div style={{ padding: "0 18px 18px", display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className={form.type === "debit" ? "btn btn--danger" : "btn btn--primary"}
            disabled={!valid || busy}
            onClick={() => setConfirming(true)}
          >
            Review {form.type === "debit" ? "debit" : "credit"}
          </button>
          <span className="hint">Nothing is written until you confirm.</span>
        </div>
      </div>

      {confirming ? (
        <div className="panel" style={{ marginTop: 12, maxWidth: 720 }}>
          <div className="panel__head">
            <h2>Confirm {form.type}</h2>
            <Chip tone={form.type === "debit" ? "danger" : "ok"}>
              {fmtAmount(amount, form.currency)}
            </Chip>
          </div>
          <div className="fields" style={{ margin: 16 }}>
            <div className="frow">
              <span>Account</span>
              <b>{current?.phone || form.identifier}</b>
            </div>
            <div className="frow">
              <span>New balance</span>
              <b>
                {fmtAmount(
                  Number(current?.wallet?.balance || 0) + (form.type === "credit" ? amount : -amount),
                  form.currency
                )}
              </b>
            </div>
            <div className="frow">
              <span>Reason</span>
              <b style={{ whiteSpace: "normal" }}>{form.description}</b>
            </div>
          </div>
          <div className="actions" style={{ padding: "0 16px 16px" }}>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={submit}>
              {busy ? "Posting…" : `Post ${form.type}`}
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
