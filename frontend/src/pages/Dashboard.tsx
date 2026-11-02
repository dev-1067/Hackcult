import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  FileText,
  FlaskConical,
  Gauge,
  Map,
  Rows3,
  Upload,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Progress, Skeleton, Stat, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { duration, pct, timeAgo } from "../lib/format";
import { languageLabel, useMeta } from "../lib/queries";
import type { ActivityItem, Job } from "../lib/types";

interface Overview {
  manuscripts: number;
  pages: number;
  lines: number;
  verified_lines: number;
  mean_confidence: number | null;
  confidence_buckets: { high: number; medium: number; low: number };
  pending_corrections: number;
  sites: number;
  trails: number;
  contributors: number;
  by_script: Record<string, number>;
  by_language: Record<string, number>;
  pages_by_status: Record<string, number>;
  avg_ocr_ms: number | null;
  recent_jobs: Job[];
  activity: ActivityItem[];
}

const ACTIONS: Record<string, string> = {
  "ocr.completed": "finished reading a page",
  "ocr.requested": "re-ran OCR on a page",
  "pages.uploaded": "uploaded pages",
  "manuscript.created": "added a manuscript",
  "manuscript.updated": "edited a manuscript",
  "manuscript.deleted": "deleted a manuscript",
  "correction.suggested": "suggested a correction",
  "correction.applied": "corrected a line",
  "correction.approved": "approved a correction",
  "correction.rejected": "rejected a correction",
  "trail.created": "planned a heritage trail",
  "benchmark.requested": "started an OCR benchmark",
  "dataset.exported": "exported the training dataset",
  "auth.login": "signed in",
  "auth.register": "joined LipiSetu",
  "site.created": "added a heritage site",
  "user.role_changed": "changed a user's role",
  "job.retried": "retried a job",
  "page.deleted": "deleted a page",
};

