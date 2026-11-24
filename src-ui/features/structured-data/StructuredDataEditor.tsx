import { useId, useMemo, useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import {
  fieldLabel,
  formatIfDate,
  isTechnicalKey,
  parseStructured,
  recordTitle,
  serializeStructured,
  structuredFormatForExtension,
  valueLabel,
  type JsonObject,
  type JsonValue,
  type ParsedStructured,
} from "./structuredData";

const MAX_DEPTH = 3;
const RECORDS_PAGE = 60;

/** Devuelve el formato si el texto se puede mostrar como formulario o lista. */
export function structuredViewFormat(text: string, extension: string) {
  const format = structuredFormatForExtension(extension);
  return format && parseStructured(text, format) ? format : null;
}

interface StructuredDataEditorProps {
  text: string;
  extension: string;
  editable: boolean;
  onChange?: (nextText: string) => void;
}

/**
 * Muestra un JSON como formulario y un JSONL como lista de tarjetas, con nombres de campo
 * legibles. Al editar devuelve el archivo ya serializado; quien llama decide cuándo guardar.
 */
export function StructuredDataEditor({ text, extension, editable, onChange }: StructuredDataEditorProps) {
  const format = structuredFormatForExtension(extension);
  const parsed = useMemo(() => (format ? parseStructured(text, format) : null), [text, format]);
  if (!parsed) return null;
  const commit = (next: ParsedStructured) => onChange?.(serializeStructured(next));

  if (parsed.format === "jsonl") {
    return (
      <RecordList
        records={parsed.records}
        editable={editable}
        onChange={(records) => commit({ ...parsed, records })}
      />
    );
  }
  const value = parsed.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return (
      <ObjectFields obj={value} editable={editable} depth={0} onChange={(obj) => commit({ ...parsed, value: obj })} />
    );
  }
  return (
    <FieldValue value={value} label="Contenido" editable={editable} depth={0} onChange={(v) => commit({ ...parsed, value: v })} />
  );
}

function ObjectFields({
  obj,
  editable,
  depth,
  onChange,
}: {
  obj: JsonObject;
  editable: boolean;
  depth: number;
  onChange: (next: JsonObject) => void;
}) {
  const entries = Object.entries(obj);
  const main = entries.filter(([key]) => !isTechnicalKey(key));
  const technical = entries.filter(([key]) => isTechnicalKey(key));
  const renderField = ([key, value]: [string, JsonValue]) => (
    <FieldValue
      key={key}
      label={fieldLabel(key)}
      value={value}
      editable={editable}
      depth={depth}
      onChange={(next) => onChange({ ...obj, [key]: next })}
    />
  );
  return (
    <div className="space-y-3.5">
      {main.map(renderField)}
      {technical.length > 0 && (
        <details className="group rounded-xl bg-white/[0.02] border border-white/[0.06]">
          <summary className="cursor-pointer select-none list-none px-3 py-2 text-[12px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5">
            <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" aria-hidden="true" />
            Detalles técnicos
          </summary>
          <div className="px-3 pb-3 space-y-3">{technical.map(renderField)}</div>
        </details>
      )}
    </div>
  );
}

