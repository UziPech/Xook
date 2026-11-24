import type { AiProviderId } from "./ProviderIcon";

/*
 * Reconoce cuándo el usuario pide configurar un proveedor de IA o guardar una clave.
 *
 * Es un atajo local: si acierta, la interfaz responde con el formulario y el mensaje no llega
 * al modelo. Por eso exige precisión. Si deja pasar una petición no se pierde nada (el modelo
 * tiene `configure_ai_vault`); si acierta de más, le roba el turno al usuario: "dile a Claude
 * que no puedes abrir mi app" abría el formulario de Anthropic por nombrar a Claude y "abrir".
 */

const PROVIDER_PATTERNS: ReadonlyArray<readonly [AiProviderId, string]> = [
  ["deepseek", "deepseek"],
  ["kimi", "kimi|moonshot"],
  ["anthropic", "anthropic|antrophic|anhtropic|claude"],
  ["groq", "groq"],
  ["gemini", "gemini|google\\s*ai|ai\\s*studio"],
  ["openai", "openai|open\\s*ia|openia|chatgpt|gpt-4|gpt4|gpt-5"],
  ["openrouter", "openrouter"],
];
const ANY_PROVIDER = PROVIDER_PATTERNS.map(([, names]) => names).join("|");

export function detectKeySetupIntentWithProvider(text: string): {
  isSetup: boolean;
  providerHint: AiProviderId | null;
} {
  const match = PROVIDER_PATTERNS.find(([, names]) => new RegExp(`\\b(?:${names})\\b`, "i").test(text));
  const isSetup =
    /(api\s*key|clave\s*api|b[oó]veda|openrouter|deepseek|kimi|moonshot|groq|gemini|anthropic|antrophic|openai|open\s*ia|openia|token\s*de\s*ia|configur\w*\s*(?:la\s*|el\s*|mi\s*|tu\s*)?(?:ia|clave|api|key|modelo|b[oó]veda|provedor|proveedor)|cambia\w*\s*(?:clave|proveedor|modelo)|guarda\w*\s*(?:la\s*|mi\s*)?(?:clave|api|key))/i.test(
      text
    );
  return { isSetup, providerHint: match ? match[0] : null };
}

export function isKeySetupIntent(text: string): boolean {
  return detectKeySetupIntentWithProvider(text).isSetup;
}

export interface VaultConfigRequestDetection {
  isVaultRequest: boolean;
  intentKind: "switch_provider" | "save_or_edit_key" | "open_vault";
  providerHint: AiProviderId | null;
}

// "Dile a Claude…", "mándale a ChatGPT…": el proveedor es a quién va el mensaje, no qué configurar.
const ADDRESSES_SOMEONE =
  /\b(?:d[ií]|preg[uú]nta|escr[ií]be|m[aá]nda|env[ií]a|resp[oó]nde|cont[eé]sta|av[ií]sa|comenta|platica|cu[eé]nta|p[ií]de|decir|preguntar|escribir|mandar|enviar|responder|contestar|avisar|comentar|platicar|contar|pedir)(?:le|les|selo|sela)\b/i;

const CONNECT_VERB =
  "configur\\w*|agreg\\w*|añad\\w*|anad\\w*|conect\\w*|activ\\w*|c[aá]mbi\\w*|us(?:a|ar|emos)|seleccion\\w*|p[aá]sa(?:te|r|me|rme)?|pon(?:er|me|te)?";
const LINK_WORDS =
  "a|al|el|la|los|con|de|del|en|mi|tu|un|una|otro|otra|como|por|proveedor(?:es)?|provedor(?:es)?|modelos?|ia|cuenta|servicio";
const TAIL_WORDS =
  "por\\s+favor|porfa(?:vor)?|gracias|ahora|ya|mejor|aqu[ií]|mismo|desde|como|de|para|en|a|el|la|mi|tu|ti|este|esta|chat|proveedor|provedor|modelo|ia|xook|xox|predeterminado|principal|activo|default|pro|flash|lite|mini|nano|max|plus|opus|sonnet|haiku|fable|turbo|reasoner|coder|studio|v?\\d+(?:\\.\\d+)*[a-z]?";

// El proveedor es el objeto del verbo y el mensaje termina ahí: "usa deepseek por favor" sí;
// "usa claude para escribirle a mi jefe" no, porque lo que se pide es otra cosa.
const PROVIDER_IS_THE_OBJECT = new RegExp(
  `\\b(?:${CONNECT_VERB})\\s+(?:(?:${LINK_WORDS})\\s+){0,4}(?:${ANY_PROVIDER})(?:[\\s,.\\-]+(?:${TAIL_WORDS}))*[\\s,.!¡?¿]*$`,
  "i"
);

