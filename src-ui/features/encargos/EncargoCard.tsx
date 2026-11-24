import React, { useState } from "react";
import { FileText, Play, Trash2 } from "lucide-react";
import {
  ENCARGO_STATUS_LABEL,
  encargoWhenLabel,
  readEncargoReport,
  type Encargo,
} from "./encargosApi";

interface EncargoCardProps {
  encargo: Encargo;
  now: Date;
  onRunNow: (encargo: Encargo) => void;
  onRemove: (encargo: Encargo) => void;
}

/** Un pendiente que Xox hará (o hizo) solo: cuándo, con qué app y si dará el último clic. */
export const EncargoCard: React.FC<EncargoCardProps> = ({ encargo, now, onRunNow, onRemove }) => {
  const [report, setReport] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);

  const needsAttention = encargo.status === "perdido" || encargo.status === "detenido";
  const running = encargo.status === "en_curso";
  const hasRun = encargo.status !== "programado" || Boolean(encargo.recurrence);
  const when = encargoWhenLabel(encargo.nextRunAt, now);
  const finish = encargo.mayFinish
    ? `Lo deja hecho: ${encargo.finalAction ?? "último clic"}`
    : "Lo deja listo, sin el último clic";

  const toggleReport = async () => {
    if (reportOpen) {
      setReportOpen(false);
      return;
    }
    setReportOpen(true);
    setLoadingReport(true);
    try {
      setReport(await readEncargoReport(encargo.id));
    } catch {
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  };

  return (
    <article
      aria-label={`${encargo.name}, ${ENCARGO_STATUS_LABEL[encargo.status]}`}
      className="rounded-2xl border border-white/[0.08] bg-zinc-900 p-3 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-white leading-snug">{encargo.name}</h4>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            {when}
            {encargo.recurrence ? ` · ${encargo.recurrence}` : ""}
            {encargo.targetApp ? ` · ${encargo.targetApp}` : ""}
          </p>
        </div>
        <span
          className={`shrink-0 px-2 py-0.5 rounded-full text-[10.5px] font-medium border ${
            running
              ? "bg-zinc-100 text-zinc-900 border-zinc-100"
              : needsAttention
              ? "text-zinc-100 border-zinc-300/60"
              : "text-zinc-400 border-white/[0.12]"
          }`}
        >
          {ENCARGO_STATUS_LABEL[encargo.status]}
        </span>
      </div>

      <p className="text-[11px] text-zinc-300 leading-relaxed" title={encargo.instruction}>
        {finish}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        {needsAttention && (
          <button
            type="button"
            onClick={() => onRunNow(encargo)}
            className="xook-approve-btn inline-flex items-center gap-1.5 min-h-8 px-3 rounded-xl text-[11px] font-semibold cursor-pointer"
          >
            <Play className="w-3 h-3" aria-hidden="true" />
            <span>Hacerlo ahora</span>
          </button>
        )}
        {hasRun && (
          <button
            type="button"
            onClick={() => void toggleReport()}
            aria-expanded={reportOpen}
            className="inline-flex items-center gap-1.5 min-h-8 px-3 rounded-xl text-[11px] font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-white/[0.08] cursor-pointer transition-colors"
          >
            <FileText className="w-3 h-3" aria-hidden="true" />
            <span>{reportOpen ? "Ocultar informe" : "Ver informe"}</span>
          </button>
        )}
        {!running && (
          <button
            type="button"
            onClick={() => onRemove(encargo)}
            aria-label={`Quitar «${encargo.name}»`}
            title="Quitar el pendiente. Su carpeta y sus informes se conservan."
            className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {reportOpen && (
        <div className="rounded-xl bg-black border border-white/[0.08] p-2.5 text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto select-text">
          {loadingReport
            ? "Cargando informe…"
            : report ?? "Todavía no hay informe: aparece cuando Xox termina de ejecutarlo."}
        </div>
      )}
    </article>
  );
};
