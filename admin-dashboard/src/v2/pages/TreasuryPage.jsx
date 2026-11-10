import { useState } from "react";
import api from "../lib/api";
import { fmtDate, fmtInt, errText } from "../lib/format";
import { useApi } from "../lib/useApi";
import { Chip, EmptyState, Field, Stat } from "../ui/Bits";
import { toast } from "../lib/toast";

export default function TreasuryPage() {
  const status = useApi(
    () => api.get("/admin/usdt-scanner/status").then((res) => res.data),
    [],
    "Scanner status unavailable"
  );

  const [limit, setLimit] = useState("5");
  const [energy, setEnergy] = useState("65000");
  const [duration, setDuration] = useState("15m");
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState([]);

  async function run(label, method, path, body) {
    setBusy(label);
    try {
      const res = await api.request({ method, url: path, data: body });
      const message = res.data?.message || `${label} finished`;
      setLog((prev) => [
        { at: new Date().toISOString(), ok: true, text: message },
        ...prev,
      ].slice(0, 8));
      toast(message);
      status.reload(true);
    } catch (err) {
      const message = errText(err, `${label} failed`);
      setLog((prev) => [
        { at: new Date().toISOString(), ok: false, text: message },
        ...prev,
      ].slice(0, 8));
      toast(message);
    } finally {
      setBusy("");
    }
  }

  const s = status.data || {};
  const interval = Number(s.intervalMs || 0) / 60000;

  return (
    <>
      <div className="page__head">
        <h1>Treasury</h1>
        <p>
          Deposit scanner health and manual chain operations. Sweeps move credited USDT from deposit
          addresses into the treasury wallet.
        </p>
      </div>

      <div className="stackbar">
        <Stat
          label="Auto scanner"
          value={s.enabled ? "On" : "Off"}
          suffix={interval ? `· every ${interval}m` : undefined}
          hot={!s.enabled}
        />
        <Stat label="Last scan" value={s.lastScanAt ? fmtDate(s.lastScanAt) : "—"} />
        <Stat label="Addresses" value={fmtInt(s.lastScannedAddresses ?? 0)} />
        <Stat label="Detected" value={fmtInt(s.lastDetectedDeposits ?? 0)} />
        <Stat label="Credited" value={fmtInt(s.lastCreditedDeposits ?? 0)} />
        <Stat label="Errors" value={fmtInt(s.lastErrors ?? 0)} hot={Number(s.lastErrors) > 0} />
      </div>

      {status.error ? (
        <div className="formnote formnote--warn" style={{ marginTop: 12 }}>
          {status.error}
        </div>
      ) : null}

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel__head">
          <h2>Chain operations</h2>
          <span className="panel__hint">requires wallets.adjust</span>
        </div>
        <div className="formgrid">
          <Field label="Sweep limit" hint="How many deposit addresses to process per run.">
            <input
              value={limit}
              onChange={(event) => setLimit(event.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className="mono"
            />
          </Field>
          <Field label="Energy amount" hint="TRON energy units for the rental.">
            <input
              value={energy}
              onChange={(event) => setEnergy(event.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className="mono"
            />
          </Field>
          <Field label="Energy duration" hint="TronMax accepts 5m, 15m, 1h, 1d.">
            <select value={duration} onChange={(event) => setDuration(event.target.value)}>
              {["5m", "15m", "1h", "1d"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="actions" style={{ padding: "0 18px 18px" }}>
          <button
            type="button"
            className="btn btn--primary"
            disabled={Boolean(busy)}
            onClick={() =>
              run("TRC20 sweep", "post", "/admin/crypto/deposits/sweep", { limit: Number(limit) || 5 })
            }
          >
            {busy === "TRC20 sweep" ? "Running…" : "Sweep TRC20"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={Boolean(busy)}
            onClick={() => run("BEP20 scan", "post", "/admin/crypto/deposits/scan-bep20", {})}
          >
            {busy === "BEP20 scan" ? "Scanning…" : "Scan BEP20"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={Boolean(busy)}
            onClick={() =>
              run("BEP20 sweep", "post", "/admin/crypto/deposits/sweep-bep20", { limit: Number(limit) || 5 })
            }
          >
            {busy === "BEP20 sweep" ? "Running…" : "Sweep BEP20"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={Boolean(busy)}
            onClick={() =>
              run("Energy rental", "post", "/admin/tronmax/rent-energy", {
                amount: Number(energy) || 65000,
                duration,
              })
            }
          >
            {busy === "Energy rental" ? "Renting…" : "Rent energy"}
          </button>
        </div>

        <div className="formnote">
          Sweeps broadcast on-chain transfers and cannot be reversed. Rent energy first if the treasury
          wallet is short on TRX.
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel__head">
          <h2>This session</h2>
          <span className="panel__hint">results from actions you ran here</span>
        </div>
        {log.length === 0 ? (
          <EmptyState title="Nothing run yet">
            Results appear here; the full history is in Scanner logs and the audit log.
          </EmptyState>
        ) : (
          <div className="fields" style={{ margin: 16 }}>
            {log.map((entry) => (
              <div className="frow" key={entry.at + entry.text}>
                <span className="mono">{fmtDate(entry.at)}</span>
                <b style={{ whiteSpace: "normal", color: entry.ok ? "var(--ink)" : "var(--danger)" }}>
                  {entry.text}
                </b>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel__head">
          <h2>Scanner configuration</h2>
          <Chip tone={s.enabled ? "ok" : "wait"}>{s.enabled ? "Automatic" : "Manual only"}</Chip>
        </div>
        <div className="fields" style={{ margin: 16 }}>
          <div className="frow">
            <span>USDT_DEPOSIT_SCANNER_ENABLED</span>
            <b>{s.enabled ? "true" : "false"}</b>
          </div>
          <div className="frow">
            <span>Interval</span>
            <b>{interval ? `${interval} min` : "—"}</b>
          </div>
          <div className="frow">
            <span>Running now</span>
            <b>{s.isRunning ? "yes" : "no"}</b>
          </div>
        </div>
        <div className="formnote">
          Change these in the API environment, not here — the scanner only reads them at boot.
        </div>
      </div>
    </>
  );
}
