import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import * as maplibregl from "maplibre-gl";
import { BookOpenText, Car, Crosshair, ExternalLink, Footprints, Locate, MapPin, Plus, Route, Search as SearchIcon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, Segmented, Select, Skeleton, Spinner, Textarea } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { minutes, SITE_KINDS } from "../lib/format";
import { baseStyle, fitTo, KIND_COLOR, markerEl, useDarkClass } from "../lib/map";
import { useSites } from "../lib/queries";
import type { Manuscript, Site, Trail } from "../lib/types";

const PRESETS = [
  { label: "IIT Gandhinagar", lat: 23.2135, lng: 72.6847 },
  { label: "Ahmedabad old city", lat: 23.0225, lng: 72.581 },
  { label: "Patan", lat: 23.8493, lng: 72.1266 },
  { label: "Vadodara", lat: 22.3072, lng: 73.1812 },
];

export default function MapPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sites = useSites();
  const dark = useDarkClass();
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const startMarker = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);

  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState("");
  const [start, setStart] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [radius, setRadius] = useState(50);
  const [selected, setSelected] = useState<string | null>(params.get("site"));
  const [trailIds, setTrailIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"drive" | "walk">("drive");
  const [trailName, setTrailName] = useState("My heritage trail");
  const [trail, setTrail] = useState<Trail | null>(null);
  const [locating, setLocating] = useState(false);
  const [adding, setAdding] = useState(false);

  const nearby = useQuery({
    queryKey: ["nearby", start?.lat, start?.lng, radius],
    queryFn: () => api.get<{ items: Site[] }>(`/sites/nearby${qs({ lat: start!.lat, lng: start!.lng, radius_km: radius, limit: 200 })}`),
    enabled: !!start,
  });

  const detail = useQuery({
    queryKey: ["site", selected],
    queryFn: () => api.get<Site & { manuscripts: Manuscript[] }>(`/sites/${selected}`),
    enabled: !!selected,
  });

  const list = useMemo(() => {
    const base = start ? nearby.data?.items ?? [] : sites.data?.items ?? [];
    const f = filter.trim().toLowerCase();
    return base.filter((s) => (!kind || s.kind === kind) && (!f || `${s.name} ${s.city} ${s.state}`.toLowerCase().includes(f)));
  }, [start, nearby.data, sites.data, filter, kind]);

  // Create the map once.
  useEffect(() => {
    if (!mapEl.current || map.current) return;
    const m = new maplibregl.Map({ container: mapEl.current, style: baseStyle(dark), center: [72.4, 22.9], zoom: 6.2, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => setReady(true));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Swap tiles with the theme (route layers are re-added after the style change).
  useEffect(() => {
    if (!map.current || !ready) return;
    map.current.setStyle(baseStyle(dark));
    map.current.once("styledata", () => drawRoute(trail));
  }, [dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Site markers.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current.clear();
    const order = trail ? new Map(trail.stops.map((s, i) => [s.id, i + 1])) : null;
    for (const s of list) {
      const n = order?.get(s.id);
      const el = markerEl(s.kind, n ? String(n) : undefined, s.id === selected || !!n);
      el.title = s.name;
      el.onclick = (e) => {
        e.stopPropagation();
        setSelected(s.id);
      };
      markers.current.set(s.id, new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(m));
    }
  }, [list, ready, selected, trail]);

  // Fly to selection.
  useEffect(() => {
    const s = list.find((x) => x.id === selected) ?? sites.data?.items.find((x) => x.id === selected);
    if (s && map.current) map.current.flyTo({ center: [s.lng, s.lat], zoom: Math.max(map.current.getZoom(), 11), duration: 900 });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start point marker and framing.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    startMarker.current?.remove();
    if (!start) return;
    const el = document.createElement("div");
    el.style.cssText = "width:18px;height:18px;border-radius:999px;background:#2e4374;border:3px solid white;box-shadow:0 0 0 6px rgb(46 67 116 / .25)";
    el.title = start.label;
    startMarker.current = new maplibregl.Marker({ element: el }).setLngLat([start.lng, start.lat]).addTo(m);
    const pts: [number, number][] = [[start.lng, start.lat], ...(nearby.data?.items ?? []).slice(0, 12).map((s) => [s.lng, s.lat] as [number, number])];
    fitTo(m, pts);
  }, [start, ready, nearby.data]);

  function drawRoute(t: Trail | null) {
    const m = map.current;
    if (!m) return;
    if (m.getLayer("route")) m.removeLayer("route");
    if (m.getLayer("route-casing")) m.removeLayer("route-casing");
    if (m.getSource("route")) m.removeSource("route");
    if (!t) return;
    m.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: t.geometry } });
    m.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
    m.addLayer({
      id: "route",
      type: "line",
      source: "route",
      paint: { "line-color": "#b2472d", "line-width": 4, ...(t.routing === "straight-line" ? { "line-dasharray": [2, 1.5] } : {}) },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    fitTo(m, t.geometry.coordinates as [number, number][]);
  }

  const build = useMutation({
    mutationFn: () => {
      const origin = start ?? PRESETS[0];
      return api.post<Trail>("/trails", { name: trailName.trim() || "My heritage trail", mode, start_lat: origin.lat, start_lng: origin.lng, site_ids: trailIds });
    },
    onSuccess: (t) => {
      setTrail(t);
      drawRoute(t);
      qc.invalidateQueries({ queryKey: ["trails"] });
      toast.success(`Trail ready: ${t.stops.length} stops, ${t.total_km} km`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function locate() {
    if (!navigator.geolocation) {
      toast.error("Your browser cannot share location. Pick a starting point instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setStart({ lat: p.coords.latitude, lng: p.coords.longitude, label: "Your location" });
        toast.success("Showing heritage near you");
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === 1 ? "Location permission was denied. Pick a starting point instead." : "Could not get your location. Pick a starting point instead.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  function toggleTrail(id: string) {
    setTrail(null);
    drawRoute(null);
    setTrailIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 12 ? (toast.error("A trail can have up to 12 stops"), ids) : [...ids, id]));
  }

  const allSites = sites.data?.items ?? [];
  const nameOf = (id: string) => allSites.find((s) => s.id === id)?.name ?? "Site";

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row">
      {/* Side panel */}
      <aside className="scroll-thin order-2 flex min-h-0 w-full flex-col overflow-y-auto border-line bg-surface lg:order-1 lg:w-[400px] lg:border-r">
        <div className="space-y-3 border-b border-line p-4">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-[20px] font-semibold">Heritage map</h1>
            {can("curator") && (
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
                Add site
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" icon={locating ? <Spinner className="text-white" /> : <Locate className="size-3.5" />} onClick={locate} disabled={locating}>
              Near me
            </Button>
            <Select
              value={start && start.label !== "Your location" ? start.label : ""}
              onChange={(e) => {
                const p = PRESETS.find((x) => x.label === e.target.value);
                setStart(p ? { ...p } : null);
              }}
              className="h-8 flex-1 text-[12.5px]"
              aria-label="Starting point"
            >
              <option value="">{start?.label === "Your location" ? "Your location" : "Start from…"}</option>
              {PRESETS.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </Select>
            {start && (
              <IconButton label="Clear starting point" onClick={() => setStart(null)}>
                <X className="size-4" />
              </IconButton>
            )}
          </div>
          {start && (
            <div className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <Crosshair className="size-3.5 text-indigo" /> Within
              <Select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="h-7 w-24 text-[12px]" aria-label="Radius">
                {[10, 25, 50, 100, 250, 1000].map((r) => (
                  <option key={r} value={r}>
                    {r} km
                  </option>
                ))}
              </Select>
              of {start.label}
            </div>
          )}
          <div className="flex gap-2">
            <Input icon={<SearchIcon className="size-4" />} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter places" className="h-8 text-[12.5px]" aria-label="Filter places" />
            <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-36 text-[12.5px]" aria-label="Kind">
              <option value="">All kinds</option>
              {Object.entries(SITE_KINDS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Trail builder */}
        <div className="border-b border-line bg-surface-2/50 p-4">
          <div className="flex items-center gap-2">
            <Route className="size-4 text-accent" />
            <span className="text-[13.5px] font-semibold">Trail builder</span>
            <span className="text-[12px] text-muted">{trailIds.length}/12 stops</span>
          </div>
          {trailIds.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-muted">Tick places below to add them. We order the stops for the shortest route from your starting point.</p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {trailIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-[12px]">
                    {nameOf(id)}
                    <button onClick={() => toggleTrail(id)} className="text-muted hover:text-bad" aria-label={`Remove ${nameOf(id)}`}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input value={trailName} onChange={(e) => setTrailName(e.target.value)} className="h-8 min-w-[140px] flex-1 text-[12.5px]" aria-label="Trail name" />
                <Segmented<"drive" | "walk">
                  size="sm"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "drive", label: <><Car className="size-3.5" /> Drive</> },
                    { value: "walk", label: <><Footprints className="size-3.5" /> Walk</> },
                  ]}
                />
              </div>
              <Button className="mt-2.5 w-full" variant="primary" loading={build.isPending} onClick={() => build.mutate()}>
                Plan trail from {start?.label ?? PRESETS[0].label}
              </Button>
            </>
          )}
          {trail && (
            <div className="rise mt-3 rounded-xl border border-line bg-surface p-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="eyebrow">Distance</div>
                  <div className="text-[15px] font-semibold tabular-nums">{trail.total_km} km</div>
                </div>
                <div>
                  <div className="eyebrow">Travel</div>
                  <div className="text-[15px] font-semibold">{minutes(trail.travel_minutes ?? 0)}</div>
                </div>
                <div>
                  <div className="eyebrow">With visits</div>
                  <div className="text-[15px] font-semibold">{minutes(trail.total_minutes)}</div>
                </div>
              </div>
              <ol className="mt-3 space-y-1.5 text-[12.5px]">
                {trail.stops.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[10.5px] font-semibold text-white">{i + 1}</span>
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-muted tabular-nums">
                      {trail.legs[i]?.km} km · {minutes(trail.legs[i]?.minutes ?? 0)}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted">
                <span>{trail.routing === "osrm" ? "Road route via OSRM" : "Router offline: straight-line estimate"}</span>
                <button className="font-medium text-accent hover:underline" onClick={() => navigate(`/trails/${trail.id}`)}>
                  Open trail
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1">
          {sites.isLoading || (start && nearby.isLoading) ? (
            <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : list.length ? (
            <ul className="divide-y divide-line">
              {list.map((s) => (
                <li key={s.id} className={clsx("flex items-start gap-3 px-4 py-3 transition-colors", selected === s.id ? "bg-accent-soft/50" : "hover:bg-surface-2")}>
                  <input
                    type="checkbox"
                    checked={trailIds.includes(s.id)}
                    onChange={() => toggleTrail(s.id)}
                    className="mt-1 size-4 accent-[var(--accent)]"
                    aria-label={`Add ${s.name} to trail`}
                  />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(s.id)}>
                    <div className="flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[s.kind] ?? KIND_COLOR.other }} />
                      <span className="truncate text-[13.5px] font-medium text-ink">{s.name}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-muted">
                      {SITE_KINDS[s.kind] ?? s.kind} · {s.city}
                      {s.manuscript_count ? ` · ${s.manuscript_count} manuscript${s.manuscript_count > 1 ? "s" : ""}` : ""}
                    </div>
                  </button>
                  {s.distance_km !== undefined && <span className="shrink-0 text-[12px] text-muted tabular-nums">{s.distance_km} km</span>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<MapPin className="size-5" />} title="No places here" body={start ? "Try a larger radius or a different starting point." : "Try another filter."} />
          )}
        </div>
      </aside>

      {/* Map */}
      <div className="relative order-1 h-[45vh] min-w-0 flex-1 lg:order-2 lg:h-auto">
        <div ref={mapEl} className="absolute inset-0 h-full w-full" style={{ position: "absolute" }} />
        {selected && (
          <Card className="rise absolute top-3 left-3 z-10 w-[min(360px,calc(100%-24px))] overflow-hidden">
            {detail.data ? (
              <>
                <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
                  <div>
                    <Badge className="mb-1" tone={detail.data.kind === "unesco" ? "accent" : detail.data.kind === "repository" ? "indigo" : "neutral"}>
                      {SITE_KINDS[detail.data.kind] ?? detail.data.kind}
                    </Badge>
                    <div className="font-display text-[17px] leading-snug font-semibold">{detail.data.name}</div>
                    <div className="text-[12px] text-muted">
                      {detail.data.city}, {detail.data.state} · {detail.data.era}
                    </div>
                  </div>
                  <IconButton label="Close" onClick={() => setSelected(null)}>
                    <X className="size-4" />
                  </IconButton>
                </div>
                <div className="scroll-thin max-h-[40vh] space-y-3 overflow-y-auto px-4 py-3">
                  <p className="text-[13px] leading-relaxed text-ink-2">{detail.data.description}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={trailIds.includes(detail.data.id) ? "soft" : "secondary"} icon={<Route className="size-3.5" />} onClick={() => toggleTrail(detail.data!.id)}>
                      {trailIds.includes(detail.data.id) ? "In trail" : "Add to trail"}
                    </Button>
                    <a href={`https://www.google.com/maps/dir/?api=1&destination=${detail.data.lat},${detail.data.lng}`} target="_blank" rel="noreferrer">
                      <Button size="sm" icon={<ExternalLink className="size-3.5" />}>Directions</Button>
                    </a>
                    {detail.data.source_url && (
                      <a href={detail.data.source_url} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="ghost">Source</Button>
                      </a>
                    )}
                  </div>
                  <div>
                    <div className="eyebrow mb-1.5">Manuscripts linked to this place</div>
                    {detail.data.manuscripts.length ? (
                      <ul className="space-y-1.5">
                        {detail.data.manuscripts.map((m) => (
                          <li key={m.id}>
                            <Link to={`/manuscripts/${m.id}`} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[12.5px] hover:border-line-strong">
                              <BookOpenText className="size-3.5 text-accent" />
                              <span className="flex-1 truncate font-medium">{m.title}</span>
                              <span className="text-muted">{m.page_count} p.</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[12.5px] text-muted">None yet. Link a manuscript to this place from its edit form.</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="p-4"><Skeleton className="h-28" /></div>
            )}
          </Card>
        )}
        <div className="absolute bottom-3 left-3 z-10 hidden flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line bg-surface/95 px-3 py-2 text-[11px] text-ink-2 shadow-card backdrop-blur sm:flex">
          {Object.entries(SITE_KINDS).filter(([k]) => k !== "other").map(([k, l]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} /> {l}
            </span>
          ))}
        </div>
      </div>

      <AddSiteModal open={adding} onClose={() => setAdding(false)} center={map.current?.getCenter()} />
    </div>
  );
}

function AddSiteModal({ open, onClose, center }: { open: boolean; onClose: () => void; center?: maplibregl.LngLat }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", kind: "monument", lat: "", lng: "", city: "", state: "Gujarat", era: "", description: "" });
  useEffect(() => {
    if (open && center) setF((x) => ({ ...x, lat: center.lat.toFixed(5), lng: center.lng.toFixed(5) }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => api.post<Site>("/sites", { ...f, lat: Number(f.lat), lng: Number(f.lng) }),
    onSuccess: (s) => {
      toast.success(`${s.name} added to the map`);
      qc.invalidateQueries({ queryKey: ["sites"] });
      onClose();
      setF({ name: "", kind: "monument", lat: "", lng: "", city: "", state: "Gujarat", era: "", description: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const valid = f.name.trim().length >= 2 && !isNaN(Number(f.lat)) && !isNaN(Number(f.lng)) && f.lat !== "" && f.lng !== "";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a heritage site"
      subtitle="Coordinates start at the current map centre."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            Add site
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name">
            <Input value={f.name} onChange={set("name")} placeholder="e.g. Rudabai Stepwell" />
          </Field>
        </div>
        <Field label="Kind">
          <Select value={f.kind} onChange={set("kind")}>
            {Object.entries(SITE_KINDS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Era">
          <Input value={f.era} onChange={set("era")} placeholder="15th century" />
        </Field>
        <Field label="Latitude">
          <Input value={f.lat} onChange={set("lat")} inputMode="decimal" />
        </Field>
        <Field label="Longitude">
          <Input value={f.lng} onChange={set("lng")} inputMode="decimal" />
        </Field>
        <Field label="City">
          <Input value={f.city} onChange={set("city")} />
        </Field>
        <Field label="State">
          <Input value={f.state} onChange={set("state")} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <Textarea rows={3} value={f.description} onChange={set("description")} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
