import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cog, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, EmptyState, ErrorBox, PageHeader, Progress, Skeleton, StatusBadge, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { duration, timeAgo } from "../lib/format";
import type { Job } from "../lib/types";

type F = "" | "queued" | "running" | "done" | "failed";

export default function Jobs() {
  const [status, setStatus] = useState<F>("");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["jobs", status],
    queryFn: () => api.get<{ counts: Record<string, number>; items: Job[] }>(`/jobs?limit=100${status ? `&status=${status}` : ""}`),
    refetchInterval: (query) => (query.state.data?.items.some((j) => j.status === "queued" || j.status === "running") ? 1500 : 8000),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post<Job>(`/jobs/${id}/retry`),
    onSuccess: () => {
      toast.success("Job queued again");
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const c = q.data?.counts ?? {};

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-7 sm:px-8">
      <PageHeader
        title="Processing jobs"
        subtitle="OCR runs in background workers. Jobs are claimed with a lease, retried with exponential backoff, and picked up again if a worker stops mid-way."
      />
      <Tabs<F>
        value={status}
        onChange={setStatus}
        tabs={[
          { value: "", label: "All" },
          { value: "running", label: <>Running <span className="text-muted">{c.running ?? 0}</span></> },
          { value: "queued", label: <>Queued <span className="text-muted">{c.queued ?? 0}</span></> },
          { value: "done", label: <>Done <span className="text-muted">{c.done ?? 0}</span></> },
          { value: "failed", label: <>Failed <span className="text-muted">{c.failed ?? 0}</span></> },
        ]}
      />
      <Card className="mt-4 overflow-hidden">
        {q.error ? (
          <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>
        ) : q.isLoading ? (
          <Skeleton className="m-4 h-60" />
        ) : q.data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Job", "Target", "Status", "Progress", "Engine", "Attempts", "Took", "Created", ""].map((h) => (
                    <th key={h} className="eyebrow px-4 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.items.map((j) => (
                  <tr key={j.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono text-[12px] text-ink">#{j.id.slice(0, 8)}</div>
                      <div className="text-[11.5px] text-muted">{j.kind === "ocr" ? "Page OCR" : "Benchmark"}</div>
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      {j.page_id && j.manuscript_title ? (
                        <Link to={`/pages/${j.page_id}`} className="line-clamp-2 text-accent hover:underline">
                          {j.manuscript_title} · p. {j.page_no}
                        </Link>
                      ) : j.kind === "benchmark" ? (
                        <Link to="/lab" className="text-accent hover:underline">OCR Lab</Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {j.error && <div className="mt-1 line-clamp-2 text-[11.5px] text-bad">{j.error}</div>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={j.status} /></td>
                    <td className="w-40 px-4 py-3">
                      <Progress value={j.progress} tone={j.status === "done" ? "good" : "indigo"} />
                      <div className="mt-1 truncate text-[11px] text-muted">{j.stage}</div>
                    </td>
                    <td className="px-4 py-3 text-ink-2">{j.engine_used || j.engine_requested}</td>
                    <td className="px-4 py-3 tabular-nums text-ink-2">{j.attempts}/{j.max_attempts}</td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums text-ink-2">{duration(j.duration_ms)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{timeAgo(j.created_at)}</td>
                    <td className="px-4 py-3">
                      {(j.status === "failed" || j.status === "done") && (
                        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} loading={retry.isPending && retry.variables === j.id} onClick={() => retry.mutate(j.id)}>
                          {j.status === "failed" ? "Retry" : "Run again"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Cog className="size-5" />} title="No jobs here" />
        )}
      </Card>
    </div>
  );
}
