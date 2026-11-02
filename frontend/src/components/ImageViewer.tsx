import clsx from "clsx";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { confidenceTone } from "../lib/format";
import type { Line } from "../lib/types";
import { IconButton } from "./ui";

interface View {
  scale: number;
  x: number;
  y: number;
}

const STROKE = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)" };

/** Zoomable, pannable page image with an SVG overlay of recognised line boxes. */
export function ImageViewer({
  src,
  width,
  height,
  lines,
  showBoxes,
  selectedId,
  hoverId,
  onSelect,
  onHover,
}: {
  src: string;
  width: number;
  height: number;
  lines: Line[];
  showBoxes: boolean;
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !width || !height) return;
    const s = Math.min(el.clientWidth / width, el.clientHeight / height) * 0.96;
    setView({ scale: s, x: (el.clientWidth - width * s) / 2, y: (el.clientHeight - height * s) / 2 });
  }, [width, height]);

  useLayoutEffect(() => {
    fit();
  }, [fit, src]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Bring the selected line into view (zoom so the line fills about 85% of the width).
  useEffect(() => {
    const el = box.current;
    const ln = lines.find((l) => l.id === selectedId);
    if (!el || !ln) return;
    setView((v) => {
      const target = Math.min(Math.max((el.clientWidth * 0.85) / ln.w, v.scale), 4);
      const cx = ln.x + ln.w / 2;
      const cy = ln.y + ln.h / 2;
      const sx = cx * v.scale + v.x;
      const sy = cy * v.scale + v.y;
      const visible = sx > 40 && sx < el.clientWidth - 40 && sy > 40 && sy < el.clientHeight - 40 && ln.w * v.scale <= el.clientWidth;
      const readable = ln.h * v.scale >= 28; // too small to compare with the text -> zoom in
      if (visible && readable) return v;
      return { scale: target, x: el.clientWidth / 2 - cx * target, y: el.clientHeight / 2 - cy * target };
    });
  }, [selectedId, lines]);

  function zoomAt(factor: number, px?: number, py?: number) {
    const el = box.current;
    if (!el) return;
    const cx = px ?? el.clientWidth / 2;
    const cy = py ?? el.clientHeight / 2;
    setView((v) => {
      const scale = Math.min(Math.max(v.scale * factor, 0.05), 8);
      const k = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="relative size-full overflow-hidden bg-[radial-gradient(var(--line)_1px,transparent_1px)] [background-size:16px_16px]">
      <div
        ref={box}
        className={clsx("absolute inset-0 touch-none", drag.current ? "cursor-grabbing" : "cursor-grab")}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        }}
        onPointerUp={() => {
          setTimeout(() => (drag.current = null), 0);
        }}
        onDoubleClick={(e) => {
          const r = box.current!.getBoundingClientRect();
          zoomAt(1.8, e.clientX - r.left, e.clientY - r.top);
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {!loaded && <div className="skeleton absolute inset-0" />}
          <img
            src={src}
            alt="Manuscript page"
            draggable={false}
            onLoad={() => setLoaded(true)}
            className="block size-full rounded-sm shadow-pop select-none"
          />
          {showBoxes && (
            <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 size-full">
              {lines.map((ln) => {
                const tone = confidenceTone(ln.confidence);
                const active = ln.id === selectedId;
                const hover = ln.id === hoverId;
                return (
                  <g key={ln.id}>
                    <rect
                      x={ln.x}
                      y={ln.y}
                      width={ln.w}
                      height={ln.h}
                      rx={4}
                      fill={active ? "rgb(178 71 45 / 0.14)" : hover ? "rgb(46 67 116 / 0.10)" : "transparent"}
                      stroke={active ? "var(--accent)" : ln.verified ? "var(--indigo)" : STROKE[tone]}
                      strokeWidth={(active ? 3 : 1.6) / view.scale}
                      strokeDasharray={ln.verified ? undefined : `${6 / view.scale} ${3 / view.scale}`}
                      className="cursor-pointer"
                      onPointerEnter={() => onHover(ln.id)}
                      onPointerLeave={() => onHover(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!drag.current?.moved) onSelect(ln.id);
                      }}
                    />
                    {(active || hover) && (
                      <text x={ln.x + 4} y={ln.y - 6 / view.scale} fontSize={13 / view.scale} fill="var(--accent)" fontWeight={600} fontFamily="var(--font-mono)">
                        {ln.line_no}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
      <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-xl border border-line bg-surface/95 p-1 shadow-card backdrop-blur">
        <IconButton label="Zoom out" onClick={() => zoomAt(1 / 1.3)}>
          <Minus className="size-4" />
        </IconButton>
        <span className="w-12 text-center font-mono text-[11.5px] text-muted tabular-nums">{Math.round(view.scale * 100)}%</span>
        <IconButton label="Zoom in" onClick={() => zoomAt(1.3)}>
          <Plus className="size-4" />
        </IconButton>
        <IconButton label="Fit page" onClick={fit}>
          <Maximize2 className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
