import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { FileImage, FileText, ImageUp, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { API, loadSession } from "../lib/api";
import { useMeta } from "../lib/queries";
import { Button, Progress, Select } from "./ui";

const ACCEPT = "image/jpeg,image/png,image/tiff,image/webp,image/bmp,application/pdf";
const MAX_MB = 25;

function upload(manuscriptId: string, files: File[], autoOcr: boolean, engine: string, onProgress: (p: number) => void) {
  return new Promise<{ pages: unknown[] }>((resolve, reject) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("auto_ocr", String(autoOcr));
    form.append("engine", engine);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/manuscripts/${manuscriptId}/pages`);
    const s = loadSession();
    if (s) xhr.setRequestHeader("Authorization", `Bearer ${s.access_token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress((e.loaded / e.total) * 100);
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body?.error?.message ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(form);
  });
}

export function UploadPages({ manuscriptId, onDone, compact }: { manuscriptId: string; onDone?: () => void; compact?: boolean }) {
  const qc = useQueryClient();
  const meta = useMeta();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [autoOcr, setAutoOcr] = useState(true);
  const [engine, setEngine] = useState("auto");

  function add(list: FileList | null) {
    if (!list) return;
    const ok: File[] = [];
    for (const f of Array.from(list)) {
      if (!ACCEPT.split(",").includes(f.type)) {
        toast.error(`${f.name}: use JPG, PNG, TIFF, WebP or PDF`);
        continue;
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        toast.error(`${f.name} is larger than ${MAX_MB} MB`);
        continue;
      }
      ok.push(f);
    }
    setFiles((prev) => [...prev, ...ok].slice(0, 50));
  }

  async function send() {
    if (!files.length) return;
    setProgress(0);
    try {
      const res = await upload(manuscriptId, files, autoOcr, engine, setProgress);
      toast.success(`${res.pages.length} ${res.pages.length === 1 ? "page" : "pages"} added${autoOcr ? " — reading started" : ""}`);
      setFiles([]);
      qc.invalidateQueries({ queryKey: ["manuscript", manuscriptId] });
      qc.invalidateQueries({ queryKey: ["manuscripts"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        role="button"
        tabIndex={0}
        className={clsx(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition-colors",
          compact ? "px-4 py-6" : "px-6 py-10",
          drag ? "border-accent bg-accent-soft/50" : "border-line-strong bg-surface-2/50 hover:border-accent/50 hover:bg-surface-2",
        )}
      >
        <div className="flex size-11 items-center justify-center rounded-2xl bg-surface text-accent shadow-card">
          <ImageUp className="size-5" />
        </div>
        <div className="mt-3 text-[13.5px] font-medium text-ink">Drop page photos or a PDF here</div>
        <div className="mt-0.5 text-[12px] text-muted">or click to choose · JPG, PNG, TIFF, WebP, PDF · up to {MAX_MB} MB each</div>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <div className="mt-3 space-y-3">
          <ul className="divide-y divide-line rounded-xl border border-line">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                {f.type === "application/pdf" ? <FileText className="size-4 text-muted" /> : <FileImage className="size-4 text-muted" />}
                <span className="flex-1 truncate text-ink">{f.name}</span>
                <span className="text-[11.5px] text-muted tabular-nums">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                <button className="rounded p-1 text-muted hover:bg-surface-2 hover:text-ink" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} disabled={progress !== null}>
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={autoOcr} onChange={(e) => setAutoOcr(e.target.checked)} className="size-4 accent-[var(--accent)]" />
              Read pages after upload
            </label>
            {autoOcr && (
              <Select value={engine} onChange={(e) => setEngine(e.target.value)} className="h-8 w-56 text-[12.5px]" aria-label="OCR engine">
                <option value="auto">Engine: automatic (recommended)</option>
                {meta.data?.engines.filter((e) => e.available).map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.label}
                  </option>
                ))}
              </Select>
            )}
            <div className="ml-auto flex gap-2">
              <Button onClick={() => setFiles([])} disabled={progress !== null}>
                Clear
              </Button>
              <Button variant="primary" onClick={send} loading={progress !== null}>
                Upload {files.length} {files.length === 1 ? "file" : "files"}
              </Button>
            </div>
          </div>
          {progress !== null && (
            <div>
              <Progress value={progress} />
              <div className="mt-1 text-[11.5px] text-muted">{progress < 100 ? `Uploading… ${progress.toFixed(0)}%` : "Processing images on the server…"}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
