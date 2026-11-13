import {
  AgendaItem,
  TaskProposal,
  sanitizeTaskProposal,
} from "./taskSchema";

export const INITIAL_GENERATIVE_PROPOSALS: TaskProposal[] = [
  sanitizeTaskProposal({
    cardId: "card_sched_auto_01",
    title: "Auto-agendar conteo y reorden semanal",
    subtitle: "Xox detectó que sueles aprobar compras los martes y miércoles antes de mediodía.",
    category: "agenda",
    urgency: "info",
    statusChip: "Mar y Mié · 09:00",
    defaultExpanded: false,
    generatedBy: "Memoria + Agenda",
    paramValues: {
      auto_schedule: true,
      window_slot: "09:00",
    },
    intent: {
      type: "schedule_event",
      targetLabel: "Revisión automática de inventario",
      primaryLabel: "Activar agenda",
    },
    blocks: [
      {
        type: "schedule",
        mode: "auto",
        timeLabel: "09:00 hrs",
        dateLabel: "Cada martes y miércoles",
        recurrence: "Semanal",
        autoSchedule: true,
        autoTriggerLabel: "Auto-agendar si el stock baja de 7 días",
      },
      {
        type: "checklist",
        title: "Pasos que Xox preparará en esa ventana",
        items: [
          { id: "chk_1", label: "Revisar existencias críticas de café y té", done: false },
          { id: "chk_2", label: "Preparar borrador de orden para tu firma HITL", done: false },
        ],
      },
      {
        type: "param_control",
        key: "window_slot",
        label: "Horario preferido",
        kind: "select",
        value: "09:00",
        options: [
          { value: "09:00", label: "09:00", hint: "Apertura" },
          { value: "13:00", label: "13:00", hint: "Mediodía" },
          { value: "18:00", label: "18:00", hint: "Cierre" },
        ],
      },
      {
        type: "insight",
        text: "Basado en tus aprobaciones previas. Nunca emitirá compras sin tu clic.",
        source: "memory_store.json",
        confidence: 0.88,
      },
    ],
  }),
];

export const INITIAL_AGENDA_ITEMS: AgendaItem[] = [
  {
    id: "ag_timer_demo",
    kind: "timer",
    title: "Confirmar recepción con Distribuidora del Sur",
    subtitle: "Reloj operativo para seguimiento de entrega",
    timeLabel: "15:00",
    durationSeconds: 900,
    remainingSeconds: 900,
    isRunning: false,
    autoScheduled: false,
    createdAtLabel: "Hoy · 16:15",
  },
  {
    id: "ag_note_demo",
    kind: "note",
    title: "Nota de turno · Revisión de bodega",
    subtitle: "Recordatorios fijados para cierre",
    timeLabel: "Hoy 19:00",
    noteContent: "Validar lote nuevo de Café Chiapas y verificar humedad en anaquel de Matcha.",
    checklist: [
      { id: "n_chk_1", label: "Contar bolsas abiertas en barra", done: true },
      { id: "n_chk_2", label: "Etiquetar fecha de caducidad en recepción", done: false },
    ],
    tags: ["Bodega", "Cierre"],
    createdAtLabel: "Hoy · 14:20",
  },
];

function extractMinutes(query: string): number | null {
  const minMatch = query.match(/(\d+)\s*(?:min|minuto|minutos|m\b)/i);
  if (minMatch) return Math.min(180, Math.max(1, Number(minMatch[1])));
  const hrMatch = query.match(/(\d+)\s*(?:h|hora|horas)\b/i);
  if (hrMatch) return Math.min(240, Math.max(1, Number(hrMatch[1]) * 60));
  return null;
}

function extractTimeString(query: string): string | null {
  const match = query.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|hrs)?)\b/i);
  return match ? match[1].trim() : null;
}

export interface SynthesisOutcome {
  mode: "add_cards" | "replace_consolidated" | "none";
  newProposals: TaskProposal[];
  statusText: string;
}

/**
 * Simula al agente reconstruyendo tarjetas seguras a partir de una instrucción en lenguaje natural.
 * Siempre produce TaskProposal tipadas y validadas por sanitizeTaskProposal (cero HTML/JSON libre).
 */
