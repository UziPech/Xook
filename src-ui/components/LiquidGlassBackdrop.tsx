import React, { useId } from "react";

interface LiquidGlassBackdropProps {
  /** Ajusta la densidad del brillo superior e iluminación ambiental monocromática. */
  variant?: "menu" | "modal";
}

/**
 * Capa de iluminación neutra y reflejo especular monocromo estilo Liquid Glass.
 * Sin gradientes de color ni tintes cromáticos (100% negro/gris/cristal neutro).
 */
export const LiquidGlassBackdrop: React.FC<LiquidGlassBackdropProps> = ({
  variant = "menu",
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const lightId = `xook-lg-light-${uid}`;

  const topOpacity = variant === "modal" ? "0.06" : "0.04";

  return (
    <div className="absolute inset-0 rounded-[inherit] overflow-hidden pointer-events-none">
      <svg
        aria-hidden="true"
        viewBox="0 0 210 180"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        <defs>
          <radialGradient id={lightId} cx="25%" cy="15%" r="70%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity={topOpacity} />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="210" height="180" fill={`url(#${lightId})`} />
      </svg>
      {/* Sutil arista especular superior monocromática */}
      <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />
    </div>
  );
};
