import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as maplibregl from "maplibre-gl";
import { ArrowLeft, Clock, ExternalLink, Link2, MapPin, Navigation, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Button, Card, ConfirmDialog, ErrorBox, PageHeader, Skeleton, Stat } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { minutes, SITE_KINDS } from "../lib/format";
import { baseStyle, fitTo, markerEl, useDarkClass } from "../lib/map";
import type { Trail } from "../lib/types";

export default function TrailDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const dark = useDarkClass();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [deleting, setDeleting] = useState(false);
  const q = useQuery({ queryKey: ["trail", id], queryFn: () => api.get<Trail>(`/trails/${id}`) });
  const t = q.data;

  useEffect(() => {
    if (!t || !el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: baseStyle(dark), center: [t.start.lng, t.start.lat], zoom: 10, attributionControl: { compact: true } });
    map.current = m;
    m.on("load", () => {
      m.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: t.geometry } });
      m.addLayer({ id: "casing", type: "line", source: "route", paint: { "line-color": "#fff", "line-width": 7 }, layout: { "line-cap": "round", "line-join": "round" } });
      m.addLayer({
        id: "route",
        type: "line",
        source: "route",
        paint: { "line-color": "#b2472d", "line-width": 4, ...(t.routing === "straight-line" ? { "line-dasharray": [2, 1.5] } : {}) },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      const start = document.createElement("div");
      start.style.cssText = "width:16px;height:16px;border-radius:999px;background:#2e4374;border:3px solid white;box-shadow:0 0 0 5px rgb(46 67 116 / .25)";
      new maplibregl.Marker({ element: start }).setLngLat([t.start.lng, t.start.lat]).addTo(m);
      t.stops.forEach((s, i) => new maplibregl.Marker({ element: markerEl(s.kind, String(i + 1), true) }).setLngLat([s.lng, s.lat]).addTo(m));
      fitTo(m, t.geometry.coordinates as [number, number][], 50);
    });
    return () => m.remove();
  }, [t, dark]);

  const del = useMutation({
    mutationFn: () => api.del(`/trails/${id}`),
    onSuccess: () => {
      toast.success("Trail deleted");
      qc.invalidateQueries({ queryKey: ["trails"] });
      navigate("/trails");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.error) return <div className="mx-auto max-w-[1100px] px-4 py-7 sm:px-8"><ErrorBox error={q.error} /></div>;
  if (!t) return <div className="mx-auto max-w-[1100px] space-y-3 px-4 py-7 sm:px-8"><Skeleton className="h-10 w-72" /><Skeleton className="h-96" /></div>;

  const travel = t.legs.reduce((a, l) => a + l.minutes, 0);
  const gmaps = `https://www.google.com/maps/dir/${[`${t.start.lat},${t.start.lng}`, ...t.stops.map((s) => `${s.lat},${s.lng}`)].join("/")}`;

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-7 sm:px-8">
      <PageHeader
        back={<Link to="/trails" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> My trails</Link>}
        title={t.name}
        subtitle={`${t.stops.length} stops · ${t.mode === "walk" ? "walking" : "driving"} · ${t.routing === "osrm" ? "road route" : "straight-line estimate (router was offline)"}`}
        actions={
          <>
            <Button icon={<Link2 className="size-4" />} onClick={() => navigator.clipboard.writeText(window.location.href).then(() => toast.success("Link copied"), () => toast.error("Clipboard is not available"))}>
              Copy link
            </Button>
            <a href={gmaps} target="_blank" rel="noreferrer">
              <Button variant="primary" icon={<Navigation className="size-4" />}>Navigate</Button>
            </a>
            {user?.id === t.user_id && (
              <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>
                Delete
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Distance" value={`${t.total_km} km`} icon={<MapPin className="size-4" />} tone="accent" />
        <Stat label="Travel time" value={minutes(travel)} icon={<Navigation className="size-4" />} tone="indigo" />
        <Stat label="With visits" value={minutes(t.total_minutes)} icon={<Clock className="size-4" />} tone="good" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card className="h-[480px] overflow-hidden">
          <div ref={el} className="size-full" />
        </Card>
        <Card className="p-4">
          <div className="eyebrow mb-3">Itinerary</div>
          <ol className="relative space-y-4 border-l-2 border-dashed border-line pl-5">
            <li className="relative">
              <span className="absolute top-0.5 -left-[27px] size-3.5 rounded-full border-2 border-surface bg-indigo" />
              <div className="text-[13px] font-medium">Start</div>
              <div className="text-[11.5px] text-muted">
                {t.start.lat.toFixed(4)}, {t.start.lng.toFixed(4)}
              </div>
            </li>
            {t.stops.map((s, i) => (
              <li key={s.id} className="relative">
                <span className="absolute top-0 -left-[30px] flex size-5 items-center justify-center rounded-full bg-accent text-[10.5px] font-semibold text-white">{i + 1}</span>
                <div className="text-[11.5px] text-muted">
                  {t.legs[i]?.km} km · {minutes(t.legs[i]?.minutes ?? 0)} {t.mode === "walk" ? "walk" : "drive"}
                </div>
                <div className="text-[13.5px] font-medium">{s.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                  <Badge>{SITE_KINDS[s.kind] ?? s.kind}</Badge> spend about {minutes(s.visit_minutes)}
                </div>
                <Link to={`/map?site=${s.id}`} className="mt-1 inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
                  Details <ExternalLink className="size-3" />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => del.mutate()} loading={del.isPending} title="Delete this trail?" body="The route and its stops will be removed. The heritage sites themselves stay on the map." />
    </div>
  );
}
