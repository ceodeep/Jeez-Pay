import {
  useCallback,
  useEffect,
  useState,
} from "react";

import api from "../lib/api";

function formatDate(value) {
  if (!value) return "Not yet";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

const buttonStyle = {
  border: 0,
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 700,
  cursor: "pointer",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: "11px 12px",
  fontSize: 14,
  outline: "none",
};

export default function AdminMfaSetup() {
  const [status, setStatus] = useState(null);
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState(null);
  const [token, setToken] = useState("");
  const [recoveryCodes, setRecoveryCodes] =
    useState([]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.get(
        "/admin/mfa/status"
      );

      setStatus(
        res.data?.mfa || null
      );
    } catch (err) {
      setMessage(
        err?.response?.data?.message ||
          "Unable to load MFA status."
      );
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function startEnrollment() {
    if (!password) {
      setMessage(
        "Enter your current password first."
      );
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await api.post(
        "/admin/mfa/enroll/start",
        {
          password,
        }
      );

      const value =
        res.data?.setup || null;

      if (
        !value?.secret ||
        !value?.otpauthUri
      ) {
        throw new Error(
          "Invalid MFA setup response"
        );
      }

      setSetup(value);
      setPassword("");
      setToken("");
      setRecoveryCodes([]);

      setMessage(
        "Authenticator setup created. Add the key to your authenticator app, then enter its 6-digit code."
      );

      await loadStatus();
    } catch (err) {
      setMessage(
        err?.response?.data?.message ||
          err?.message ||
          "Unable to start MFA enrollment."
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirmEnrollment() {
    if (!/^\d{6}$/.test(token)) {
      setMessage(
        "Enter the 6-digit code from your authenticator app."
      );
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await api.post(
        "/admin/mfa/enroll/confirm",
        {
          token,
        }
      );

      const codes =
        Array.isArray(
          res.data?.recoveryCodes
        )
          ? res.data.recoveryCodes
          : [];

      if (codes.length !== 10) {
        throw new Error(
          "Recovery codes were not returned correctly"
        );
      }

      setRecoveryCodes(codes);
      setSetup(null);
      setToken("");

      setMessage(
        "MFA is enabled. Save the recovery codes now; they will not be shown again."
      );

      await loadStatus();
    } catch (err) {
      setMessage(
        err?.response?.data?.message ||
          err?.message ||
          "Unable to confirm MFA enrollment."
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyText(
    value,
    label
  ) {
    try {
      await navigator.clipboard.writeText(
        value
      );

      setMessage(
        `${label} copied.`
      );
    } catch {
      setMessage(
        `Could not copy ${label.toLowerCase()}. Select it manually instead.`
      );
    }
  }

  const enabled =
    status?.enabled === true;

  return (
    <section
      style={{
        marginBottom: 24,
        background: "#ffffff",
        border:
          enabled
            ? "1px solid #bbf7d0"
            : "1px solid #fde68a",
        borderRadius: 18,
        padding: 20,
        boxShadow:
          "0 6px 24px rgba(15, 23, 42, 0.05)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              color: "#64748b",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              marginBottom: 5,
            }}
          >
            Admin security
          </div>

          <h2
            style={{
              margin: 0,
              color: "#0f172a",
              fontSize: 20,
            }}
          >
            Multi-factor authentication
          </h2>
        </div>

        <span
          style={{
            borderRadius: 999,
            padding: "7px 11px",
            fontSize: 12,
            fontWeight: 800,
            background:
              enabled
                ? "#dcfce7"
                : "#fef3c7",
            color:
              enabled
                ? "#166534"
                : "#92400e",
          }}
        >
          {enabled
            ? "Enabled"
            : "Setup required"}
        </span>
      </div>

      {message ? (
        <div
          role="status"
          style={{
            marginTop: 16,
            padding: "11px 13px",
            borderRadius: 10,
            background: "#f1f5f9",
            color: "#334155",
            fontSize: 14,
          }}
        >
          {message}
        </div>
      ) : null}

      {recoveryCodes.length > 0 ? (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontWeight: 800,
              color: "#991b1b",
              marginBottom: 8,
            }}
          >
            Save these recovery codes now
          </div>

          <p
            style={{
              color: "#475569",
              fontSize: 14,
              marginTop: 0,
            }}
          >
            Each code works once. Keep them
            offline in a secure location. They
            cannot be viewed again after leaving
            this page.
          </p>

          <pre
            style={{
              background: "#0f172a",
              color: "#f8fafc",
              padding: 16,
              borderRadius: 12,
              overflowX: "auto",
              lineHeight: 1.8,
              fontSize: 15,
            }}
          >
            {recoveryCodes.join("\n")}
          </pre>

          <button
            type="button"
            onClick={() =>
              copyText(
                recoveryCodes.join("\n"),
                "Recovery codes"
              )
            }
            style={{
              ...buttonStyle,
              background: "#0f172a",
              color: "#ffffff",
            }}
          >
            Copy recovery codes
          </button>
        </div>
      ) : enabled ? (
        <div
          style={{
            marginTop: 18,
            display: "grid",
            gap: 8,
            color: "#475569",
            fontSize: 14,
          }}
        >
          <div>
            Authenticator MFA is active for
            this admin account.
          </div>

          <div>
            Enabled:{" "}
            <strong>
              {formatDate(
                status?.enabledAt
              )}
            </strong>
          </div>

          <div>
            Current session verified:{" "}
            <strong>
              {formatDate(
                status?.sessionVerifiedAt
              )}
            </strong>
          </div>

          <div>
            Unused recovery codes:{" "}
            <strong>
              {
                status
                  ?.recoveryCodesRemaining
              }
            </strong>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <p
            style={{
              color: "#475569",
              lineHeight: 1.6,
              fontSize: 14,
            }}
          >
            Protect administrative access with
            an authenticator app such as Google
            Authenticator, Microsoft
            Authenticator, 2FAS, or another
            standard TOTP application.
          </p>

          {!setup ? (
            <div
              style={{
                maxWidth: 520,
                display: "grid",
                gap: 10,
              }}
            >
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                Current password
              </label>

              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value
                  )
                }
                disabled={loading}
                style={inputStyle}
              />

              <div>
                <button
                  type="button"
                  onClick={
                    startEnrollment
                  }
                  disabled={loading}
                  style={{
                    ...buttonStyle,
                    background: "#0f172a",
                    color: "#ffffff",
                    opacity:
                      loading ? 0.6 : 1,
                  }}
                >
                  {loading
                    ? "Preparing…"
                    : status
                        ?.enrollmentStarted
                      ? "Restart MFA setup"
                      : "Set up MFA"}
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: 16,
                maxWidth: 680,
              }}
            >
              <div
                style={{
                  background: "#f8fafc",
                  border:
                    "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    color: "#0f172a",
                    marginBottom: 10,
                  }}
                >
                  Add JeezPay Admin to your
                  authenticator
                </div>

                <div
                  style={{
                    fontSize: 13,
                    color: "#64748b",
                    marginBottom: 4,
                  }}
                >
                  Account
                </div>

                <div
                  style={{
                    color: "#0f172a",
                    marginBottom: 14,
                    wordBreak:
                      "break-all",
                  }}
                >
                  {setup.accountLabel}
                </div>

                <div
                  style={{
                    fontSize: 13,
                    color: "#64748b",
                    marginBottom: 5,
                  }}
                >
                  Setup key
                </div>

                <code
                  style={{
                    display: "block",
                    padding: 12,
                    borderRadius: 9,
                    background: "#e2e8f0",
                    color: "#0f172a",
                    fontSize: 15,
                    fontWeight: 800,
                    wordBreak:
                      "break-all",
                  }}
                >
                  {setup.secret}
                </code>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    marginTop: 12,
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        setup.secret,
                        "Setup key"
                      )
                    }
                    style={{
                      ...buttonStyle,
                      background: "#e2e8f0",
                      color: "#0f172a",
                    }}
                  >
                    Copy setup key
                  </button>

                  <a
                    href={
                      setup.otpauthUri
                    }
                    style={{
                      ...buttonStyle,
                      display:
                        "inline-block",
                      background: "#e2e8f0",
                      color: "#0f172a",
                      textDecoration:
                        "none",
                    }}
                  >
                    Open authenticator app
                  </a>
                </div>
              </div>

              <label
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#334155",
                }}
              >
                6-digit authenticator code
              </label>

              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={token}
                onChange={(event) =>
                  setToken(
                    event.target.value
                      .replace(
                        /\D/g,
                        ""
                      )
                      .slice(0, 6)
                  )
                }
                disabled={loading}
                placeholder="000000"
                style={{
                  ...inputStyle,
                  maxWidth: 220,
                  letterSpacing: 5,
                  fontSize: 18,
                  fontWeight: 800,
                }}
              />

              <div>
                <button
                  type="button"
                  onClick={
                    confirmEnrollment
                  }
                  disabled={
                    loading ||
                    token.length !== 6
                  }
                  style={{
                    ...buttonStyle,
                    background: "#16a34a",
                    color: "#ffffff",
                    opacity:
                      loading ||
                      token.length !== 6
                        ? 0.6
                        : 1,
                  }}
                >
                  {loading
                    ? "Verifying…"
                    : "Verify and enable MFA"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
