import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileWarning, MapPin, Pencil, Play, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ManuscriptForm } from "../components/ManuscriptForm";
import { UploadPages } from "../components/UploadPages";
import { Badge, Button, Card, CardHeader, ConfidenceChip, ConfirmDialog, EmptyState, ErrorBox, PageHeader, Progress, Skeleton, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { century, date, MATERIALS } from "../lib/format";
import { scriptLabel, useMeta } from "../lib/queries";
import type { Manuscript, Page } from "../lib/types";

export default function ManuscriptDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useMeta();
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showUpload, setShowUpload] = useState(params.get("upload") === "1");

  const q = useQuery({
    queryKey: ["manuscript", id],
    queryFn: () => api.get<Manuscript & { pages: Page[] }>(`/manuscripts/${id}`),
    refetchInterval: (query) => (query.state.data?.pages.some((p) => ["queued", "processing"].includes(p.status)) ? 1500 : false),
  });
  const ms = q.data;
  const canEdit = !!ms && !!user && (ms.uploaded_by === user.id || can("curator"));

  const runAll = useMutation({
    mutationFn: () => api.post<{ queued: number }>(`/manuscripts/${id}/ocr?only_pending=true`, { engine: "auto" }),
    onSuccess: (r) => {
      toast.success(r.queued ? `Reading ${r.queued} ${r.queued === 1 ? "page" : "pages"}` : "All pages are already read");
      qc.invalidateQueries({ queryKey: ["manuscript", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => api.del(`/manuscripts/${id}`),
    onSuccess: () => {
      toast.success("Manuscript deleted");
      qc.invalidateQueries({ queryKey: ["manuscripts"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      navigate("/manuscripts");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.error) return <div className="mx-auto max-w-[1240px] px-4 py-7 sm:px-8"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>;
  if (!ms) return <div className="mx-auto max-w-[1240px] space-y-4 px-4 py-7 sm:px-8"><Skeleton className="h-10 w-80" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;

  const pending = ms.pages.filter((p) => p.status === "pending" || p.status === "failed").length;
  const active = ms.pages.filter((p) => ["queued", "processing"].includes(p.status)).length;

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-7 sm:px-8">
      <PageHeader
        back={
          <Link to="/manuscripts" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
            <ArrowLeft className="size-3.5" /> All manuscripts
          </Link>
        }
        title={ms.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{ms.language_label}</Badge>
            <Badge>{scriptLabel(meta.data, ms.script)} script</Badge>
            <Badge>{MATERIALS[ms.material]}</Badge>
            <span>{century(ms.century)}</span>
          </span>
        }
        actions={
          canEdit && (
            <>
              <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>
                Delete
              </Button>
              <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setShowUpload((s) => !s)}>
                Add pages
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="About this manuscript" />
          <div className="p-5">
            <p className="text-[13.5px] leading-relaxed whitespace-pre-line text-ink-2">{ms.description || "No description yet."}</p>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
              <div>
                <dt className="eyebrow">Repository</dt>
                <dd className="mt-0.5 text-ink">{ms.repository || "—"}</dd>
              </div>
              <div>
                <dt className="eyebrow">Associated place</dt>
                <dd className="mt-0.5 text-ink">
                  {ms.site_id ? (
                    <Link to={`/map?site=${ms.site_id}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                      <MapPin className="size-3.5" /> {ms.site_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="eyebrow">Licence</dt>
                <dd className="mt-0.5 text-ink">{ms.license || "—"}</dd>
              </div>
              <div>
                <dt className="eyebrow">Added</dt>
                <dd className="mt-0.5 text-ink">{date(ms.created_at)}</dd>
              </div>
              <div>
                <dt className="eyebrow">Source</dt>
                <dd className="mt-0.5">
                  {ms.source_url ? (
                    <a href={ms.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                      Original scan <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </Card>
        <Card>
          <CardHeader title="Reading progress" />
          <div className="space-y-4 p-5">
            <div>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-ink-2">Pages read</span>
                <span className="font-semibold tabular-nums">
                  {ms.done_pages} / {ms.page_count}
                </span>
              </div>
              <Progress value={ms.page_count ? (ms.done_pages / ms.page_count) * 100 : 0} className="mt-2" tone="good" />
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink-2">Lines recognised</span>
              <span className="font-semibold tabular-nums">{ms.line_count}</span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink-2">Mean confidence</span>
              {ms.mean_confidence !== null ? <ConfidenceChip value={ms.mean_confidence} /> : <span className="text-muted">—</span>}
            </div>
            {can("contributor") && pending > 0 && (
              <Button className="w-full" icon={<Play className="size-4" />} loading={runAll.isPending} onClick={() => runAll.mutate()}>
                Read {pending} unread {pending === 1 ? "page" : "pages"}
              </Button>
            )}
            {active > 0 && <div className="rounded-lg bg-indigo-soft px-3 py-2 text-[12.5px] text-indigo">Reading {active} {active === 1 ? "page" : "pages"} now. This view updates by itself.</div>}
          </div>
        </Card>
      </div>

      {showUpload && canEdit && (
        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[14.5px] font-semibold">Add pages</h3>
            <button className="text-[12.5px] text-muted hover:text-ink" onClick={() => { setShowUpload(false); params.delete("upload"); setParams(params, { replace: true }); }}>
              Close
            </button>
          </div>
          <UploadPages manuscriptId={ms.id} onDone={() => setShowUpload(false)} />
        </Card>
      )}

      <div className="mt-7 mb-3 flex items-center justify-between">
        <h2 className="font-display text-[19px] font-semibold">Pages</h2>
        <span className="text-[12.5px] text-muted">{ms.page_count} total</span>
      </div>
      {ms.pages.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {ms.pages.map((p) => (
            <Link key={p.id} to={`/pages/${p.id}`} className="group">
              <Card className="overflow-hidden transition-all group-hover:border-line-strong group-hover:shadow-pop">
                <div className="relative aspect-[4/3] overflow-hidden bg-surface-3">
                  <img src={p.normalized_url ?? p.image_url} alt={`Page ${p.page_no}`} loading="lazy" className="size-full object-cover object-top" />
                  <span className="absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white">p. {p.page_no}</span>
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={p.status} />
                    {p.status === "done" && p.mean_confidence !== null && <ConfidenceChip value={p.mean_confidence} />}
                  </div>
                  {["queued", "processing"].includes(p.status) && p.job ? (
                    <div>
                      <Progress value={p.job.progress} tone="indigo" />
                      <div className="mt-1 truncate text-[11px] text-muted">{p.job.stage}</div>
                    </div>
                  ) : p.status === "failed" ? (
                    <div className="flex items-center gap-1 text-[11.5px] text-bad">
                      <FileWarning className="size-3.5" /> {p.job?.error?.slice(0, 60) || "Could not read this page"}
                    </div>
                  ) : (
                    <div className="text-[11.5px] text-muted">{p.status === "done" ? `${p.line_count} lines · ${p.engine}` : "Not read yet"}</div>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Upload className="size-5" />}
            title="No pages yet"
            body="Upload photos or a scanned PDF. Each page is cleaned, split into lines and read automatically."
            action={canEdit && !showUpload ? <Button variant="primary" onClick={() => setShowUpload(true)}>Add pages</Button> : undefined}
          />
        </Card>
      )}

      <ManuscriptForm open={editing} onClose={() => setEditing(false)} initial={ms} onSaved={() => setEditing(false)} />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => del.mutate()}
        loading={del.isPending}
        title="Delete this manuscript?"
        body={
          <>
            <strong>{ms.title}</strong>, its {ms.page_count} pages, {ms.line_count} recognised lines and all corrections will be removed. This cannot be undone.
          </>
        }
      />
    </div>
  );
}
