import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { useState } from "react";
import { Card, EmptyState, ErrorBox, Input, PageHeader, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import type { ActivityItem } from "../lib/types";

export default function Audit() {
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api.get<{ items: ActivityItem[] }>("/audit?limit=300"), refetchInterval: 15000 });
  const items = (q.data?.items ?? []).filter((a) => !filter || `${a.action} ${a.user} ${a.entity}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-7 sm:px-8">
      <PageHeader title="Audit log" subtitle="Append-only record of sign-ins, uploads, OCR runs, corrections, reviews, exports and role changes." actions={<Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by action or person" className="w-64" aria-label="Filter audit log" />} />
      <Card className="overflow-hidden">
        {q.error ? (
          <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>
        ) : q.isLoading ? (
          <Skeleton className="m-4 h-72" />
        ) : items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Time", "Who", "Action", "Target", "Details"].map((h) => (
                    <th key={h} className="eyebrow px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">{new Date(a.ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-ink">{a.user}</td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-accent">{a.action}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-ink-2">
                      {a.entity} <span className="font-mono text-[11px] text-muted">{a.entity_id.slice(0, 8)}</span>
                    </td>
                    <td className="max-w-[360px] truncate px-4 py-2.5 font-mono text-[11px] text-muted">{Object.keys(a.detail ?? {}).length ? JSON.stringify(a.detail) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<ScrollText className="size-5" />} title="No entries" />
        )}
      </Card>
    </div>
  );
}
