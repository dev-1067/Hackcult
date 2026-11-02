import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, ExternalLink, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Diff } from "../components/Diff";
import { Badge, Button, Card, EmptyState, ErrorBox, Input, PageHeader, Skeleton, StatusBadge, Tabs, Textarea } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { Correction } from "../lib/types";

type Status = "pending" | "approved" | "rejected" | "all";

export default function Review() {
  const [status, setStatus] = useState<Status>("pending");
  const q = useQuery({
    queryKey: ["corrections", status],
    queryFn: () => api.get<{ counts: Record<string, number>; items: Correction[] }>(`/corrections?status=${status}&limit=100`),
  });
  const counts = q.data?.counts ?? {};

  return (
    <div className="mx-auto max-w-[1040px] px-4 py-7 sm:px-8">
      <PageHeader
        title="Review queue"
        subtitle="Contributors suggest fixes for lines the machine misread. Approving a suggestion updates the text, marks the line verified, and adds it to the training dataset."
      />
      <Tabs<Status>
        value={status}
        onChange={setStatus}
        tabs={[
          { value: "pending", label: <>Pending <span className="ml-1 text-muted tabular-nums">{counts.pending ?? 0}</span></> },
          { value: "approved", label: <>Approved <span className="ml-1 text-muted tabular-nums">{counts.approved ?? 0}</span></> },
          { value: "rejected", label: <>Rejected <span className="ml-1 text-muted tabular-nums">{counts.rejected ?? 0}</span></> },
          { value: "all", label: "All" },
        ]}
      />
      <div className="mt-5 space-y-3">
        {q.error ? (
          <ErrorBox error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)
        ) : q.data?.items.length ? (
          q.data.items.map((c) => <ReviewCard key={c.id} c={c} />)
        ) : (
          <Card>
            <EmptyState icon={<ClipboardCheck className="size-5" />} title={status === "pending" ? "Nothing waiting for review" : "No corrections here"} body={status === "pending" ? "When contributors suggest fixes, they appear here." : undefined} />
          </Card>
        )}
      </div>
    </div>
  );
}

function ReviewCard({ c }: { c: Correction }) {
  const qc = useQueryClient();
  const [adjusting, setAdjusting] = useState(false);
  const [text, setText] = useState(c.text);
  const [note, setNote] = useState("");

  const review = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      api.post(`/corrections/${c.id}/review`, { action, note, text: action === "approve" && adjusting ? text : undefined }),
    onSuccess: (_, action) => {
      toast.success(action === "approve" ? "Approved. The line is now verified." : "Suggestion rejected");
      qc.invalidateQueries({ queryKey: ["corrections"] });
      qc.invalidateQueries({ queryKey: ["corrections-count"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      if (c.page_id) qc.invalidateQueries({ queryKey: ["page", c.page_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="rise overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-[12.5px] text-muted">
        <span className="font-medium text-ink">{c.manuscript_title ?? "Deleted manuscript"}</span>
        <span>
          · page {c.page_no}, line {c.line_no}
        </span>
        <span>· by {c.user_name}</span>
        <span>· {timeAgo(c.created_at)}</span>
        <span className="ml-auto flex items-center gap-2">
          <StatusBadge status={c.status} kind="correction" />
          {c.page_id && (
            <Link to={`/pages/${c.page_id}?line=${c.line_id}`} className="inline-flex items-center gap-1 text-accent hover:underline">
              Open <ExternalLink className="size-3" />
            </Link>
          )}
        </span>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-[1fr_1fr]">
        <div>
          <div className="eyebrow mb-1.5">Line image</div>
          <img src={`/api/v1/lines/${c.line_id}/image`} alt="Line" className="max-h-28 w-full rounded-lg border border-line bg-surface-2 object-contain" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        </div>
        <div className="space-y-3">
          <div>
            <div className="eyebrow mb-1">Change</div>
            <p className="script-text text-[17px] leading-relaxed text-ink">
              <Diff before={c.previous_text} after={c.text} />
            </p>
          </div>
          {c.status === "pending" && adjusting && (
            <div>
              <div className="eyebrow mb-1">Adjust before approving</div>
              <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} className="script-text text-[16px]" />
            </div>
          )}
          {c.review_note && <p className="text-[12.5px] text-muted">Note: {c.review_note}</p>}
        </div>
      </div>
      {c.status === "pending" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/50 px-5 py-3">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note to the contributor" className="h-8 max-w-sm flex-1 text-[12.5px]" />
          <div className="ml-auto flex gap-2">
            <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setAdjusting((a) => !a)}>
              {adjusting ? "Use as suggested" : "Adjust"}
            </Button>
            <Button size="sm" variant="danger" icon={<X className="size-3.5" />} loading={review.isPending && review.variables === "reject"} onClick={() => review.mutate("reject")}>
              Reject
            </Button>
            <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={review.isPending && review.variables === "approve"} disabled={adjusting && !text.trim()} onClick={() => review.mutate("approve")}>
              Approve
            </Button>
          </div>
        </div>
      )}
      {c.status !== "pending" && c.current_text !== c.text && c.status === "approved" && (
        <div className="border-t border-line px-5 py-2 text-[12px] text-muted">
          <Badge>Note</Badge> The line has since been edited again.
        </div>
      )}
    </Card>
  );
}
