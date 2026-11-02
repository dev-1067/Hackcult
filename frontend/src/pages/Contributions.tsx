import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ScrollText } from "lucide-react";
import { Link } from "react-router-dom";
import { Diff } from "../components/Diff";
import { Card, EmptyState, ErrorBox, PageHeader, Skeleton, Stat, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { Correction } from "../lib/types";

export default function Contributions() {
  const q = useQuery({ queryKey: ["my-corrections"], queryFn: () => api.get<{ items: Correction[] }>("/corrections/mine") });
  const items = q.data?.items ?? [];
  const by = (s: string) => items.filter((c) => c.status === s).length;

  return (
    <div className="mx-auto max-w-[980px] px-4 py-7 sm:px-8">
      <PageHeader title="My contributions" subtitle="Corrections you have suggested and what reviewers decided." />
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Pending" value={by("pending")} tone="warn" />
        <Stat label="Approved" value={by("approved")} tone="good" />
        <Stat label="Rejected" value={by("rejected")} tone="bad" />
      </div>
      {q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Skeleton className="h-60" />
      ) : items.length ? (
        <Card className="divide-y divide-line">
          {items.map((c) => (
            <div key={c.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                <span className="font-medium text-ink">{c.manuscript_title}</span>
                <span>· page {c.page_no}, line {c.line_no}</span>
                <span>· {timeAgo(c.created_at)}</span>
                <span className="ml-auto flex items-center gap-2">
                  <StatusBadge status={c.status} kind="correction" />
                  {c.page_id && (
                    <Link to={`/pages/${c.page_id}?line=${c.line_id}`} className="text-accent" aria-label="Open line">
                      <ExternalLink className="size-3.5" />
                    </Link>
                  )}
                </span>
              </div>
              <p className="script-text mt-1.5 text-[16.5px]">
                <Diff before={c.previous_text} after={c.text} />
              </p>
              {c.review_note && <p className="mt-1 text-[12px] text-muted">Reviewer: {c.review_note}</p>}
            </div>
          ))}
        </Card>
      ) : (
        <Card>
          <EmptyState icon={<ScrollText className="size-5" />} title="No contributions yet" body="Open any page, select a line with a red box and suggest a fix." action={<Link to="/manuscripts" className="text-[13px] font-medium text-accent hover:underline">Browse manuscripts</Link>} />
        </Card>
      )}
    </div>
  );
}
