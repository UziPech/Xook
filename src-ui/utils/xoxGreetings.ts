export const DEFAULT_IDLE_GREETING = "¿En qué puedo ayudarte?";

export type TimeOfDayBand =
  | "lateNight"
  | "earlyBird"
  | "morning"
  | "afternoon"
  | "evening";

export interface HeroGreetingOptions {
  userName?: string | null;
  now?: Date;
  seed?: number;
  avoidText?: string | null;
}

export interface XoxBubbleOptions {
  agentName?: string | null;
  activeRole?: string | null;
  userName?: string | null;
  inActiveChat?: boolean;
  pendingTasksCount?: number;
  now?: Date;
  lastMessage?: string | null;
  seed?: number;
}

export interface ChatPlaceholderOptions {
  isStreaming?: boolean;
  isDragging?: boolean;
  hasMessages?: boolean;
  seed?: number;
}

export interface QuickBarPlaceholderOptions {
  isStreaming?: boolean;
  userName?: string | null;
  now?: Date;
  seed?: number;
}

/** Extrae el primer nombre limpio de un perfil local; retorna null si no hay nombre. */
export function extractFirstName(fullName?: string | null): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0]?.trim();
  return first || null;
}

/** Clasifica la hora local en franjas de saludo naturales. */
export function getTimeOfDayBand(now: Date): TimeOfDayBand {
  const hour = now.getHours();
  if (hour < 4) return "lateNight";
  if (hour < 6) return "earlyBird";
  if (hour < 12) return "morning";
  if (hour < 19) return "afternoon";
  return "evening";
}

