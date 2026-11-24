import type { CommandPermissionUiItem } from "@xook/contracts";

/*
 * Qué dice la tarjeta de permiso, en palabras de quien la lee.
 *
 * La acción sale de `detailPreview`, que arma Rust con lo que de verdad se va a ejecutar. El
 * motivo (`purpose`) lo escribe el modelo: acompaña, pero nunca sustituye a la acción.
 */
export interface PermissionDetail {
  title: string;
  /** Lo que se va a hacer. */
  action: string | null;
  /** Para qué, según el modelo. */
  reason: string | null;
  /** Texto que se va a escribir en la otra app. */
  quote: string | null;
  /** El texto es más largo que lo que llega a la tarjeta. */
  quoteIsPartial: boolean;
  rows: ReadonlyArray<{ label: string; value: string }>;
  /** Contenido largo: archivo, cambio o script. */
  preview: string | null;
  warning: string | null;
  /** `null` cuando esta acción se pregunta siempre. */
  alwaysLabel: string | null;
  alwaysHint: string;
}

// Topes con los que `desktop_control/commands.rs` recorta el texto de la vista previa.
const TYPED_TEXT_LIMITS: Record<string, number> = { desktop_ui_type: 120, desktop_ui_act: 80 };

const TITLES: Record<string, (app: string) => string> = {
  open_app: (app) => `Xox quiere abrir ${app}`,
  os_notes_read: () => "Xox quiere ver tus notas",
  os_notes_write: () => "Xox quiere crear una nota",
  os_calendar_read: () => "Xox quiere ver tu calendario",
  os_calendar_write: () => "Xox quiere agendar un evento",
  ext_fs_list: () => "Xox quiere ver una carpeta",
  ext_fs_search: () => "Xox quiere buscar archivos",
  ext_fs_read: () => "Xox quiere leer un archivo",
  ext_fs_write: () => "Xox quiere guardar un archivo",
  ext_fs_edit: () => "Xox quiere editar un archivo",
  ext_fs_mkdir: () => "Xox quiere crear una carpeta",
  desktop_ui_act: (app) => `Xox quiere usar ${app}`,
  desktop_ui_type: (app) => `Xox quiere escribir en ${app}`,
  desktop_ui_focus: (app) => `Xox quiere traer ${app} al frente`,
};

const ROLE_NAMES: Record<string, string> = {
  button: "un botón",
  link: "un enlace",
  textfield: "un campo de texto",
  textarea: "un campo de texto",
  search_field: "un buscador",
  checkbox: "una casilla",
  radio: "una opción",
  combobox: "una lista",
  menuitem: "una opción del menú",
  menu: "un menú",
  tab: "una pestaña",
  text: "un texto",
  cell: "una celda",
  row: "una fila",
  image: "una imagen",
};

const KEY_NAMES: Record<string, string> = {
  return: "Enter",
  enter: "Enter",
  escape: "Esc",
  esc: "Esc",
  tab: "Tab",
  space: "Espacio",
  delete: "Borrar",
  backspace: "Borrar",
  up: "Flecha arriba",
  down: "Flecha abajo",
  left: "Flecha izquierda",
  right: "Flecha derecha",
  cmd: "⌘",
  command: "⌘",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
  ctrl: "⌃",
  control: "⌃",
};

/** "Microsoft Teams" → "Teams": en un botón basta con el nombre corto. */
export function shortAppName(app: string): string {
  return app.replace(/^(?:Microsoft|Google|Apple|Adobe)\s+(?=\S)/i, "").trim() || app;
}

function keyName(raw: string): string {
  const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
  const named = parts.map((part) => KEY_NAMES[part.toLowerCase()] ?? part.toUpperCase());
  return named.join(parts.length > 1 ? " " : "");
}

