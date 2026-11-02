import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useState } from "react";

// MapLibre v6 loads its tile worker from a separate file; let Vite bundle it and tell MapLibre where it is.
maplibregl.setWorkerUrl(workerUrl);

/** Keyless vector basemaps from OpenFreeMap (OpenStreetMap data), light and dark to match the app theme. */
export function baseStyle(dark: boolean): string | StyleSpecification {
  return `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;
}

/** Tracks the app's dark-mode class so maps can swap tiles. */
export function useDarkClass() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export const KIND_COLOR: Record<string, string> = {
  unesco: "#b2472d",
  repository: "#2e4374",
  temple: "#9a6512",
  stepwell: "#2f7a4b",
  monument: "#6b4f9a",
  museum: "#3b7a8a",
  fort: "#7a5a3b",
  other: "#7a7064",
};

export function markerEl(kind: string, label?: string, active = false) {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", label ?? kind);
  const color = KIND_COLOR[kind] ?? KIND_COLOR.other;
  el.style.cssText = `width:${active ? 30 : 22}px;height:${active ? 30 : 22}px;border-radius:999px;background:${color};border:3px solid white;box-shadow:0 2px 8px rgb(0 0 0 / .35);cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;font:600 11px Inter Variable, sans-serif;transition:transform .15s`;
  if (label) el.textContent = label;
  el.onmouseenter = () => (el.style.transform = "scale(1.15)");
  el.onmouseleave = () => (el.style.transform = "");
  return el;
}

export function fitTo(map: maplibregl.Map, points: [number, number][], padding = 70) {
  if (!points.length) return;
  const b = new maplibregl.LngLatBounds(points[0], points[0]);
  points.forEach((p) => b.extend(p));
  map.fitBounds(b, { padding, maxZoom: 13, duration: 800 });
}
