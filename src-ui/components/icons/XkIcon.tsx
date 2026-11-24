import type { ReactNode } from "react";
import "./xkIcons.css";

/** Detalle que se mueve: un solo color plano, sin degradados (AGENTS.md, Diseño de interfaz). */
const ACTION = "#fcd34d";

/**
 * Catálogo de íconos de XOOK. Cada uno es línea fina en `currentColor` y su parte
 * animada (clase `xk-move`) muestra la acción. Las pantallas solo escriben
 * `<XkIcon name="…" />`; los trazos viven aquí.
 */
const ICONS = {
  "new-chat": (
    <>
      {/* Burbuja ovalada con la cola abajo a la izquierda; el + va en su centro óptico. */}
      <path d="M12 3.6c4.8 0 8.6 3.2 8.6 7.3s-3.8 7.3-8.6 7.3c-1 0-2-.15-2.9-.4L5 19.9l1.1-3.6C4.4 15 3.4 13.1 3.4 10.9 3.4 6.8 7.2 3.6 12 3.6z" />
      <g className="xk-move xk-plus-turn">
        <path d="M12 8v5.8M9.1 10.9h5.8" strokeWidth="1.8" />
      </g>
    </>
  ),
  compact: (
    <>
      <path className="xk-move xk-squeeze-top" d="M5 5h14" />
      <path d="M5 10h14" />
      <path d="M5 14h14" />
      <path className="xk-move xk-squeeze-bottom" d="M5 19h14" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <g className="xk-move xk-needle">
        <path d="M12 6.8l2.2 5.2-2.2 5.2-2.2-5.2z" stroke={ACTION} />
      </g>
    </>
  ),
  instructions: (
    <>
      <rect x="3.5" y="3" width="13" height="18" rx="2" />
      <path d="M7 8h6M7 11.5h6" />
      <path className="xk-move xk-draw" d="M7 15h5" stroke={ACTION} />
      <g className="xk-move xk-pen">
        <path d="M12.6 15.6l.5-2.2 5.4-5.4a1.3 1.3 0 0 1 1.8 1.8l-5.4 5.4z" />
      </g>
    </>
  ),
  documents: (
    <>
      <path d="M3 9V7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5V11" />
      <g className="xk-move xk-drop">
        <rect x="8.5" y="3.5" width="7" height="8" rx="1" stroke={ACTION} />
      </g>
      {/* El frente tapa la hoja al caer: se rellena con el fondo del contenedor. */}
      <path
        d="M2.6 11.2A1 1 0 0 1 3.6 10h16.8a1 1 0 0 1 1 1.2l-1.3 7.6a1.5 1.5 0 0 1-1.5 1.2H5.4a1.5 1.5 0 0 1-1.5-1.2z"
        fill="var(--xk-icon-bg, #0b0c10)"
      />
    </>
  ),
  memory: (
    <>
      <path d="M12 6.5l1.88 4.41 4.78.43-3.62 3.15 1.07 4.67L12 16.7l-4.11 2.46 1.07-4.67-3.62-3.15 4.78-.43z" />
      <g className="xk-move xk-spark-left">
        <path d="M4.5 2.5v3M3 4h3" stroke={ACTION} />
      </g>
      <g className="xk-move xk-spark-right">
        <path d="M19.5 2.5v3M18 4h3" stroke={ACTION} />
      </g>
    </>
  ),
  permissions: (
    <>
      <path d="M12 3l7 2.8v5.4c0 4.4-3 8.1-7 9.8-4-1.7-7-5.4-7-9.8V5.8z" />
      <path className="xk-move xk-check" d="M8.8 12.2l2.2 2.2 4.4-4.6" stroke={ACTION} />
    </>
  ),
  chevron: <path d="M7 10l5 5 5-5" />,
} satisfies Record<string, ReactNode>;

export type XkIconName = keyof typeof ICONS;

/** Clases del contenedor que activan la animación: al pasar el mouse, o siempre. */
export const ICON_ANIMATE_ON_HOVER = "xk-hover";
export const ICON_ANIMATE_ALWAYS = "xk-live";

export function XkIcon({
  name,
  size = 18,
  title,
  className,
}: {
  name: XkIconName;
  size?: number;
  /** Solo si el ícono comunica algo por sí solo; si no, queda oculto para lectores de pantalla. */
  title?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={className}
    >
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  );
}
