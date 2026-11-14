export type ClarificationQuestionKind = "choice_or_text" | "single" | "multi" | "text";

export interface ClarificationQuestion {
  id: string;
  prompt: string;
  kind: ClarificationQuestionKind;
  options: string[];
  placeholder?: string;
  required: boolean;
}

export interface ClarificationSpec {
  id: string;
  title: string;
  subtitle?: string;
  originalQuery?: string;
  submitLabel: string;
  questions: ClarificationQuestion[];
}

const ALLOWED_KINDS = new Set<ClarificationQuestionKind>([
  "choice_or_text",
  "single",
  "multi",
  "text",
]);

function readStr(val: unknown): string {
  return typeof val === "string" ? val.trim() : "";
}

function inferFallbackOptionsForPrompt(prompt: string): string[] {
  const low = prompt.toLowerCase();
  if (/(hora|horario|cuándo|cuando|día|dia|fecha)/.test(low)) {
    return [
      "Hoy más tarde",
      "Mañana a las 9:00 AM",
      "Esta semana (sugerir horario)",
    ];
  }
  if (/(actividad|evento|incluir|agenda|tarea|pendiente|reunión|reunion)/.test(low)) {
    return [
      "Revisión de inventario y pedidos",
      "Seguimiento a proveedores y pendientes",
      "Agenda operativa sugerida por Xox",
    ];
  }
  if (/(formato|tipo|dónde|donde|canal|medio)/.test(low)) {
    return [
      "En XOOK (Tareas y Agenda)",
      "En Calendario / Notas de Mac",
      "En un documento o tabla",
    ];
  }
  if (/(proveedor|compra|stock|producto|inventario|orden)/.test(low)) {
    return [
      "Productos con stock crítico",
      "Proveedor principal habitual",
      "Comparar opciones disponibles",
    ];
  }
  return [
    "Opción recomendada por Xox",
    "Versión rápida y directa",
    "Detallar paso a paso",
  ];
}

export function sanitizeClarificationSpec(raw: unknown): ClarificationSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rawQuestions = Array.isArray(obj.questions)
    ? obj.questions
    : Array.isArray(obj.preguntas)
    ? obj.preguntas
    : [];

  const cleanQuestions: ClarificationQuestion[] = [];
  for (let idx = 0; idx < Math.min(rawQuestions.length, 5); idx += 1) {
    const q = rawQuestions[idx];
    if (!q || typeof q !== "object") continue;
    const qObj = q as Record<string, unknown>;
    const prompt =
      readStr(qObj.prompt) ||
      readStr(qObj.question) ||
      readStr(qObj.label) ||
      readStr(qObj.pregunta);
    if (!prompt) continue;

    const rawOpts = Array.isArray(qObj.options)
      ? qObj.options
      : Array.isArray(qObj.opciones)
      ? qObj.opciones
      : [];
    const options: string[] = [];
    for (const opt of rawOpts.slice(0, 6)) {
      const label =
        typeof opt === "string"
          ? opt.trim()
          : opt && typeof opt === "object"
          ? readStr((opt as Record<string, unknown>).label) ||
            readStr((opt as Record<string, unknown>).text) ||
            readStr((opt as Record<string, unknown>).value)
          : "";
      if (label && !options.includes(label)) {
        options.push(label);
      }
    }

    if (options.length < 2) {
      for (const fallbackOpt of inferFallbackOptionsForPrompt(prompt)) {
        if (!options.includes(fallbackOpt)) {
          options.push(fallbackOpt);
        }
        if (options.length >= 3) break;
      }
    }

    const rawKind = readStr(qObj.kind || qObj.type).toLowerCase() as ClarificationQuestionKind;
    const kind: ClarificationQuestionKind =
      ALLOWED_KINDS.has(rawKind) && rawKind === "multi"
        ? "multi"
        : "choice_or_text";

    cleanQuestions.push({
      id: readStr(qObj.id) || `q_${idx + 1}`,
      prompt,
      kind,
      options,
      placeholder: readStr(qObj.placeholder) || "Escribe tu propia respuesta...",
      required: qObj.required === undefined ? true : Boolean(qObj.required),
    });
  }

  if (cleanQuestions.length === 0) return null;

  return {
    id: readStr(obj.id) || `clarify_${Date.now()}`,
    title: readStr(obj.title) || readStr(obj.titulo) || "Aclaremos algunos detalles",
    subtitle:
      readStr(obj.subtitle) ||
      readStr(obj.subtitulo) ||
      readStr(obj.description) ||
      undefined,
    originalQuery: readStr(obj.originalQuery) || readStr(obj.original_query) || undefined,
    submitLabel:
      readStr(obj.submitLabel) || readStr(obj.submit_label) || "Enviar respuestas a Xox",
    questions: cleanQuestions,
  };
}

export function formatClarificationReply(
  spec: ClarificationSpec,
  answers: Record<string, { selected: string[]; customText: string }>
): string {
  const lines: string[] = [];
  for (const q of spec.questions) {
    const entry = answers[q.id];
    const parts = [...(entry?.selected ?? [])];
    const custom = entry?.customText?.trim();
    if (custom && !parts.includes(custom)) {
      parts.push(custom);
    }
    if (parts.length > 0) {
      lines.push(`- ${q.prompt} ${parts.join(", ")}`);
    }
  }
  if (lines.length === 0) return "";
  const prefix = spec.originalQuery
    ? `Sobre mi solicitud ("${spec.originalQuery}"):`
    : "Sobre tus preguntas:";
  return `${prefix}\n${lines.join("\n")}`;
}

