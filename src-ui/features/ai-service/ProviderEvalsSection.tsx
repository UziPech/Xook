import React, { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { isTauriRuntime } from "./aiClient";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderEvalReport, runProviderEvals } from "./providerEvalsApi";

function scoreDot(pct: number): string {
  if (pct >= 80) return "bg-emerald-400";
  if (pct >= 50) return "bg-amber-400";
  return "bg-rose-400";
}

/** Sección plegable y discreta de Ajustes: prueba los modelos configurados con las herramientas reales. */
export const ProviderEvalsSection: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ProviderEvalReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isTauriRuntime()) return null;

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      setReport(await runProviderEvals());
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="pt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-100 cursor-pointer transition-colors"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        <span>Probar qué tan bien trabajan tus modelos con XOOK</span>
      </button>
      <div className={`xook-collapse-grid ${open ? "is-open" : ""}`}>
        <div>
          <div className="mt-2.5 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-zinc-500">
                18 pruebas por cada modelo con clave. Gasta tokens de tus proveedores; con modelos gratuitos no cuesta.
              </p>
              <button
                type="button"
                tabIndex={open ? 0 : -1}
                disabled={running}
                onClick={() => void handleRun()}
                className="xook-obsidian-btn px-3.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer disabled:opacity-45 shrink-0 inline-flex items-center gap-1.5"
              >
                {running && <Loader2 className="w-3 h-3 animate-spin" />}
                {running ? "Probando…" : report ? "Repetir" : "Probar"}
              </button>
            </div>

            {error && <p className="text-[11px] text-rose-300/90">{error}</p>}

            {report && (
              <ul className="space-y-1.5">
                {Object.entries(report).map(([label, entry]) => {
                  const [provider, ...modelParts] = label.split(":");
                  const model = modelParts.join(":");
                  const pct = entry.resumen.puntaje_pct ?? 0;
                  const failures = (entry.resultados ?? []).filter((r) => r.resultado !== "ok");
                  return (
                    <li key={label} className="text-[11px]">
                      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-black/35 border border-white/[0.06]">
                        <span className="flex items-center gap-2 min-w-0">
                          <ProviderIcon provider={provider} size={13} className="shrink-0 text-zinc-200" />
                          <span className="font-mono text-zinc-200 truncate">{model}</span>
                        </span>
                        {entry.saltado ? (
                          <span className="text-[10px] text-zinc-500 shrink-0">{entry.saltado}</span>
                        ) : (
                          <span className="inline-flex items-center gap-2 shrink-0 text-[10px] text-zinc-400">
                            <span
                              className="inline-flex items-center gap-1"
                              title="1 punto por acierto, medio punto por un paso previo válido"
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${scoreDot(pct)}`} />
                              {pct}%
                            </span>
                            <span>{((entry.resumen.latencia_p50_ms ?? 0) / 1000).toFixed(1)} s</span>
                          </span>
                        )}
                      </div>
                      {failures.length > 0 && (
                        <details className="mt-1 ml-2.5">
                          <summary className="text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer">
                            {failures.length} {failures.length === 1 ? "prueba" : "pruebas"} por revisar
                          </summary>
                          <ul className="mt-1 space-y-0.5">
                            {failures.map((f, idx) => (
                              <li key={`${f.caso}-${idx}`} className="text-[10px] text-zinc-500">
                                <span className="text-zinc-400">{f.caso.replace(/-/g, " ")}</span>: {f.motivo}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