function controlName(raw: string): string {
  const clean = raw.replace(/\s*\(s\d+:@e\d+\)\s*$/, "").trim();
  const named = clean.match(/^\w+\s+(«[\s\S]+»)$/);
  if (named) return named[1];
  return ROLE_NAMES[clean.toLowerCase()] ?? "un elemento de la ventana";
}

/**
 * Separa el texto que se va a escribir de los datos de Rust que lo siguen. Es codicioso a propósito:
 * si el texto (que es del modelo) imita el formato de la tarjeta, se muestra entero como texto.
 */
function splitTyped(detail: string): { text: string | null; facts: string } {
  const match = detail.match(/\nTexto: "([\s\S]*)"((?:\n(?:Control|Destino|Confirmación obligatoria): [^\n]*)*)$/);
  return match ? { text: match[1], facts: match[2] } : { text: null, facts: detail };
}

function desktopAction(detail: string, facts: string): string | null {
  const raw = detail.match(/^Acción:\s*(.+)/)?.[1]?.trim();
  if (!raw) return null;
  if (/^Clic físico en coordenadas/.test(raw)) return "Hacer clic en un punto de la ventana";
  if (/^Traer al frente/.test(raw)) return null;
  const key = raw.match(/^Presionar tecla '(.+)'$/);
  if (key) return `Presionar ${keyName(key[1])}`;

  const typed = raw.match(/^Escribir (y enviar|texto)\b/);
  if (typed) {
    const verb = typed[1] === "y enviar" ? "Escribir y enviar" : "Escribir";
    const control = facts.match(/\nControl: (.+)/)?.[1];
    return control ? `${verb} en ${controlName(control)}` : verb;
  }
  const onControl = raw.match(/^(Hacer clic en|Escribir valor en|Enfocar control|Desplazar hasta)\s+([\s\S]+)$/);
  if (!onControl) return raw.replace(/\s*\(s\d+:@e\d+\)/g, "");
  const verb = onControl[1]
    .replace("Escribir valor en", "Escribir en")
    .replace("Enfocar control", "Ir a")
    .replace("Desplazar hasta", "Bajar hasta");
  return `${verb} ${controlName(onControl[2])}`;
}

function desktopWarning(facts: string): string | null {
  const note = facts.match(/\nConfirmación obligatoria: ([^\n]*)$/)?.[1];
  if (!note) return null;
  if (/enviará el texto/.test(note)) return "Se envía en cuanto lo permitas.";
  if (/tecla/.test(note)) return "Esta tecla puede enviar o confirmar cambios.";
  if (/coordenadas/.test(note)) return "No hay un botón identificado: revisa que sea el lugar correcto.";
  return "Puede enviar, borrar o confirmar algo.";
}

/** "Hacer clic en el botón Tareas … para ver las tareas" → "Para ver las tareas". */
function reasonFromPurpose(purpose: string, hasAction: boolean): string | null {
  const clean = purpose.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (!hasAction) return clean;
  // Solo si sigue un verbo: en "el mensaje para Claude", "para" no es un motivo.
  const why = clean.match(/\bpara\s+([\p{L}]+(?:ar|er|ir|ír)(?:lo|la|los|las|le|les|se|te|me|nos)?\b.*)$/iu);
  return why ? `Para ${why[1].replace(/\.$/, "")}` : clean;
}

function labeledRows(detail: string, labels: readonly string[], last?: string): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  for (const line of detail.split("\n")) {
    const current = rows[rows.length - 1];
    const match = line.match(/^([^:]{2,20}):\s*(.*)$/);
    // Después del último campo todo es su contenido, aunque parezca otra etiqueta.
    if (match && labels.includes(match[1]) && (last === undefined || current?.label !== last)) {
      rows.push({ label: match[1], value: match[2] });
    } else if (current) {
      current.value += `\n${line}`;
    }
  }
  return rows.map((row) => ({ ...row, value: row.value.trim() })).filter((row) => row.value);
}

function pathFromPurpose(purpose: string): string | null {
  return purpose.match(/^[^:]+(?:equipo|archivo|carpeta):\s*(.+)$/i)?.[1]?.trim() ?? null;
}