export function synthesizeTasksFromPrompt(
  rawQuery: string,
  currentTasks: TaskProposal[]
): SynthesisOutcome {
  const q = rawQuery.trim();
  const lower = q.toLowerCase();
  const idSuffix = Date.now().toString().slice(-5);

  // 1. Consolidar / reorganizar / comparar tareas actuales
  if (/(consolida|agrupa|reconstru|optimiza|compara|resumen)/i.test(lower)) {
    const orderTasks = currentTasks.filter((t) => t.intent.type === "stock_reorder");
    if (orderTasks.length >= 2) {
      const totalEstimated = orderTasks.reduce((acc, t) => {
        const qty = Number(t.paramValues[t.intent.quantityParamKey ?? ""] ?? 0);
        const unit = t.intent.unitPrice ?? 0;
        return acc + qty * unit;
      }, 0);

      const consolidated = sanitizeTaskProposal({
        cardId: `card_consolidated_${idSuffix}`,
        title: "Plan consolidado de reabastecimiento",
        subtitle: `Xox reorganizó ${orderTasks.length} órdenes pendientes en una vista de lote y presupuesto.`,
        category: "optimizacion",
        urgency: "alta",
        statusChip: `${orderTasks.length} productos`,
        defaultExpanded: true,
        generatedBy: "Reconstrucción Xox",
        paramValues: {
          auto_schedule: false,
        },
        intent: {
          type: "apply_rule",
          targetLabel: "Lote de reabastecimiento semanal",
          primaryLabel: "Confirmar lote",
          fixedCost: totalEstimated,
          currency: "MXN",
          maxBudgetLimit: 50000,
        },
        blocks: [
          {
            type: "metrics_strip",
            items: [
              { label: "Ítems", value: `${orderTasks.length}`, tone: "neutral" },
              {
                label: "Inversión total",
                value: `$${totalEstimated.toLocaleString()}`,
                sub: "MXN",
                tone: "positive",
              },
              {
                label: "Presupuesto",
                value: `${Math.max(1, Math.round((totalEstimated / 50000) * 100))}%`,
                sub: "de $50k",
                tone: "neutral",
              },
            ],
          },
          {
            type: "kv_list",
            rows: orderTasks.map((t) => ({
              label: t.intent.targetLabel,
              value: `+${t.paramValues[t.intent.quantityParamKey ?? ""] ?? 0} un.`,
              subtle: t.intent.supplierName,
            })),
          },
          {
            type: "comparison",
            rows: [
              {
                label: "Gestión",
                before: `${orderTasks.length} aprobaciones separadas`,
                after: "1 revisión unificada de lote",
                tone: "positive",
              },
            ],
          },
          {
            type: "insight",
            text: "Reconstruí estas órdenes en una vista ejecutiva respetando tu tope de $50,000 MXN.",
            source: "Xox Planner",
          },
        ],
      });

      return {
        mode: "add_cards",
        newProposals: [consolidated],
        statusText: "Reconstruí un resumen consolidado de tus órdenes pendientes.",
      };
    }
  }

  // 2. Reloj / Temporizador / Alarma
  if (/(reloj|timer|temporizador|alarma|cron[oó]metro|av[ií]same en)/i.test(lower)) {
    const mins = extractMinutes(lower) ?? 15;
    const durationSeconds = mins * 60;
    const cleanSubject = q
      .replace(/(pon|crea|inicia|agrega|un|una|el|reloj|timer|temporizador|alarma|de|\d+\s*(?:min|minutos?|h|horas?)|para)/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const title = cleanSubject ? `Reloj: ${cleanSubject}` : `Temporizador operativo (${mins} min)`;

    const timerProposal = sanitizeTaskProposal({
      cardId: `card_timer_${idSuffix}`,
      title,
      subtitle: "Propuesta de reloj en vivo generada por Xox para tu barra de Agenda.",
      category: "reloj",
      urgency: "info",
      statusChip: `${mins} min`,
      defaultExpanded: true,
      generatedBy: "Agenda Xox",
      paramValues: {
        duration_min: mins,
        auto_schedule: false,
      },
      intent: {
        type: "start_timer",
        targetLabel: title,
        primaryLabel: "Iniciar reloj",
      },
      blocks: [
        {
          type: "schedule",
          mode: "timer",
          timeLabel: `${String(mins).padStart(2, "0")}:00`,
          dateLabel: "Cuenta regresiva en vivo",
          durationSeconds,
          autoSchedule: false,
        },
        {
          type: "param_control",
          key: "duration_min",
          label: "Duración",
          kind: "stepper",
          value: mins,
          min: 1,
          max: 180,
          step: 5,
          unit: "min",
        },
        {
          type: "insight",
          text: "Al aprobarlo, el reloj comenzará a correr en la pestaña Agenda y te avisaré al terminar.",
          source: "Reloj HITL",
        },
      ],
    });

    return {
      mode: "add_cards",
      newProposals: [timerProposal],
      statusText: `Preparé la tarjeta de reloj (${mins} min) para que la inicies cuando quieras.`,
    };
  }

  // 3. Agendar / Auto-agendar / Recordatorio
  if (/(agenda|auto|programa|recordatorio|recu[eé]rdame|ma[nñ]ana|martes|mi[eé]rcoles|jueves|viernes|lunes)/i.test(lower)) {
    const timeStr = extractTimeString(lower) ?? "09:00";
    const isAuto = /auto/i.test(lower);
    const title = q.length > 48 ? `${q.slice(0, 45).trim()}...` : q;

    const schedProposal = sanitizeTaskProposal({
      cardId: `card_sched_${idSuffix}`,
      title: isAuto ? `Auto-agenda: ${title}` : `Agendar: ${title}`,
      subtitle: "Tarea programada estructurada por Xox con opción de auto-agendado.",
      category: "agenda",
      urgency: "media",
      statusChip: timeStr,
      defaultExpanded: true,
      generatedBy: "Agenda Xox",
      paramValues: {
        auto_schedule: isAuto,
      },
      intent: {
        type: "schedule_event",
        targetLabel: title,
        primaryLabel: isAuto ? "Confirmar auto-agenda" : "Agendar tarea",
      },
      blocks: [
        {
          type: "schedule",
          mode: isAuto ? "auto" : "alarm",
          timeLabel: timeStr,
          dateLabel: /ma[nñ]ana/i.test(lower) ? "Mañana" : "Próxima ventana hábil",
          recurrence: /cada|semanal|martes|auto/i.test(lower) ? "Recurrente" : "Una vez",
          autoSchedule: isAuto,
          autoTriggerLabel: "Permitir que Xox reprograme si cambia el stock",
        },
        {
          type: "checklist",
          title: "Acciones incluidas",
          items: [
            { id: `c_${idSuffix}_1`, label: "Notificar en panel de Tareas & Xox", done: false },
            { id: `c_${idSuffix}_2`, label: "Adjuntar contexto de tienda actualizado", done: false },
          ],
        },
        {
          type: "insight",
          text: "Se guardará en tu pestaña Agenda y respetará el horario configurado.",
          source: "Agenda inteligente",
        },
      ],
    });

    return {
      mode: "add_cards",
      newProposals: [schedProposal],
      statusText: `Armé la propuesta de agenda para "${title}".`,
    };
  }

  // 4. Nota / Lista / Tarea manual
  if (/(nota|anota|apunta|lista|tarea|pendiente|checklist|compra|revisar|verificar)/i.test(lower)) {
    const cleanText = q.replace(/^(anota|crea una nota|nota:?|apunta|tarea:?)\s*/i, "").trim() || q;
    const noteProposal = sanitizeTaskProposal({
      cardId: `card_note_${idSuffix}`,
      title: cleanText.length > 42 ? `${cleanText.slice(0, 39)}...` : cleanText,
      subtitle: "Nota operativa y checklist generado a partir de tu mensaje.",
      category: "nota",
      urgency: "info",
      statusChip: "Nota",
      defaultExpanded: true,
      generatedBy: "Notas Xox",
      paramValues: {},
      intent: {
        type: "save_note",
        targetLabel: cleanText,
        primaryLabel: "Guardar en Agenda",
      },
      blocks: [
        {
          type: "note",
          content: cleanText,
          tags: ["Operación", "Xox"],
        },
        {
          type: "checklist",
          items: [
            { id: `n_${idSuffix}_1`, label: cleanText, done: false },
          ],
        },
        {
          type: "insight",
          text: "Puedes marcar puntos como listos aquí mismo o fijarla en Agenda.",
          source: "Nota estructurada",
        },
      ],
    });

    return {
      mode: "add_cards",
      newProposals: [noteProposal],
      statusText: "Creé una nota accionable lista para revisar o fijar en Agenda.",
    };
  }

  return {
    mode: "none",
    newProposals: [],
    statusText: "¡Análisis completado! He evaluado las directivas.",
  };
}
