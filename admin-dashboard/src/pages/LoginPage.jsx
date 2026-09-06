import {
  useState,
} from "react";

import api from "../lib/api";

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box",
  height: 48,
  padding: "0 14px",
  borderRadius: 14,
  border: "1px solid #dbe2ea",
  background: "#f8fafc",
  color: "#0f172a",
  fontSize: 15,
  outline: "none",
};

export default function LoginPage({
  onLogin,
}) {
  const [
    identifier,
    setIdentifier,
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    challengeToken,
    setChallengeToken,
  ] = useState("");

  const [
    mfaCode,
    setMfaCode,
  ] = useState("");

  const [
    recoveryCode,
    setRecoveryCode,
  ] = useState("");

  const [
    useRecovery,
    setUseRecovery,
  ] = useState(false);

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  function finishLogin(token) {
    if (!token) {
      throw new Error(
        "Authentication token missing"
      );
    }

    localStorage.setItem(
      "admin_token",
      token
    );

    onLogin(token);
  }

  async function submitPassword(
    event
  ) {
    event.preventDefault();

    setLoading(true);
    setError("");

    try {
      const res =
        await api.post(
          "/auth/login",
          {
            identifier:
              identifier.trim(),

            password,
          }
        );

      if (
        res.data
          ?.mfaRequired
      ) {
        if (
          !res.data
            ?.challengeToken
        ) {
          throw new Error(
            "MFA challenge missing"
          );
        }

        setChallengeToken(
          res.data
            .challengeToken
        );

        setPassword("");
        setMfaCode("");
        setRecoveryCode("");
        setUseRecovery(false);

        return;
      }

      finishLogin(
        res.data?.token
      );
    } catch (err) {
      setError(
        err?.response
          ?.data?.message ||
          err?.message ||
          "Login failed"
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitMfa(
    event
  ) {
    event.preventDefault();

    if (
      !useRecovery &&
      !/^\d{6}$/.test(
        mfaCode
      )
    ) {
      setError(
        "Enter the 6-digit authenticator code."
      );

      return;
    }

    if (
      useRecovery &&
      !recoveryCode.trim()
    ) {
      setError(
        "Enter one recovery code."
      );

      return;
    }

    setLoading(true);
    setError("");

    try {
      const body = {
        challengeToken,
      };

      if (useRecovery) {
        body.recoveryCode =
          recoveryCode.trim();
      } else {
        body.token =
          mfaCode;
      }

      const res =
        await api.post(
          "/auth/admin-mfa/verify-login",
          body
        );

      finishLogin(
        res.data?.token
      );
    } catch (err) {
      setError(
        err?.response
          ?.data?.message ||
          err?.message ||
          "MFA verification failed"
      );
    } finally {
      setLoading(false);
    }
  }

  function restartLogin() {
    setChallengeToken("");
    setMfaCode("");
    setRecoveryCode("");
    setUseRecovery(false);
    setError("");
  }

  const mfaMode =
    !!challengeToken;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background:
          "linear-gradient(135deg, #0f172a 0%, #111827 35%, #e5e7eb 35%, #f8fafc 100%)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#ffffff",
          borderRadius: 24,
          padding: 32,
          boxShadow:
            "0 25px 60px rgba(15,23,42,0.16)",
          border:
            "1px solid rgba(15,23,42,0.06)",
        }}
      >
        <div
          style={{
            marginBottom: 28,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              background: "#0f172a",
              color: "#ffffff",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              fontSize: 18,
              marginBottom: 16,
            }}
          >
            JP
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              color: "#0f172a",
            }}
          >
            {mfaMode
              ? "Verify MFA"
              : "JeezPay Admin"}
          </h1>

          <p
            style={{
              margin:
                "8px 0 0",
              color: "#64748b",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {mfaMode
              ? "Password accepted. Complete multi-factor authentication to open the admin session."
              : "Sign in to manage JeezPay administrative operations."}
          </p>
        </div>

        {!mfaMode ? (
          <form
            onSubmit={
              submitPassword
            }
            style={{
              display: "grid",
              gap: 16,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#334155",
                }}
              >
                Email or phone
              </label>

              <input
                value={identifier}
                onChange={(e) =>
                  setIdentifier(
                    e.target.value
                  )
                }
                placeholder="admin@example.com or +211..."
                autoComplete="username"
                style={fieldStyle}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#334155",
                }}
              >
                Password
              </label>

              <input
                type="password"
                value={password}
                onChange={(e) =>
                  setPassword(
                    e.target.value
                  )
                }
                placeholder="Enter password"
                autoComplete="current-password"
                style={fieldStyle}
              />
            </div>

            {error ? (
              <div
                style={{
                  background: "#fef2f2",
                  color: "#b91c1c",
                  border:
                    "1px solid #fecaca",
                  padding:
                    "12px 14px",
                  borderRadius: 14,
                  fontSize: 14,
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              style={{
                height: 50,
                borderRadius: 14,
                border: "none",
                background:
                  loading
                    ? "#334155"
                    : "#0f172a",
                color: "#ffffff",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {loading
                ? "Signing in..."
                : "Sign in"}
            </button>
          </form>
        ) : (
          <form
            onSubmit={submitMfa}
            style={{
              display: "grid",
              gap: 16,
            }}
          >
            {!useRecovery ? (
              <div>
                <label
                  style={{
                    display:
                      "block",
                    marginBottom: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#334155",
                  }}
                >
                  Authenticator code
                </label>

                <input
                  value={mfaCode}
                  onChange={(e) =>
                    setMfaCode(
                      e.target.value
                        .replace(
                          /\D/g,
                          ""
                        )
                        .slice(
                          0,
                          6
                        )
                    )
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  style={{
                    ...fieldStyle,
                    letterSpacing: 5,
                    fontWeight: 800,
                    fontSize: 18,
                  }}
                />
              </div>
            ) : (
              <div>
                <label
                  style={{
                    display:
                      "block",
                    marginBottom: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#334155",
                  }}
                >
                  Recovery code
                </label>

                <input
                  value={
                    recoveryCode
                  }
                  onChange={(e) =>
                    setRecoveryCode(
                      e.target.value
                    )
                  }
                  autoComplete="off"
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  style={fieldStyle}
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setUseRecovery(
                  !useRecovery
                );
                setError("");
              }}
              style={{
                justifySelf:
                  "start",
                border: "none",
                background:
                  "transparent",
                color: "#334155",
                cursor: "pointer",
                padding: 0,
                fontWeight: 700,
              }}
            >
              {useRecovery
                ? "Use authenticator code"
                : "Use a recovery code"}
            </button>

            {error ? (
              <div
                style={{
                  background: "#fef2f2",
                  color: "#b91c1c",
                  border:
                    "1px solid #fecaca",
                  padding:
                    "12px 14px",
                  borderRadius: 14,
                  fontSize: 14,
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              style={{
                height: 50,
                borderRadius: 14,
                border: "none",
                background:
                  loading
                    ? "#334155"
                    : "#0f172a",
                color: "#ffffff",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {loading
                ? "Verifying..."
                : "Verify and sign in"}
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={
                restartLogin
              }
              style={{
                border: "none",
                background:
                  "transparent",
                color: "#64748b",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Back to password
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
