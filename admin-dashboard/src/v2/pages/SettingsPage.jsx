import { useState } from "react";
import api from "../lib/api";
import { fmtDate, errText } from "../lib/format";
import { useApi } from "../lib/useApi";
import { Chip, Field } from "../ui/Bits";
import { toast } from "../lib/toast";
import AdminMfaSetup from "../../components/AdminMfaSetup";

export default function SettingsPage() {
  const feed = useApi(
    () => api.get("/admin/settings").then((res) => res.data?.settings || null),
    [],
    "Failed to load platform settings"
  );
  const currencies = useApi(
    () => api.get("/admin/settings/currencies").then((res) => res.data?.currencies || []),
    [],
    "Currency list unavailable"
  );

  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const server = feed.data;
  const live = server
    ? {
        dailyTransferLimit: String(server.dailyTransferLimit ?? 0),
        kycRequired: Boolean(server.kycRequired),
        maintenanceMode: Boolean(server.maintenanceMode),
        supportedCurrencies: Array.isArray(server.supportedCurrencies)
          ? server.supportedCurrencies
          : [],
      }
    : null;

  const codes = (currencies.data || []).map((row) => row.currency);
  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  function toggleCurrency(code) {
    setForm((prev) => {
      const list = prev.supportedCurrencies.includes(code)
        ? prev.supportedCurrencies.filter((item) => item !== code)
        : [...prev.supportedCurrencies, code];
      return { ...prev, supportedCurrencies: list };
    });
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.post("/admin/settings", {
        dailyTransferLimit: Number(form.dailyTransferLimit) || 0,
        kycRequired: Boolean(form.kycRequired),
        maintenanceMode: Boolean(form.maintenanceMode),
        supportedCurrencies: form.supportedCurrencies,
      });
      toast("Platform settings saved");
      setForm(null);
      feed.reload(true);
    } catch (err) {
      setError(errText(err, "Could not save settings"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page__head">
        <h1>Settings</h1>
        <p>Platform-wide switches and your own admin security. Changes apply to every user immediately.</p>
      </div>

      <div className="panel" style={{ marginTop: 14, maxWidth: 780 }}>
        <div className="panel__head">
          <h2>Platform</h2>
          <div className="actions">
            {live?.maintenanceMode ? <Chip tone="danger">Maintenance</Chip> : null}
            <Chip tone={live?.kycRequired ? "ok" : "wait"}>
              {live?.kycRequired ? "KYC required" : "KYC optional"}
            </Chip>
            {!form && live ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setError("");
                  setForm({ ...live });
                }}
              >
                Edit
              </button>
            ) : null}
          </div>
        </div>

        {feed.loading ? (
          <div className="skel" style={{ margin: 16 }} />
        ) : feed.error ? (
          <div className="formnote formnote--warn" style={{ margin: 16 }}>{feed.error}</div>
        ) : form ? (
          <>
            <div className="formgrid">
              <Field label="Daily transfer limit" hint="0 removes the limit.">
                <input
                  value={form.dailyTransferLimit}
                  onChange={(event) => set("dailyTransferLimit")(event.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  className="mono"
                />
              </Field>
              <Field label="Switches">
                <div className="stack" style={{ gap: 8 }}>
                  <label className="switchrow">
                    <input
                      type="checkbox"
                      checked={form.kycRequired}
                      onChange={(event) => set("kycRequired")(event.target.checked)}
                    />
                    <span>
                      <b>KYC required</b>
                      <span>Unverified users can’t send money.</span>
                    </span>
                  </label>
                  <label className="switchrow">
                    <input
                      type="checkbox"
                      checked={form.maintenanceMode}
                      onChange={(event) => set("maintenanceMode")(event.target.checked)}
                    />
                    <span>
                      <b>Maintenance mode</b>
                      <span>Blocks transfers for everyone. Use briefly.</span>
                    </span>
                  </label>
                </div>
              </Field>
              <div className="field field--wide">
                <label>Supported currencies</label>
                {codes.length === 0 ? (
                  <div className="hint">
                    No currency rows found — add them under Currency settings first.
                  </div>
                ) : (
                  <div className="actions">
                    {codes.map((code) => {
                      const on = form.supportedCurrencies.includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          className={`seg ${on ? "seg--on" : ""}`}
                          style={{ border: "1px solid var(--line-strong)", borderRadius: 6 }}
                          aria-pressed={on}
                          onClick={() => toggleCurrency(code)}
                        >
                          {code}
                        </button>
                      );
                    })}
                  </div>
                )}
                <span className="field__hint">
                  At least one is required — the API rejects an empty list.
                </span>
              </div>
            </div>
            {error ? <div className="formnote formnote--warn">{error}</div> : null}
            <div className="actions" style={{ padding: "0 18px 18px" }}>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || form.supportedCurrencies.length === 0}
                onClick={save}
              >
                {busy ? "Saving…" : "Save settings"}
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setForm(null)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="fields" style={{ margin: 16 }}>
            <div className="frow">
              <span>Daily transfer limit</span>
              <b>{Number(live?.dailyTransferLimit) === 0 ? "none" : live?.dailyTransferLimit}</b>
            </div>
            <div className="frow">
              <span>KYC required</span>
              <b>{live?.kycRequired ? "yes" : "no"}</b>
            </div>
            <div className="frow">
              <span>Maintenance mode</span>
              <b>{live?.maintenanceMode ? "on" : "off"}</b>
            </div>
            <div className="frow">
              <span>Supported currencies</span>
              <b>{(live?.supportedCurrencies || []).join(" · ") || "—"}</b>
            </div>
            <div className="frow">
              <span>Last updated</span>
              <b>{server?.updatedAt ? fmtDate(server.updatedAt) : "—"}</b>
            </div>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 12, maxWidth: 780 }}>
        <div className="panel__head">
          <h2>Your admin security</h2>
          <span className="panel__hint">two-factor authentication</span>
        </div>
        <div style={{ padding: 16 }}>
          <AdminMfaSetup />
        </div>
      </div>

      <div className="formnote" style={{ maxWidth: 780 }}>
        Treasury keys, chain RPC endpoints and scanner intervals live in the API environment, not in
        this dashboard. Changing them needs a redeploy from Coolify.
      </div>
    </>
  );
}
