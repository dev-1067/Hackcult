import { useQuery } from "@tanstack/react-query";
import { Database, Download, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardHeader, ErrorBox, Field, PageHeader, Segmented, Select, Skeleton, Stat } from "../components/ui";
import { api, download, qs } from "../lib/api";

interface Summary {
  verified: number;
  high_confidence: number;
  by_script: Record<string, number>;
  min_conf: number;
}

export default function Dataset() {
  const [minConf, setMinConf] = useState(0.9);
  const [include, setInclude] = useState<"verified" | "verified_and_confident">("verified");
  const [fmt, setFmt] = useState<"jsonl" | "csv">("jsonl");
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["dataset", minConf], queryFn: () => api.get<Summary>(`/export/summary?min_conf=${minConf}`) });
  const count = q.data ? (include === "verified" ? q.data.verified : q.data.verified + q.data.high_confidence) : 0;

  async function exportNow() {
    setBusy(true);
    try {
      await download(`/export/training-data${qs({ format: fmt, include, min_conf: minConf })}`, `lipisetu-training.${fmt}`);
      toast.success(`Exported ${count} lines`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[980px] px-4 py-7 sm:px-8">
      <PageHeader
        title="Training dataset"
        subtitle="Every line a person has verified becomes a labelled example: the line image plus its correct text. Export them to fine-tune a better recogniser for Indic manuscripts, for example with Adaption's dataset and training tools."
      />
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {q.data ? (
          <>
            <Stat label="Human-verified lines" value={q.data.verified} icon={<ShieldCheck className="size-4" />} tone="indigo" />
            <Stat label={`Machine lines ≥ ${Math.round(minConf * 100)}%`} value={q.data.high_confidence} icon={<Sparkles className="size-4" />} tone="good" />
            <Stat label="Ready to export" value={count} icon={<Database className="size-4" />} tone="accent" />
          </>
        ) : (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)
        )}
      </div>
      <Card>
        <CardHeader title="Export" subtitle="Each record links to its line image at /api/v1/lines/{id}/image." />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Include">
            <Select value={include} onChange={(e) => setInclude(e.target.value as typeof include)}>
              <option value="verified">Human-verified only (gold)</option>
              <option value="verified_and_confident">Verified + confident machine lines (silver)</option>
            </Select>
          </Field>
          <Field label="Confidence threshold" hint="Used for machine lines">
            <Select value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} disabled={include === "verified"}>
              {[0.8, 0.85, 0.9, 0.95].map((v) => (
                <option key={v} value={v}>
                  {Math.round(v * 100)}%
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Format">
            <Segmented<"jsonl" | "csv">
              value={fmt}
              onChange={setFmt}
              options={[
                { value: "jsonl", label: "JSONL" },
                { value: "csv", label: "CSV" },
              ]}
            />
          </Field>
        </div>
        <div className="border-t border-line px-5 py-4">
          <pre className="scroll-thin overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
{`{"id": "…", "image_url": "/api/v1/lines/…/image", "text": "धर्मक्षेत्रे कुरुक्षेत्रे …",
 "source": "human-verified", "ocr_confidence": 0.71, "script": "devanagari",
 "language": "sa", "manuscript": "…", "page_no": 1, "line_no": 3, "license": "CC BY-SA 4.0"}`}
          </pre>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-muted">{count === 0 ? "Nothing to export yet. Approve some corrections first." : `${count} lines will be exported.`}</span>
            <Button variant="primary" icon={<Download className="size-4" />} loading={busy} disabled={count === 0} onClick={exportNow}>
              Download {fmt.toUpperCase()}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