function FieldValue({
  label,
  value,
  editable,
  depth,
  onChange,
}: {
  label: string;
  value: JsonValue;
  editable: boolean;
  depth: number;
  onChange: (next: JsonValue) => void;
}) {
  const id = useId();
  const labelEl = (
    <label htmlFor={id} className="block text-[12px] font-medium text-zinc-400 mb-1.5">
      {label}
    </label>
  );

  if (Array.isArray(value)) {
    const allPrimitive = value.every((item) => item === null || typeof item !== "object");
    const allObjects = value.every((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    return (
      <div>
        <span className="block text-[12px] font-medium text-zinc-400 mb-1.5">{label}</span>
        {allPrimitive ? (
          <StringList items={value as (string | number | boolean | null)[]} editable={editable} onChange={onChange} />
        ) : allObjects ? (
          <RecordList records={value as JsonObject[]} editable={editable} nested onChange={(records) => onChange(records)} />
        ) : (
          // Lista mixta: editarla por partes podría perder elementos, así que solo se muestra.
          <pre className="text-[11.5px] font-mono text-zinc-300 whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
        )}
      </div>
    );
  }

  if (value && typeof value === "object") {
    return (
      <div>
        <span className="block text-[12px] font-medium text-zinc-400 mb-1.5">{label}</span>
        {depth < MAX_DEPTH ? (
          <div className="pl-3 border-l border-white/[0.08]">
            <ObjectFields obj={value} editable={editable} depth={depth + 1} onChange={onChange} />
          </div>
        ) : (
          <pre className="text-[11.5px] font-mono text-zinc-300 whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
        )}
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3">
        <span id={id} className="text-[12px] font-medium text-zinc-400">
          {label}
        </span>
        {editable ? (
          <button
            type="button"
            aria-labelledby={id}
            aria-pressed={value}
            onClick={() => onChange(!value)}
            className={`w-10 h-6 p-0.5 rounded-full flex cursor-pointer transition-colors ${
              value ? "bg-zinc-100 justify-end" : "bg-white/[0.14] justify-start"
            }`}
          >
            <span className={`w-5 h-5 rounded-full ${value ? "bg-zinc-950" : "bg-zinc-400"}`} />
          </button>
        ) : (
          <span className="text-[13px] text-zinc-100">{value ? "Sí" : "No"}</span>
        )}
      </div>
    );
  }

  if (!editable) {
    const text = value === null || value === "" ? "—" : String(value);
    const shown = typeof value === "string" ? formatIfDate(value) ?? valueLabel(value) : text;
    return (
      <div>
        <span className="block text-[12px] font-medium text-zinc-400 mb-1">{label}</span>
        <p className="text-[13.5px] leading-relaxed text-zinc-100 whitespace-pre-wrap break-words">{shown || "—"}</p>
      </div>
    );
  }

  if (typeof value === "number") {
    return (
      <div>
        {labelEl}
        <input
          id={id}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="w-full h-9 px-3 rounded-lg border border-white/[0.1] bg-[#07080b] text-[13.5px] text-zinc-100 outline-none focus:border-white/[0.28]"
        />
      </div>
    );
  }

  const text = value ?? "";
  const multiline = text.length > 60 || text.includes("\n");
  return (
    <div>
      {labelEl}
      {multiline ? (
        <textarea
          id={id}
          value={text}
          rows={Math.min(8, Math.max(2, Math.ceil(text.length / 70)))}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-white/[0.1] bg-[#07080b] text-[13.5px] leading-relaxed text-zinc-100 outline-none focus:border-white/[0.28] resize-y"
        />
      ) : (
        <input
          id={id}
          value={text}
          placeholder="Vacío"
          onChange={(e) => onChange(e.target.value === "" && value === null ? null : e.target.value)}
          className="w-full h-9 px-3 rounded-lg border border-white/[0.1] bg-[#07080b] text-[13.5px] text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-white/[0.28]"
        />
      )}
    </div>
  );
}

function StringList({
  items,
  editable,
  onChange,
}: {
  items: (string | number | boolean | null)[];
  editable: boolean;
  onChange: (next: JsonValue) => void;
}) {
  const [draft, setDraft] = useState("");
  if (!editable) {
    return items.length === 0 ? (
      <p className="text-[13px] text-zinc-400">Sin elementos.</p>
    ) : (
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-zinc-100">
            <span className="text-zinc-500 select-none" aria-hidden="true">
              ·
            </span>
            <span className="break-words">{String(item ?? "—")}</span>
          </li>
        ))}
      </ul>
    );
  }
  const add = () => {
    const clean = draft.trim();
    if (!clean) return;
    onChange([...items, clean]);
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <textarea
            aria-label={`Elemento ${i + 1}`}
            value={String(item ?? "")}
            rows={Math.min(4, Math.max(1, Math.ceil(String(item ?? "").length / 70)))}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-white/[0.1] bg-[#07080b] text-[13.5px] leading-relaxed text-zinc-100 outline-none focus:border-white/[0.28] resize-none"
          />
          <button
            type="button"
            aria-label={`Quitar elemento ${i + 1}`}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <input
          aria-label="Nuevo elemento"
          value={draft}
          placeholder="Escribe y presiona Agregar"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-dashed border-white/[0.16] bg-transparent text-[13px] text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-white/[0.3]"
        />
        <button
          type="button"
          onClick={add}
          className="h-9 px-3 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[12.5px] font-semibold flex items-center gap-1 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          Agregar
        </button>
      </div>
    </div>
  );
}

function RecordList({
  records,
  editable,
  nested = false,
  onChange,
}: {
  records: JsonObject[];
  editable: boolean;
  nested?: boolean;
  onChange: (next: JsonObject[]) => void;
}) {
  const [limit, setLimit] = useState(RECORDS_PAGE);
  // Los registros con fecha (bitácoras) se muestran del más reciente al más antiguo.
  const hasDates = records.some((r) => typeof r.timestamp === "string" || typeof r.created_at === "string");
  const order = records.map((_, i) => i);
  if (hasDates) order.reverse();
  const shown = order.slice(0, limit);
  return (
    <div className="space-y-1.5">
      {!nested && (
        <p className="text-[12px] text-zinc-400">
          {records.length} {records.length === 1 ? "registro" : "registros"}
          {hasDates ? " · los más recientes primero" : ""}
        </p>
      )}
      {shown.map((index) => (
        <RecordCard
          key={index}
          record={records[index]}
          fallbackTitle={`Registro ${index + 1}`}
          editable={editable}
          onChange={(next) => onChange(records.map((r, j) => (j === index ? next : r)))}
        />
      ))}
      {records.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + RECORDS_PAGE)}
          className="w-full h-9 rounded-lg border border-white/[0.08] text-[12.5px] text-zinc-300 hover:bg-white/[0.04] cursor-pointer"
        >
          Mostrar más ({records.length - limit})
        </button>
      )}
    </div>
  );
}

function RecordCard({
  record,
  fallbackTitle,
  editable,
  onChange,
}: {
  record: JsonObject;
  fallbackTitle: string;
  editable: boolean;
  onChange: (next: JsonObject) => void;
}) {
  const [open, setOpen] = useState(false);
  const status = ["decision", "status", "state", "estado"]
    .map((key) => record[key])
    .find((v): v is string => typeof v === "string" && Boolean(v));
  const rawDate = [record.timestamp, record.created_at, record.updated_at].find(
    (v): v is string => typeof v === "string"
  );
  const date = rawDate ? formatIfDate(rawDate) : null;
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full min-h-11 flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer rounded-xl hover:bg-white/[0.03]"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-zinc-400 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
        <span className="flex-1 min-w-0">
          <span className="block text-[13.5px] text-zinc-100 truncate">{recordTitle(record, fallbackTitle)}</span>
          {date && <span className="block text-[11.5px] text-zinc-400">{date}</span>}
        </span>
        {status && (
          <span className="shrink-0 px-2 py-0.5 rounded-full bg-[#1f2026] text-[11.5px] text-zinc-200">
            {valueLabel(status)}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-white/[0.05]">
          <ObjectFields obj={record} editable={editable} depth={1} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
