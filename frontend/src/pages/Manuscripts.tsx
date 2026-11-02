import { useQuery } from "@tanstack/react-query";
import { BookOpenText, Filter, MapPin, Plus, Search as SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ManuscriptForm } from "../components/ManuscriptForm";
import { Badge, Button, Card, ConfidenceChip, EmptyState, ErrorBox, Input, PageHeader, Select, Skeleton } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { century, MATERIALS } from "../lib/format";
import { useMeta } from "../lib/queries";
import type { Manuscript } from "../lib/types";

export default function Manuscripts() {
  const { can } = useAuth();
  const meta = useMeta();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const language = params.get("language") ?? "";
  const [creating, setCreating] = useState(params.get("new") === "1");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const list = useQuery({
    queryKey: ["manuscripts", debounced, language],
    queryFn: () => api.get<{ total: number; items: Manuscript[] }>(`/manuscripts${qs({ q: debounced, language, limit: 100 })}`),
    refetchInterval: (query) => (query.state.data?.items.some((m) => m.done_pages < m.page_count) ? 4000 : false),
  });

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-7 sm:px-8">
      <PageHeader
        title="Manuscripts"
        subtitle="Every folio in the archive. Open one to read it line by line, compare transliterations and suggest fixes."
        actions={
          can("contributor") && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New manuscript
            </Button>
          )
        }
      />

      <Card className="mb-5 flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-[220px] flex-1">
          <Input icon={<SearchIcon className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, repository or description" aria-label="Filter manuscripts" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted" />
          <Select
            value={language}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set("language", e.target.value);
              else next.delete("language");
              setParams(next, { replace: true });
            }}
            className="w-44"
            aria-label="Language"
          >
            <option value="">All languages</option>
            {meta.data?.languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </Select>
        </div>
        <span className="text-[12.5px] text-muted">{list.data ? `${list.data.total} manuscripts` : ""}</span>
      </Card>

      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}

      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : list.data?.items.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.items.map((m, i) => (
            <Link key={m.id} to={`/manuscripts/${m.id}`} className="rise group" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
              <Card className="h-full overflow-hidden transition-all group-hover:-translate-y-0.5 group-hover:border-line-strong group-hover:shadow-pop">
                <div className="relative h-40 overflow-hidden bg-surface-3">
                  {m.cover_url ? (
                    <img src={m.cover_url} alt="" loading="lazy" className="size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted">
                      <BookOpenText className="size-8" />
                    </div>
                  )}
                  <div className="absolute top-2.5 left-2.5 flex gap-1.5">
                    <Badge className="bg-surface/90 backdrop-blur">{m.language_label}</Badge>
                    {m.material !== "paper" && <Badge className="bg-surface/90 backdrop-blur">{MATERIALS[m.material]}</Badge>}
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-display line-clamp-2 text-[16.5px] leading-snug font-semibold text-ink">{m.title}</h3>
                  <div className="mt-1 text-[12.5px] text-muted">
                    {century(m.century)}
                    {m.site_name && (
                      <>
                        {" · "}
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="size-3" />
                          {m.site_name}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[12px] text-ink-2">
                    <span>
                      {m.page_count} {m.page_count === 1 ? "page" : "pages"} · {m.line_count} lines
                    </span>
                    {m.done_pages < m.page_count ? (
                      <Badge tone="indigo" dot>
                        Reading {m.done_pages}/{m.page_count}
                      </Badge>
                    ) : m.mean_confidence !== null ? (
                      <ConfidenceChip value={m.mean_confidence} />
                    ) : (
                      <Badge>No pages</Badge>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<BookOpenText className="size-5" />}
            title={debounced || language ? "No manuscripts match these filters" : "The archive is empty"}
            body={debounced || language ? "Try a different word or clear the language filter." : "Create a manuscript and upload photos or a PDF of its pages."}
            action={
              can("contributor") && !debounced && !language ? (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  New manuscript
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      <ManuscriptForm
        open={creating}
        onClose={() => {
          setCreating(false);
          if (params.get("new")) {
            params.delete("new");
            setParams(params, { replace: true });
          }
        }}
        onSaved={(m) => navigate(`/manuscripts/${m.id}?upload=1`)}
      />
    </div>
  );
}
