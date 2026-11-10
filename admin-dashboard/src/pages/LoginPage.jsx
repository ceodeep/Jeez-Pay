import { useState } from "react";

import api from "../lib/api";

export default function LoginPage({ onLogin }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [challengeToken, setChallengeToken] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function finishLogin(token) {
    if (!token) throw new Error("Authentication token missing");
    localStorage.setItem("admin_token", token);
    onLogin(token);
  }

  async function submitPassword(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/login", {
        identifier: identifier.trim(),
        password,
      });

      if (res.data?.mfaRequired) {
        if (!res.data?.challengeToken) throw new Error("MFA challenge missing");
        setChallengeToken(res.data.challengeToken);
        setPassword("");
        setMfaCode("");
        setRecoveryCode("");
        setUseRecovery(false);
        return;
      }

      finishLogin(res.data?.token);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function submitMfa(event) {
    event.preventDefault();

    if (!useRecovery && !/^\d{6}$/.test(mfaCode)) {
      setError("Enter the 6-digit authenticator code.");
      return;
    }
    if (useRecovery && !recoveryCode.trim()) {
      setError("Enter one recovery code.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const body = { challengeToken };
      if (useRecovery) body.recoveryCode = recoveryCode.trim();
      else body.token = mfaCode;

      const res = await api.post("/auth/admin-mfa/verify-login", body);
      finishLogin(res.data?.token);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "MFA verification failed");
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

  const mfaMode = !!challengeToken;

  return (
    <div className="login">
      <aside className="login__brand">
        <div className="login__brandtop">
          <div className="login__brandmark">J</div>
          <div>
            <span className="login__word">JeezPay</span>
            <span className="login__kicker">Admin console</span>
          </div>
        </div>

        <div className="login__brandmid">
          <p className="login__live">
            <i />
            Production
          </p>
          <div className="login__pitch">
            <h2>Work the queue, not the dashboard.</h2>
            <p>
              KYC decisions, payouts, merchant requests and the ledgers behind them — one console for the
              people who clear the work.
            </p>
            <ul className="login__facts">
              <li>
                <i />
                <span>
                  <b>Every decision is audited</b> with operator, target and IP.
                </span>
              </li>
              <li>
                <i />
                <span>
                  <b>Payout approvals broadcast on-chain</b> and cannot be undone.
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="login__foot">
          Restricted access · sessions expire automatically · sign out on shared machines
        </div>
      </aside>

      <main className="login__panel">
        <div className="login__card">
          <div className="login__form">
            <h1 className="login__title">{mfaMode ? "Two-factor check" : "Sign in"}</h1>
            <p className="login__sub">
              {mfaMode
                ? "Password accepted. Enter the current code from your authenticator app."
                : "Admin email or phone number. You’ll confirm a 6-digit code next."}
            </p>

          {!mfaMode ? (
            <form onSubmit={submitPassword} noValidate>
              <div className="login__field">
                <label className="login__label" htmlFor="login-id">
                  Email or phone
                </label>
                <input
                  id="login-id"
                  className="login__input mono"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="you@jeezpay.co or +211…"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck="false"
                  required
                />
              </div>

              <div className="login__field">
                <div className="login__labelrow">
                  <label className="login__label" htmlFor="login-password">
                    Password
                  </label>
                  <button
                    type="button"
                    className="login__reveal"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  id="login-password"
                  className="login__input"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
              </div>

              {error ? <div className="login__error" role="alert">{error}</div> : null}

              <button type="submit" className="login__submit" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </button>

              <p className="login__hintline">
                Locked out? A super admin has to reset the password — a reset also ends open sessions.
              </p>
            </form>
          ) : (
            <form onSubmit={submitMfa} noValidate>
              {!useRecovery ? (
                <div className="login__field">
                  <label className="login__label" htmlFor="login-otp">
                    Authenticator code
                  </label>
                  <input
                    id="login-otp"
                    className="login__input login__otp"
                    value={mfaCode}
                    onChange={(event) =>
                      setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                  />
                </div>
              ) : (
                <div className="login__field">
                  <label className="login__label" htmlFor="login-recovery">
                    Recovery code
                  </label>
                  <input
                    id="login-recovery"
                    className="login__input mono"
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value)}
                    autoComplete="off"
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                  />
                </div>
              )}

              {error ? <div className="login__error" role="alert">{error}</div> : null}

              <button type="submit" className="login__submit" disabled={loading}>
                {loading ? "Verifying…" : "Verify and sign in"}
              </button>

              <div className="login__alt">
                <button
                  type="button"
                  className="login__link"
                  onClick={() => {
                    setUseRecovery((prev) => !prev);
                    setError("");
                  }}
                >
                  {useRecovery ? "Use authenticator code" : "Use a recovery code"}
                </button>
                <button
                  type="button"
                  className="login__link login__link--quiet"
                  onClick={restartLogin}
                  disabled={loading}
                >
                  Back to password
                </button>
              </div>
            </form>
          )}
          </div>
        </div>
      </main>
    </div>
  );
}
