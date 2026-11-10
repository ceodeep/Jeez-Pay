import { Fragment, useState } from "react";
import api from "../lib/api";
import { errText } from "../lib/format";
import { useApi } from "../lib/useApi";
import { Field } from "../ui/Bits";
import { toast } from "../lib/toast";

export default function RolesPage() {
  const feed = useApi(
    () => api.get("/admin/roles/permissions").then((res) => res.data),
    [],
    "Failed to load the role matrix"
  );

  const roles = feed.data?.roles || {};
  const all = feed.data?.allPermissions || [];
  const manageable = feed.data?.manageableRoles || Object.keys(roles);
  const roleNames = Object.keys(roles).filter((role) => role !== "user");

  const [assign, setAssign] = useState({ userId: "", role: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function has(role, permission) {
    const list = roles[role] || [];
    return list.includes("*") || list.includes(permission);
  }

  async function submitRole() {
    setBusy(true);
    setError("");
    try {
      await api.post("/admin/user/set-role", {
        userId: assign.userId.trim(),
        role: assign.role,
      });
      toast("Role updated");
      setAssign({ userId: "", role: "" });
    } catch (err) {
      setError(errText(err, "Could not change the role"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page__head">
        <h1>Roles &amp; permissions</h1>
        <p>
          Who can do what. The matrix is fixed in the API config — this screen is the reference; assign
          roles below.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel__head">
          <h2>Assign a role</h2>
          <span className="panel__hint">audited</span>
        </div>
        <div className="formgrid">
          <Field label="User ID" hint="The uuid from the Users screen, not the phone.">
            <input
              value={assign.userId}
              onChange={(event) => setAssign((prev) => ({ ...prev, userId: event.target.value }))}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="mono"
            />
          </Field>
          <Field label="New role">
            <select
              value={assign.role}
              onChange={(event) => setAssign((prev) => ({ ...prev, role: event.target.value }))}
            >
              <option value="">Choose a role…</option>
              {manageable.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {error ? <div className="formnote formnote--warn">{error}</div> : null}
        <div className="actions" style={{ padding: "0 18px 18px" }}>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !assign.userId.trim() || !assign.role}
            onClick={submitRole}
          >
            {busy ? "Saving…" : "Change role"}
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel__head">
          <h2>Permission matrix</h2>
          <span className="panel__hint">
            {all.length} permissions · ✓ granted · — not granted
            <span className="mobileonly"> · swipe to see every role →</span>
          </span>
        </div>
        {feed.error ? (
          <div className="formnote formnote--warn" style={{ margin: 16 }}>{feed.error}</div>
        ) : feed.loading ? (
          <div className="skel" style={{ margin: 16 }} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <div
              className="permgrid"
              style={{ "--perm-cols": roleNames.length || 1 }}
            >
              <div className="permhead">Permission</div>
              {roleNames.map((role) => (
                <div className="permhead" key={role}>{role.replaceAll("_", " ")}</div>
              ))}
              {all.map((permission) => (
                <Fragment key={permission}>
                  <div className="permcell mono">{permission}</div>
                  {roleNames.map((role) => (
                    <div className="permcell" key={`${role}-${permission}`}>
                      {has(role, permission) ? (
                        <span className="perm-yes" aria-label="allowed">
                          ✓
                        </span>
                      ) : (
                        <span className="perm-no" aria-label="not allowed">
                          —
                        </span>
                      )}
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
