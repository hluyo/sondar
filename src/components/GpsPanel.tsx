import { useEffect, useReducer } from "react";
import type { GpsConfig, GpsSimulator } from "../lib/gpsSimulator";
import { t } from "../lib/i18n";
import type { PositionTracker } from "../lib/positionTracker";
import type { RouteData } from "../lib/routeData";
import type { RouteFaults, RoutePlayer, Speed } from "../lib/routePlayer";
import type { Settings } from "../lib/settings";
import type { Theme } from "../lib/theme";
import { MapPanel } from "./MapPanel";
import { PlayerCard, ResultsTable, RouteDetails, RouteExport, RouteFaultsEditor, RouteHeader, RouteSteps, useRouteLoader } from "./RoutePanel";
import { LastSentence, SyntheticCard, SyntheticSettings } from "./SimulatorPanel";
import { Collapsible } from "./ui";

interface Props {
  tracker: PositionTracker;
  simulator: GpsSimulator;
  player: RoutePlayer;
  theme: Theme;
  visible: boolean;
  connected: boolean;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onGpsConfig: (config: GpsConfig) => void;
  onRouteLoaded: (route: RouteData) => void;
  onRouteRemoved: () => void;
  onExport: (name: string, contents: string) => Promise<string | null>;
  onOpenExportFolder: () => void;
}

/**
 * The GPS tab: the map and its player on one screen. With a recorded route it
 * plays frame files and grades the answers; with the synthetic GPS it generates
 * sentences. Everything else is in folded sections below.
 */
export function GpsPanel(props: Props) {
  const { tracker, simulator, player, theme, visible, connected, settings, update } = props;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => player.changes.on(rerender), [player]);
  useEffect(() => simulator.changes.on(rerender), [simulator]);
  // Distances, ages and countdowns move even when nothing new arrives.
  useEffect(() => {
    const id = window.setInterval(rerender, 500);
    return () => window.clearInterval(id);
  }, []);

  const loader = useRouteLoader(props.onRouteLoaded);
  const source = settings.simSource;
  const route = player.route;
  const faultsOn = settings.routeFaults.checksum.on || settings.routeFaults.bytesLost.on || player.signalLossLeft > 0;
  const syntheticFaultsOn = Object.values(settings.gps.faults).some((f) => f.on);

  const setRouteFaults = (routeFaults: RouteFaults) => {
    update({ routeFaults });
    player.setFaults(routeFaults);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 scroll-thin [&>*]:shrink-0">
      {loader.inputs}

      {source === "route" && !route ? (
        <RouteSteps connected={connected} loader={loader} />
      ) : (
        <>
          {source === "route" && route ? (
            <RouteHeader route={route} loader={loader} onRemove={props.onRouteRemoved} />
          ) : (
            <span className="text-[12.5px] text-fg-2">
              <b className="text-fg">{t("Synthetic GPS")}</b> · {t("GGA sentences generated along a track")}
            </span>
          )}
          <MapPanel tracker={tracker} simulator={simulator} player={player} theme={theme} visible={visible} source={source} />
          {source === "route" ? (
            <PlayerCard
              player={player}
              connected={connected}
              speed={settings.routeSpeed}
              loop={settings.routeLoop}
              onSpeed={(routeSpeed: Speed) => {
                update({ routeSpeed });
                player.setSpeed(routeSpeed);
              }}
              onLoop={(routeLoop) => {
                update({ routeLoop });
                player.setLoop(routeLoop);
              }}
            />
          ) : (
            <SyntheticCard simulator={simulator} config={settings.gps} connected={connected} />
          )}
        </>
      )}

      {source === "route" ? (
        <>
          <Collapsible title={t("Simulate errors")} summary={faultsOn ? t("on") : t("off")}>
            <RouteFaultsEditor player={player} faults={settings.routeFaults} onChange={setRouteFaults} />
          </Collapsible>
          <Collapsible title={t("Results per frame")} summary={t("last 8")}>
            <ResultsTable player={player} />
          </Collapsible>
          <Collapsible title={t("Live details")} summary={t("points, time, speed, distance")}>
            <RouteDetails player={player} tracker={tracker} txOnlyGga={settings.routeTxOnlyGga} onTxOnlyGga={(routeTxOnlyGga) => update({ routeTxOnlyGga })} />
          </Collapsible>
          <Collapsible title={t("Export")} summary="CSV · GPX">
            <RouteExport player={player} onExport={props.onExport} onOpenExportFolder={props.onOpenExportFolder} />
          </Collapsible>
        </>
      ) : (
        <>
          <Collapsible title={t("Synthetic GPS settings")} summary={syntheticFaultsOn ? t("errors on") : undefined} defaultOpen>
            <SyntheticSettings config={settings.gps} onConfigChange={props.onGpsConfig} />
          </Collapsible>
          <Collapsible title={t("Last sentence, field by field")}>
            <LastSentence simulator={simulator} />
          </Collapsible>
        </>
      )}

      <Collapsible title={t("Data source")} summary={source === "route" ? t("Recorded route") : t("Synthetic GPS")}>
        <div className="flex flex-col gap-2">
          {(
            [
              { value: "route", title: t("Recorded route"), hint: t("Frame files of a real trip (nmea_0001.txt…), one per second, checked against a reference CSV.") },
              { value: "synthetic", title: t("Synthetic GPS"), hint: t("GGA sentences generated on the fly on a fixed point, a circle or a straight line.") },
            ] as const
          ).map((o) => (
            <label key={o.value} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1 hover:bg-raised">
              <input
                type="radio"
                name="gps-source"
                checked={source === o.value}
                onChange={() => update({ simSource: o.value })}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <span className="flex flex-col">
                <span className="font-medium">{o.title}</span>
                <span className="text-xs text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </Collapsible>
    </div>
  );
}
