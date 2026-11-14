import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

const ICON_DATA_QUERY = "?icon-data";
const VIEWBOX_RE =
  /^-?\d+(?:\.\d+)?(?:\s+|,)-?\d+(?:\.\d+)?(?:\s+|,)\d+(?:\.\d+)?(?:\s+|,)\d+(?:\.\d+)?$/;
const PATH_DATA_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/;
const UNSAFE_SVG_RE =
  /<script\b|<foreignObject\b|javascript:|on[a-z]+\s*=|xlink:href\s*=|\bhref\s*=/i;

/**
 * Extrae únicamente geometría SVG validada (viewBox, fillRule y path `d`) en tiempo de compilación,
 * evitando dangerouslySetInnerHTML y dependencias en runtime.
 */
function parseSafeSvgIconData(svgSource: string, filePath: string) {
  if (UNSAFE_SVG_RE.test(svgSource)) {
    throw new Error(`Contenido SVG no permitido en ${filePath}`);
  }
  const svgTagMatch = svgSource.match(/<svg\b([^>]*)>/i);
  if (!svgTagMatch) {
    throw new Error(`Etiqueta <svg> inválida en ${filePath}`);
  }
  const svgAttrs = svgTagMatch[1];
  const viewBoxMatch = svgAttrs.match(/\bviewBox=["']([^"']+)["']/i);
  const viewBox = viewBoxMatch ? viewBoxMatch[1].trim() : "0 0 24 24";
  if (!VIEWBOX_RE.test(viewBox)) {
    throw new Error(`viewBox inválido en ${filePath}`);
  }
  const svgFillRuleMatch = svgAttrs.match(/\bfill-rule=["'](evenodd|nonzero)["']/i);
  const fillRule = svgFillRuleMatch?.[1].toLowerCase() as "evenodd" | "nonzero" | undefined;

  const paths: Array<{ d: string; fillRule?: "evenodd" | "nonzero" }> = [];
  for (const match of svgSource.matchAll(/<path\b([^>]*)\/?>/gi)) {
    const attrs = match[1];
    const dMatch = attrs.match(/\bd=["']([^"']+)["']/i);
    if (!dMatch) continue;
    const d = dMatch[1].trim();
    if (!PATH_DATA_RE.test(d)) {
      throw new Error(`Atributo path d inválido en ${filePath}`);
    }
    const pathFillRuleMatch = attrs.match(/\bfill-rule=["'](evenodd|nonzero)["']/i);
    const pathFillRule = pathFillRuleMatch?.[1].toLowerCase() as "evenodd" | "nonzero" | undefined;
    paths.push(pathFillRule ? { d, fillRule: pathFillRule } : { d });
  }

  if (paths.length === 0) {
    throw new Error(`No se encontraron rutas <path> válidas en ${filePath}`);
  }

  return {
    viewBox,
    ...(fillRule ? { fillRule } : {}),
    paths,
  };
}

function staticSvgIconDataPlugin(): Plugin {
  return {
    name: "xook-static-svg-icon-data",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.endsWith(`.svg${ICON_DATA_QUERY}`)) return null;
      const cleanSource = source.slice(0, -ICON_DATA_QUERY.length);
      const resolved = await this.resolve(cleanSource, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved || resolved.external) return null;
      const cleanId = resolved.id.split("?")[0];
      return `${cleanId}${ICON_DATA_QUERY}`;
    },
    load(id) {
      if (!id.endsWith(`.svg${ICON_DATA_QUERY}`)) return null;
      const filePath = id.slice(0, -ICON_DATA_QUERY.length);
      if (filePath.includes("\0") || !filePath.endsWith(".svg")) return null;
      this.addWatchFile(filePath);
      const svgSource = fs.readFileSync(filePath, "utf8");
      const iconData = parseSafeSvgIconData(svgSource, filePath);
      return `export default ${JSON.stringify(iconData)};`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [staticSvgIconDataPlugin(), react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
