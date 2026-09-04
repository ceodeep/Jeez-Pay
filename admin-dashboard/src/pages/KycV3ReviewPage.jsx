import { useEffect, useMemo, useState } from "react";
import api from "../lib/api";

const CHECKS = [
  ["document_verification", "Document verification"],
  ["liveness", "Liveness / face match"],
  ["sanctions", "Sanctions screening"],
  ["pep", "PEP screening"],
  ["adverse_media", "Adverse media"],
];

function badge(value) {
  const v = String(value || "unknown").toLowerCase();
  const palette = v.includes("high") || v.includes("failed") || v.includes("match") || v.includes("rejected")
    ? ["#fee2e2", "#991b1b"]
    : v.includes("approved") || v.includes("clear") || v.includes("verified") || v.includes("low")
      ? ["#dcfce7", "#166534"]
      : ["#fef3c7", "#92400e"];
  return <span style={{ padding: "5px 9px", borderRadius: 999, background: palette[0], color: palette[1], fontWeight: 700, fontSize: 12 }}>{value || "-"}</span>;
}

const panel = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 18,
  boxShadow: "0 8px 30px rgba(15,23,42,.05)",
};

function Field({ label, value }) {
  return (
    <div>
      <div style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ color: "#0f172a", fontSize: 14, wordBreak: "break-word" }}>{value ?? "-"}</div>
    </div>
  );
}

