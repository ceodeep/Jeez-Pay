const supabase = require("../config/supabase");

async function logAdminAction({
  adminId,
  adminPhone,
  action,
  targetType,
  targetId = null,
  targetDisplay = null,
  oldValue = null,
  newValue = null,
  req,
}) {
  try {
    await supabase.from("audit_logs").insert([
      {
        admin_id: adminId,
        admin_phone: adminPhone,
        action,
        target_type: targetType,
        target_id: targetId,
        target_display: targetDisplay,
        old_value: oldValue,
        new_value: newValue,
        ip_address: req.ip || req.headers["x-forwarded-for"] || null,
        user_agent: req.headers["user-agent"] || null,
      },
    ]);
  } catch (err) {
    console.error("audit log failed:", err);
  }
}

module.exports = { logAdminAction };