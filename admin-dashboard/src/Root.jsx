import App from "./App";
import AdminV2 from "./v2/AdminV2";
import KycV3ReviewPage from "./pages/KycV3ReviewPage";

/**
 * Route map
 *   /            → the new operations console (v2)
 *   /classic     → the previous admin, kept until every screen is ported
 *   /kyc-review  → the international KYC reviewer workspace
 */
export default function Root() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const hash = String(window.location.hash || "").toLowerCase();

  if (path === "/kyc-review" || hash === "#/kyc-review") {
    return <KycV3ReviewPage />;
  }

  if (path === "/classic" || hash === "#/classic") {
    return <App />;
  }

  return <AdminV2 />;
}