export default function KycV3ReviewPage() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [workflow, setWorkflow] = useState("submitted");
  const [risk, setRisk] = useState("");
  const [assignment, setAssignment] = useState("");
  const [cursorSeq, setCursorSeq] = useState(null);
  const [nextCursorSeq, setNextCursorSeq] = useState(null);
  const [history, setHistory] = useState([]);
  const [reviewReason, setReviewReason] = useState("");
  const [requiredAction, setRequiredAction] = useState("");
  const [checkDrafts, setCheckDrafts] = useState({});

  const checksByType = useMemo(() => {
    const map = {};
    for (const row of detail?.checks || []) if (!map[row.check_type]) map[row.check_type] = row;
    return map;
  }, [detail]);

  async function loadQueue(cursor = null, append = false) {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (workflow) params.set("workflow", workflow);
      if (risk) params.set("risk", risk);
      if (assignment) params.set("assignedTo", assignment);
      if (cursor) params.set("cursorSeq", String(cursor));
      const res = await api.get(`/admin/kyc/v3/list?${params.toString()}`);
      const rows = res.data?.items || [];
      setItems((prev) => append ? [...prev, ...rows] : rows);
      setNextCursorSeq(res.data?.pagination?.nextCursorSeq ?? null);
      if (!append) setCursorSeq(null);
    } catch (err) {
      if (err?.response?.status === 401) window.location.href = "/";
      setMessage(err?.response?.data?.message || "Failed to load KYC review queue");
    } finally {
      setLoading(false);
    }
  }

  async function openApplication(item) {
    setSelected(item);
    setDetail(null);
    setDetailLoading(true);
    setMessage("");
    try {
      const res = await api.get(`/admin/kyc/v3/${item.id}`);
      setDetail(res.data);
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to load KYC application");
    } finally {
      setDetailLoading(false);
    }
  }

  async function claim() {
    if (!selected) return;
    try {
      await api.post(`/admin/kyc/v3/${selected.id}/claim`, {});
      await openApplication(selected);
      await loadQueue();
      setMessage("Application assigned to you");
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to claim application");
    }
  }

  async function recordCheck(type) {
    if (!detail?.application?.user_id) return;
    const draft = checkDrafts[type] || {};
    if (!draft.status) return setMessage("Choose a check result first");
    try {
      await api.post(`/admin/kyc/v3/${detail.application.user_id}/checks`, {
        checkType: type,
        status: draft.status,
        provider: draft.provider || "manual",
        providerReference: draft.providerReference || null,
        notes: draft.notes || null,
        details: type === "liveness" && draft.status === "manual_verified"
          ? { attendedSession: Boolean(draft.attendedSession) }
          : {},
      });
      await openApplication(selected);
      setMessage("KYC check recorded");
    } catch (err) {
      setMessage(err?.response?.data?.message || "Failed to record KYC check");
    }
  }

  async function decide(decision) {
    if (!detail?.application?.user_id) return;
    if ((decision === "rejected" || decision === "needs-more-info") && !reviewReason.trim()) {
      return setMessage("A clear reviewer reason is required");
    }
    const path = decision === "needs-more-info" ? "needs-more-info" : decision;
    try {
      const res = await api.post(`/admin/kyc/v3/${detail.application.user_id}/${path}`, {
        reason: reviewReason.trim() || null,
        requiredAction: requiredAction.trim() || null,
      });
      setMessage(res.data?.message || `KYC ${decision}`);
      setReviewReason("");
      setRequiredAction("");
      await openApplication(selected);
      await loadQueue();
    } catch (err) {
      setMessage(err?.response?.data?.message || err?.response?.data?.code || "KYC decision failed");
    }
  }

  useEffect(() => { loadQueue(); }, [workflow, risk, assignment]);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a", fontFamily: "Inter, system-ui, sans-serif" }}>
      <header style={{ background: "#0f172a", color: "#fff", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>JeezPay KYC Review Workspace</div>
          <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 3 }}>CDD · document verification · liveness · sanctions · PEP · risk · audit trail</div>
        </div>
        <button onClick={() => { window.location.href = "/"; }} style={{ border: "1px solid #475569", background: "transparent", color: "#fff", padding: "9px 12px", borderRadius: 10, cursor: "pointer" }}>Back to admin</button>
      </header>

      {message && <div style={{ margin: "14px 20px 0", padding: 12, background: "#eff6ff", color: "#1e3a8a", borderRadius: 12 }}>{message}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(330px, 420px) minmax(0, 1fr)", gap: 16, padding: 20, alignItems: "start" }}>
        <aside style={{ ...panel, padding: 14, position: "sticky", top: 12, maxHeight: "calc(100vh - 100px)", overflow: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong>Review queue</strong>
            <button onClick={() => loadQueue()} style={{ border: 0, background: "#e2e8f0", padding: "7px 10px", borderRadius: 8, cursor: "pointer" }}>Refresh</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <select value={workflow} onChange={(e) => setWorkflow(e.target.value)} style={{ padding: 9, borderRadius: 9, border: "1px solid #cbd5e1" }}>
              <option value="">All workflow states</option><option value="submitted">Submitted</option><option value="in_review">In review</option><option value="needs_more_info">Needs more info</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
            </select>
            <select value={risk} onChange={(e) => setRisk(e.target.value)} style={{ padding: 9, borderRadius: 9, border: "1px solid #cbd5e1" }}>
              <option value="">All risk</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
            <select value={assignment} onChange={(e) => setAssignment(e.target.value)} style={{ padding: 9, borderRadius: 9, border: "1px solid #cbd5e1", gridColumn: "1 / -1" }}>
              <option value="">All assignments</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option>
            </select>
          </div>

          {loading && items.length === 0 ? <p>Loading…</p> : items.map((item) => (
            <button key={item.id} onClick={() => openApplication(item)} style={{ width: "100%", textAlign: "left", padding: 12, marginBottom: 8, borderRadius: 12, border: selected?.id === item.id ? "2px solid #2563eb" : "1px solid #e2e8f0", background: "#fff", cursor: "pointer" }}>
              <div style={{ fontWeight: 800 }}>{item.full_name}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 7, flexWrap: "wrap" }}>{badge(item.workflow_status)} {badge(item.risk_rating)}</div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 7 }}>{item.nationality} · resident {item.residence_country} · v{item.application_version}</div>
              {item.assigned_to && <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>Assigned</div>}
            </button>
          ))}
          {nextCursorSeq && <button onClick={() => { setCursorSeq(nextCursorSeq); loadQueue(nextCursorSeq, true); }} disabled={loading} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>{loading ? "Loading…" : "Load more"}</button>}
        </aside>

        <main>
          {!selected ? <div style={{ ...panel, padding: 30, color: "#64748b" }}>Select an application to begin review.</div> : detailLoading ? <div style={{ ...panel, padding: 30 }}>Loading application…</div> : detail ? (
            <div style={{ display: "grid", gap: 14 }}>
              <section style={{ ...panel, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
                  <div><h2 style={{ margin: 0 }}>{detail.application.full_name}</h2><div style={{ color: "#64748b", marginTop: 5 }}>Application v{detail.application.application_version} · #{detail.application.review_seq}</div></div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{badge(detail.application.workflow_status)} {badge(detail.application.risk_rating)} {badge(detail.application.assurance_level)}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14, marginTop: 18 }}>
                  <Field label="User" value={detail.application.user_id} /><Field label="Phone" value={detail.user?.phone} /><Field label="Nationality" value={detail.application.nationality} /><Field label="Residence" value={detail.application.residence_country} />
                  <Field label="DOB" value={detail.application.dob} /><Field label="Occupation" value={detail.application.occupation} /><Field label="Employment" value={detail.application.employment_status} /><Field label="Purpose" value={detail.application.account_purpose} />
                  <Field label="Source of funds" value={(detail.application.source_of_funds || []).join(", ")} /><Field label="Source of wealth" value={detail.application.source_of_wealth} /><Field label="Tax residencies" value={(detail.application.tax_residencies || []).join(", ")} /><Field label="Expected activity" value={`${detail.application.expected_monthly_volume_band} / ${detail.application.expected_monthly_tx_count_band || "-"}`} />
                  <Field label="PEP self-declared" value={detail.application.pep_self_declared ? "Yes" : "No"} /><Field label="PEP related" value={detail.application.pep_related_declared ? "Yes" : "No"} /><Field label="Risk score" value={detail.application.risk_score} /><Field label="Next review" value={detail.application.next_review_at} />
                </div>
                <button onClick={claim} style={{ marginTop: 16, border: 0, background: "#0f172a", color: "#fff", padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Claim / start review</button>
              </section>

              <section style={{ ...panel, padding: 18 }}>
                <h3 style={{ marginTop: 0 }}>Government document & evidence</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14 }}>
                  <Field label="Type" value={detail.document?.documentType} /><Field label="Issuing country" value={detail.document?.issuingCountry} /><Field label="Document ending" value={detail.document?.documentLast4 ? `•••• ${detail.document.documentLast4}` : "-"} /><Field label="Expiry" value={detail.document?.noExpiry ? "No expiry" : detail.document?.expiryDate} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12, marginTop: 14 }}>
                  {(detail.evidence || []).map((e) => <div key={e.id} style={{ border: "1px solid #e2e8f0", padding: 10, borderRadius: 12 }}><div style={{ fontWeight: 700, marginBottom: 8 }}>{e.evidenceType}</div>{e.signedUrl ? <a href={e.signedUrl} target="_blank" rel="noreferrer">Open secure evidence</a> : <span style={{ color: "#94a3b8" }}>Unavailable</span>}</div>)}
                </div>
              </section>

              <section style={{ ...panel, padding: 18 }}>
                <h3 style={{ marginTop: 0 }}>Verification & screening</h3>
                <div style={{ display: "grid", gap: 10 }}>
                  {CHECKS.map(([type, label]) => {
                    const current = checksByType[type];
                    const draft = checkDrafts[type] || {};
                    const statuses = type === "document_verification" || type === "liveness"
                      ? ["verified", "manual_verified", "failed", "inconclusive"]
                      : type === "pep"
                        ? ["clear", "manual_clear", "potential_match", "confirmed_pep", "inconclusive"]
                        : ["clear", "manual_clear", "potential_match", "confirmed_match", "inconclusive", "not_applicable"];
                    return <div key={type} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><strong>{label}</strong>{badge(current?.status || "pending")}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr auto", gap: 8, marginTop: 10 }}>
                        <select value={draft.status || ""} onChange={(e) => setCheckDrafts((p) => ({ ...p, [type]: { ...p[type], status: e.target.value } }))} style={{ padding: 9, borderRadius: 8, border: "1px solid #cbd5e1" }}><option value="">Select result</option>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}</select>
                        <input placeholder="Provider / manual" value={draft.provider || ""} onChange={(e) => setCheckDrafts((p) => ({ ...p, [type]: { ...p[type], provider: e.target.value } }))} style={{ padding: 9, borderRadius: 8, border: "1px solid #cbd5e1" }} />
                        <input placeholder="Reviewer notes" value={draft.notes || ""} onChange={(e) => setCheckDrafts((p) => ({ ...p, [type]: { ...p[type], notes: e.target.value } }))} style={{ padding: 9, borderRadius: 8, border: "1px solid #cbd5e1" }} />
                        <button onClick={() => recordCheck(type)} style={{ border: 0, background: "#e2e8f0", padding: "8px 12px", borderRadius: 8, cursor: "pointer" }}>Record</button>
                      </div>
                    </div>;
                  })}
                </div>
              </section>

              <section style={{ ...panel, padding: 18 }}>
                <h3 style={{ marginTop: 0 }}>Decision</h3>
                <textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} placeholder="Required for rejection or more-information request. Be specific and customer-actionable." rows={3} style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #cbd5e1", borderRadius: 10 }} />
                <input value={requiredAction} onChange={(e) => setRequiredAction(e.target.value)} placeholder="Required action (for example: recapture_document_front)" style={{ width: "100%", boxSizing: "border-box", marginTop: 8, padding: 10, border: "1px solid #cbd5e1", borderRadius: 10 }} />
                <div style={{ display: "flex", gap: 9, marginTop: 12, flexWrap: "wrap" }}>
                  <button onClick={() => decide("approved")} style={{ border: 0, background: "#166534", color: "#fff", padding: "10px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 700 }}>Approve</button>
                  <button onClick={() => decide("needs-more-info")} style={{ border: 0, background: "#d97706", color: "#fff", padding: "10px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 700 }}>Request more info</button>
                  <button onClick={() => decide("rejected")} style={{ border: 0, background: "#b91c1c", color: "#fff", padding: "10px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 700 }}>Reject</button>
                </div>
              </section>

              <section style={{ ...panel, padding: 18 }}>
                <h3 style={{ marginTop: 0 }}>Immutable review timeline</h3>
                <div style={{ display: "grid", gap: 8 }}>{(detail.timeline || []).map((e) => <div key={e.id} style={{ padding: 10, borderLeft: "3px solid #94a3b8", background: "#f8fafc" }}><strong>{e.event_type}</strong> · {e.from_status || "-"} → {e.to_status}<div style={{ color: "#64748b", fontSize: 12, marginTop: 3 }}>{e.created_at}{e.reason ? ` · ${e.reason}` : ""}</div></div>)}</div>
              </section>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
