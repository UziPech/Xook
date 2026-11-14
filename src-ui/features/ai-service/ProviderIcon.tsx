import type { SVGProps } from "react";
import anthropicIcon from "@lobehub/icons-static-svg/icons/anthropic.svg?icon-data";
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek.svg?icon-data";
import geminiIcon from "@lobehub/icons-static-svg/icons/gemini.svg?icon-data";
import groqIcon from "@lobehub/icons-static-svg/icons/groq.svg?icon-data";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi.svg?icon-data";
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg?icon-data";
import openrouterIcon from "@lobehub/icons-static-svg/icons/openrouter.svg?icon-data";

interface StaticSvgIconData {
  viewBox: string;
  fillRule?: "evenodd" | "nonzero";
  paths: ReadonlyArray<{
    d: string;
    fillRule?: "evenodd" | "nonzero";
  }>;
}

export type AiProviderId =
  | "openrouter"
  | "deepseek"
  | "kimi"
  | "groq"
  | "gemini"
  | "openai"
  | "anthropic";

export interface ProviderIconProps extends SVGProps<SVGSVGElement> {
  provider: string;
  size?: number;
}

export function normalizeProviderIdClient(raw?: string | null): AiProviderId {
  const clean = (raw || "").trim().toLowerCase();
  if (clean === "deepseek") return "deepseek";
  if (
    clean === "kimi" ||
    clean === "moonshot" ||
    clean === "moonshot-ai" ||
    clean === "moonshot_ai" ||
    clean === "moonshotai" ||
    clean === "moonshot-cn" ||
    clean === "moonshot_cn"
  ) {
    return "kimi";
  }
  if (clean === "groq") return "groq";
  if (
    clean === "gemini" ||
    clean === "google" ||
    clean === "google_ai" ||
    clean === "google-gemini" ||
    clean === "aistudio"
  ) {
    return "gemini";
  }
  if (clean === "openai" || clean === "gpt") return "openai";
  if (clean === "anthropic" || clean === "claude") return "anthropic";
  return "openrouter";
}

const PROVIDER_ICONS: Record<AiProviderId, StaticSvgIconData> = {
  openrouter: openrouterIcon,
  deepseek: deepseekIcon,
  kimi: kimiIcon,
  groq: groqIcon,
  gemini: geminiIcon,
  openai: openaiIcon,
  anthropic: anthropicIcon,
};

/**
 * Iconos vectoriales monocromáticos por proveedor provenientes de `@lobehub/icons-static-svg` (MIT),
 * renderizados localmente en JSX con `currentColor` y alineados al sistema visual Liquid Glass de XOOK.
 */
export function ProviderIcon({
  provider,
  size = 16,
  className = "",
  ...rest
}: ProviderIconProps) {
  const pid = normalizeProviderIdClient(provider);
  const icon = PROVIDER_ICONS[pid];

  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="currentColor"
      fillRule={icon.fillRule}
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {icon.paths.map((path, index) => (
        <path key={index} d={path.d} fillRule={path.fillRule} />
      ))}
    </svg>
  );
}
