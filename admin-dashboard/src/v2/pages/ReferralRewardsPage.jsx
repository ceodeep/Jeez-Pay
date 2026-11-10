import { useState } from "react";
import api from "../lib/api";
import { fmtAmount, fmtDate, errText } from "../lib/format";
import { useApi } from "../lib/useApi";
import DataTable from "../ui/DataTable";
import { Chip, EmptyState, Field } from "../ui/Bits";
import { toast } from "../lib/toast";

const TRIGGERS = ["kyc_approved", "signup", "first_transfer"];

export default function ReferralRewardsPage() {
  const settingsFeed = useApi(
    () => api.get("/admin/referral-rewards/settings").then((res) => res.data?.settings || null),
    [],
    "Failed to load referral settings"
  );
  const history = useApi(
    () => api.get("/admin/referral-rewards/history").then((res) => res.data?.rewards || []),
    [],
    "Failed to load referral history"
  );

  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const server = settingsFeed.data;
  const live = server
    ? {
        enabled: Boolean(server.enabled),
        rewardAmount: String(server.reward_amount ?? server.rewardAmount ?? 0),
        currency: server.currency || "USDT",
        triggerEvent: server.trigger_event || server.triggerEvent || "kyc_approved",
        maxRewardsPerUser: String(server.max_rewards_per_user ?? server.maxRewardsPerUser ?? 0),
      }
    : null;

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.post("/admin/referral-rewards/settings", {
        enabled: Boolean(form.enabled),
        rewardAmount: Number(form.rewardAmount) || 0,
        currency: form.currency,
        triggerEvent: form.triggerEvent,
        maxRewardsPerUser: Number(form.maxRewardsPerUser) || 0,
      });
      toast("Referral settings saved");
      settingsFeed.reload(true);
    } catch (err) {
      setError(errText(err, "Could not save referral settings"));
    } finally {
      setBusy(false);
    }
  }

  const rewards = history.data || [];

  const columns = [
    {
      key: "when",
      label: "When",
      width: "18%",
      render: (row) => <span className="cell-sub">{fmtDate(row.created_at || row.rewarded_at)}</span>,
    },
    {
      key: "referrer",
      label: "Referrer",
      width: "24%",
      render: (row) => (
        <span className="mono cell-sub">
          {row.referrer_phone || row.referrer_user_id || row.referrer_id || "—"}
        </span>
      ),
    },
    {
      key: "referee",
      label: "Referred",
      width: "24%",
      render: (row) => (
        <span className="mono cell-sub">
          {row.referee_phone || row.referee_user_id || row.referee_id || "—"}
        </span>
      ),
    },
    {
      key: "amount",
      label: "Reward",
      align: "right",
      width: "18%",
      render: (row) => (
        <span className="mono">
          {fmtAmount(row.reward_amount ?? row.amount, row.currency || form?.currency)}
        </span>
      ),
    },
    {
      key: "state",
      label: "Status",
      width: "16%",
      render: (row) => (
        <Chip tone={row.status === "paid" || row.status === "credited" ? "ok" : "wait"}>
          {row.status || row.trigger_event || "recorded"}
        </Chip>
      ),
    },
  ];

  return (
    <>
      <div className="page__head">
        <h1>Referral rewards</h1>
        <p>Pay a fixed amount when a referred account hits the trigger event.</p>
      </div>

      <div className="panel" style={{ marginTop: 14, maxWidth: 760 }}>
        <div className="panel__head">
          <h2>Programme settings</h2>
          <div className="actions">
            <Chip tone={live?.enabled ? "ok" : "wait"}>{live?.enabled ? "Running" : "Paused"}</Chip>
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

        {settingsFeed.loading ? (
          <div className="skel" style={{ margin: 16 }} />
        ) : settingsFeed.error ? (
          <div className="formnote formnote--warn" style={{ margin: 16 }}>
            {settingsFeed.error}
          </div>
        ) : form ? (
          <>
            <div className="formgrid">
              <Field label="Status">
                <label className="switchrow">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => set("enabled")(event.target.checked)}
                  />
                  <span>
                    <b>{form.enabled ? "Rewards are paid" : "Paused"}</b>
                    <span>Pausing stops new rewards; existing ones stay on the ledger.</span>
                  </span>
                </label>
              </Field>
              <Field label="Trigger">
                <select
                  value={form.triggerEvent}
                  onChange={(event) => set("triggerEvent")(event.target.value)}
                >
                  {TRIGGERS.map((trigger) => (
                    <option key={trigger} value={trigger}>
                      {trigger.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reward amount">
                <input
                  value={form.rewardAmount}
                  onChange={(event) => set("rewardAmount")(event.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  className="mono"
                />
              </Field>
              <Field label="Reward currency">
                <input
                  value={form.currency}
                  onChange={(event) => set("currency")(event.target.value.toUpperCase())}
                  maxLength={8}
                  className="mono"
                />
              </Field>
              <Field label="Max rewards per referrer" hint="0 means unlimited.">
                <input
                  value={form.maxRewardsPerUser}
                  onChange={(event) => set("maxRewardsPerUser")(event.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  className="mono"
                />
              </Field>
            </div>
            {error ? <div className="formnote formnote--warn">{error}</div> : null}
            <div className="actions" style={{ padding: "0 18px 18px" }}>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>
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
              <span>Trigger</span>
              <b>{String(live?.triggerEvent || "—").replaceAll("_", " ")}</b>
            </div>
            <div className="frow">
              <span>Reward</span>
              <b>{fmtAmount(live?.rewardAmount, live?.currency)}</b>
            </div>
            <div className="frow">
              <span>Max per referrer</span>
              <b>{Number(live?.maxRewardsPerUser) === 0 ? "unlimited" : live?.maxRewardsPerUser}</b>
            </div>
            <div className="frow">
              <span>Status</span>
              <b>{live?.enabled ? "paying" : "paused"}</b>
            </div>
          </div>
        )}
      </div>

      <div className="tablewrap" style={{ marginTop: 12 }}>
        <DataTable
          columns={columns}
          rows={rewards}
          rowKey={(row) => row.id || `${row.created_at}-${row.referee_user_id}`}
          loading={history.loading}
          error={history.error}
          onRetry={history.reload}
          empty={<EmptyState title="No rewards paid yet">The first trigger will show up here.</EmptyState>}
          footer={
            <div className="tfoot">
              <span>
                Showing <b>{rewards.length}</b> recent rewards
              </span>
            </div>
          }
        />
      </div>
    </>
  );
}
