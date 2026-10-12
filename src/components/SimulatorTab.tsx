import type { ReactNode } from "react";
import { Segmented } from "./ui";

type Source = "route" | "synthetic";

interface Props {
  source: Source;
  onSourceChange: (source: Source) => void;
  route: ReactNode;
  synthetic: ReactNode;
}

/** The Simulator tab: a recorded route played from files, or the synthetic GPS. */
export function SimulatorTab({ source, onSourceChange, route, synthetic }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="text-xs text-muted">Source</span>
        <Segmented
          label="Simulator source"
          value={source}
          options={[
            { value: "route", label: "Recorded route", title: "Burst files of a real route, checked against a reference CSV" },
            { value: "synthetic", label: "Synthetic GPS", title: "GGA sentences generated on the fly along a track" },
          ]}
          onChange={onSourceChange}
        />
      </div>
      {source === "route" ? route : synthetic}
    </div>
  );
}
