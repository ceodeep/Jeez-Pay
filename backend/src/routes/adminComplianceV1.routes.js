const express = require("express");

const supabase = require("../config/supabase");
const authMiddleware = require("../middlewares/auth.middleware");
const {
  requireAdmin,
  requirePermission,
} = require("../middlewares/admin.middleware");
const { logAdminAction } = require("../utils/auditLogger");

const router = express.Router();

function clampLimit(value, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), 200);
}

router.get(
  "/compliance/events",
  authMiddleware,
  requireAdmin,
  requirePermission("audit_logs.view"),
  async (req, res) => {
    try {
      const decision = String(req.query.decision || "").trim().toLowerCase();
      const limit = clampLimit(req.query.limit);

      let query = supabase
        .from("compliance_events")
        .select(
          "id,journal_id,source_type,source_ref,entity_type,entity_ref,currency,outgoing_amount,incoming_amount,decision,severity,triggered_rules,created_at"
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (decision) query = query.eq("decision", decision);

      const { data, error } = await query;
      if (error) {
        console.error("compliance events lookup error:", error);
        return res.status(500).json({ message: "Failed to load compliance events" });
      }

      return res.json({ events: data || [] });
    } catch (error) {
      console.error("compliance events crash:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/compliance/cases",
  authMiddleware,
  requireAdmin,
  requirePermission("audit_logs.view"),
  async (req, res) => {
    try {
      const status = String(req.query.status || "").trim().toLowerCase();
      const limit = clampLimit(req.query.limit);

      let query = supabase
        .from("compliance_cases")
        .select(
          "id,event_id,entity_type,entity_ref,status,severity,assigned_to,resolution_note,resolved_at,created_at,updated_at"
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) {
        console.error("compliance cases lookup error:", error);
        return res.status(500).json({ message: "Failed to load compliance cases" });
      }

      return res.json({ cases: data || [] });
    } catch (error) {
      console.error("compliance cases crash:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/compliance/control",
  authMiddleware,
  requireAdmin,
  requirePermission("settings.update"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const entityType = String(req.body.entityType || "").trim().toUpperCase();
      const entityRef = String(req.body.entityRef || "").trim();
      const status = String(req.body.status || "").trim().toLowerCase();
      const reason = String(req.body.reason || "").trim() || null;
      const expiresAtRaw = String(req.body.expiresAt || "").trim();
      let expiresAt = null;

      if (!entityRef || !["USER", "MERCHANT"].includes(entityType)) {
        return res.status(400).json({ message: "Valid entityType and entityRef are required" });
      }

      if (!["clear", "review", "frozen"].includes(status)) {
        return res.status(400).json({ message: "status must be clear, review, or frozen" });
      }

      if (status !== "clear" && !reason) {
        return res.status(400).json({ message: "reason is required for review/frozen status" });
      }

      if (expiresAtRaw) {
        const d = new Date(expiresAtRaw);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "Invalid expiresAt" });
        }
        expiresAt = d.toISOString();
      }

      const { data, error } = await supabase.rpc(
        "set_compliance_entity_control_v1",
        {
          p_admin_user_id: adminId,
          p_entity_type: entityType,
          p_entity_ref: entityRef,
          p_status: status,
          p_reason: reason,
          p_expires_at: expiresAt,
        }
      );

      if (error) {
        console.error("compliance control RPC error:", {
          message: error.message,
          code: error.code,
        });
        return res.status(400).json({ message: "Compliance control update failed" });
      }

      await logAdminAction({
        adminId,
        adminPhone: req.adminUser?.phone || null,
        action: "COMPLIANCE_CONTROL_UPDATED",
        targetType: entityType.toLowerCase(),
        targetId: entityRef,
        targetDisplay: entityRef,
        oldValue: null,
        newValue: { status, reason, expiresAt },
        req,
      });

      return res.json({ success: true, control: data });
    } catch (error) {
      console.error("compliance control crash:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/compliance/cases/:id/status",
  authMiddleware,
  requireAdmin,
  requirePermission("settings.update"),
  async (req, res) => {
    try {
      const adminId = req.user.userId;
      const caseId = String(req.params.id || "").trim();
      const status = String(req.body.status || "").trim().toLowerCase();
      const note = String(req.body.note || "").trim() || null;

      if (!caseId || !["open", "reviewing", "closed"].includes(status)) {
        return res.status(400).json({ message: "Invalid case id or status" });
      }

      if (status === "closed" && !note) {
        return res.status(400).json({ message: "A resolution note is required to close a case" });
      }

      const patch = {
        status,
        assigned_to: adminId,
        resolution_note: note,
        resolved_at: status === "closed" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("compliance_cases")
        .update(patch)
        .eq("id", caseId)
        .select(
          "id,event_id,entity_type,entity_ref,status,severity,assigned_to,resolution_note,resolved_at,created_at,updated_at"
        )
        .maybeSingle();

      if (error) {
        console.error("compliance case update error:", error);
        return res.status(500).json({ message: "Compliance case update failed" });
      }

      if (!data) {
        return res.status(404).json({ message: "Compliance case not found" });
      }

      await logAdminAction({
        adminId,
        adminPhone: req.adminUser?.phone || null,
        action: "COMPLIANCE_CASE_UPDATED",
        targetType: "compliance_case",
        targetId: caseId,
        targetDisplay: caseId,
        oldValue: null,
        newValue: patch,
        req,
      });

      return res.json({ success: true, case: data });
    } catch (error) {
      console.error("compliance case status crash:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

module.exports = router;
