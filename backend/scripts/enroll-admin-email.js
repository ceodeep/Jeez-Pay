const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const readline = require("readline");
const { Writable } = require("stream");

require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true,
});

const supabase = require("../src/config/supabase");
const { sendEmailOTP } = require("../src/services/email.service");

const ADMIN_ROLES = new Set([
  "admin",
  "super_admin",
  "finance_admin",
  "kyc_officer",
  "support_agent",
  "auditor",
]);

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

function normalizePhone(raw) {
  const value = String(raw || "").trim();
  const digits = value.replace(/\D/g, "");

  if (!digits) return "";
  return `+${digits}`;
}

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "configured email";

  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 2))}@${domain}`;
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      reject(new Error("A TTY is required for hidden password entry"));
      return;
    }

    const mutedOutput = new Writable({
      write(chunk, encoding, callback) {
        if (!mutedOutput.muted) {
          process.stdout.write(chunk, encoding);
        }
        callback();
      },
    });

    mutedOutput.muted = false;

    const rl = readline.createInterface({
      input: process.stdin,
      output: mutedOutput,
      terminal: true,
    });

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });

    mutedOutput.muted = true;
  });
}

function constantTimeOtpMatch(expected, actual) {
  const left = Buffer.from(String(expected || ""));
  const right = Buffer.from(String(actual || ""));

  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function findAdminByPhone(rawPhone) {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from("users")
    .select(
      "id, phone, email, email_verified, role, is_active, password_hash"
    )
    .eq("phone", normalized)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function main() {
  console.log("JeezPay admin email enrollment");
  console.log("This tool verifies the current admin password and new email ownership.\n");

  const phone = await prompt("Current admin phone: ");
  const admin = await findAdminByPhone(phone);

  if (!admin) {
    throw new Error("Admin account not found");
  }

  if (!ADMIN_ROLES.has(String(admin.role || "").trim())) {
    throw new Error("The selected account is not an administrative account");
  }

  if (admin.is_active === false) {
    throw new Error("The selected admin account is suspended");
  }

  if (!admin.password_hash) {
    throw new Error("The selected admin account has no password configured");
  }

  const password = await promptHidden("Current admin password: ");
  const passwordOk = await bcrypt.compare(password, admin.password_hash);

  if (!passwordOk) {
    throw new Error("Current admin password is incorrect");
  }

  const email = normalizeEmail(await prompt("New admin email: "));

  if (!isValidEmail(email)) {
    throw new Error("Enter a valid email address");
  }

  const { data: emailOwner, error: emailLookupError } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .neq("id", admin.id)
    .maybeSingle();

  if (emailLookupError) throw emailLookupError;

  if (emailOwner) {
    throw new Error("That email is already used by another JeezPay account");
  }

  if (admin.email === email && admin.email_verified === true) {
    console.log(`\nAdmin email is already verified: ${maskEmail(email)}`);
    return;
  }

  const otp = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = Date.now() + OTP_TTL_MS;

  const delivery = await sendEmailOTP(email, otp);

  if (delivery?.error) {
    throw new Error(`Failed to send verification email: ${delivery.error.message || "unknown error"}`);
  }

  console.log(`\nVerification code sent to ${maskEmail(email)}.`);

  let verified = false;

  for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt += 1) {
    if (Date.now() > expiresAt) {
      throw new Error("Verification code expired. Run the enrollment tool again.");
    }

    const submitted = String(await prompt("Verification code: ")).trim();

    if (constantTimeOtpMatch(otp, submitted)) {
      verified = true;
      break;
    }

    const remaining = MAX_OTP_ATTEMPTS - attempt;

    if (remaining > 0) {
      console.log(`Invalid code. ${remaining} attempt(s) remaining.`);
    }
  }

  if (!verified) {
    throw new Error("Too many invalid verification-code attempts");
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({
      email,
      email_verified: true,
    })
    .eq("id", admin.id);

  if (updateError) throw updateError;

  console.log(`\nAdmin email enrolled and verified: ${maskEmail(email)}`);
  console.log("The legacy phone verification flag has not been changed by this tool.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\nEnrollment failed: ${error.message}`);
    process.exit(1);
  });
