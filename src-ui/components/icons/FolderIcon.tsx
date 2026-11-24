import "./xkIcons.css";

/**
 * Carpeta al estilo de Finder: pestaña corta arriba a la izquierda, frente alto con un
 * filo de luz y esquinas redondeadas. Dos tonos planos por color, sin degradados.
 * - Con contenido asoman hojas por arriba; vacía, solo la carpeta.
 * - Abierta, el frente se inclina hacia abajo y las hojas se levantan (transición corta,
 *   quieta con «reducir movimiento»).
 */
const FOLDER_TONES = {
  gray: { back: "#7d7e86", front: "#a2a3ab", lip: "#c9cad0" },
  blue: { back: "#2f63c4", front: "#4a86ea", lip: "#8cb6f6" },
  green: { back: "#2f8f55", front: "#43b26f", lip: "#8cd9a8" },
  purple: { back: "#6a48b8", front: "#8a68d8", lip: "#bea8f0" },
  amber: { back: "#b9852a", front: "#e0a93f", lip: "#f4d083" },
  orange: { back: "#b8602e", front: "#e07f45", lip: "#f4b48a" },
  red: { back: "#b0403d", front: "#d95b57", lip: "#f09e9b" },
} as const;

export type FolderTone = keyof typeof FOLDER_TONES;

export function FolderIcon({
  size = 18,
  tone = "gray",
  open = false,
  hasContent = false,
  className,
}: {
  size?: number;
  tone?: FolderTone;
  open?: boolean;
  hasContent?: boolean;
  className?: string;
}) {
  const colors = FOLDER_TONES[tone];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`xk-folder${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
    >
      {/* Fondo con la pestaña: más corta y más alta que el resto, como en Finder. */}
      <path
        d="M2 6.2A2.6 2.6 0 0 1 4.6 3.6h3.6a1.9 1.9 0 0 1 1.4.6l1.1 1.2h8.7A2.6 2.6 0 0 1 22 8v9.6a2.6 2.6 0 0 1-2.6 2.6H4.6A2.6 2.6 0 0 1 2 17.6z"
        fill={colors.back}
      />
      {hasContent && (
        <g className="xk-folder-papers">
          <rect x="4.2" y="5.1" width="15.6" height="6" rx="1" fill="#d4d4db" />
          <rect x="5.4" y="4.4" width="13.2" height="6" rx="1" fill="#f1f1f4" />
        </g>
      )}
      <g className="xk-folder-front">
        <rect x="2" y="7.5" width="20" height="12.7" rx="2.6" fill={colors.front} />
        <path d="M4.4 8.2h15.2" stroke={colors.lip} strokeWidth="0.9" strokeLinecap="round" />
      </g>
    </svg>
  );
}
