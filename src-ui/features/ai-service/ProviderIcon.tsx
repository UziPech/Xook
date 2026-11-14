import type { SVGProps } from "react";

export type AiProviderId =
  | "openrouter"
  | "deepseek"
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

/**
 * Iconos vectoriales monocromáticos por proveedor, alineados al sistema visual Liquid Glass de XOOK.
 */
export function ProviderIcon({
  provider,
  size = 16,
  className = "",
  ...rest
}: ProviderIconProps) {
  const pid = normalizeProviderIdClient(provider);

  if (pid === "gemini") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className={className}
        {...rest}
      >
        <path d="M12 2.2c.22 4.86 4.94 9.58 9.8 9.8-4.86.22-9.58 4.94-9.8 9.8-.22-4.86-4.94-9.58-9.8-9.8 4.86-.22 9.58-4.94 9.8-9.8Z" />
      </svg>
    );
  }

  if (pid === "openai") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
        {...rest}
      >
        <path d="M12 3.2a4.1 4.1 0 0 1 3.55 2.05l2.5 4.33a4.1 4.1 0 0 1-.01 4.11l-2.49 4.32A4.1 4.1 0 0 1 12 20.06a4.1 4.1 0 0 1-3.55-2.05l-2.5-4.33a4.1 4.1 0 0 1 .01-4.11l2.49-4.32A4.1 4.1 0 0 1 12 3.2Z" />
        <path d="M12 7.4v4.6l4 2.3" />
        <path d="M8 14.3 12 12l-4-2.3" />
        <path d="m16 9.7-4 2.3v4.6" />
      </svg>
    );
  }

  if (pid === "anthropic") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className={className}
        {...rest}
      >
        <path d="M13.85 4.5h2.4l5.25 15h-2.45l-1.25-3.75h-4.9l-1.2 3.75H9.3l4.55-15Zm.05 9.25h3.25L15.5 8.5l-1.6 5.25ZM7.95 4.5h2.25l-5.25 15H2.55l5.4-15Z" />
      </svg>
    );
  }

  if (pid === "deepseek") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
        {...rest}
      >
        <path d="M3.5 14.2c1.2 3.2 4.3 5.1 8.4 5.1 5 0 8.6-2.9 8.6-7.3 0-3-1.9-5.3-4.9-5.7-1.6-.2-2.9.6-3.7 1.8-.9-1.9-2.8-3.1-5-3.1.8 1.6.9 3.3.3 4.8-1.9.7-3.4 2.2-3.7 4.4Z" />
        <path d="M16.2 6.2c.6-1.4 1.8-2.3 3.4-2.5-.2 1.6-1.1 2.8-2.5 3.3" />
        <circle cx="14.7" cy="11.2" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (pid === "groq") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.85}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
        {...rest}
      >
        <path d="M16.6 7.4A6.5 6.5 0 1 0 18.5 12v-1h-5.8" />
        <path d="M12 2.8V5.2M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4" />
      </svg>
    );
  }

  // openrouter (enrutador de modelos con nodos conectados)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      <circle cx="5.2" cy="12" r="2.2" />
      <circle cx="18.8" cy="6.2" r="2.1" />
      <circle cx="18.8" cy="17.8" r="2.1" />
      <path d="M7.4 12c3.2 0 4.4-5.8 9.3-5.8" />
      <path d="M7.4 12c3.2 0 4.4 5.8 9.3 5.8" />
      <path d="M14.7 4.4 16.7 6.2 14.7 8" />
      <path d="M14.7 16 16.7 17.8 14.7 19.6" />
    </svg>
  );
}
