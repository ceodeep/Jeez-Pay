import AdminV2 from "./v2/AdminV2";
import KycV3ReviewPage from "./pages/KycV3ReviewPage";

/**
 * Route map
 *   /            → the operations console
 *   /kyc-review  → the international KYC reviewer workspace
 *
 * The old single-component admin retires here; every screen it had now lives
 * in src/v2/pages and is reachable from the rail.
 */
export default function Root() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const hash = String(window.location.hash || "").toLowerCase();

  if (path === "/kyc-review" || hash === "#/kyc-review") {
    return <KycV3ReviewPage />;
  }

  return <AdminV2 />;
}
