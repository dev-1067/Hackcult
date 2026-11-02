export function pct(v: number | null | undefined, digits = 0) {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function confidenceTone(c: number): "good" | "warn" | "bad" {
  if (c >= 0.85) return "good";
  if (c >= 0.6) return "warn";
  return "bad";
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function date(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function duration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}

export function minutes(m: number) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function century(c: number | null) {
  if (!c) return "Undated";
  const suffix = c % 10 === 1 && c !== 11 ? "st" : c % 10 === 2 && c !== 12 ? "nd" : c % 10 === 3 && c !== 13 ? "rd" : "th";
  return `${c}${suffix} century`;
}

export const MATERIALS: Record<string, string> = {
  paper: "Paper",
  palm_leaf: "Palm leaf",
  birch_bark: "Birch bark",
  cloth: "Cloth",
  print: "Printed",
  other: "Other",
};

export const SITE_KINDS: Record<string, string> = {
  unesco: "UNESCO site",
  monument: "Monument",
  temple: "Temple",
  repository: "Manuscript library",
  museum: "Museum",
  stepwell: "Stepwell",
  fort: "Fort",
  other: "Other",
};

export function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
