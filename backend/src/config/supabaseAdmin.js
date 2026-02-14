const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("ENV CHECK:", {
    cwd: process.cwd(),
    has_SUPABASE_URL: !!supabaseUrl,
    has_SERVICE_ROLE: !!serviceRoleKey,
    keys_present: Object.keys(process.env).filter((k) =>
      k.toLowerCase().includes("supabase")
    ),
  });

  throw new Error("Missing SUPABASE URL or SERVICE ROLE KEY in env");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

module.exports = supabaseAdmin;
