import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search as SearchIcon, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, ConfidenceChip, EmptyState, ErrorBox, Input, PageHeader, Select, Skeleton } from "../components/ui";
import { api, qs } from "../lib/api";
import { languageLabel, useMeta } from "../lib/queries";
import type { SearchResult } from "../lib/types";

interface SearchResponse {
  query: string;
  variants: string[];
  total: number;
  fuzzy: boolean;
  results: SearchResult[];
}

const EXAMPLES = ["dharma", "karma", "धर्म", "vidya", "गणपति", "bharata"];

function Highlighted({ text, span }: { text: string; span: [number, number] | null }) {
  if (!span) return <>{text}</>;
  const [a, b] = span;
  return (
    <>
      {text.slice(0, a)}
      <mark className="rounded bg-accent-soft px-0.5 text-accent">{text.slice(a, b)}</mark>
      {text.slice(b)}
    </>
  );
}

export default function SearchPage() {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const language = params.get("language") ?? "";
  const verified = params.get("verified") === "1";
  const [draft, setDraft] = useState(q);
  const [limit, setLimit] = useState(30);

  useEffect(() => {
    setDraft(q);
    setLimit(30);
  }, [q]);

  const res = useQuery({
    queryKey: ["search", q, language, verified, limit],
    queryFn: () => api.get<SearchResponse>(`/search${qs({ q, language, verified_only: verified || undefined, limit })}`),
    enabled: q.trim().length >= 2,
    placeholderData: (prev) => prev,
  });

  function update(next: Record<string, string>) {
    const p = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    setParams(p);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (draft.trim().length >= 2) update({ q: draft.trim() });
  }

  return (
    <div className="mx-auto max-w-[980px] px-4 py-7 sm:px-8">
      <PageHeader title="Search the archive" subtitle="Search every recognised line in any script. Type in English (dharma), in Devanagari (धर्म) or in Gujarati. Small OCR mistakes are tolerated." />

      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <div className="min-w-[240px] flex-1">
          <Input icon={<SearchIcon className="size-4" />} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search for a word or phrase" className="h-11 text-[15px]" autoFocus aria-label="Search query" />
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={draft.trim().length < 2}>
          Search
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Select value={language} onChange={(e) => update({ language: e.target.value })} className="h-8 w-40 text-[12.5px]" aria-label="Language filter">
          <option value="">All languages</option>
          {meta.data?.languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={verified} onChange={(e) => update({ verified: e.target.checked ? "1" : "" })} className="accent-[var(--accent)]" />
          Human-verified lines only
        </label>
      </div>

      <div className="mt-6">
        {!q ? (
          <Card className="p-6">
            <div className="eyebrow">Try</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => update({ q: ex })} className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[13.5px] text-ink hover:border-accent/50 hover:text-accent">
                  <span className={/[ऀ-ॿ]/.test(ex) ? "script-text" : ""}>{ex}</span>
                </button>
              ))}
            </div>
          </Card>
        ) : res.error ? (
          <ErrorBox error={res.error} onRetry={() => res.refetch()} />
        ) : res.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : res.data ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span>
                <strong className="text-ink">{res.data.total}</strong> {res.data.total === 1 ? "line" : "lines"} for “{res.data.query}”
              </span>
              {res.data.variants.length > 1 && (
                <span className="flex flex-wrap items-center gap-1">
                  · also searched
                  {res.data.variants.filter((v) => v !== res.data!.query).slice(0, 4).map((v) => (
                    <Badge key={v} className="script-text !text-[12px] font-normal">{v}</Badge>
                  ))}
                </span>
              )}
              {res.data.fuzzy && (
                <Badge tone="indigo">
                  <Sparkles className="size-3" /> includes near matches
                </Badge>
              )}
            </div>
            {res.data.results.length ? (
              <div className="space-y-2.5">
                {res.data.results.map((r) => (
                  <Link key={r.line_id} to={`/pages/${r.page_id}?line=${r.line_id}`} className="group block">
                    <Card className="p-4 transition-colors group-hover:border-line-strong">
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                        <span className="font-medium text-ink">{r.manuscript_title}</span>
                        <span>· page {r.page_no}, line {r.line_no}</span>
                        <Badge>{languageLabel(meta.data, r.language)}</Badge>
                        {!r.exact && <Badge tone="indigo">near match {r.score}%</Badge>}
                        <span className="ml-auto flex items-center gap-1.5">
                          {r.verified && (
                            <Badge tone="indigo">
                              <ShieldCheck className="size-3" /> Verified
                            </Badge>
                          )}
                          <ConfidenceChip value={r.confidence} />
                        </span>
                      </div>
                      <p className="script-text mt-2 text-[18px] text-ink">
                        <Highlighted text={r.text} span={r.match_field === "text" ? r.highlight : null} />
                      </p>
                      <p className="font-display mt-0.5 text-[13.5px] text-muted italic">{r.iast}</p>
                      <div className="mt-2 flex items-center gap-1 text-[12px] font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                        Open on the page <ArrowRight className="size-3.5" />
                      </div>
                    </Card>
                  </Link>
                ))}
                {res.data.total > res.data.results.length && (
                  <div className="pt-2 text-center">
                    <Button onClick={() => setLimit((l) => l + 30)} loading={res.isFetching}>
                      Show more ({res.data.total - res.data.results.length} left)
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <Card>
                <EmptyState icon={<SearchIcon className="size-5" />} title="No lines match" body="Try another spelling, fewer words, or switch off the filters." />
              </Card>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