/** Verifica si dos fechas caen en el mismo día calendario local. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Elige un elemento del pool evitando repetir `avoidText` cuando hay más de una opción. */
function pickCandidate(
  pool: readonly string[],
  seed?: number,
  avoidText?: string | null
): string {
  if (pool.length === 0) return DEFAULT_IDLE_GREETING;
  const filtered =
    avoidText && pool.length > 1
      ? pool.filter((item) => item !== avoidText)
      : pool;
  const candidates = filtered.length > 0 ? filtered : pool;
  const index =
    typeof seed === "number" && Number.isFinite(seed)
      ? Math.abs(Math.floor(seed)) % candidates.length
      : Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

interface GreetingBuckets {
  greetings: string[];
  questions: string[];
  combined: string[];
}

function pickFromBuckets(
  buckets: GreetingBuckets,
  seed?: number,
  avoidText?: string | null
): string {
  const groups = [buckets.greetings, buckets.questions, buckets.combined].filter(
    (group) => group.length > 0
  );
  if (groups.length === 0) return DEFAULT_IDLE_GREETING;

  const rawSeed =
    typeof seed === "number" && Number.isFinite(seed)
      ? Math.abs(Math.floor(seed))
      : Math.floor(Math.random() * 100_000);

  const chosenGroup = groups[rawSeed % groups.length];
  const innerSeed = Math.floor(rawSeed / groups.length);
  const picked = pickCandidate(chosenGroup, innerSeed, avoidText);

  if (avoidText && picked === avoidText) {
    return pickCandidate(groups.flat(), innerSeed, avoidText);
  }
  return picked;
}

function getFeaturedHolidayBuckets(firstName: string, now: Date): GreetingBuckets | null {
  const month = now.getMonth();
  const day = now.getDate();

  if (month === 0 && day === 1) {
    return {
      greetings: [
        `¡Feliz Año Nuevo, ${firstName}!`,
        `Arrancando el año, ${firstName}`,
      ],
      questions: [
        `¿Qué construimos este año, ${firstName}?`,
        "¿Con qué empezamos el año?",
      ],
      combined: [`¡Feliz Año Nuevo, ${firstName}! ¿Qué construimos hoy?`],
    };
  }
  if (month === 11 && (day === 24 || day === 25)) {
    return {
      greetings: [
        `¡Felices fiestas, ${firstName}!`,
        `Aquí sigo en estas fiestas, ${firstName}`,
      ],
      questions: [
        `¿En qué te ayudo hoy, ${firstName}?`,
        "¿Qué adelantamos hoy?",
      ],
      combined: [`¡Felices fiestas, ${firstName}! ¿En qué te ayudo hoy?`],
    };
  }
  if (month === 11 && day === 31) {
    return {
      greetings: [
        `Cerrando el año, ${firstName}`,
        `Último día del año, ${firstName}`,
      ],
      questions: [
        `¿Qué dejamos listo hoy, ${firstName}?`,
        "¿Cerramos algún pendiente del año?",
      ],
      combined: [`Cerrando el año, ${firstName}. ¿Qué dejamos listo hoy?`],
    };
  }
  return null;
}

/**
 * Genera el saludo principal del Home según nombre, franja horaria y ocasión.
 * Alterna entre solo saludo, solo pregunta y saludo + pregunta.
 * Si no hay nombre configurado, devuelve siempre "¿En qué puedo ayudarte?".
 */
export function getHeroGreeting(options: HeroGreetingOptions = {}): string {
  const firstName = extractFirstName(options.userName);
  if (!firstName) {
    return DEFAULT_IDLE_GREETING;
  }

  const now = options.now ?? new Date();
  const featuredHoliday = getFeaturedHolidayBuckets(firstName, now);
  if (featuredHoliday) {
    return pickFromBuckets(featuredHoliday, options.seed, options.avoidText);
  }

  const band = getTimeOfDayBand(now);
  const hour = now.getHours();
  const weekday = now.getDay();
  const month = now.getMonth();
  const dayOfMonth = now.getDate();

  const buckets: GreetingBuckets = {
    greetings: [],
    questions: [],
    combined: [],
  };

  switch (band) {
    case "lateNight":
      buckets.greetings.push(
        `Modo nocturno activo, ${firstName}`,
        `Aquí sigo contigo, ${firstName}`,
        `Turno nocturno listo, ${firstName}`
      );
      buckets.questions.push(
        `¿Desvelándonos, ${firstName}?`,
        `¿Madrugando, ${firstName}?`,
        "¿Qué adelantamos esta noche?",
        `¿En qué te echo la mano, ${firstName}?`
      );
      buckets.combined.push(
        `¿Desvelándonos, ${firstName}? Aquí sigo contigo`,
        `Modo nocturno activo, ${firstName}. ¿Qué adelantamos?`,
        `¿Madrugando, ${firstName}? ¿En qué te echo la mano?`
      );
      break;
    case "earlyBird":
      buckets.greetings.push(
        `¡Qué temprano, ${firstName}!`,
        `Aquí estoy listo, ${firstName}`,
        `Arrancando temprano, ${firstName}`
      );
      buckets.questions.push(
        `¿Madrugando, ${firstName}?`,
        "¿Con qué arrancamos hoy?",
        `¿En qué avanzamos hoy, ${firstName}?`
      );
      buckets.combined.push(
        `¿Madrugando, ${firstName}? Aquí estoy listo`,
        `¡Qué temprano, ${firstName}! ¿Con qué arrancamos?`,
        `¿Madrugando, ${firstName}? ¿En qué avanzamos hoy?`
      );
      break;
    case "morning":
      buckets.greetings.push(
        `Buenos días, ${firstName}`,
        `¡Buen día, ${firstName}!`,
        `Listo para el día, ${firstName}`
      );
      buckets.questions.push(
        `¿Con qué arrancamos, ${firstName}?`,
        "¿Qué tenemos en mente hoy?",
        `¿Por dónde empezamos, ${firstName}?`,
        DEFAULT_IDLE_GREETING
      );
      buckets.combined.push(
        `Buenos días, ${firstName}. ¿Con qué arrancamos?`,
        `¡Buen día, ${firstName}! ¿Qué tenemos en mente hoy?`,
        `Listo para el día, ${firstName}. ¿Por dónde empezamos?`
      );
      if (weekday === 1) {
        buckets.greetings.push(`Arrancando la semana, ${firstName}`);
        buckets.questions.push(`¿Cuál es la prioridad hoy, ${firstName}?`);
        buckets.combined.push(
          `Arrancando la semana, ${firstName}. ¿Cuál es la prioridad?`
        );
      }
      break;
    case "afternoon":
      buckets.greetings.push(
        `Buenas tardes, ${firstName}`,
        `Seguimos al ritmo, ${firstName}`,
        `Aquí al pendiente, ${firstName}`
      );
      buckets.questions.push(
        `¿Cómo va tu tarde, ${firstName}?`,
        `¿En qué avanzamos, ${firstName}?`,
        "¿Qué toca ahora?",
        DEFAULT_IDLE_GREETING
      );
      buckets.combined.push(
        `Buenas tardes, ${firstName}. ¿En qué avanzamos?`,
        `¿Cómo va tu tarde, ${firstName}? Dime qué resolvemos`,
        `Seguimos al ritmo, ${firstName}. ¿Qué toca ahora?`
      );
      if (weekday === 5 && hour >= 13) {
        buckets.greetings.push(`¡Por fin viernes, ${firstName}!`);
        buckets.questions.push(`¿Cerramos la semana fuerte, ${firstName}?`);
        buckets.combined.push(
          `¡Viernes, ${firstName}! ¿Cerramos la semana fuerte?`
        );
      }
      break;
    case "evening":
      buckets.greetings.push(
        `Buenas noches, ${firstName}`,
        `Aquí sigo contigo, ${firstName}`,
        `Cierre de día tranquilo, ${firstName}`
      );
      buckets.questions.push(
        `¿Cerramos algún pendiente, ${firstName}?`,
        `¿Último empujón del día, ${firstName}?`,
        DEFAULT_IDLE_GREETING,
        "¿Qué revisamos antes de cerrar?"
      );
      buckets.combined.push(
        `Buenas noches, ${firstName}. ¿Cerramos algún pendiente?`,
        `Buenas noches, ${firstName}. ¿En qué puedo ayudarte?`,
        `¿Último empujón del día, ${firstName}? Aquí estoy`
      );
      if (weekday === 5 && hour <= 22) {
        buckets.greetings.push(`¡Viernes por la noche, ${firstName}!`);
        buckets.questions.push(`¿Cerramos la semana fuerte, ${firstName}?`);
        buckets.combined.push(
          `¡Viernes, ${firstName}! ¿Cerramos la semana fuerte?`
        );
      }
      break;
  }

  if ((weekday === 0 || weekday === 6) && hour >= 8 && hour <= 20) {
    buckets.greetings.push(`Fin de semana activo, ${firstName}`);
    buckets.questions.push(`¿Trabajando en finde, ${firstName}?`);
    buckets.combined.push(`¿Trabajando en finde, ${firstName}? Yo te cubro`);
  }

  if ((month === 9 && dayOfMonth === 31) || (month === 10 && (dayOfMonth === 1 || dayOfMonth === 2))) {
    buckets.greetings.push(`¡Felices fechas, ${firstName}!`);
    buckets.combined.push(`¡Felices fechas, ${firstName}! ¿En qué avanzamos hoy?`);
  }

  return pickFromBuckets(buckets, options.seed, options.avoidText);
}

/**
 * Genera frases cortas y carismáticas para la burbuja al hacer clic sobre Xox.
 */
export function getXoxBubbleGreeting(options: XoxBubbleOptions = {}): string {
  const agent = options.agentName?.trim() || "Xox";
  const role = options.activeRole?.trim() || null;
  const firstName = extractFirstName(options.userName);
  const now = options.now ?? new Date();
  const hour = now.getHours();
  const pending = Math.max(0, options.pendingTasksCount ?? 0);

  const buckets: GreetingBuckets = {
    greetings: [],
    questions: [],
    combined: [],
  };

  if (options.inActiveChat) {
    buckets.greetings.push(
      "Atento por si quieres darle otro enfoque.",
      firstName ? `Aquí sigo contigo, ${firstName}.` : "Aquí sigo al pendiente."
    );
    buckets.questions.push(
      "¿Ajustamos algo de esto?",
      "¿Seguimos con esto o probamos otra ruta?",
      firstName ? `¿Qué sigue, ${firstName}?` : "¿Qué sigue?"
    );
    buckets.combined.push(
      "¡Aquí sigo! ¿Ajustamos algo de esto?",
      firstName
        ? `Dime qué sigue, ${firstName}, aquí estoy.`
        : "Aquí estoy, dime qué ajustamos."
    );
    if (pending > 0) {
      buckets.greetings.push(
        `También tienes ${pending} ${pending === 1 ? "pendiente" : "pendientes"} en Tareas.`
      );
    }
  } else {
    buckets.greetings.push(
      "Brillando al 100%.",
      "Si me das un archivo o una duda, lo ordeno.",
      firstName ? `Todo listo por aquí, ${firstName}.` : "¡Aquí estoy listo!"
    );
    buckets.questions.push(
      "¿Probamos una idea?",
      "¿Qué armamos hoy?",
      firstName ? `¿En qué te echo la mano, ${firstName}?` : "¿En qué trabajamos hoy?"
    );
    buckets.combined.push(
      role
        ? `¡Hola! Soy ${agent} (${role}). ¿En qué trabajamos hoy?`
        : `¡Hola! Soy ${agent}. ¿Qué construimos o revisamos hoy?`,
      "¡Aquí estoy! ¿Probamos una idea?",
      "Brillando y listo. ¿Qué armamos?"
    );
    if (role) {
      buckets.combined.push(`Modo ${role} listo. ¿Por dónde empezamos?`);
    }
    if (firstName) {
      buckets.combined.push(
        `¡Hola, ${firstName}! ¿En qué te echo la mano?`,
        `Todo listo por aquí, ${firstName}. ¿Qué toca hoy?`
      );
    }
    if (hour < 6) {
      buckets.questions.push(
        firstName ? `¿Madrugando, ${firstName}?` : "¿Madrugando?"
      );
      buckets.combined.push(
        firstName
          ? `¿Madrugando, ${firstName}? Aquí sigo contigo.`
          : "¿Madrugando? Aquí sigo despierto."
      );
    } else if (hour < 12) {
      buckets.greetings.push("¡Con toda la energía de la mañana!");
    } else if (hour >= 19) {
      buckets.combined.push("Cierre tranquilo del día. ¿Qué revisamos?");
    }
    if (pending > 0) {
      buckets.greetings.push(
        `Tienes ${pending} ${pending === 1 ? "pendiente" : "pendientes"} esperando revisión.`
      );
    }
  }

  return pickFromBuckets(buckets, options.seed, options.lastMessage);
}

const HOME_INPUT_PLACEHOLDERS = [
  "Escribe a Xox (o arrastra PDFs e imágenes)...",
  "Pídeme una tabla, un resumen o arrastra un PDF...",
  "¿Qué analizamos o construimos hoy?",
  "Cuéntame qué necesitas resolver...",
] as const;

/** Placeholder rotativo y contextual para el cuadro de entrada principal. */
export function getChatInputPlaceholder(options: ChatPlaceholderOptions = {}): string {
  if (options.isStreaming) return "Procesando...";
  if (options.isDragging) return "Suelta tu PDF, imagen o archivo aquí...";
  if (options.hasMessages) return "Sigue la charla o arrastra PDFs e imágenes...";
  return pickCandidate(HOME_INPUT_PLACEHOLDERS, options.seed);
}

/** Placeholder corto para la Quick Bar al invocarla. */
export function getQuickBarPlaceholder(options: QuickBarPlaceholderOptions = {}): string {
  if (options.isStreaming) return "Procesando...";
  const firstName = extractFirstName(options.userName);
  const now = options.now ?? new Date();
  const hour = now.getHours();

  const pool: string[] = [
    "Escribe a Xox...",
    "Pregunta rápida, tabla o resumen...",
    "¿Qué resolvemos ahora?",
  ];

  if (firstName) {
    pool.push(`¿En qué te ayudo, ${firstName}?`);
    if (hour < 6) {
      pool.push(`¿Madrugando, ${firstName}? Dime qué necesitas...`);
    }
  }

  return pickCandidate(pool, options.seed);
}
