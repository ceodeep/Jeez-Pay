import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import "./KycReviewWorkspace.css";

const CHECK_LABELS = {
  document_authenticity: "Document authenticity",
  document_presence: "Live document presence",
  face_match: "Face match",
  liveness: "Liveness",
  database_identity: "Identity database",
  address: "Address verification",
  enhanced_due_diligence: "Enhanced due diligence",
};

const SCREENING_LABELS = {
  sanctions: "Sanctions",
  pep: "PEP",
  adverse_media: "Adverse media",
};

function fmt(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function badge(value, tone) {
  return <span className={`kyc-badge ${tone || String(value || "").toLowerCase()}`}>{value || "—"}</span>;
}

function Field({ label, value }) {
  return (
    <div className="kyc-field">
      <span>{label}</span>
      <strong>{value == null || value === "" ? "—" : String(value)}</strong>
    </div>
  );
}

function EvidenceCard({ label, url }) {
  return (
    <div className="kyc-evidence-card">
      <div className="kyc-evidence-label">{label}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="kyc-evidence-link">
          <img src={url} alt={label} />
          <span>Open full image</span>
        </a>
      ) : (
        <div className="kyc-empty-evidence">Not provided</div>
      )}
    </div>
  );
}

function ReviewerCheck({ userId, check, reload }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const isLiveness = check.check_type === "liveness";
  const passed = ["passed", "manual_passed"].includes(check.status);

  async function update(status) {
    setBusy(true);
    try {
      const evidence = {
        reviewerNote: note || undefined,
        reviewMethod: "trained_reviewer",
        ...(isLiveness && status === "manual_passed" ? { attendedSession: true } : {}),
      };
      await api.post(`/admin/kyc/${userId}/check`, {
        checkType: check.check_type,
        status,
        provider: "manual",
        resultCode: status === "manual_passed" ? "MANUAL_REVIEW_PASSED" : "MANUAL_REVIEW_FAILED",
        evidence,
      });
      await reload();
    } catch (error) {
      alert(error?.response?.data?.message || "Verification check update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kyc-check-row">
      <div>
        <strong>{CHECK_LABELS[check.check_type] || check.check_type}</strong>
        <div className="kyc-subtle">{check.provider || "manual"} · {check.result_code || "No result code"}</div>
      </div>
      <div>{badge(check.status, passed ? "clear" : check.status)}</div>
      <input
        className="kyc-small-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={isLiveness ? "Attended session evidence / note" : "Reviewer note"}
      />
      <div className="kyc-row-actions">
        <button disabled={busy} className="kyc-button kyc-button-secondary" onClick={() => update("manual_passed")}>
          {isLiveness ? "Pass attended check" : "Pass manually"}
        </button>
        <button disabled={busy} className="kyc-button kyc-button-danger-outline" onClick={() => update("failed")}>Fail</button>
      </div>
    </div>
  );
}

function ScreeningRow({ userId, screening, reload }) {
  const [status, setStatus] = useState(screening.status || "not_run");
  const [listVersion, setListVersion] = useState(screening.list_version || "");
  const [reference, setReference] = useState(screening.provider_reference || "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!listVersion.trim()) {
      alert("Enter the screening list/version or provider dataset version.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/kyc/${userId}/screening`, {
        screeningType: screening.screening_type,
        status,
        provider: screening.provider || "manual",
        providerReference: reference || null,
        listVersion,
        matchCount: ["potential_match", "confirmed_match"].includes(status) ? Math.max(1, screening.match_count || 1) : 0,
        resultSummary: { reviewedInWorkspace: true },
      });
      await reload();
    } catch (error) {
      alert(error?.response?.data?.message || "Screening update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kyc-screening-row">
      <strong>{SCREENING_LABELS[screening.screening_type] || screening.screening_type}</strong>
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="not_run">Not run</option>
        <option value="clear">Clear</option>
        <option value="potential_match">Potential match</option>
        <option value="reviewed">Reviewed / false positive cleared</option>
        <option value="confirmed_match">Confirmed match</option>
        <option value="unavailable">Unavailable</option>
      </select>
      <input value={listVersion} onChange={(e) => setListVersion(e.target.value)} placeholder="List / dataset version" />
      <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Provider reference (optional)" />
      <button disabled={busy} className="kyc-button kyc-button-secondary" onClick={save}>Save</button>
    </div>
  );
}

export default function KycReviewWorkspace() {
  const [items, setItems] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("pending");
  const [riskTier, setRiskTier] = useState("all");
  const [country, setCountry] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [decisionReason, setDecisionReason] = useState("");
  const [sensitiveNumber, setSensitiveNumber] = useState(null);

  const token = localStorage.getItem("admin_token");

  const handleUnauthorized = useCallback((error) => {
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      window.location.href = "/";
      return true;
    }
    return false;
  }, []);

  const loadQueue = useCallback(async ({ append = false, cursor = null } = {}) => {
    if (!token) {
      window.location.href = "/";
      return;
    }
    setLoading(true);
    try {
      const response = await api.get("/admin/kyc/list", {
        params: {
          status,
          riskTier,
          country: country || undefined,
          search: search.trim() || undefined,
          cursor: cursor || undefined,
          limit: 50,
        },
      });
      const rows = response.data?.kycs || [];
      setItems((old) => (append ? [...old, ...rows] : rows));
      setNextCursor(response.data?.page?.nextCursor || null);
      setHasMore(response.data?.page?.hasMore === true);
      if (!append && rows.length && !selectedUserId) setSelectedUserId(rows[0].user_id);
    } catch (error) {
      if (!handleUnauthorized(error)) alert(error?.response?.data?.message || "Failed to load KYC queue");
    } finally {
      setLoading(false);
    }
  }, [token, status, riskTier, country, search, selectedUserId, handleUnauthorized]);

  const loadDetail = useCallback(async (userId = selectedUserId) => {
    if (!userId) return;
    setDetailLoading(true);
    setSensitiveNumber(null);
    try {
      const response = await api.get(`/admin/kyc/${userId}/detail`);
      setDetail(response.data);
    } catch (error) {
      if (!handleUnauthorized(error)) alert(error?.response?.data?.message || "Failed to load KYC details");
    } finally {
      setDetailLoading(false);
    }
  }, [selectedUserId, handleUnauthorized]);

  useEffect(() => { loadQueue(); }, [status, riskTier, country]);
  useEffect(() => { if (selectedUserId) loadDetail(selectedUserId); }, [selectedUserId]);

  const app = detail?.application;
  const document = detail?.document;
  const providerChecks = detail?.providerChecks || [];
  const screenings = detail?.screenings || [];

  const approvalReadiness = useMemo(() => {
    const lookup = Object.fromEntries(providerChecks.map((x) => [x.check_type, x.status]));
    const screenLookup = Object.fromEntries(screenings.map((x) => [x.screening_type, x.status]));
    const pass = (s) => ["passed", "manual_passed"].includes(s);
    const screenPass = (s) => ["clear", "reviewed"].includes(s);
    return {
      document: ["verified", "manual_verified"].includes(document?.verificationStatus),
      face: pass(lookup.face_match),
      liveness: pass(lookup.liveness),
      sanctions: screenPass(screenLookup.sanctions),
      pep: screenPass(screenLookup.pep),
      edd: !app?.edd_required || pass(lookup.enhanced_due_diligence),
    };
  }, [providerChecks, screenings, document, app]);

  const readyToApprove = Object.values(approvalReadiness).every(Boolean);

  async function claim() {
    try {
      await api.post(`/admin/kyc/${selectedUserId}/claim`);
      await Promise.all([loadQueue(), loadDetail()]);
    } catch (error) {
      alert(error?.response?.data?.message || error?.response?.data?.code || "Failed to claim application");
    }
  }

  async function revealNumber() {
    if (!window.confirm("Reveal the full government ID number? This access is audit logged.")) return;
    try {
      const response = await api.get(`/admin/kyc/${selectedUserId}/document-number`);
      setSensitiveNumber(response.data?.documentNumber || null);
    } catch (error) {
      alert(error?.response?.data?.message || "Unable to reveal document number");
    }
  }

  async function decide(action) {
    const reasonRequired = action !== "approve";
    if (reasonRequired && !decisionReason.trim()) {
      alert("A specific reason is required.");
      return;
    }
    if (action === "approve" && !readyToApprove) {
      alert("Required verification, liveness, sanctions/PEP, or EDD checks are incomplete.");
      return;
    }
    if (!window.confirm(`Confirm KYC ${action.replaceAll("_", " ")}?`)) return;

    const endpoint = action === "more_info"
      ? `/admin/kyc/${selectedUserId}/request-more-info`
      : `/admin/kyc/${action}`;
    const body = action === "more_info"
      ? { reason: decisionReason }
      : { userId: selectedUserId, reason: decisionReason || undefined };

    try {
      await api.post(endpoint, body);
      setDecisionReason("");
      await Promise.all([loadQueue(), loadDetail()]);
    } catch (error) {
      alert(error?.response?.data?.message || error?.response?.data?.code || "KYC decision failed");
    }
  }

  function submitSearch(e) {
    e?.preventDefault();
    setSelectedUserId(null);
    loadQueue({ append: false, cursor: null });
  }

  if (!token) return null;

  return (
    <div className="kyc-workspace">
      <header className="kyc-workspace-header">
        <div>
          <button className="kyc-back-link" onClick={() => { window.location.href = "/"; }}>← Admin dashboard</button>
          <h1>Identity verification</h1>
          <p>International KYC reviewer workspace · evidence access and decisions are audited.</p>
        </div>
        <div className="kyc-header-badges">
          {badge("KYC V3", "clear")}
          {badge("Sensitive data", "review")}
        </div>
      </header>

      <form className="kyc-filterbar" onSubmit={submitSearch}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, account number or user UUID" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending / in review</option>
          <option value="all">All statuses</option>
          <option value="submitted">Submitted</option>
          <option value="in_review">In review</option>
          <option value="needs_more_info">Needs more info</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select value={riskTier} onChange={(e) => setRiskTier(e.target.value)}>
          <option value="all">All risk tiers</option>
          <option value="low">Low risk</option>
          <option value="medium">Medium risk</option>
          <option value="high">High risk / EDD</option>
          <option value="unassessed">Unassessed</option>
        </select>
        <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} placeholder="Country (ISO)" />
        <button className="kyc-button kyc-button-primary" type="submit">Search</button>
      </form>

      <main className="kyc-workspace-grid">
        <aside className="kyc-queue-panel">
          <div className="kyc-panel-title"><strong>Review queue</strong><span>{loading ? "Loading…" : `${items.length} shown`}</span></div>
          <div className="kyc-queue-list">
            {items.map((item) => (
              <button
                key={item.applicationId || `${item.user_id}-${item.applicationVersion}`}
                className={`kyc-queue-item ${selectedUserId === item.user_id ? "active" : ""}`}
                onClick={() => setSelectedUserId(item.user_id)}
              >
                <div className="kyc-queue-line"><strong>{item.fullName || item.user_id}</strong>{badge(item.workflowStatus || item.status)}</div>
                <div>{item.phone || "No phone"} · {item.residenceCountry || "Unknown country"}</div>
                <div className="kyc-queue-line"><span>Risk: {item.riskTier || "unassessed"}</span><span>{fmt(item.created_at)}</span></div>
              </button>
            ))}
            {!loading && items.length === 0 && <div className="kyc-empty">No KYC applications match these filters.</div>}
          </div>
          {hasMore && <button className="kyc-button kyc-button-secondary kyc-load-more" onClick={() => loadQueue({ append: true, cursor: nextCursor })}>Load more</button>}
        </aside>

        <section className="kyc-detail-panel">
          {!selectedUserId && <div className="kyc-empty">Select a KYC application.</div>}
          {selectedUserId && detailLoading && <div className="kyc-empty">Loading protected KYC evidence…</div>}
          {selectedUserId && !detailLoading && detail && (
            <>
              <div className="kyc-detail-header">
                <div>
                  <h2>{app?.full_name || selectedUserId}</h2>
                  <div className="kyc-subtle">{detail.user?.phone || "—"} · Account {detail.user?.wallet_account_number || "—"}</div>
                </div>
                <div className="kyc-detail-actions">
                  {badge(app?.workflow_status)}
                  {badge(app?.risk_tier || "unassessed")}
                  <button className="kyc-button kyc-button-secondary" onClick={claim}>Claim review</button>
                </div>
              </div>

              <div className="kyc-summary-grid">
                <Field label="Application" value={`v${app?.application_version || "?"} / schema ${app?.schema_version || "?"}`} />
                <Field label="Policy version" value={app?.policy_version} />
                <Field label="Submitted" value={fmt(app?.submitted_at)} />
                <Field label="Assigned reviewer" value={app?.assigned_to || "Unassigned"} />
                <Field label="Risk score" value={app?.risk_score} />
                <Field label="EDD required" value={app?.edd_required ? "Yes" : "No"} />
                <Field label="Screening" value={app?.screening_status} />
                <Field label="Provider status" value={app?.provider_status} />
              </div>

              <div className="kyc-section">
                <h3>Identity & residence</h3>
                <div className="kyc-fields-grid">
                  <Field label="Full legal name" value={app?.full_name} />
                  <Field label="Date of birth" value={app?.dob} />
                  <Field label="Nationality" value={app?.nationality} />
                  <Field label="Country of birth" value={app?.country_of_birth} />
                  <Field label="Residence country" value={app?.residence_country} />
                  <Field label="Address" value={[app?.address_line1, app?.address_line2, app?.city, app?.region, app?.postal_code].filter(Boolean).join(", ")} />
                </div>
              </div>

              <div className="kyc-section">
                <h3>Government document</h3>
                <div className="kyc-fields-grid">
                  <Field label="Type" value={document?.documentType} />
                  <Field label="Issuing country" value={document?.issuingCountry} />
                  <Field label="Document number" value={sensitiveNumber || (document?.documentNumberLast4 ? `•••• ${document.documentNumberLast4}` : "—")} />
                  <Field label="Issue date" value={document?.issueDate} />
                  <Field label="Expiry" value={document?.noExpiry ? "No expiry" : document?.expiryDate} />
                  <Field label="Verification" value={document?.verificationStatus} />
                </div>
                <button className="kyc-button kyc-button-secondary" onClick={revealNumber}>Reveal full document number</button>
                <div className="kyc-evidence-grid">
                  <EvidenceCard label="ID front" url={detail.evidence?.idFrontUrl} />
                  <EvidenceCard label="ID back" url={detail.evidence?.idBackUrl} />
                  <EvidenceCard label="Selfie" url={detail.evidence?.selfieUrl} />
                </div>
              </div>

              <div className="kyc-section">
                <h3>Financial profile & declarations</h3>
                <div className="kyc-fields-grid">
                  <Field label="Employment" value={app?.employment_status} />
                  <Field label="Occupation" value={app?.occupation} />
                  <Field label="Employer / business" value={app?.employer_name} />
                  <Field label="Source of funds" value={(app?.source_of_funds || []).join(", ")} />
                  <Field label="Source of wealth" value={app?.source_of_wealth} />
                  <Field label="Account purpose" value={app?.account_purpose} />
                  <Field label="Expected monthly volume" value={app?.expected_monthly_volume_band} />
                  <Field label="Expected monthly tx count" value={app?.expected_monthly_tx_count_band} />
                  <Field label="Self-declared PEP" value={app?.pep_self_declared ? "Yes" : "No"} />
                  <Field label="PEP family/associate" value={app?.pep_related_declared ? "Yes" : "No"} />
                </div>
              </div>

              <div className="kyc-section">
                <h3>Verification checks</h3>
                <p className="kyc-subtle">Manual liveness may only be marked passed after an actual attended video/in-person session. A still selfie is not liveness.</p>
                <div className="kyc-check-list">
                  {providerChecks.map((check) => <ReviewerCheck key={check.check_type} userId={selectedUserId} check={check} reload={loadDetail} />)}
                </div>
              </div>

              <div className="kyc-section">
                <h3>PEP / sanctions / adverse-media screening</h3>
                <div className="kyc-screening-list">
                  {screenings.map((screening) => <ScreeningRow key={screening.screening_type} userId={selectedUserId} screening={screening} reload={loadDetail} />)}
                </div>
              </div>

              <div className="kyc-section">
                <h3>Approval readiness</h3>
                <div className="kyc-readiness-grid">
                  {Object.entries(approvalReadiness).map(([key, ok]) => (
                    <div key={key} className={ok ? "ready" : "not-ready"}>{ok ? "✓" : "!"} {key}</div>
                  ))}
                </div>
              </div>

              <div className="kyc-section">
                <h3>Decision</h3>
                <textarea value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} placeholder="Reason / instructions to customer (required for reject or more information)" rows={4} />
                <div className="kyc-decision-actions">
                  <button className="kyc-button kyc-button-secondary" onClick={() => decide("more_info")}>Request more information</button>
                  <button className="kyc-button kyc-button-danger" onClick={() => decide("reject")}>Reject</button>
                  <button disabled={!readyToApprove} className="kyc-button kyc-button-primary" onClick={() => decide("approve")}>Approve</button>
                </div>
              </div>

              <div className="kyc-section">
                <h3>Review timeline</h3>
                <div className="kyc-timeline">
                  {(detail.reviewEvents || []).map((event) => (
                    <div className="kyc-timeline-row" key={event.id}>
                      <div>{badge(event.event_type)}</div>
                      <div><strong>{event.from_status || "start"} → {event.to_status}</strong><div>{event.reason || "No reason"}</div></div>
                      <div>{fmt(event.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
