export type Role = "viewer" | "contributor" | "curator" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Job {
  id: string;
  kind: "ocr" | "benchmark";
  page_id: string | null;
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  progress: number;
  attempts: number;
  max_attempts: number;
  engine_requested: string;
  engine_used: string;
  error: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  result: Record<string, any> | null;
  page_no?: number;
  manuscript_id?: string;
  manuscript_title?: string;
}

export interface Page {
  id: string;
  manuscript_id: string;
  page_no: number;
  status: "pending" | "queued" | "processing" | "done" | "failed";
  image_url: string;
  normalized_url: string | null;
  binary_url: string | null;
  width: number;
  height: number;
  norm_width: number;
  norm_height: number;
  engine: string;
  mean_confidence: number | null;
  skew_angle: number | null;
  line_count: number;
  job: Job | null;
  created_at: string;
}

export interface Manuscript {
  id: string;
  title: string;
  script: string;
  language: string;
  language_label: string;
  century: number | null;
  material: string;
  repository: string;
  site_id: string | null;
  site_name: string | null;
  description: string;
  license: string;
  source_url: string;
  uploaded_by: string | null;
  created_at: string;
  page_count: number;
  done_pages: number;
  line_count: number;
  mean_confidence: number | null;
  cover_url: string | null;
  pages?: Page[];
}

export interface Line {
  id: string;
  page_id: string;
  line_no: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  ocr_text: string;
  confidence: number;
  engine: string;
  verified: boolean;
  pending_corrections: number;
}

export interface PageDetail extends Page {
  manuscript: Manuscript;
  lines: Line[];
  prev_page_id: string | null;
  next_page_id: string | null;
  page_total: number;
}

export interface Site {
  id: string;
  name: string;
  kind: string;
  description: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  era: string;
  visit_minutes: number;
  source_url: string;
  manuscript_count?: number;
  distance_km?: number;
}

export interface Trail {
  id: string;
  name: string;
  mode: "walk" | "drive";
  start: { lat: number; lng: number };
  total_km: number;
  total_minutes: number;
  routing: "osrm" | "straight-line";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  legs: { km: number; minutes: number; to_site_id: string }[];
  stops: Site[];
  is_public: boolean;
  user_id: string | null;
  created_at: string;
  travel_minutes?: number;
  visit_minutes?: number;
}

export interface Correction {
  id: string;
  line_id: string;
  page_id: string | null;
  line_no: number | null;
  current_text: string;
  previous_text: string;
  text: string;
  status: "pending" | "approved" | "rejected";
  user_id: string | null;
  user_name: string;
  review_note: string;
  created_at: string;
  reviewed_at: string | null;
  page_no?: number | null;
  manuscript_id?: string | null;
  manuscript_title?: string | null;
  script?: string | null;
}

export interface SearchResult {
  line_id: string;
  text: string;
  iast: string;
  match_field: "text" | "ascii";
  highlight: [number, number] | null;
  score: number;
  exact: boolean;
  confidence: number;
  verified: boolean;
  line_no: number;
  page_id: string;
  page_no: number;
  manuscript_id: string;
  manuscript_title: string;
  script: string;
  language: string;
}

export interface Engine {
  name: string;
  label: string;
  kind: "local" | "cloud";
  architecture: string;
  available: boolean;
  scripts: string[];
}

export interface Meta {
  app: string;
  version: string;
  languages: { code: string; label: string; script: string }[];
  scripts: { id: string; label: string }[];
  engines: Engine[];
  translation: { available: boolean; provider: string | null; message: string };
  transliteration_targets: string[];
}

export interface ActivityItem {
  id: number;
  ts: string;
  action: string;
  entity: string;
  entity_id: string;
  user: string;
  detail: Record<string, any>;
}
