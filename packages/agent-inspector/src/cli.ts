#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseTraceLine } from "../../contracts/src/index.ts";
import {
  analyzeTraceEvents,
  formatAnalysisReport,
  parseTraceJsonl,
} from "./analyzer.ts";

interface CliOptions {
  targetPath: string;
  sessionId?: string;
  listOnly: boolean;
  asJson: boolean;
  watch: boolean;
}

function parseCliArgs(argv: string[]): CliOptions {
  let targetPath = process.cwd();
  let sessionId: string | undefined;
  let listOnly = false;
  let asJson = false;
  let watch = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list" || arg === "-l") {
      listOnly = true;
    } else if (arg === "--json") {
      asJson = true;
    } else if (arg === "--watch" || arg === "-w") {
      watch = true;
    } else if ((arg === "--session" || arg === "-s") && argv[i + 1]) {
      sessionId = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Uso: npm run agent:inspect -- [ruta_workspace_o_archivo.jsonl] [opciones]",
          "",
          "Opciones:",
          "  --list, -l            Lista las sesiones registradas en .xook/agent_traces/",
          "  --session, -s <id>    Inspecciona una sesión específica por ID",
          "  --watch, -w           Sigue en vivo los eventos nuevos del archivo seleccionado",
          "  --json                Imprime el reporte completo en formato JSON",
        ].join("\n")
      );
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      targetPath = path.resolve(arg);
    }
  }

  return { targetPath, sessionId, listOnly, asJson, watch };
}

function resolveTraceFiles(targetPath: string): { traceDir: string; files: string[] } {
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
    return { traceDir: path.dirname ? path.dirname(targetPath) : targetPath, files: [targetPath] };
  }

  const candidates = [
    path.join(targetPath, ".xook", "agent_traces"),
    targetPath,
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const jsonlFiles = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(dir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (jsonlFiles.length > 0 || dir.endsWith("agent_traces")) {
      return { traceDir: dir, files: jsonlFiles };
    }
  }
  return { traceDir: path.join(targetPath, ".xook", "agent_traces"), files: [] };
}

function printLiveWatch(filePath: string): void {
  console.log(`\n[watch] Escuchando eventos en vivo: ${filePath} (Ctrl+C para salir)`);
  let offset = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  let remainder = "";
  const decoder = new TextDecoder("utf-8");

  fs.watchFile(filePath, { interval: 400 }, (curr) => {
    if (curr.size <= offset) return;
    const length = curr.size - offset;
    const buf = new Uint8Array(length);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buf, 0, length, offset);
    } finally {
      fs.closeSync(fd);
    }
    offset = curr.size;
    const chunk = remainder + decoder.decode(buf);
    const parts = chunk.split(/\r?\n/);
    remainder = parts.pop() ?? "";
    for (const rawLine of parts) {
      const parsed = parseTraceLine(rawLine);
      if (!parsed.event) continue;
      const ev = parsed.event;
      const summary =
        ev.type === "tool.result"
          ? `${ev.tool} (${ev.ok ? "ok" : "error"}, ${ev.durationMs}ms${ev.disposition ? `, ${ev.disposition.delivery}` : ""})`
          : ev.type === "context.compacted"
            ? `${ev.method} (-${ev.savedPct}%, ${ev.compactedTurns} turnos)`
            : ev.type === "context.budget"
              ? `${ev.utilizationPct.toFixed(1)}% de ${ev.modelContextWindow} tok`
              : ev.type === "turn.end"
                ? `${ev.provider}/${ev.model} · ${ev.rounds} rondas · ${ev.totalTokens ?? 0} tok · ${ev.latencyMs}ms`
                : ev.type === "subagent.done"
                  ? `${ev.name} (${ev.ok ? "ok" : "error"}, ${ev.durationMs}ms)`
                  : ev.type;
      console.log(`[${ev.ts}] ${ev.type} · ${summary}`);
    }
  });
}

function main(): void {
  const opts = parseCliArgs(process.argv.slice(2));
  const { traceDir, files } = resolveTraceFiles(opts.targetPath);

  if (files.length === 0) {
    console.log(`No se encontraron trazas JSONL en ${traceDir}.`);
    console.log("Ejecuta al menos un turno en XOOK sobre ese workspace o pasa la ruta de tu workspace:");
    console.log("  npm run agent:inspect -- /ruta/al/workspace");
    return;
  }

  if (opts.listOnly) {
    console.log(`Sesiones registradas en ${traceDir}:`);
    for (const f of files) {
      const st = fs.statSync(f);
      const id = path.basename(f, ".jsonl");
      console.log(`  - ${id} (${Math.max(1, Math.round(st.size / 1024))} KB)`);
    }
    return;
  }

  const chosen = opts.sessionId
    ? files.find((f) => path.basename(f, ".jsonl") === opts.sessionId)
    : files[0];

  if (!chosen) {
    console.error(`No se encontró la sesión '${opts.sessionId}' en ${traceDir}.`);
    process.exit(1);
  }

  const content = fs.readFileSync(chosen, "utf8");
  const { events, warnings } = parseTraceJsonl(content);
  const report = analyzeTraceEvents(events, warnings);

  if (opts.asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatAnalysisReport(report));
  }

  if (opts.watch) {
    printLiveWatch(chosen);
  }
}

main();
