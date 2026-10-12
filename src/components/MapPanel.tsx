import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { distance, type GpsSimulator, type LatLon } from "../lib/gpsSimulator";
import type { PositionTracker } from "../lib/positionTracker";
import type { RouteData } from "../lib/routeData";
import { type BurstResult, formatDistance, type RoutePlayer } from "../lib/routePlayer";
import { t } from "../lib/i18n";
import { cssColor, type Theme } from "../lib/theme";
import { TrashIcon } from "./icons";

interface Props {
  tracker: PositionTracker;
  simulator: GpsSimulator;
  player: RoutePlayer;
  theme: Theme;
  /** The map lives in a tab; Leaflet must re-measure when it becomes visible. */
  visible: boolean;
  /** Which GPS source is in use: it decides whether the reference route or the sent position is drawn. */
  source: "route" | "synthetic";
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const REFRESH_MS = 200;
const START_ZOOM = 18;
/** Above this distance between sent and reported positions the device is probably parsing wrong. */
const MISMATCH_METERS = 25;

const carIcon = L.divIcon({
  className: "sonda-car",
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  html: '<div class="sonda-car-body"><svg viewBox="-17 -17 34 34" width="34" height="34" aria-hidden="true"><circle r="16" class="sonda-car-halo"/><path d="M0,-11 L8,9 L0,4.5 L-8,9 Z" class="sonda-car-arrow"/></svg></div>',
});

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function pinIcon(label: string, kind: "start" | "end") {
  return L.divIcon({
    className: `sonda-pin sonda-pin-${kind}`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<span class="sonda-pin-dot"></span><span class="sonda-pin-label">${escapeHtml(label)}</span>`,
  });
}

interface Readout {
  reported: (LatLon & { fix: boolean; age: number }) | null;
  sent: LatLon | null;
  gap: number | null;
  noSignal: boolean;
  routeResult: BurstResult | null;
  hasRoute: boolean;
}

const toLatLng = (p: LatLon): L.LatLngTuple => [p.lat, p.lon];
const streetPoint = (s: RouteData["steps"][number]): L.LatLngTuple => [s.streetLat, s.streetLon];

function headingBetween(a: LatLon, b: LatLon) {
  const north = b.lat - a.lat;
  const east = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  return (Math.atan2(east, north) * 180) / Math.PI;
}

/**
 * Map of the position the device reports (the car). Depending on what is
 * running it also shows the position the synthetic simulator sent (dashed
 * ring) or the reference route of a recorded route (grey dashed line, start
 * and end pins, wrong answers in red).
 */
export function MapPanel({ tracker, simulator, player, theme, visible, source }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{
    mcuTrail: L.Polyline;
    sentTrail: L.Polyline;
    ghost: L.CircleMarker;
    reference: L.Polyline;
    wrong: L.LayerGroup;
  } | null>(null);
  const followRef = useRef(true);
  const showSentRef = useRef(true);
  const showRefRef = useRef(true);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [follow, setFollow] = useState(true);
  const [showSent, setShowSent] = useState(true);
  const [showRef, setShowRef] = useState(true);
  const [offline, setOffline] = useState(false);
  const [readout, setReadout] = useState<Readout>({ reported: null, sent: null, gap: null, noSignal: false, routeResult: null, hasRoute: false });

  useEffect(() => {
    const first = player.route?.steps[0];
    const start: LatLon = tracker.last ?? (first ? { lat: first.streetLat, lon: first.streetLon } : simulator.config);
    const map = L.map(hostRef.current!, { zoomControl: false, scrollWheelZoom: false }).setView(toLatLng(start), START_ZOOM);
    // The map sits in a scrolling panel: the wheel scrolls the panel until the map is clicked.
    map.on("click", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION })
      .on("tileerror", () => setOffline(true))
      .on("tileload", () => setOffline(false))
      .addTo(map);

    const reference = L.polyline([], { weight: 5, opacity: 0.5, dashArray: "8 8", interactive: false }).addTo(map);
    const sentTrail = L.polyline([], { weight: 2, dashArray: "6 6", interactive: false }).addTo(map);
    const mcuTrail = L.polyline([], { weight: 4, opacity: 0.85, interactive: false }).addTo(map);
    const wrong = L.layerGroup().addTo(map);
    const ghost = L.circleMarker([0, 0], { radius: 12, weight: 2, dashArray: "4 4", fill: false, interactive: false });
    const car = L.marker([0, 0], { icon: carIcon, interactive: false, keyboard: false, zIndexOffset: 1000 });
    const startPin = L.marker([0, 0], { interactive: false, keyboard: false });
    const endPin = L.marker([0, 0], { interactive: false, keyboard: false });
    layersRef.current = { mcuTrail, sentTrail, ghost, reference, wrong };
    mapRef.current = map;

    // Dragging the map means the user wants to look around: stop following.
    map.on("dragstart", () => {
      followRef.current = false;
      setFollow(false);
    });

    let drawn = "";
    let drawnRoute: RouteData | null | undefined;
    let drawnWrong = "";
    const refresh = () => {
      const route = player.route;
      if (route !== drawnRoute) {
        drawnRoute = route;
        if (route) {
          const points = route.steps.map(streetPoint);
          reference.setLatLngs(points);
          startPin.setLatLng(points[0]).setIcon(pinIcon(route.startLabel, "start")).addTo(map);
          endPin.setLatLng(points[points.length - 1]).setIcon(pinIcon(route.endLabel, "end")).addTo(map);
          map.fitBounds(reference.getBounds(), { padding: [40, 40] });
        } else {
          reference.setLatLngs([]);
          startPin.remove();
          endPin.remove();
        }
      }
      const routeMode = sourceRef.current === "route";
      reference.setStyle({ opacity: showRefRef.current && routeMode ? 0.5 : 0 });
      if (route && routeMode) {
        if (!map.hasLayer(startPin)) startPin.addTo(map);
        if (!map.hasLayer(endPin)) endPin.addTo(map);
      } else {
        startPin.remove();
        endPin.remove();
      }

      // Wrong answers of the route, in red, with what was expected.
      const results = player.results;
      const wrongKey = `${route && routeMode ? results.length : 0}:${results[results.length - 1]?.verdict}`;
      if (wrongKey !== drawnWrong) {
        drawnWrong = wrongKey;
        wrong.clearLayers();
        const color = cssColor("--color-err");
        for (const r of route && routeMode ? results : []) {
          const p = r.responses.find((x) => x.kind === "pos");
          if (r.verdict !== "wrong" || !p) continue;
          L.circleMarker([p.lat!, p.lon!], { radius: 6, color, weight: 2, fillColor: color, fillOpacity: 0.6 })
            .bindTooltip(`#${r.step.index} ${r.step.utc}: ${p.text}<br>${t("expected")} ${r.expected ?? t("no response")}${r.errorMeters !== null ? ` (${formatDistance(r.errorMeters)})` : ""}`)
            .addTo(wrong);
        }
      }

      const last = tracker.last;
      const sentLast = simulator.trail[simulator.trail.length - 1] ?? null;
      const key = `${tracker.version}|${simulator.trail.length}|${sentLast?.lat}|${showSentRef.current}|${routeMode}`;
      if (key !== drawn) {
        drawn = key;
        mcuTrail.setLatLngs(tracker.trail.map(toLatLng));
        if (last) {
          car.setLatLng(toLatLng(last));
          if (!map.hasLayer(car)) car.addTo(map);
          const el = car.getElement();
          el?.classList.toggle("no-fix", !last.fix);
          const t = tracker.trail;
          for (let i = t.length - 2; i >= 0; i--) {
            if (t[i].lat !== t[t.length - 1].lat || t[i].lon !== t[t.length - 1].lon) {
              const body = el?.querySelector<HTMLElement>(".sonda-car-body");
              if (body) body.style.transform = `rotate(${headingBetween(t[i], t[t.length - 1])}deg)`;
              break;
            }
          }
        } else if (map.hasLayer(car)) {
          car.remove();
        }

        const sentVisible = showSentRef.current && sentLast !== null && !routeMode;
        sentTrail.setLatLngs(sentVisible ? simulator.trail.map(toLatLng) : []);
        if (sentVisible) {
          ghost.setLatLng(toLatLng(sentLast));
          if (!map.hasLayer(ghost)) ghost.addTo(map);
        } else if (map.hasLayer(ghost)) {
          ghost.remove();
        }

        const focus = last ?? sentLast;
        if (followRef.current && focus) map.panTo(toLatLng(focus), { animate: true, duration: 0.25 });
      }

      setReadout({
        reported: last ? { lat: last.lat, lon: last.lon, fix: last.fix, age: (Date.now() - last.time) / 1000 } : null,
        sent: sentLast,
        gap: last && sentLast && simulator.running ? distance(last, sentLast) : null,
        noSignal: tracker.signal === "nofix",
        routeResult: route ? (player.lastResult ?? null) : null,
        hasRoute: !!route,
      });
    };
    refresh();
    const id = window.setInterval(refresh, REFRESH_MS);