const SECRET_OR_VAULT = new RegExp(
  [
    "\\b(?:api\\s*key|apikey|token\\s+de\\s+ia)\\b",
    "\\bb[oó]veda\\b",
    `\\b(?:clave|key)\\s+(?:api|secreta|de\\s+(?:ia|acceso|la\\s+ia|${ANY_PROVIDER}))\\b`,
    // "guarda mi clave" a secas; "la clave del wifi" o "la clave de la puerta" no son de aquí.
    "\\b(?:la|mi|tu|una)\\s+(?:key|clave)\\b(?!\\s+(?:del?|para|con)\\b)",
  ].join("|"),
  "i"
);

const ACTION_VERB =
  /\b(?:configur\w*|agreg\w*|añad\w*|anad\w*|pon(?:er|le|me|ga)?|met(?:e|er|ele|eme)?|guard\w*|conect\w*|activ\w*|cambi\w*|us(?:a|ar|emos)|seleccion\w*|abr(?:e|ir|eme)|edita\w*|actualiz\w*|ingres\w*|peg(?:a|ar)|dej\w*\s+configurar|deja\w*\s+configurar)\b/i;

/**
 * Detecta en lenguaje natural cuando el usuario pide a Xox configurar un proveedor,
 * cambiar de proveedor o guardar una API key en la bóveda de XOOK (sin filtrar código ajeno).
 */
export function detectVaultConfigRequest(text: string): VaultConfigRequestDetection {
  const trimmed = text.trim();
  const { providerHint } = detectKeySetupIntentWithProvider(trimmed);
  const notVault: VaultConfigRequestDetection = { isVaultRequest: false, intentKind: "open_vault", providerHint };
  if (!trimmed || trimmed.length > 260) return notVault;

  const mentionsXookApp = /\b(?:xook|xox|b[oó]veda|esta\s+app|la\s+app|tus\s+ajustes|tu\s+configuraci[oó]n)\b/i.test(
    trimmed
  );
  const mentionsExternalCoding =
    /\b(?:python|node\.?js|typescript|javascript|react|rust|flask|fastapi|django|express|next\.?js|snippet|c[oó]digo\s+en|script\s+en|mi\s+proyecto|\.py|\.tsx?|\.jsx?)\b/i.test(
      trimmed
    );
  if (mentionsExternalCoding && !mentionsXookApp) return notVault;
  if (ADDRESSES_SOMEONE.test(trimmed)) return notVault;

  const mentionsVault = /\bb[oó]veda\b/i.test(trimmed);
  const mentionsSecretOrVault = SECRET_OR_VAULT.test(trimmed);
  const hasActionVerb = ACTION_VERB.test(trimmed);

  // Evitar capturar preguntas meramente informativas (ej. "¿cuánto cuesta deepseek?" o "compara gemini vs groq")
  const isPureQuestion =
    !hasActionVerb &&
    !mentionsVault &&
    /\b(?:cu[aá]nto\s+cuesta|tarifas?|precios?|l[ií]mites?|compar\w*|qu[eé]\s+es|por\s+qu[eé]|conviene|mejor)\b/i.test(
      trimmed
    );
  if (isPureQuestion) return notVault;

  const explicitlyWantsVaultAction =
    mentionsVault || (mentionsSecretOrVault && hasActionVerb) || PROVIDER_IS_THE_OBJECT.test(trimmed);
  if (!explicitlyWantsVaultAction) return notVault;

  const isExplicitSwitch =
    Boolean(providerHint) &&
    !mentionsSecretOrVault &&
    !/\b(?:configur\w*|agreg\w*|añad\w*|anad\w*|guard\w*|edita\w*|peg\w*|b[oó]veda|pon(?:er|le|me)?\s+(?:la|mi|una)\b)\b/i.test(
      trimmed
    ) &&
    /\b(?:c[aá]mbi\w*|us(?:a|ar|emos)|activ\w*|p[aá]sa\w*|seleccion\w*)\b/i.test(trimmed);

  if (isExplicitSwitch) {
    return { isVaultRequest: true, intentKind: "switch_provider", providerHint };
  }
  if (/\b(?:abr(?:e|ir|eme)|ver|muestra\w*)\b/i.test(trimmed) && !mentionsSecretOrVault && !providerHint) {
    return { isVaultRequest: true, intentKind: "open_vault", providerHint };
  }
  return { isVaultRequest: true, intentKind: "save_or_edit_key", providerHint };
}
