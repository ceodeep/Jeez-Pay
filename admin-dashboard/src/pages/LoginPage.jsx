import { useState } from "react";
import api from "../lib/api";

export default function LoginPage({ onLogin }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await api.post("/auth/login", { phone, password });
      localStorage.setItem("admin_token", res.data.token);
      onLogin(res.data.token);
        } catch (err) {
      console.log("LOGIN ERROR:", err);
      console.log("LOGIN ERROR RESPONSE:", err?.response?.data);
      setError(
        err?.response?.data?.message ||
        err?.message ||
        "Login failed"
      );
    } finally {
      setLoading(false);
    }
  }

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
          boxShadow: "0 25px 60px rgba(15,23,42,0.16)",
          border: "1px solid rgba(15,23,42,0.06)",
        }}
      >
        <div style={{ marginBottom: 28 }}>
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
            JeezPay Admin
          </h1>

          <p
            style={{
              margin: "8px 0 0",
              color: "#64748b",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Sign in to manage KYC, users, transactions, and wallet operations.
          </p>
        </div>

        <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
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
              Phone number
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+249xxxxxxxxx"
              style={{
                width: "100%",
                height: 48,
                padding: "0 14px",
                borderRadius: 14,
                border: "1px solid #dbe2ea",
                background: "#f8fafc",
                color: "#0f172a",
                fontSize: 15,
                outline: "none",
              }}
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
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              style={{
                width: "100%",
                height: 48,
                padding: "0 14px",
                borderRadius: 14,
                border: "1px solid #dbe2ea",
                background: "#f8fafc",
                color: "#0f172a",
                fontSize: 15,
                outline: "none",
              }}
            />
          </div>

          {error ? (
            <div
              style={{
                background: "#fef2f2",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                padding: "12px 14px",
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
              background: loading ? "#334155" : "#0f172a",
              color: "#ffffff",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
              marginTop: 4,
              boxShadow: "0 10px 20px rgba(15,23,42,0.14)",
            }}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}