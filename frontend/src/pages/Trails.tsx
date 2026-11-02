import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Car, Footprints, Plus, Route } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { date, minutes } from "../lib/format";
import type { Trail } from "../lib/types";

export default function Trails() {
  const q = useQuery({ queryKey: ["trails"], queryFn: () => api.get<{ items: Trail[] }>("/trails") });
  return (
    <div className="mx-auto max-w-[1040px] px-4 py-7 sm:px-8">
      <PageHeader
        title="My trails"
        subtitle="Heritage routes you have planned. Each one is ordered for the shortest trip and can be shared with a link."
        actions={
          <Link to="/map">
            <Button variant="primary" icon={<Plus className="size-4" />}>
              Plan a trail
            </Button>
          </Link>
        }
      />
      {q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : q.data?.items.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {q.data.items.map((t) => (
            <Link key={t.id} to={`/trails/${t.id}`} className="group">
              <Card className="h-full p-4 transition-colors group-hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-[16.5px] font-semibold">{t.name}</div>
                    <div className="text-[12px] text-muted">Planned {date(t.created_at)}</div>
                  </div>
                  <Badge>{t.mode === "walk" ? <><Footprints className="size-3" /> Walk</> : <><Car className="size-3" /> Drive</>}</Badge>
                </div>
                <ol className="mt-3 space-y-1 text-[12.5px] text-ink-2">
                  {t.stops.slice(0, 4).map((s, i) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className="flex size-4 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">{i + 1}</span>
                      <span className="truncate">{s.name}</span>
                    </li>
                  ))}
                  {t.stops.length > 4 && <li className="pl-6 text-muted">+{t.stops.length - 4} more</li>}
                </ol>
                <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[12.5px]">
                  <span className="text-ink-2">
                    {t.total_km} km · {minutes(t.total_minutes)} with visits
                  </span>
                  <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<Route className="size-5" />} title="No trails yet" body="Open the heritage map, tick a few places and plan a route." action={<Link to="/map"><Button variant="primary">Open the map</Button></Link>} />
        </Card>
      )}
    </div>
  );
}