    return () => {
      window.clearInterval(id);
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, [tracker, simulator, player]);

  // Line colors come from the theme tokens.
  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    const tx = cssColor("--color-tx");
    layers.mcuTrail.setStyle({ color: cssColor("--color-accent") });
    layers.sentTrail.setStyle({ color: tx });
    layers.ghost.setStyle({ color: tx });
    layers.reference.setStyle({ color: cssColor("--color-dim") });
  }, [theme]);

  useEffect(() => {
    if (visible) mapRef.current?.invalidateSize();
  }, [visible]);

  const toggleFollow = () => {
    const next = !follow;
    followRef.current = next;
    setFollow(next);
    const focus = tracker.last ?? simulator.trail[simulator.trail.length - 1];
    if (next && focus) mapRef.current?.panTo(toLatLng(focus));
  };

  const toggleSent = () => {
    showSentRef.current = !showSent;
    setShowSent(!showSent);
  };

  const toggleRef = () => {
    showRefRef.current = !showRef;
    setShowRef(!showRef);
  };

  const { reported, sent, gap, noSignal, routeResult, hasRoute } = readout;
  const routeMode = source === "route" && hasRoute;
  const routeWrong = routeMode && routeResult?.verdict === "wrong" && routeResult.errorMeters !== null ? routeResult : null;
  const mismatch = !routeMode && gap !== null && gap > MISMATCH_METERS;

  const showBoth = () => {
    const target: LatLon | null = routeWrong ? { lat: routeWrong.step.streetLat, lon: routeWrong.step.streetLon } : sent;
    if (!reported || !target) return;
    followRef.current = false;
    setFollow(false);
    mapRef.current?.fitBounds([toLatLng(reported), toLatLng(target)], { padding: [48, 48], maxZoom: START_ZOOM });
  };

  const clearTracks = () => {
    tracker.clear();
    simulator.clearTrail();
  };

  const warning = routeWrong
    ? t("Frame {n}: the board reports a position {d} away from the expected one. Check the ddmm.mmmm to degrees conversion and the N/S, E/W signs.", {
        n: routeWrong.step.index,
        d: formatDistance(routeWrong.errorMeters!),
      })
    : mismatch
      ? t("The board reports a position {d} away from the one sent. Check the ddmm.mmmm to degrees conversion and the N/S, E/W signs.", { d: formatDistance(gap!) })
      : null;

  const overlayButton = "flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-panel px-2.5 text-xs text-fg-2 shadow-[0_2px_8px_var(--color-shadow)] hover:text-fg";
  const pressedRing = "ring-2 ring-accent/60";

  let status: { text: string; tone: string };
  if (!reported) status = { text: noSignal ? t("The board answers NOFIX: no position yet") : t("Waiting for a position from the board"), tone: "text-muted" };
  else if (!reported.fix) status = { text: t("NOFIX · last known position"), tone: "text-warn" };
  else status = { text: `${reported.lat.toFixed(6)}, ${reported.lon.toFixed(6)} · ${t("{s} s ago", { s: reported.age.toFixed(1) })}`, tone: "text-fg-2" };

  let check: { text: string; tone: string } | null = null;
  if (routeMode && routeResult && routeResult.verdict !== "pending") {
    const v = routeResult.verdict;
    check = {
      text:
        v === "ok" || v === "rounding"
          ? `✓ ${t("matches the CSV")}`
          : v === "wrong"
            ? `✗ ${t("expected")} ${routeResult.expected ?? t("no response")}`
            : v === "format"
              ? `✗ ${t("format error")}`
              : v === "duplicate"
                ? t("duplicate answer")
                : t("no answer"),
      tone: v === "ok" || v === "rounding" ? "text-ok" : v === "wrong" || v === "format" ? "text-err" : "text-warn",
    };
  } else if (!routeMode && gap !== null) {
    check = { text: `${t("Difference with the sent position")}: ${formatDistance(gap)}`, tone: mismatch ? "text-warn" : "text-ok" };
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className={`relative h-[clamp(220px,36vh,460px)] overflow-hidden rounded-xl border border-line ${theme === "dark" ? "map-dark" : ""}`}>
        <div ref={hostRef} className="absolute inset-0" />

        <div className="absolute top-2.5 right-12 z-[500] flex flex-col items-end gap-1.5">
          {routeMode ? (
            <button type="button" aria-pressed={showRef} onClick={toggleRef} className={`${overlayButton} ${showRef ? pressedRing : ""}`}>
              {t("Reference route")}
            </button>
          ) : (
            <button type="button" aria-pressed={showSent} onClick={toggleSent} className={`${overlayButton} ${showSent ? pressedRing : ""}`}>
              {t("Sent position")}
            </button>
          )}
          <button type="button" aria-pressed={follow} onClick={toggleFollow} className={`${overlayButton} ${follow ? pressedRing : ""}`}>
            {t("Follow vehicle")}
          </button>
          <button type="button" onClick={clearTracks} title={t("Clear the board's track")} className={overlayButton}>
            <TrashIcon size={12} />
            {t("Clear track")}
          </button>
        </div>

        {!reported && !sent && !noSignal && (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 z-[500] mx-auto w-fit max-w-[80%] rounded-lg border border-line-strong bg-panel px-3 py-2 text-center text-xs leading-relaxed text-muted shadow-[0_4px_14px_var(--color-shadow)]">
            {t("The board's answers are drawn here: lines like")} <code className="font-mono text-fg-2">POS,43.307078,-2.011059</code>
          </div>
        )}
        {noSignal && (
          <div className="pointer-events-none absolute top-2.5 left-1/2 z-[500] flex -translate-x-1/2 items-center gap-2 rounded-full border border-warn bg-panel px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap text-warn shadow-[0_4px_14px_var(--color-shadow)]">
            <span className="size-2 animate-pulse rounded-full bg-warn" />
            {t("No GPS signal (NOFIX)")}
          </div>
        )}
        {warning && (
          <div className="absolute right-3 bottom-8 left-3 z-[500] flex items-start gap-2 rounded-lg border border-err bg-panel px-3 py-2 text-xs leading-relaxed text-fg shadow-[0_4px_14px_var(--color-shadow)]">
            <span className="font-semibold text-err">!</span>
            <span className="flex-1">{warning}</span>
            <button type="button" onClick={showBoth} className="shrink-0 font-medium text-tx hover:underline">
              {t("Show both")}
            </button>
          </div>
        )}
        {offline && (
          <div className="pointer-events-none absolute inset-x-3 bottom-8 z-[500] rounded-lg border border-line-strong bg-panel px-3 py-2 text-xs text-muted">
            {t("Map tiles could not load. They need an internet connection; positions are still drawn.")}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 font-mono text-[11.5px]">
        <span className="flex items-center gap-1.5 text-muted">
          <svg width="10" height="10" viewBox="-12 -12 24 24" aria-hidden="true">
            <path d="M0,-11 L8,9 L0,4.5 L-8,9 Z" fill="var(--color-accent)" />
          </svg>
          {t("Board")}:
        </span>
        <span className={status.tone}>{status.text}</span>
        {check && <span className={`ml-auto ${check.tone}`}>{check.text}</span>}
      </div>
    </div>
  );
}
