/**
 * Carpeta al estilo de Finder pero más redondeada: pestaña al fondo y frente con un
 * borde de luz. Colores planos en dos tonos, sin degradados.
 */
const FOLDER_TONES = {
  gray: { back: "#5c5d66", front: "#80818b", lip: "#a3a4ad" },
  blue: { back: "#2f63c4", front: "#4a86ea", lip: "#86b2f5" },
  amber: { back: "#b9852a", front: "#e0a93f", lip: "#f2cd7d" },
} as const;

export type FolderTone = keyof typeof FOLDER_TONES;

export function FolderGlyph({
  size = 18,
  tone = "gray",
  className,
}: {
  size?: number;
  tone?: FolderTone;
  className?: string;
}) {
  const colors = FOLDER_TONES[tone];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M2.5 7A3 3 0 0 1 5.5 4h3.7a2.5 2.5 0 0 1 1.9.9l1.1 1.3h6.3a3 3 0 0 1 3 3V17a3 3 0 0 1-3 3h-13a3 3 0 0 1-3-3z"
        fill={colors.back}
      />
      <rect x="2.5" y="8.4" width="19" height="11.6" rx="3" fill={colors.front} />
      <path d="M5.6 9.3h12.8" stroke={colors.lip} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
