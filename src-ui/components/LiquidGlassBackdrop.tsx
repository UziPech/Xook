import React, { useId } from "react";

interface LiquidGlassBackdropProps {
  /** Ajusta la densidad del brillo superior e iluminación ambiental. */
  variant?: "menu" | "modal";
}

/**
 * Capa de iluminación prismática y reflejo especular estilo QuickBar Liquid Glass.
 * Usa IDs únicos por instancia para que múltiples menús o diálogos coexistan sin colisión.
 */
export const LiquidGlassBackdrop: React.FC<LiquidGlassBackdropProps> = ({
  variant = "menu",
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const cyanId = `xook-lg-cyan-${uid}`;
  const auroraId = `xook-lg-aurora-${uid}`;

  const cyanOpacity = variant === "modal" ? "0.11" : "0.15";
  const pinkOpacity = variant === "modal" ? "0.08" : "0.10";
  const violetOpacity = variant === "modal" ? "0.045" : "0.055";

  return (
    <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
      <svg
        aria-hidden="true"
        viewBox="0 0 210 180"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        <defs>
          <radialGradient id={cyanId} cx="20%" cy="18%" r="65%">
            <stop offset="0%" stopColor="#7DD3FC" stopOpacity={cyanOpacity} />
            <stop offset="100%" stopColor="#7DD3FC" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={auroraId} cx="85%" cy="82%" r="60%">
            <stop offset="0%" stopColor="#F472B6" stopOpacity={pinkOpacity} />
            <stop offset="55%" stopColor="#A78BFA" stopOpacity={violetOpacity} />
            <stop offset="100%" stopColor="#A78BFA" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="210" height="180" fill={`url(#${cyanId})`} />
        <rect width="210" height="180" fill={`url(#${auroraId})`} />
      </svg>
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.18] to-transparent" />
    </div>
  );
};
