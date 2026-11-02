import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { FlaskConical, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, PageHeader, Progress, Segmented, Select, Skeleton, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { duration, pct, timeAgo } from "../lib/format";
import type { Job } from "../lib/types";

interface Summary {
  label: string;
  cer: number;
  wer: number;
  ms: number;
}
interface BenchResult {
  script: string;
  pages: number;
  difficulty: number;
  summary: Record<"stock" | "raw" | "full", Summary>;
  per_page: Record<string, any>[];
  samples: { original: string; normalized: string; binary: string; truth: string[]; predicted: string[]; skew_true: number; skew_estimated: number }[];
  real_coverage?: CoverageRow[];
}
interface CoverageRow {
  manuscript: string;
  page_id: string;
  page_no: number;
  stock_chars: number;
  ours_chars: number;
  our_lines: number;
}

function RealCoverage({ rows }: { rows: CoverageRow[] }) {
  const stock = rows.reduce((a, r) => a + r.stock_chars, 0);
  const ours = rows.reduce((a, r) => a + r.ours_chars, 0);
  const max = Math.max(...rows.map((r) => Math.max(r.stock_chars, r.ours_chars)), 1);
  return (
    <Card>
      <CardHeader
        title="Real handwritten folios: how much text is found"
        subtitle="No ground truth exists for these, so we count the characters each approach reads. Missing text cannot be corrected later; low-confidence text can."
      />
      <div className="space-y-3 p-5">
        <div className="rounded-xl border border-good/25 bg-good-soft px-4 py-3 text-[13px] text-good">
          Across {rows.length} real folios LipiSetu reads {ours.toLocaleString("en-IN")} characters; the off-the-shelf detector reads {stock.toLocaleString("en-IN")}
          {stock > 0 ? ` (${(ours / stock).toFixed(1)}× more text)` : ""}. Dense pages without word spaces are where stock detectors lose whole lines.
        </div>
        {rows.map((r) => (
          <Link key={r.page_id} to={`/pages/${r.page_id}`} className="block rounded-lg px-1 py-1 hover:bg-surface-2">
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="truncate text-ink">
                {r.manuscript} <span className="text-muted">· p. {r.page_no} · {r.our_lines} lines</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted">
                {r.stock_chars} → <strong className="text-good">{r.ours_chars}</strong>
              </span>
            </div>
            <div className="mt-1 space-y-0.5">
              <div className="h-1.5 rounded-full bg-ink-2/40" style={{ width: `${(r.stock_chars / max) * 100}%` }} />
              <div className="h-1.5 rounded-full bg-good" style={{ width: `${(r.ours_chars / max) * 100}%` }} />
            </div>
          </Link>
        ))}
        <div className="flex gap-4 text-[11.5px] text-muted">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-ink-2/40" /> Off-the-shelf detector</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-good" /> LipiSetu</span>
        </div>
      </div>
    </Card>
  );
}
interface BenchResponse {
  variants: Record<string, string>;
  latest: (Job & { result: BenchResult }) | null;
  running: Job | null;
  history: { id: string; status: string; created_at: string; duration_ms: number | null; summary: BenchResult["summary"] | null; pages: number; difficulty: number }[];
}

const ORDER = ["stock", "raw", "full"] as const;
const COLOR = { stock: "bg-ink-2/40", raw: "bg-warn", full: "bg-good" };
const DESC = {
  stock: "PP-OCRv5's own text detector and recogniser on the whole photo. What you get off the shelf.",
  raw: "Our line segmentation (plain Otsu threshold), but no crop, contrast, denoise or deskew.",
  full: "LipiSetu: crop, CLAHE, denoise, Sauvola binarisation, deskew, projection-profile segmentation.",
};

export default function Lab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [pages, setPages] = useState(6);
  const [difficulty, setDifficulty] = useState("1.0");
  const [sample, setSample] = useState(0);
  const [view, setView] = useState<"original" | "normalized" | "binary">("normalized");

  const q = useQuery({
    queryKey: ["benchmarks"],
    queryFn: () => api.get<BenchResponse>("/lab/benchmarks"),
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  });

  const run = useMutation({
    mutationFn: () => api.post<Job>("/lab/benchmarks", { script: "devanagari", pages, difficulty: Number(difficulty) }),
    onSuccess: () => {
      toast.success("Benchmark started");
      qc.invalidateQueries({ queryKey: ["benchmarks"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const latest = q.data?.latest?.result;
  const running = q.data?.running;
  const best = latest ? latest.summary.full.cer : 0;
  const maxCer = latest ? Math.max(...ORDER.map((k) => latest.summary[k].cer), 0.01) : 1;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-7 sm:px-8">
      <PageHeader
        title="OCR Lab"
        subtitle="We measure ourselves. Each run renders real Sanskrit and Hindi text on synthetic aged pages (stains, uneven light, blur, skew, a table behind the page), so the exact text is known. Then three approaches are scored by character error rate (CER)."
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit p-5">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <FlaskConical className="size-4 text-accent" /> Run a benchmark
          </div>
          <div className="mt-4 space-y-3">
            <Field label="Pages">
              <Select value={pages} onChange={(e) => setPages(Number(e.target.value))}>
                {[4, 6, 8, 12].map((n) => (
                  <option key={n} value={n}>
                    {n} pages (~{n * 7} lines)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Damage level">
              <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="0.5">Light (well-kept copy)</option>
                <option value="1.0">Typical (stained, skewed photo)</option>
                <option value="1.4">Heavy (faded, blurred, steep skew)</option>
              </Select>
            </Field>
            {can("contributor") ? (
              <Button variant="primary" className="w-full" icon={<Play className="size-4" />} loading={run.isPending} disabled={!!running} onClick={() => run.mutate()}>
                {running ? "Running…" : "Run benchmark"}
              </Button>
            ) : (
              <p className="text-[12.5px] text-muted">Contributors can start new runs. You can view the latest results.</p>
            )}
            {running && (
              <div>
                <div className="mb-1 flex items-center gap-2 text-[12.5px] text-indigo">
                  <Spinner className="text-indigo" /> {running.stage}
                </div>
                <Progress value={running.progress} tone="indigo" />
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
          {q.isLoading ? (
            <Skeleton className="h-72" />
          ) : latest ? (
            <>
              <Card>
                <CardHeader
                  title="Character error rate (lower is better)"
                  subtitle={`${latest.pages} pages · damage ${latest.difficulty} · run ${timeAgo(q.data!.latest!.finished_at)} · took ${duration(q.data!.latest!.duration_ms)}`}
                />
                <div className="space-y-4 p-5">
                  {ORDER.map((k) => {
                    const s = latest.summary[k];
                    return (
                      <div key={k}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[13.5px] font-medium text-ink">
                            {s.label} {k === "full" && <Badge tone="good" className="ml-1">Ours</Badge>}
                          </span>
                          <span className="text-[13px] tabular-nums">
                            <strong className={clsx("text-[16px]", k === "full" ? "text-good" : "text-ink")}>{pct(s.cer, 1)}</strong>
                            <span className="text-muted"> CER · {pct(s.wer, 0)} WER · {duration(s.ms)}/page</span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-surface-3">
                          <div className={clsx("h-full rounded-full", COLOR[k])} style={{ width: `${(s.cer / maxCer) * 100}%` }} />
                        </div>
                        <p className="mt-1 text-[12px] text-muted">{DESC[k]}</p>
                      </div>
                    );
                  })}
                  <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
                    On these synthetic pages our clean-up cuts errors {((latest.summary.raw.cer / Math.max(best, 0.0001)) || 0).toFixed(1)}× compared with the same recogniser on the raw photo
                    {Math.abs(latest.summary.full.cer - latest.summary.stock.cer) < 0.005
                      ? ", and matches the off-the-shelf detector on clean, evenly spaced text like this."
                      : latest.summary.full.cer < latest.summary.stock.cer
                        ? `, and has ${((latest.summary.stock.cer / Math.max(best, 0.0001)) || 0).toFixed(1)}× fewer errors than the off-the-shelf detector.`
                        : "; the off-the-shelf detector is slightly ahead on clean, evenly spaced text like this."}{" "}
                    The real test is handwritten folios, below.
                  </div>
                </div>
              </Card>

              {latest.real_coverage && latest.real_coverage.length > 0 && <RealCoverage rows={latest.real_coverage} />}

              {latest.samples.length > 0 && (
                <Card>
                  <CardHeader
                    title="Look inside a run"
                    subtitle="Ground truth vs what our pipeline read, with the page stages."
                    action={
                      <div className="flex gap-2">
                        <Segmented
                          size="sm"
                          value={String(sample)}
                          onChange={(v) => setSample(Number(v))}
                          options={latest.samples.map((_, i) => ({ value: String(i), label: `Page ${i + 1}` }))}
                        />
                      </div>
                    }
                  />
                  {latest.samples[sample] && (
                    <div className="grid gap-4 p-5 lg:grid-cols-2">
                      <div>
                        <Segmented<"original" | "normalized" | "binary">
                          size="sm"
                          value={view}
                          onChange={setView}
                          options={[
                            { value: "original", label: "Photo" },
                            { value: "normalized", label: "Cleaned + lines" },
                            { value: "binary", label: "Ink" },
                          ]}
                        />
                        <img src={latest.samples[sample][view]} alt={view} className="mt-2 w-full rounded-lg border border-line" />
                        <div className="mt-1.5 text-[12px] text-muted">
                          True skew {latest.samples[sample].skew_true}° · our estimate {(-latest.samples[sample].skew_estimated).toFixed(1)}°
                        </div>
                      </div>
                      <div className="space-y-2">
                        {latest.samples[sample].truth.map((t, i) => (
                          <div key={i} className="rounded-lg border border-line p-2.5">
                            <div className="script-text text-[15px] text-ink">{t}</div>
                            <div className="script-text mt-0.5 text-[14px] text-muted">{latest.samples[sample].predicted[i] ?? "—"}</div>
                          </div>
                        ))}
                        <div className="text-[11.5px] text-muted">Top: ground truth · Bottom: LipiSetu output</div>
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </>
          ) : (
            <Card>
              <EmptyState icon={<FlaskConical className="size-5" />} title="No benchmark yet" body="Run one to see measured accuracy for each approach." />
            </Card>
          )}

          {q.data && q.data.history.length > 1 && (
            <Card>
              <CardHeader title="History" />
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-left">
                      {["When", "Pages", "Damage", "Off-the-shelf", "No clean-up", "LipiSetu"].map((h) => (
                        <th key={h} className="eyebrow px-5 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {q.data.history.filter((h) => h.summary).map((h) => (
                      <tr key={h.id}>
                        <td className="px-5 py-2.5">{timeAgo(h.created_at)}</td>
                        <td className="px-5 py-2.5 tabular-nums">{h.pages}</td>
                        <td className="px-5 py-2.5 tabular-nums">{h.difficulty}</td>
                        <td className="px-5 py-2.5 tabular-nums">{pct(h.summary!.stock.cer, 1)}</td>
                        <td className="px-5 py-2.5 tabular-nums">{pct(h.summary!.raw.cer, 1)}</td>
                        <td className="px-5 py-2.5 font-semibold text-good tabular-nums">{pct(h.summary!.full.cer, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
