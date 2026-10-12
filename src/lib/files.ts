import { invoke } from "@tauri-apps/api/core";

/** Subfolders of Documents/Sonda Serial. */
export type FolderKind = "logs" | "exports";

export const logStart = (name: string) => invoke<string>("log_start", { name });
export const logWrite = (text: string) => invoke<void>("log_write", { text });
export const logStop = () => invoke<void>("log_stop");
export const saveExport = (name: string, contents: string) => invoke<string>("save_export", { name, contents });
export const openFolder = (kind: FolderKind) => invoke<void>("open_folder", { kind });

/** Local date and time for file names: "2026-10-12_15-30-01". */
export function fileStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
