const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function fmtAmount(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const formatted = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

export function fmtInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

/** Exchange rates need precision below 1 (0.0017 must not read as 0.00). */
export function fmtRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 1 ? 6 : 2;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
}

export function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

export function ageOf(value) {
  if (!value) return { label: "—", level: "" };
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return { label: "—", level: "" };
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;

  let label;
  if (days > 0) label = `${days}d ${hours}h`;
  else if (hours > 0) label = `${hours}h ${String(rest).padStart(2, "0")}m`;
  else label = `${rest}m`;

  let level = "";
  if (mins >= 240) level = "danger";
  else if (mins >= 120) level = "warn";
  return { label, level };
}

export function shortAddress(value) {
  const s = String(value || "");
  if (s.length <= 14) return s || "—";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export function errText(err, fallback) {
  return (
    err?.response?.data?.message ||
    err?.response?.data?.error ||
    err?.message ||
    fallback ||
    "Something went wrong"
  );
}

export function todayLabel() {
  const d = new Date();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
