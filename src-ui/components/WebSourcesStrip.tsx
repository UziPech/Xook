import { useState } from "react";
import { Globe } from "lucide-react";
import type { WebSource } from "../features/ai-service/aiClient";
import { openExternalUrl } from "../utils/markdownRenderer";

const MAX_PAGE_THUMBS = 4;
const MAX_GALLERY = 9;
const MAX_CHIPS = 6;

/**
 * Lo que Xox consultó en internet durante el turno:
 * - galería con las imágenes de `image_search` (título, fuente y licencia);
 * - miniaturas de vista previa de las páginas y enlaces por dominio.
 * Las imágenes se cargan por URL desde su sitio; XOOK no las guarda.
 */
export function WebSourcesStrip({ sources }: { sources: WebSource[] }) {
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set());
  const isShown = (s: WebSource) => Boolean(s.image) && !brokenImages.has(s.image as string);
  const gallery = sources.filter((s) => s.kind === "image" && isShown(s)).slice(0, MAX_GALLERY);
  const pages = sources.filter((s) => s.kind !== "image");
  const pageThumbs = pages.filter(isShown).slice(0, MAX_PAGE_THUMBS);
  const chips = pages.slice(0, MAX_CHIPS);
  const hidden = pages.length - chips.length;

  const open = (url: string) => {
    void openExternalUrl(url);
  };
  const markBroken = (image: string) => setBrokenImages((prev) => new Set(prev).add(image));

  return (
    <div className="space-y-2.5">
      {gallery.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-2xl">
          {gallery.map((s) => (
            <button
              key={s.url}
              type="button"
              onClick={() => open(s.url)}
              title={`${s.title}${s.license ? ` · ${s.license}` : ""}`}
              className="group text-left rounded-xl overflow-hidden border border-white/[0.09] bg-[#0b0c10] hover:border-white/[0.22] transition-colors cursor-pointer"
            >
              <img
                src={s.image}
                alt={s.title}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full h-36 object-cover bg-white/[0.03]"
                onError={() => markBroken(s.image as string)}
              />
              <span className="block px-2.5 pt-1.5 text-[11.5px] text-zinc-200 truncate">{s.title}</span>
              <span className="block px-2.5 pb-2 text-[10.5px] text-zinc-400 truncate">
                {[s.source || s.domain, s.license].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}
      {pageThumbs.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {pageThumbs.map((s) => (
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
                onError={() => markBroken(s.image as string)}
              />
            </button>
          ))}
        </div>
      )}
      {chips.length > 0 && (
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
          {hidden > 0 && <span className="text-[11px] text-zinc-400">+{hidden}</span>}
        </div>
      )}
    </div>
  );
}