export default function Dashboard() {
  const { user, can } = useAuth();
  const meta = useMeta();
  const q = useQuery({ queryKey: ["overview"], queryFn: () => api.get<Overview>("/stats/overview"), refetchInterval: 10000 });
  const d = q.data;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const totalBuckets = d ? d.confidence_buckets.high + d.confidence_buckets.medium + d.confidence_buckets.low : 0;

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-7 sm:px-8">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Overview</div>
          <h1 className="font-display mt-1 text-[28px] font-semibold text-ink">
            {greeting}, {user?.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-[13.5px] text-muted">Here is what is happening in the archive today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("contributor") && (
            <Link to="/manuscripts?new=1">
              <Button variant="primary" icon={<Upload className="size-4" />}>
                Add manuscript
              </Button>
            </Link>
          )}
          <Link to="/map">
            <Button icon={<Map className="size-4" />}>Plan a trail</Button>
          </Link>
        </div>
      </div>

      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {d ? (
          <>
            <Stat label="Manuscripts" value={d.manuscripts} hint={`${d.pages} pages digitised`} icon={<BookOpenText className="size-4" />} tone="accent" />
            <Stat label="Lines read" value={d.lines.toLocaleString("en-IN")} hint={`${d.verified_lines} verified by people`} icon={<Rows3 className="size-4" />} tone="indigo" />
            <Stat label="Mean confidence" value={pct(d.mean_confidence)} hint="across all recognised lines" icon={<Gauge className="size-4" />} tone="good" />
            <Stat
              label="Awaiting review"
              value={d.pending_corrections}
              hint={d.avg_ocr_ms ? `Avg OCR ${duration(d.avg_ocr_ms)} per page` : "suggested corrections"}
              icon={<ClipboardCheck className="size-4" />}
              tone="warn"
            />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recognition quality" subtitle="How confident the recogniser is, line by line. Red lines need a human eye." icon={<Gauge className="size-4" />} />
          <div className="p-5">
            {d && totalBuckets > 0 ? (
              <>
                <div className="flex h-3 overflow-hidden rounded-full">
                  <div className="bg-good" style={{ width: `${(d.confidence_buckets.high / totalBuckets) * 100}%` }} />
                  <div className="bg-warn" style={{ width: `${(d.confidence_buckets.medium / totalBuckets) * 100}%` }} />
                  <div className="bg-bad" style={{ width: `${(d.confidence_buckets.low / totalBuckets) * 100}%` }} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {(
                    [
                      ["High", "≥ 85%", d.confidence_buckets.high, "bg-good"],
                      ["Review", "60–85%", d.confidence_buckets.medium, "bg-warn"],
                      ["Low", "< 60%", d.confidence_buckets.low, "bg-bad"],
                    ] as const
                  ).map(([label, range, n, color]) => (
                    <div key={label} className="rounded-xl border border-line bg-surface-2/60 p-3">
                      <div className="flex items-center gap-1.5 text-[12px] text-muted">
                        <span className={`size-2 rounded-full ${color}`} /> {label} <span className="text-muted/70">{range}</span>
                      </div>
                      <div className="mt-1 text-[20px] font-semibold tabular-nums">{n}</div>
                      <div className="text-[11.5px] text-muted">{pct(n / totalBuckets)} of lines</div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="eyebrow mb-2">Languages</div>
                    <div className="space-y-2">
                      {Object.entries(d.by_language).map(([code, n]) => (
                        <div key={code} className="flex items-center gap-3 text-[13px]">
                          <span className="w-20 text-ink-2">{languageLabel(meta.data, code)}</span>
                          <Progress value={(n / d.manuscripts) * 100} tone="indigo" className="flex-1" />
                          <span className="w-6 text-right text-muted tabular-nums">{n}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="eyebrow mb-2">Pages</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(d.pages_by_status).map(([s, n]) => (
                        <span key={s} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[12px]">
                          <StatusBadge status={s} /> <span className="tabular-nums text-ink-2">{n}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : d ? (
              <EmptyState icon={<FileText className="size-5" />} title="Nothing read yet" body="Upload a manuscript page to see recognition quality here." />
            ) : (
              <Skeleton className="h-40" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recognition engines" subtitle="Used automatically, with fallback" icon={<Cpu className="size-4" />} />
          <div className="divide-y divide-line">
            {meta.data?.engines.map((e) => (
              <div key={e.name} className="px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink">{e.label}</span>
                  {e.available ? <Badge tone="good" dot>Ready</Badge> : <Badge>Not configured</Badge>}
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted">{e.available ? e.scripts.join(" · ") : e.kind === "cloud" ? "Set ANTHROPIC_API_KEY to enable" : "Install Tesseract to enable"}</div>
              </div>
            )) ?? <Skeleton className="m-5 h-24" />}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent processing"
            icon={<Cpu className="size-4" />}
            action={
              can("contributor") ? (
                <Link to="/jobs" className="text-[12.5px] font-medium text-accent hover:underline">
                  All jobs
                </Link>
              ) : undefined
            }
          />
          {d?.recent_jobs.length ? (
            <ul className="divide-y divide-line">
              {d.recent_jobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-ink">
                      {j.kind === "benchmark" ? "OCR benchmark" : "Page OCR"} <span className="font-mono text-[11.5px] text-muted">#{j.id.slice(0, 6)}</span>
                    </div>
                    <div className="text-[11.5px] text-muted">
                      {timeAgo(j.created_at)} · {j.engine_used || j.engine_requested} · {duration(j.duration_ms)}
                    </div>
                  </div>
                  <StatusBadge status={j.status} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No jobs yet" />
          )}
        </Card>

        <Card>
          <CardHeader title="Activity" subtitle="Every change is recorded in the audit log" icon={<CheckCircle2 className="size-4" />} />
          {d?.activity.length ? (
            <ul className="divide-y divide-line">
              {d.activity.slice(0, 7).map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-[13px]">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{a.user}</span>{" "}
                    <span className="text-ink-2">{ACTIONS[a.action] ?? a.action}</span>
                    {a.detail?.title && <span className="text-muted"> · {a.detail.title}</span>}
                  </div>
                  <span className="shrink-0 text-[11.5px] text-muted">{timeAgo(a.ts)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet" />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { to: "/search?q=dharma", title: "Search across scripts", body: "Type in English, find Devanagari.", icon: <BookOpenText className="size-4" /> },
          { to: "/lab", title: "See the OCR Lab", body: "Measured accuracy, with and without our pipeline.", icon: <FlaskConical className="size-4" /> },
          { to: can("curator") ? "/review" : "/manuscripts", title: can("curator") ? "Review corrections" : "Browse manuscripts", body: can("curator") ? `${d?.pending_corrections ?? 0} waiting for you.` : "Open a folio and read it line by line.", icon: <ClipboardCheck className="size-4" /> },
        ].map((c) => (
          <Link key={c.title} to={c.to} className="group rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
            <div className="flex items-center justify-between">
              <span className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-ink-2">{c.icon}</span>
              <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
            </div>
            <div className="mt-3 text-[13.5px] font-medium text-ink">{c.title}</div>
            <div className="text-[12.5px] text-muted">{c.body}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
