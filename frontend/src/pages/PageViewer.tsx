import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Languages,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ImageViewer } from "../components/ImageViewer";
import {
  Badge,
  Button,
  ConfidenceChip,
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  IconButton,
  Modal,
  Progress,
  Segmented,
  Select,
  Skeleton,
  Spinner,
  StatusBadge,
  Textarea,
} from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { pct } from "../lib/format";
import { useMeta } from "../lib/queries";
import type { Line, PageDetail } from "../lib/types";

type ViewMode = "clean" | "binary" | "original";
type Script = "original" | "iast" | "devanagari" | "gujarati";

export default function PageViewer() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useMeta();
  const { user, can } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<ViewMode>("clean");
  const [script, setScript] = useState<Script>("original");
  const [boxes, setBoxes] = useState(true);
  const [lowOnly, setLowOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(params.get("line"));
  const [hover, setHover] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [rerun, setRerun] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const q = useQuery({
    queryKey: ["page", id],
    queryFn: () => api.get<PageDetail>(`/pages/${id}`),
    refetchInterval: (query) => (["queued", "processing"].includes(query.state.data?.status ?? "") ? 1200 : false),
  });
  const page = q.data;

  const translit = useQuery({
    queryKey: ["translit", id, script, page?.lines.map((l) => l.text).join("|")],
    queryFn: () => api.get<{ lines: Record<string, string> }>(`/pages/${id}/transliterate?to=${script}`),
    enabled: !!page && script !== "original" && page.lines.length > 0,
  });

  useEffect(() => {
    setSelected(params.get("line"));
    setEditing(null);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the selected line visible in the list.
  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-line="${selected}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const lines = useMemo(() => (page?.lines ?? []).filter((l) => !lowOnly || l.confidence < 0.6), [page, lowOnly]);

  // Keyboard: arrows move between lines, E edits, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || !page) return;
      const idx = lines.findIndex((l) => l.id === selected);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelected(lines[Math.min(lines.length - 1, idx + 1)]?.id ?? null);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelected(lines[Math.max(0, idx - 1)]?.id ?? null);
      } else if (e.key === "e" && selected && can("contributor")) {
        e.preventDefault();
        setEditing(selected);
      } else if (e.key === "Escape") {
        setEditing(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lines, selected, page, can]);

  const del = useMutation({
    mutationFn: () => api.del(`/pages/${id}`),
    onSuccess: () => {
      toast.success("Page deleted");
      qc.invalidateQueries({ queryKey: ["manuscript", page?.manuscript_id] });
      navigate(`/manuscripts/${page?.manuscript_id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.error) return <div className="p-8"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>;
  if (!page) return <div className="space-y-3 p-8"><Skeleton className="h-10 w-96" /><Skeleton className="h-[70vh]" /></div>;

  const busy = ["queued", "processing"].includes(page.status);
  const canEdit = !!user && (page.manuscript.uploaded_by === user.id || can("curator"));
  const imgSrc = mode === "original" || !page.normalized_url ? page.image_url : mode === "binary" ? page.binary_url! : page.normalized_url;
  const dims = mode === "original" || !page.normalized_url ? { w: page.width, h: page.height } : { w: page.norm_width, h: page.norm_height };
  const textOf = (l: Line) => (script === "original" ? l.text : translit.data?.lines[l.id] ?? l.text);

  function copyAll() {
    const text = page!.lines.map(textOf).join("\n");
    navigator.clipboard.writeText(text).then(() => toast.success("Page text copied"), () => toast.error("Clipboard is not available"));
  }
  function downloadTxt() {
    const blob = new Blob([page!.lines.map(textOf).join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${page!.manuscript.title.replace(/[^\w\s-]/g, "").trim() || "page"} - p${page!.page_no}${script !== "original" ? ` (${script})` : ""}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
        <Link to={`/manuscripts/${page.manuscript_id}`} className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4 shrink-0" />
          <span className="max-w-[260px] truncate font-medium">{page.manuscript.title}</span>
        </Link>
        <div className="flex items-center gap-1">
          <IconButton label="Previous page" disabled={!page.prev_page_id} onClick={() => navigate(`/pages/${page.prev_page_id}`)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <span className="font-mono text-[12px] text-muted">
            p. {page.page_no} / {page.page_total}
          </span>
          <IconButton label="Next page" disabled={!page.next_page_id} onClick={() => navigate(`/pages/${page.next_page_id}`)}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
        <StatusBadge status={page.status} />
        {page.status === "done" && (
          <span className="hidden text-[12px] text-muted md:inline">
            {page.engine} · skew {page.skew_angle ?? 0}° · {page.line_count} lines · mean {pct(page.mean_confidence)}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented<ViewMode>
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "clean", label: "Cleaned", title: "Cropped and deskewed by our pipeline" },
              { value: "binary", label: "Ink", title: "Sauvola binarisation used for line finding" },
              { value: "original", label: "Original", title: "As uploaded" },
            ]}
          />
          <IconButton label={boxes ? "Hide line boxes" : "Show line boxes"} onClick={() => setBoxes((b) => !b)} disabled={mode === "original"}>
            {boxes ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </IconButton>
          {can("contributor") && (
            <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => setRerun(true)} disabled={busy}>
              Re-read
            </Button>
          )}
          {canEdit && (
            <IconButton label="Delete page" onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Image */}
        <div className="relative h-[46vh] min-w-0 flex-1 border-b border-line lg:h-auto lg:border-r lg:border-b-0">
          <ImageViewer
            key={`${page.id}-${mode}`}
            src={imgSrc}
            width={dims.w}
            height={dims.h}
            lines={mode === "original" ? [] : page.lines}
            showBoxes={boxes && mode !== "original"}
            selectedId={selected}
            hoverId={hover}
            onSelect={(lid) => setSelected(lid)}
            onHover={setHover}
          />
          {mode !== "original" && boxes && page.lines.length > 0 && (
            <div className="absolute top-3 left-3 flex items-center gap-3 rounded-lg border border-line bg-surface/95 px-2.5 py-1.5 text-[11px] text-muted shadow-card backdrop-blur">
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-good" /> ≥85%</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-warn" /> 60–85%</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-bad" /> &lt;60%</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-indigo" /> verified</span>
            </div>
          )}
        </div>

        {/* Text panel */}
        <aside className="flex min-h-0 w-full flex-col bg-surface lg:w-[min(520px,42vw)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <Segmented<Script>
              size="sm"
              value={script}
              onChange={setScript}
              options={[
                { value: "original", label: "Original" },
                { value: "iast", label: "IAST" },
                { value: "devanagari", label: "देवनागरी" },
                { value: "gujarati", label: "ગુજરાતી" },
              ]}
            />
            {translit.isFetching && <Spinner />}
            <label className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-2">
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="accent-[var(--accent)]" />
              Low confidence only
            </label>
            <IconButton label="Copy page text" onClick={copyAll} disabled={!page.lines.length}>
              <Copy className="size-4" />
            </IconButton>
            <IconButton label="Download as .txt" onClick={downloadTxt} disabled={!page.lines.length}>
              <Download className="size-4" />
            </IconButton>
          </div>

          <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {busy ? (
              <div className="p-6">
                <div className="rounded-2xl border border-indigo/20 bg-indigo-soft p-5">
                  <div className="flex items-center gap-2 text-[13.5px] font-medium text-indigo">
                    <Spinner className="text-indigo" /> {page.job?.stage ?? "Queued"}
                  </div>
                  <Progress value={page.job?.progress ?? 2} tone="indigo" className="mt-3" />
                  <p className="mt-3 text-[12.5px] text-ink-2">
                    The page is being cleaned, split into lines and read. Attempt {page.job?.attempts ?? 1} of {page.job?.max_attempts ?? 3}.
                  </p>
                </div>
              </div>
            ) : page.status === "failed" ? (
              <div className="p-6">
                <ErrorBox error={new Error(page.job?.error || "This page could not be read.")} />
                {can("contributor") && <Button className="mt-3" onClick={() => setRerun(true)}>Try again</Button>}
              </div>
            ) : page.status === "pending" ? (
              <EmptyState title="This page has not been read yet" body="Run OCR to find and recognise its lines." action={can("contributor") ? <Button variant="primary" onClick={() => setRerun(true)}>Read this page</Button> : undefined} />
            ) : lines.length === 0 ? (
              <EmptyState title={lowOnly ? "No low-confidence lines" : "No text lines found"} body={lowOnly ? "Every line on this page reads with at least 60% confidence." : "The page may be blank, decorative or too faint."} />
            ) : (
              <ol className="divide-y divide-line">
                {lines.map((l) => (
                  <LineRow
                    key={l.id}
                    line={l}
                    text={textOf(l)}
                    script={script}
                    selected={selected === l.id}
                    hovered={hover === l.id}
                    editing={editing === l.id}
                    onSelect={() => setSelected(l.id)}
                    onHover={(h) => setHover(h ? l.id : null)}
                    onEdit={() => {
                      setSelected(l.id);
                      setEditing(l.id);
                    }}
                    onCloseEdit={() => setEditing(null)}
                    pageId={page.id}
                    language={page.manuscript.language}
                    translationAvailable={!!meta.data?.translation.available}
                    translationMessage={meta.data?.translation.message ?? ""}
                  />
                ))}
              </ol>
            )}
          </div>
          {page.lines.length > 0 && (
            <div className="border-t border-line px-4 py-2 text-[11.5px] text-muted">
              Click a box or a line · <span className="font-mono">↑ ↓</span> move · <span className="font-mono">E</span> edit
            </div>
          )}
        </aside>
      </div>

      <RerunDialog open={rerun} onClose={() => setRerun(false)} pageId={page.id} hasCorrections={page.lines.some((l) => l.verified)} />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => del.mutate()}
        loading={del.isPending}
        title={`Delete page ${page.page_no}?`}
        body="The image, its recognised lines and their corrections will be removed. This cannot be undone."
      />
    </div>
  );
}

function LineRow({
  line,
  text,
  script,
  selected,
  hovered,
  editing,
  onSelect,
  onHover,
  onEdit,
  onCloseEdit,
  pageId,
  language,
  translationAvailable,
  translationMessage,
}: {
  line: Line;
  text: string;
  script: Script;
  selected: boolean;
  hovered: boolean;
  editing: boolean;
  onSelect: () => void;
  onHover: (h: boolean) => void;
  onEdit: () => void;
  onCloseEdit: () => void;
  pageId: string;
  language: string;
  translationAvailable: boolean;
  translationMessage: string;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(line.text);
  const [translation, setTranslation] = useState<string | null>(null);

  useEffect(() => {
    if (editing) setDraft(line.text);
  }, [editing, line.text]);

  const suggest = useMutation({
    mutationFn: (t: string) => api.post<{ auto_approved: boolean }>(`/lines/${line.id}/corrections`, { text: t }),
    onSuccess: (r) => {
      toast.success(r.auto_approved ? "Line corrected and marked verified" : "Thanks! A curator will review your correction.");
      qc.invalidateQueries({ queryKey: ["page", pageId] });
      qc.invalidateQueries({ queryKey: ["corrections-count"] });
      onCloseEdit();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const translate = useMutation({
    mutationFn: () => api.post<{ text: string }>(`/lines/${line.id}/translate`, { target: "en" }),
    onSuccess: (r) => setTranslation(r.text),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <li
      data-line={line.id}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={clsx(
        "group relative cursor-pointer px-4 py-3 transition-colors",
        selected ? "bg-accent-soft/60" : hovered ? "bg-surface-2" : "hover:bg-surface-2/60",
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
      <div className="flex items-start gap-3">
        <span className="mt-1 w-6 shrink-0 text-right font-mono text-[11px] text-muted">{line.line_no}</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div onClick={(e) => e.stopPropagation()}>
              <img src={`/api/v1/lines/${line.id}/image`} alt={`Line ${line.line_no} image`} className="mb-2 max-h-24 w-full rounded-md border border-line object-contain object-left" />
              <Textarea
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) suggest.mutate(draft);
                  if (e.key === "Escape") onCloseEdit();
                }}
                className="script-text text-[17px]"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted">Ctrl + Enter to {can("curator") ? "save" : "submit"}</span>
                <div className="flex gap-2">
                  <Button size="sm" icon={<X className="size-3.5" />} onClick={onCloseEdit}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={suggest.isPending} disabled={!draft.trim() || draft.trim() === line.text} onClick={() => suggest.mutate(draft)}>
                    {can("curator") ? "Save & verify" : "Suggest fix"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className={clsx("break-words text-ink", script === "iast" ? "font-display text-[15.5px] italic" : "script-text text-[17.5px]")}>{text}</p>
              {translation && <p className="mt-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink-2">{translation}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <ConfidenceChip value={line.confidence} />
                {line.verified && (
                  <Badge tone="indigo">
                    <ShieldCheck className="size-3" /> Verified
                  </Badge>
                )}
                {line.pending_corrections > 0 && <Badge tone="warn">{line.pending_corrections} suggestion awaiting review</Badge>}
                <div className={clsx("ml-auto flex gap-0.5 transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                  {can("contributor") && (
                    <IconButton label="Correct this line" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                      <Pencil className="size-3.5" />
                    </IconButton>
                  )}
                  <IconButton
                    label={translationAvailable ? "Translate to English" : translationMessage}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!translationAvailable) {
                        toast.info(translationMessage);
                        return;
                      }
                      translate.mutate();
                    }}
                  >
                    {translate.isPending ? <Spinner /> : <Languages className="size-3.5" />}
                  </IconButton>
                  <IconButton
                    label="Copy line"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(text).then(() => toast.success("Line copied"), () => toast.error("Clipboard is not available"));
                    }}
                  >
                    <Copy className="size-3.5" />
                  </IconButton>
                </div>
              </div>
              {language && line.ocr_text !== line.text && selected && (
                <p className="mt-1.5 text-[11.5px] text-muted">
                  Machine reading was: <span className="script-text">{line.ocr_text}</span>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function RerunDialog({ open, onClose, pageId, hasCorrections }: { open: boolean; onClose: () => void; pageId: string; hasCorrections: boolean }) {
  const meta = useMeta();
  const qc = useQueryClient();
  const [engine, setEngine] = useState("auto");
  const run = useMutation({
    mutationFn: () => api.post(`/pages/${pageId}/ocr`, { engine }, { "Idempotency-Key": `${pageId}-${Date.now()}` }),
    onSuccess: () => {
      toast.success("Reading started");
      qc.invalidateQueries({ queryKey: ["page", pageId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Read this page again"
      subtitle="The page is cleaned, segmented and recognised from scratch."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>
            Start
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Recognition engine</span>
        <Select value={engine} onChange={(e) => setEngine(e.target.value)}>
          <option value="auto">Automatic: best available, with fallback</option>
          {meta.data?.engines.map((e) => (
            <option key={e.name} value={e.name} disabled={!e.available}>
              {e.label}
              {e.available ? "" : " (not configured)"}
            </option>
          ))}
        </Select>
      </label>
      {hasCorrections && (
        <div className="mt-3 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
          This page has human-verified lines. Re-reading replaces all lines, including verified ones.
        </div>
      )}
    </Modal>
  );
}
