const supabase = require("../config/supabase");
const { hasPermission } = require("../config/adminPermissions");

async function getAdminUser(userId) {
  const { data, error } = await supabase
    .from("users")
    .select("id, phone, role, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const adminUser = await getAdminUser(userId);

    if (!adminUser || !adminUser.is_active) {
      return res.status(403).json({ message: "Admin access denied" });
    }

    const allowedRoles = [
      "admin",
      "super_admin",
      "finance_admin",
      "kyc_officer",
      "support_agent",
      "auditor",
    ];

    if (!allowedRoles.includes(adminUser.role)) {
      return res.status(403).json({ message: "Admin access denied" });
    }

    req.adminUser = adminUser;
    next();
  } catch (err) {
    console.error("requireAdmin error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

function requirePermission(permission) {
  return async function (req, res, next) {
    try {
      const adminUser = req.adminUser;
      if (!adminUser) {
        return res.status(403).json({ message: "Admin context missing" });
      }

      if (!hasPermission(adminUser.role, permission)) {
        return res.status(403).json({
          message: `Missing permission: ${permission}`,
        });
      }

      next();
    } catch (err) {
      console.error("requirePermission error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  };
}

module.exports = {
  getAdminUser,
  requireAdmin,
  requirePermission,
};