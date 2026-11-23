import { useState } from "react";
import { Globe } from "lucide-react";
import type { WebSource } from "../features/ai-service/aiClient";
import { openExternalUrl } from "../utils/markdownRenderer";

const MAX_IMAGES = 4;
const MAX_CHIPS = 6;

/**
 * Fuentes de internet que Xox consultó en el turno: miniaturas de vista previa y
 * enlaces por dominio. Las imágenes se cargan por URL desde su sitio; XOOK no las guarda.
 */
export function WebSourcesStrip({ sources }: { sources: WebSource[] }) {
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set());
  const withImage = sources
    .filter((s) => s.image && !brokenImages.has(s.image))
    .slice(0, MAX_IMAGES);
  const chips = sources.slice(0, MAX_CHIPS);
  const hidden = sources.length - chips.length;

  const open = (url: string) => {
    void openExternalUrl(url);
  };

  return (
    <div className="space-y-2">
      {withImage.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {withImage.map((s) => (
            <button
              key={s.url}
              type="button"
              onClick={() => open(s.url)}
              title={s.title}
              className="shrink-0 w-28 h-20 rounded-xl overflow-hidden border border-white/[0.09] bg-white/[0.03] hover:border-white/[0.2] transition-colors cursor-pointer"
            >
              <img
                src={s.image}
                alt={s.title}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
                onError={() =>
                  setBrokenImages((prev) => new Set(prev).add(s.image as string))
                }
              />
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Globe className="w-3 h-3 text-zinc-500 shrink-0" aria-hidden />
        {chips.map((s) => (
          <button
            key={s.url}
            type="button"
            onClick={() => open(s.url)}
            title={s.title}
            className="inline-flex items-center px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.09] text-[11px] text-zinc-300 transition-colors cursor-pointer max-w-[180px] truncate"
          >
            {s.domain}
          </button>
        ))}
        {hidden > 0 && <span className="text-[11px] text-zinc-500">+{hidden}</span>}
      </div>
    </div>
  );
}
