import { isWorkspaceTauriRuntime } from "../workspace-store/workspaceApi";

/** Pendiente que Xox hace solo a la hora indicada (en el código, "encargo"). Ver `slices/encargos`. */
export type EncargoStatus = "programado" | "en_curso" | "hecho" | "detenido" | "perdido";

export interface Encargo {
  id: string;
  name: string;
  instruction: string;
  steps: string[];
  files: string[];
  folder: string;
  nextRunAt: string | null;
  recurrence: string | null;
  targetApp: string | null;
  mayFinish: boolean;
  finalAction: string | null;
  status: EncargoStatus;
  sourceCardId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EncargoFinishedEvent {
  id: string;
  name: string;
  outcome: "hecho" | "detenido";
  reportPath: string | null;
}

export const ENCARGO_STATUS_LABEL: Record<EncargoStatus, string> = {
  programado: "Programado",
  en_curso: "En curso",
  hecho: "Hecho",
  detenido: "Se detuvo",
  perdido: "Se pasó la hora",
};

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "Hoy 16:00", "Mañana 09:00" o "mar 1 dic 09:30", igual que la tarjeta que arma Xox. */
export function encargoWhenLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Sin hora";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "Sin hora";
  const hhmm = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(when) - startOf(now)) / 86_400_000);
  if (days === 0) return `Hoy ${hhmm}`;
  if (days === 1) return `Mañana ${hhmm}`;
  if (days === -1) return `Ayer ${hhmm}`;
  return `${WEEKDAYS[when.getDay()]} ${when.getDate()} ${MONTHS[when.getMonth()]} ${hhmm}`;
}

export async function listEncargos(): Promise<Encargo[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Encargo[]>("list_encargos");
}

export async function runEncargoNow(id: string): Promise<boolean> {
  if (!isWorkspaceTauriRuntime()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("run_encargo_now", { id });
}

export async function removeEncargo(id: string): Promise<boolean> {
  if (!isWorkspaceTauriRuntime()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("remove_encargo", { id });
}

export async function readEncargoReport(id: string): Promise<string | null> {
  if (!isWorkspaceTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("read_encargo_report", { id });
}

export async function listRiskyButtons(): Promise<string[]> {
  if (!isWorkspaceTauriRuntime()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("list_risky_buttons");
}

export async function removeRiskyButton(phrase: string): Promise<boolean> {
  if (!isWorkspaceTauriRuntime()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("remove_risky_button", { phrase });
}

/**
 * Avisa cuando cambian los pendientes (los programa, ejecuta o cierra Rust) y cuando uno termina.
 * También escucha el cambio de espacio de trabajo, porque cada espacio tiene sus pendientes.
 */
export function subscribeEncargos(
  onChange: () => void,
  onFinished?: (ev: EncargoFinishedEvent) => void
): () => void {
  if (!isWorkspaceTauriRuntime()) return () => {};
  let active = true;
  const unlisteners: Array<() => void> = [];
  const keep = (fn: () => void) => (active ? unlisteners.push(fn) : fn());

  void import("@tauri-apps/api/event").then(({ listen }) => {
    if (!active) return;
    void listen("encargos:updated", () => active && onChange()).then(keep);
    void listen("xox:workspace-updated", () => active && onChange()).then(keep);
    void listen<EncargoFinishedEvent>("encargos:finished", (ev) => {
      if (!active) return;
      onChange();
      if (ev.payload) onFinished?.(ev.payload);
    }).then(keep);
  });

  return () => {
    active = false;
    for (const fn of unlisteners) fn();
  };
}
