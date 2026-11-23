import { Mic, Settings } from "lucide-react";

/**
 * Una línea legible del estado de la IA para el pie: "DeepSeek · $0.82 USD de saldo".
 * Los detalles técnicos (tokens, RPM, precios) quedan en el `title` y en Ajustes.
 */
export function footerUsageText({
  connected,
  providerName,
  alertHeadline,
  shortBadge,
  sourceKind,
}: {
  connected: boolean;
  providerName: string;
  /** Límite alcanzado o conexión con problemas: se muestra tal cual. */
  alertHeadline: string | null;
  shortBadge: string;
  sourceKind: string;
}): string {
  if (!connected) return "Conectar IA";
  if (alertHeadline) return `${providerName} · ${alertHeadline}`;
  const badge = shortBadge.trim();
  if (!badge) return providerName;
  if (sourceKind === "api_balance" || sourceKind === "user_budget") {
    return `${providerName} · ${badge} de saldo`;
  }
  return `${providerName} · ${badge}`;
}

function initialsOf(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

interface SidebarFooterProps {
  userName: string | null;
  usageLabel: string;
  usageDetail: string;
  voiceEnabled: boolean;
  settingsOpen: boolean;
  onOpenProfile: () => void;
  onOpenUsage: () => void;
  onOpenVoice: () => void;
  onOpenSettings: () => void;
}

/** Pie del lateral: quién eres, cómo va la IA, voz y ajustes. */
export function SidebarFooter({
  userName,
  usageLabel,
  usageDetail,
  voiceEnabled,
  settingsOpen,
  onOpenProfile,
  onOpenUsage,
  onOpenVoice,
  onOpenSettings,
}: SidebarFooterProps) {
  return (
    <div className="px-2.5 py-2.5 border-t border-white/[0.06] bg-[#090a0e] flex items-center gap-2.5 shrink-0">
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label="Tu perfil"
        title="Tu perfil"
        className="w-8 h-8 rounded-full bg-[#1c1d22] hover:bg-[#26272d] text-[11.5px] font-semibold text-zinc-200 flex items-center justify-center shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60"
      >
        {initialsOf(userName)}
      </button>
      <div className="flex-1 min-w-0 flex flex-col items-start">
        <button
          type="button"
          onClick={onOpenProfile}
          className="max-w-full truncate text-[12.5px] font-medium text-zinc-100 hover:text-white cursor-pointer"
        >
          {userName ?? "Crear tu perfil"}
        </button>
        <button
          type="button"
          onClick={onOpenUsage}
          title={usageDetail}
          className="max-w-full truncate text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          {usageLabel}
        </button>
      </div>
      {voiceEnabled && (
        <button
          type="button"
          onClick={onOpenVoice}
          aria-label="Voz activada"
          title="Voz activada"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-white/[0.06] shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60"
        >
          <Mic className="w-4 h-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Ajustes"
        title="Ajustes"
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 ${
          settingsOpen ? "bg-white/[0.08] text-white" : "text-zinc-300 hover:text-white hover:bg-white/[0.06]"
        }`}
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  );
}
