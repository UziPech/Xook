import "./guideIcons.css";

/** Detalle que se mueve: un solo color plano, sin degradados. */
const ACTION_STROKE = "#fcd34d";

interface GlyphProps {
  size?: number;
  className?: string;
}

/** Burbuja con un + que late: «empieza aquí». */
export function NewChatGlyph({ size = 18, className }: GlyphProps) {
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
      aria-hidden="true"
      className={className}
    >
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z" />
      <g className="xk-glyph-move xk-pop">
        <path d="M12 6.8v5.4M9.3 9.5h5.4" stroke={ACTION_STROKE} />
      </g>
    </svg>
  );
}

/** Líneas que se juntan: «la conversación se compacta». */
export function CompactGlyph({ size = 18, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path className="xk-glyph-move xk-squeeze-top" d="M5 5h14" />
      <path d="M5 10h14" />
      <path d="M5 14h14" />
      <path className="xk-glyph-move xk-squeeze-bottom" d="M5 19h14" />
    </svg>
  );
}
