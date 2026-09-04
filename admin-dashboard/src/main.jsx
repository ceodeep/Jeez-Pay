import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import KycV3ReviewPage from "./pages/KycV3ReviewPage";
import "./index.css";

function Root() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const isKycWorkspace = path === "/kyc-review";
  const hasAdminSession = Boolean(localStorage.getItem("admin_token"));

  if (isKycWorkspace) {
    return <KycV3ReviewPage />;
  }

  return (
    <>
      <App />
      {hasAdminSession && (
        <button
          type="button"
          onClick={() => { window.location.href = "/kyc-review"; }}
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 9999,
            border: "none",
            borderRadius: 999,
            padding: "11px 16px",
            background: "#0f172a",
            color: "#fff",
            fontWeight: 800,
            boxShadow: "0 10px 30px rgba(15,23,42,.25)",
            cursor: "pointer",
          }}
          title="Open the international KYC reviewer workspace"
        >
          KYC Review Workspace
        </button>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
