import { useId, useState } from "react";
import type { CommandPermissionDecisionKind, CommandPermissionUiItem } from "@xook/contracts";
import { ICON_ANIMATE_ALWAYS, XkIcon } from "../../components/icons";
import { MacMiniTerminal } from "./MacMiniTerminal";
import { describePermission } from "./permissionDetail";

// Llenan el renglón y bajan al siguiente si no caben; en ancho conservan su tamaño.
const BUTTON =
  "h-9 grow @[30rem]:grow-0 rounded-[10px] border px-3 text-[12.5px] whitespace-nowrap transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70";

interface PermissionPromptProps {
  item: CommandPermissionUiItem;
  /** Los comandos se muestran en la mini terminal. */
  isShell: boolean;
  surfaceVariant?: "default" | "liquid";
  onResolve: (requestId: string, decision: CommandPermissionDecisionKind) => void;
}

/** Tarjeta que espera la decisión de la persona: qué se va a hacer, para qué y tres respuestas. */
export function PermissionPrompt({ item, isShell, surfaceVariant = "default", onResolve }: PermissionPromptProps) {
  const [showDetail, setShowDetail] = useState(false);
  const titleId = useId();
  const detailId = useId();
  const detail = describePermission(item);

  const technical = [
    { label: "Orden", value: isShell ? "" : item.command },
    { label: "Aplicación", value: item.bundleId ?? "" },
    { label: "Ubicación", value: item.appPath ?? "" },
    { label: "Se recordaría como", value: detail.alwaysLabel ? item.patternSuggestion ?? "" : "" },
  ].filter((row) => row.value);
  // El código de un script se revisa antes de permitirlo, pero no ocupa la tarjeta.
  const previewInDetail = isShell ? detail.preview : null;
  const previewInCard = isShell ? null : detail.preview;
  const hasDetail = technical.length > 0 || Boolean(previewInDetail);

  return (
    <section
      aria-labelledby={titleId}
      className={`@container panel-fade-in rounded-2xl border border-zinc-800 p-3 ${
        surfaceVariant === "liquid" ? "quick-liquid-subcard quick-liquid-permission" : "bg-[#121317]"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className={`${ICON_ANIMATE_ALWAYS} mt-[7px] shrink-0 text-zinc-200`}>
          <XkIcon name="permissions" size={18} />
        </span>
        <div className="min-w-0 flex-1 pt-1.5">
          <p id={titleId} className="text-[13px] font-semibold leading-snug text-zinc-100 text-pretty">
            {detail.title}
          </p>
          {detail.action && (
            <p className="mt-1 text-[12.5px] leading-snug text-zinc-200 break-words [overflow-wrap:anywhere]">
              {detail.action}
            </p>
          )}
          {detail.reason && (
            <p className="mt-0.5 text-[12px] leading-snug text-zinc-400 text-pretty">{detail.reason}</p>
          )}
        </div>
        {hasDetail && (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            aria-expanded={showDetail}
            aria-controls={detailId}
            aria-label={showDetail ? "Ocultar detalle" : "Ver detalle"}
            title={showDetail ? "Ocultar detalle" : "Ver detalle"}
            className="grid size-8 shrink-0 place-items-center rounded-lg shadow-none! text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/70"
          >
            <XkIcon
              name="chevron"
              size={16}
              className={`motion-safe:transition-transform ${showDetail ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 pl-[28px] [&:not(:empty)]:mt-2.5">
        {isShell && item.command && (
          <MacMiniTerminal
            command={item.command}
            cwdRel={item.cwdRel}
            state={item.state}
            previewOnly
            compact
            surfaceVariant={surfaceVariant}
          />
        )}

        {detail.quote && (
          <blockquote className="m-0 rounded-[10px] bg-zinc-900 border border-zinc-800 px-3 py-2">
            <p className="max-h-32 overflow-y-auto xook-scroll whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-zinc-100">
              {detail.quote}
              {detail.quoteIsPartial && "…"}
            </p>
            {detail.quoteIsPartial && <p className="mt-1 text-[11.5px] text-zinc-400">Es solo el principio del texto.</p>}
          </blockquote>
        )}

        {detail.rows.length > 0 && (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px] leading-snug">
            {detail.rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-zinc-400">{row.label}</dt>
                <dd className="m-0 max-h-32 overflow-y-auto xook-scroll whitespace-pre-wrap break-words text-zinc-100">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {previewInCard && <CodePreview text={previewInCard} />}

        {showDetail && hasDetail && (
          <div id={detailId} className="panel-fade-in flex flex-col gap-2">
            {previewInDetail && <CodePreview text={previewInDetail} />}
            {technical.length > 0 && (
              <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11.5px] leading-snug">
                {technical.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-zinc-400">{row.label}</dt>
                    <dd className="m-0 font-mono text-[11px] text-zinc-300 [overflow-wrap:anywhere]">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        {detail.warning && <p className="text-[12px] leading-snug text-zinc-300 text-pretty">{detail.warning}</p>}
      </div>

      {/* `relative`: la sombra de la mini terminal no debe caer sobre los botones. */}
      <div className="relative mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onResolve(item.requestId, "allow_once")}
          title="Solo por esta vez"
          className={`${BUTTON} border-transparent bg-zinc-100 font-semibold text-zinc-950 hover:bg-white`}
        >
          {detail.alwaysLabel ? "Permitir una vez" : "Permitir"}
        </button>
        {detail.alwaysLabel && (
          <button
            type="button"
            onClick={() => onResolve(item.requestId, "allow_always")}
            title={detail.alwaysHint}
            className={`${BUTTON} border-transparent bg-zinc-800 font-medium text-zinc-100 hover:bg-zinc-700`}
          >
            {detail.alwaysLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => onResolve(item.requestId, "deny")}
          className={`${BUTTON} border-zinc-700 font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 @[30rem]:ml-auto`}
        >
          No permitir
        </button>
      </div>
    </section>
  );
}

function CodePreview({ text }: { text: string }) {
  return (
    <pre className="m-0 max-h-40 overflow-auto xook-scroll rounded-[10px] bg-zinc-900 border border-zinc-800 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-200 whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}