function alwaysCopy(item: CommandPermissionUiItem, app: string): { label: string; hint: string } {
  const kind = item.kind ?? "command";
  if (kind.startsWith("desktop_ui_")) {
    return {
      label: `Siempre en ${shortAppName(app)}`,
      hint: `Xox podrá usar ${app} sin preguntarte. Enviar, entregar o borrar te lo vuelve a preguntar.`,
    };
  }
  if (kind === "open_app") return { label: "Siempre", hint: `Xox podrá abrir ${app} sin preguntarte.` };
  if (kind.startsWith("ext_fs_")) {
    const scope = item.patternSuggestion || item.cwdRel;
    return { label: "Siempre en esta carpeta", hint: scope ? `Sin volver a preguntarte en ${scope}` : "Sin volver a preguntarte" };
  }
  if (kind === "os_notes_read") return { label: "Siempre", hint: "Xox podrá ver tus notas sin preguntarte." };
  if (kind === "os_notes_write") return { label: "Siempre", hint: "Xox podrá crear notas sin preguntarte." };
  if (kind === "os_calendar_read") return { label: "Siempre", hint: "Xox podrá ver tu calendario sin preguntarte." };
  if (kind === "os_calendar_write") return { label: "Siempre", hint: "Xox podrá agendar eventos sin preguntarte." };
  return {
    label: "Siempre",
    hint: item.patternSuggestion ? `Sin volver a preguntarte: ${item.patternSuggestion}` : "Sin volver a preguntarte por este comando",
  };
}

export function describePermission(item: CommandPermissionUiItem): PermissionDetail {
  const kind = item.kind ?? "command";
  const app = item.appName || item.program || "la aplicación";
  const detail = (item.detailPreview ?? "").trim();
  const purpose = (item.purpose ?? "").trim();
  const always = alwaysCopy(item, app);

  const base: PermissionDetail = {
    title: TITLES[kind]?.(app) ?? "Xox quiere ejecutar un comando",
    action: null,
    reason: null,
    quote: null,
    quoteIsPartial: false,
    rows: [],
    preview: null,
    warning: null,
    alwaysLabel: item.allowAlwaysAllowed === false ? null : always.label,
    alwaysHint: always.hint,
  };

  if (kind.startsWith("desktop_ui_")) {
    const { text: quote, facts } = splitTyped(detail);
    const action = desktopAction(detail, facts);
    return {
      ...base,
      action,
      reason: reasonFromPurpose(purpose, Boolean(action)),
      quote,
      quoteIsPartial: quote !== null && Array.from(quote).length >= (TYPED_TEXT_LIMITS[kind] ?? Infinity),
      warning: desktopWarning(facts),
    };
  }
  if (kind === "os_notes_write") {
    return { ...base, rows: labeledRows(detail, ["Título", "Carpeta", "Contenido"], "Contenido") };
  }
  if (kind === "os_calendar_write") {
    return { ...base, rows: labeledRows(detail, ["Evento", "Cuándo", "Horario", "Calendario", "Lugar", "Alerta"]) };
  }
  if (kind === "ext_fs_write") {
    return {
      ...base,
      action: detail.match(/^Archivo: (.+)/)?.[1]?.trim() ?? pathFromPurpose(purpose),
      preview: detail.match(/\nVista previa:\n([\s\S]+)$/)?.[1] ?? null,
    };
  }
  if (kind.startsWith("ext_fs_")) {
    const path = pathFromPurpose(purpose);
    return {
      ...base,
      action: path ?? (purpose || item.cwdRel || null),
      preview: kind === "ext_fs_edit" && detail ? detail : null,
    };
  }
  if (kind === "command" || kind === "external_command") {
    return { ...base, reason: purpose || null, preview: detail || null };
  }
  return { ...base, action: kind === "open_app" ? null : detail || null, reason: purpose || null };
}
