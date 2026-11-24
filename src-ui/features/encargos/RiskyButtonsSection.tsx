import React, { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { listRiskyButtons, removeRiskyButton } from "./encargosApi";

interface RiskyButtonsSectionProps {
  onStatusNotice?: (msg: string) => void;
}

/**
 * Botones que Xox agregó a la lista personal de riesgo. Siempre piden permiso antes de pulsarse.
 * Xox solo puede agregar; quitar es cosa del usuario, aquí.
 */
export const RiskyButtonsSection: React.FC<RiskyButtonsSectionProps> = ({ onStatusNotice }) => {
  const [phrases, setPhrases] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPhrases(await listRiskyButtons());
    } catch {
      setPhrases([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (phrase: string) => {
    setBusy(phrase);
    try {
      await removeRiskyButton(phrase);
      onStatusNotice?.(`«${phrase}» ya no pide permiso por sí solo.`);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="xook-obsidian-surface rounded-2xl p-4 space-y-3" aria-labelledby="risky-buttons-title">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-zinc-300 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h3 id="risky-buttons-title" className="text-[13px] font-semibold text-white">
            Botones que siempre piden permiso
          </h3>
          <p className="text-[11.5px] text-zinc-400 leading-relaxed mt-0.5">
            Entregar, Enviar, Pagar o Borrar nunca se pulsan sin tu permiso. Aquí aparecen los que Xox
            agregó al encontrarlos en tus apps. Para que agregue uno, díselo en el chat.
          </p>
        </div>
      </div>

      {phrases.length === 0 ? (
        <p className="text-[11.5px] text-zinc-400">Xox todavía no ha agregado ninguno.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {phrases.map((phrase) => (
            <li
              key={phrase}
              className="inline-flex items-center gap-1 pl-3 rounded-full bg-zinc-800 border border-white/[0.08] text-[11.5px] text-zinc-100"
            >
              <span>{phrase}</span>
              <button
                type="button"
                disabled={busy === phrase}
                onClick={() => void remove(phrase)}
                aria-label={`Quitar «${phrase}» de la lista`}
                title={`Quitar «${phrase}» de la lista`}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full text-zinc-400 hover:text-zinc-100 disabled:opacity-40 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
