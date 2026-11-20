export interface CleanSpeechOptions {
  streaming?: boolean;
  maxLength?: number;
  preserveTrailingSpace?: boolean;
}

export type ScreenNoticeKind = "code" | "table" | "list" | null;

const KNOWN_FILE_EXTS = [
  // Código y web
  "tsx", "ts", "jsx", "js", "mjs", "cjs", "pyw", "py", "rs", "go", "java", "kt",
  "swift", "cpp", "hpp", "cc", "cs", "rb", "php", "bash", "zsh", "sh", "ps1",
  "bat", "cmd", "lua", "scala", "dart", "vue", "svelte", "astro", "html", "htm",
  "scss", "sass", "less", "css", "sql", "graphql", "gql", "wasm", "proto",
  // Configuración y datos
  "jsonc", "jsonl", "json", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
  "xml", "plist", "lock", "csv", "tsv", "parquet", "sqlite3", "sqlite", "db",
  "log", "bak", "tmp", "part", "safetensors", "onnx", "gguf", "bin", "dat", "model",
  // Documentos y oficina
  "mdx", "markdown", "md", "txt", "rtf", "pdf", "docx", "doc", "xlsx", "xls",
  "pptx", "ppt", "odt", "ods", "odp", "epub", "tex", "pages", "numbers", "key",
  // Media, archivos e instaladores
  "jpeg", "jpg", "png", "gif", "webp", "svg", "ico", "bmp", "tiff", "heic", "avif",
  "mp3", "wav", "ogg", "flac", "aac", "m4a", "mp4", "mov", "avi", "mkv", "webm",
  "zip", "tar", "tgz", "gz", "bz2", "xz", "7z", "rar", "dmg", "pkg", "app",
  "exe", "msi", "deb", "rpm", "apk", "ipa", "iso", "ttf", "otf", "woff2", "woff",
];

const KNOWN_EXT_PATTERN = KNOWN_FILE_EXTS.join("|");
const KNOWN_EXT_SET = new Set(KNOWN_FILE_EXTS);

const CLI_COMMAND_HEADS = new Set([
  "npm", "npx", "yarn", "pnpm", "bun", "git", "cargo", "rustc", "rustup",
  "python", "python3", "pip", "pip3", "uv", "node", "deno", "curl", "wget",
  "bash", "zsh", "sh", "cd", "ls", "ll", "rm", "cp", "mv", "mkdir", "touch",
  "cat", "head", "tail", "grep", "rg", "find", "chmod", "chown", "sudo",
  "docker", "kubectl", "gcloud", "bq", "gsutil", "firebase", "supabase",
  "sqlite3", "psql", "mysql", "brew", "tauri", "vite", "tsc", "eslint",
  "prettier", "vitest", "jest", "pytest", "make", "cmake", "ssh", "scp",
  "rsync", "tar", "unzip", "kill", "pkill", "ps", "lsof", "export", "source",
]);

const KNOWN_BRAND_CAMEL = new Set([
  "iphone", "ipad", "imac", "icloud", "ios", "macos", "watchos", "tvos",
  "ipados", "ebay", "ebook", "email", "mrna", "javascript", "typescript",
  "github", "gitlab", "openai", "chatgpt", "youtube", "whatsapp", "linkedin",
  "tiktok", "powerpoint", "onedrive", "sharepoint", "wordpress", "postgresql",
  "mysql", "graphql", "nextjs", "nuxtjs", "nodejs", "openrouter", "deepseek",
  "webkit", "playstation", "xbox", "quickbar", "tailwind", "airpods", "macbook",
]);

const CODE_PASCAL_SUFFIX_RE =
  /(?:Modal|Panel|View|Card|Client|Store|Worker|Engine|Schema|Helper|Service|Handler|Manager|Controller|Provider|Context|Props|State|Config|Utils|Types|Api|Dto|Impl|Error|Exception|Hook|Router|Parser|Builder|Factory|Adapter|Guard|Runner|Watcher|Overlay|Dialog|Popover|Dropdown|Button|Input|Form|Table|List|Item|Menu|Dock|Tray|Track|Session|Snapshot|Payload|Message|Response|Request|Result|Event|Token|Chunk|Buffer|Stream|Cache|Index|Registry|Manifest|Element|Node|Tree|Graph|Layer|Backdrop|Preview|Editor|Viewer|Reader|Writer|Generator|Loader|Sanitizer|Formatter|Validator|Resolver|Executor|Dispatcher|Scheduler|Monitor|Logger|Metrics|Status|Preset|Settings|Options|Params|Args)$/;

const SPANISH_MONTHS = [
  "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const FILE_NOUN_RE =
  "(?:archivos?|documentos?|ficheros?|reportes?|informes?|scripts?|m[óo]dulos?|componentes?|pdfs?|excels?|words?|presentaci[óo]n|presentaciones|hojas?|im[áa]genes?|imagen|fotos?|videos?|audios?|contratos?|presupuestos?|facturas?|notas?|plantillas?|configuraci[óo]n|configuraciones|registros?|logs?|respaldos?|backups?|datasets?|bases?\\s+de\\s+datos)";

const DIR_NOUN_RE =
  "(?:carpetas?|directorios?|rutas?|ubicaciones?|ubicaci[óo]n|repositorios?|repos?|proyectos?|workspaces?|espacios?)";

const CODE_NOUN_RE =
  "(?:funci[óo]n|funciones|m[ée]todos?|variables?|par[áa]metros?|propiedades?|propiedad|clases?|componentes?|comandos?|s[íi]mbolos?|constantes?|campos?|columnas?|eventos?|atributos?|tipos?|interfaz|interfaces|hooks?|objetos?|arreglos?|arrays?|expresi[óo]n|expresiones|reglas?|etiquetas?|valores?|valor|claves?|llaves?|opci[óo]n|opciones|banderas?|flags?|paquetes?|librer[íi]as?|bibliotecas?|dependencias?|endpoints?|commits?|ramas?|branch(?:es)?|identificadores?|identificador|c[óo]digos?|nombres?|usuarios?|errores?|error|estados?|tablas?|instancias?|sesiones?|sesi[óo]n|colores?|color)";

const URL_NOUN_RE =
  "(?:enlaces?|links?|p[áa]ginas?|sitios?|direcciones?|direcci[óo]n|urls?|correos?|emails?|cuentas?)";

const SENTINEL_ANY =
  "§(?:FILE|FILES|DIR|DIRS|CODE|CODES|CMD|CMDS|URL|URLS|EMAIL|EMAILS|HANDLE)§";

const ARTICLE_BEFORE_RE =
  "(?:el|la|los|las|un|una|unos|unas|este|esta|estos|estas|ese|esa|esos|esas|tu|tus|mi|mis|su|sus|nuestro|nuestra|nuestros|nuestras|del|al|otro|otra|otros|otras|cada|alg[úu]n|alguna|ning[úu]n|ninguna|dicho|dicha|dichos|dichas)";

const TECH_PATH_DIR_PREFIXES = new Set([
  "src", "src-ui", "src-brain", "src-tauri", "dist", "build", "public", "assets",
  "scripts", "skills", "slices", "features", "components", "utils", "hooks",
  "config", "docs", "tests", "test", "node_modules", "target", "app", "api",
  "lib", "pkg", "cmd", "internal", "empresa", "habilidades", "context",
  "users", "home", "desktop", "documents", "downloads", "library", "applications",
  "volumes", "var", "tmp", "etc", "opt", "usr",
]);

const ABBREV_END_RE =
  /(?:\b(?:p\.\s*ej|ej|etc|vs|aprox|m[íi]n|m[áa]x|n[úu]m|p[áa]gs?|fig|cap|vol|tel|dr|dra|sr|sra|srta|ing|lic|arq|prof|ee\.\s*uu|s\.\s*a|a\.\s*m|p\.\s*m))\.$/i;

function looksLikeKnownFileName(value: string): boolean {
  const trimmed = value.trim().replace(/^["'«“]+|["'»”]+$/g, "");
  if (!trimmed || trimmed.length > 180) return false;
  const cleaned = trimmed.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/i, "");
  if (/^\.(?:env(?:\.[\w-]+)?|gitignore|gitattributes|ds_store|eslintrc(?:\.\w+)?|prettierrc(?:\.\w+)?|babelrc|npmrc|nvmrc|editorconfig|dockerignore|bashrc|zshrc|profile|xook)$/i.test(cleaned)) {
    return true;
  }
  const m = cleaned.match(/\.([A-Za-z0-9]{2,11})$/);
  if (!m) return false;
  return KNOWN_EXT_SET.has(m[1].toLowerCase());
}

function looksLikePath(value: string): boolean {
  const t = value.trim();
  if (!t || /\s{2,}/.test(t)) return false;
  if (/^(?:file:\/\/|\/|~\/|\.\.?\/|[A-Za-z]:\\)/.test(t)) return true;
  if (/\\/.test(t) && /[A-Za-z0-9._-]\\[A-Za-z0-9._-]/.test(t)) return true;
  const slashParts = t.split("/").filter(Boolean);
  if (slashParts.length >= 3 && !/\s/.test(t)) return true;
  if (slashParts.length === 2 && !/\s/.test(t)) {
    const [first, second] = slashParts;
    if (
      first.startsWith(".") ||
      first.startsWith("@") ||
      TECH_PATH_DIR_PREFIXES.has(first.toLowerCase()) ||
      looksLikeKnownFileName(second) ||
      /[_-]/.test(first) ||
      /[_.]/.test(second)
    ) {
      return true;
    }
  }
  return false;
}

function looksLikeUrl(value: string): boolean {
  const t = value.trim();
  return /^(?:https?:\/\/|ftp:\/\/|wss?:\/\/|www\.|localhost(?::\d+)?(?:\/|$)|127\.0\.0\.1(?::\d+)?(?:\/|$)|(?:github\.com|gitlab\.com|huggingface\.co|npmjs\.com|docs\.rs|vercel\.com)\/)/i.test(
    t
  );
}

function looksLikeEmail(value: string): boolean {
  return /^(?:mailto:)?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/i.test(value.trim());
}

function isCodeIdentifierToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (KNOWN_BRAND_CAMEL.has(t.toLowerCase())) return false;
  // snake_case o CONSTANT_CASE
  if (/^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/.test(t)) return true;
  // camelCase (minúscula -> mayúscula interna)
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(t)) return true;
  // PascalCase técnico: 3+ segmentos o termina en sufijo técnico conocido
  if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+){2,}$/.test(t)) return true;
  if (/^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/.test(t) && CODE_PASCAL_SUFFIX_RE.test(t)) {
    return true;
  }
  // Hash git / UUID / hex
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return true;
  if (/^0x[0-9a-f]+$/i.test(t) || /^#[0-9a-f]{3,8}$/i.test(t)) return true;
  if (/^[0-9a-f]{7,40}$/.test(t) && /[0-9]/.test(t) && /[a-f]/.test(t)) return true;
  // Dot-chain (console.log, com.xook.app, window.speechSynthesis)
  if (/^[a-z_][A-Za-z0-9_]*\.[a-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/.test(t)) return true;
  // Namespace ::
  if (/^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)+$/.test(t)) return true;
  return false;
}

function classifyInlineCode(content: string): string {
  const t = content.trim();
  if (!t) return "";

  if (looksLikeUrl(t)) return "§URL§";
  if (looksLikeEmail(t)) return "§EMAIL§";
  if (/^file:\/\//i.test(t)) {
    return t.endsWith("/") ? "§DIR§" : "§FILE§";
  }

  // Rutas con barra o nombres de archivo (incluye nombres con espacios + extensión conocida)
  if (looksLikePath(t)) {
    if (t.endsWith("/") || t.endsWith("\\")) return "§DIR§";
    const lastSeg = t.split(/[/\\]/).filter(Boolean).pop() ?? "";
    return looksLikeKnownFileName(lastSeg) ? "§FILE§" : "§DIR§";
  }
  if (looksLikeKnownFileName(t)) return "§FILE§";

  // Comandos CLI / shell
  const firstWord = t.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (CLI_COMMAND_HEADS.has(firstWord) && (t.includes(" ") || t.includes("-") || t.length <= 8)) {
    return "§CMD§";
  }
  if (/^--?[a-zA-Z][\w-]*(?:=\S+)?$/.test(t)) return "§CMD§";

  // Expresiones con sintaxis de código/símbolos técnicos
  if (/[_{}[\]()<>\\|~$^*=;]|->|=>|::|&&|\|\||!=|==/.test(t)) {
    return "§CODE§";
  }

  // Slugs kebab-case técnicos (múltiples guiones o dígitos o prefijos técnicos)
  if (/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(t) && !/^wi-fi$/i.test(t)) {
    const parts = t.toLowerCase().split("-");
    if (
      parts.length >= 3 ||
      /\d/.test(t) ||
      TECH_PATH_DIR_PREFIXES.has(parts[0]) ||
      parts.some((p) => KNOWN_EXT_SET.has(p))
    ) {
      return "§CODE§";
    }
  }

  // Identificadores técnicos sueltos
  if (!t.includes(" ") && isCodeIdentifierToken(t)) {
    return "§CODE§";
  }

  // Múltiples tokens técnicos dentro de backticks (ej. "voiceId speed" o "let x = 1")
  const words = t.split(/\s+/);
  if (words.length >= 2 && words.some((w) => isCodeIdentifierToken(w) || looksLikeKnownFileName(w) || looksLikePath(w))) {
    return "§CODE§";
  }

  // Etiqueta humana limpia (ej. `Lola`, `Espacio de Xox`, `Configuraciones`, `50%`)
  return t;
}

function isPureSentinelLine(line: string): boolean {
  // Quita marcadores de lista, negritas, tamaños entre paréntesis, emojis y puntuación simple
  let rest = line
    .replace(/^\s*(?:[-*•▪▫▸▹◆◇■□✓✔✕✖→➜➡]+|\d+[.)])\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/~~/g, "")
    .replace(/\(\s*\d+(?:[.,]\d+)?\s*(?:B|KB|MB|GB|TB|bytes?|líneas?|págs?|páginas?)\s*\)/gi, "")
    .replace(/\(\s*(?:L\d+(?:\s*[-–]\s*L?\d+)?|#L\d+(?:-L?\d+)?)\s*\)/gi, "")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .trim();

  if (!rest) return false;
  // Comprueba si solo quedan sentinels y conectores/puntuación mínima
  const withoutSentinels = rest
    .replace(new RegExp(SENTINEL_ANY, "g"), "")
    .replace(/\b(?:y|e|o|u|ok|listo|nuevo|editado|modificado|creado|eliminado|actualizado)\b/gi, "")
    .replace(/[\s,.;:()[\]—–\-/|]+/g, "");
  return withoutSentinels.length === 0 && new RegExp(SENTINEL_ANY).test(rest);
}

function replaceMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const cur = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : "";
    const isSepLine = (ln: string) =>
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(ln) && ln.includes("-");
    const isPipeRow = (ln: string) =>
      ln.includes("|") && (ln.trim().startsWith("|") || ln.trim().endsWith("|") || (ln.match(/\|/g)?.length ?? 0) >= 2);

    if (isPipeRow(cur) && isSepLine(next)) {
      // Consumir toda la tabla markdown (encabezado + separador + filas)
      i += 2;
      while (i < lines.length && isPipeRow(lines[i])) {
        i += 1;
      }
      out.push("§TABLE§");
      continue;
    }

    if (isSepLine(cur)) {
      i += 1;
      continue;
    }

    out.push(cur);
    i += 1;
  }

  return out.join("\n");
}

function formatDateIsoOrSlash(text: string): string {
  // YYYY-MM-DD
  text = text.replace(
    /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/g,
    (full, year: string, monthStr: string, dayStr: string) => {
      const m = Number(monthStr);
      const d = Number(dayStr);
      if (m < 1 || m > 12 || d < 1 || d > 31) return full;
      return `${d} de ${SPANISH_MONTHS[m]} de ${year}`;
    }
  );
  // DD/MM/YYYY o DD-MM-YYYY
  text = text.replace(
    /\b(\d{1,2})[/-](\d{1,2})[/-]((?:19|20)\d{2})\b/g,
    (full, dayStr: string, monthStr: string, year: string) => {
      const d = Number(dayStr);
      const m = Number(monthStr);
      if (m < 1 || m > 12 || d < 1 || d > 31) return full;
      return `${d} de ${SPANISH_MONTHS[m]} de ${year}`;
    }
  );
  return text;
}

function formatTimes(text: string): string {
  return text.replace(
    /\b(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(a\.?\s*m\.?|p\.?\s*m\.?))?(?!\d)/gi,
    (full, hStr: string, mStr: string, meridiem?: string) => {
      const h = Number(hStr);
      const m = Number(mStr);
      if (h > 23 || m > 59) return full;
      let suffix = "";
      if (meridiem) {
        suffix = /^a/i.test(meridiem.trim()) ? " de la mañana" : " de la tarde";
      }
      if (m === 0) return `${h} en punto${suffix}`;
      if (m === 30 && h <= 12) return `${h} y media${suffix}`;
      return `${h} con ${m}${suffix}`;
    }
  );
}

function formatCurrency(text: string): string {
  const buildAmount = (numRaw: string, unitSing: string, unitPlur: string, centUnit: string) => {
    const clean = numRaw.replace(/,/g, "");
    const parts = clean.split(".");
    const intPart = parts[0] || "0";
    const decPart = parts[1];
    const unit = intPart === "1" ? unitSing : unitPlur;
    if (decPart && decPart.length <= 2 && Number(decPart) > 0) {
      const cents = decPart.length === 1 ? `${decPart}0` : String(Number(decPart));
      return `${intPart} ${unit} con ${cents} ${centUnit}`;
    }
    if (decPart && decPart.length > 2 && Number(decPart) > 0) {
      return `${intPart} punto ${decPart} ${unitPlur}`;
    }
    return `${intPart} ${unit}`;
  };

  text = text.replace(
    /(?:US\$\s*|\$\s*)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(?:USD|d[óo]lares?)\b/gi,
    (_, intP: string, decP?: string) =>
      buildAmount(decP ? `${intP}.${decP}` : intP, "dólar", "dólares", "centavos")
  );
  text = text.replace(
    /US\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/gi,
    (_, intP: string, decP?: string) =>
      buildAmount(decP ? `${intP}.${decP}` : intP, "dólar", "dólares", "centavos")
  );
  text = text.replace(
    /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(?:MXN|pesos?)\b/gi,
    (_, intP: string, decP?: string) =>
      buildAmount(decP ? `${intP}.${decP}` : intP, "peso", "pesos", "centavos")
  );
  text = text.replace(
    /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g,
    (_, intP: string, decP?: string) =>
      buildAmount(decP ? `${intP}.${decP}` : intP, "peso", "pesos", "centavos")
  );
  text = text.replace(
    /€\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g,
    (_, intP: string, decP?: string) =>
      buildAmount(decP ? `${intP}.${decP}` : intP, "euro", "euros", "céntimos")
  );
  text = text.replace(
    /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(?:€|EUR)\b/gi,
    (_, intP: string, decP?: string) =>
      buildAmount(decP ? `${intP}.${decP}` : intP, "euro", "euros", "céntimos")
  );
  text = text.replace(
    /£\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g,
    (_, intP: string, decP?: string) =>
      buildAmount(decP ? `${intP}.${decP}` : intP, "libra", "libras", "peniques")
  );
  return text;
}

function resolveSentinelsInSpanish(text: string): string {
  // 1. Colapsar listas repetidas del mismo tipo de sentinel
  text = text.replace(/§FILE§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§FILE§)+/gi, "§FILES§");
  text = text.replace(/§DIR§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§DIR§)+/gi, "§DIRS§");
  text = text.replace(/§CODE§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§CODE§)+/gi, "§CODES§");
  text = text.replace(/§CMD§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§CMD§)+/gi, "§CMDS§");
  text = text.replace(/§URL§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§URL§)+/gi, "§URLS§");
  text = text.replace(/§EMAIL§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§EMAIL§)+/gi, "§EMAILS§");
  text = text.replace(/§(?:FILE|DIR)§(?:\s*(?:,|y|e|o|u)\s*§(?:FILE|DIR|FILES|DIRS)§)+/gi, "§FILES§");
  text = text.replace(/§(?:CODE|CMD)§(?:\s*(?:,|y|e|o|u)\s*§(?:CODE|CMD|CODES|CMDS)§)+/gi, "§CODES§");

  // 2. Eliminar paréntesis que solo contienen sentinels técnicos: "(pocket_es.py)" -> ""
  text = text.replace(
    new RegExp(`\\(\\s*${SENTINEL_ANY}(?:\\s*(?:,|y|o|;)\\s*${SENTINEL_ANY})*\\s*\\)`, "gi"),
    " "
  );

  // 3. Frases como "se llama <archivo>" / "llamado <archivo>"
  text = text.replace(
    new RegExp(`\\bse\\s+llama\\s+${SENTINEL_ANY}`, "gi"),
    "está en pantalla"
  );
  text = text.replace(
    new RegExp(`\\b(llamad[oa]s?)\\s+${SENTINEL_ANY}`, "gi"),
    (_, word: string) => {
      const low = word.toLowerCase();
      if (low === "llamada") return "indicada en pantalla";
      if (low === "llamados") return "indicados en pantalla";
      if (low === "llamadas") return "indicadas en pantalla";
      return "indicado en pantalla";
    }
  );

  // 4. Deduplicar cuando el sustantivo español ya está inmediatamente antes
  text = text.replace(
    new RegExp(`\\b(${FILE_NOUN_RE})\\s*:?\\s*§FILES?§`, "gi"),
    "$1"
  );
  text = text.replace(
    new RegExp(`\\b(${DIR_NOUN_RE})\\s*:?\\s*§(?:DIRS?|FILES?)§`, "gi"),
    "$1"
  );
  text = text.replace(
    new RegExp(`\\b(${CODE_NOUN_RE})\\s*:?\\s*§(?:CODES?|CMDS?|HANDLE)§`, "gi"),
    "$1"
  );
  text = text.replace(
    new RegExp(`\\b(${URL_NOUN_RE})\\s*:?\\s*§(?:URLS?|EMAILS?)§`, "gi"),
    "$1"
  );

  // Verbos de ejecución + §CODE§ -> comando
  text = text.replace(
    /\b(ejecut[éeaá]\w*|corr[íie]\w*|lanz[éeaá]\w*|usa(?:r|ndo)?)\s+§CODE§/gi,
    "$1 §CMD§"
  );
  text = text.replace(
    /\b(ejecut[éeaá]\w*|corr[íie]\w*|lanz[éeaá]\w*|usa(?:r|ndo)?)\s+§CODES§/gi,
    "$1 §CMDS§"
  );

  // 5. Resolver sentinels precedidos por artículo/determinante sin duplicar artículo
  const replaceWithArticle = (
    src: string,
    sentinel: string,
    withoutArticle: string,
    withArticle: string
  ) => {
    src = src.replace(
      new RegExp(`\\b(${ARTICLE_BEFORE_RE})\\s+${sentinel}`, "gi"),
      `$1 ${withoutArticle}`
    );
    src = src.replace(new RegExp(sentinel, "g"), withArticle);
    return src;
  };

  text = replaceWithArticle(text, "§FILE§", "archivo", "el archivo");
  text = replaceWithArticle(text, "§FILES§", "archivos indicados", "los archivos indicados");
  text = replaceWithArticle(text, "§DIR§", "carpeta indicada", "la carpeta indicada");
  text = replaceWithArticle(text, "§DIRS§", "carpetas indicadas", "las carpetas indicadas");
  text = replaceWithArticle(text, "§CMD§", "comando", "el comando");
  text = replaceWithArticle(text, "§CMDS§", "comandos en pantalla", "los comandos en pantalla");
  text = replaceWithArticle(text, "§CODE§", "código indicado", "el código indicado");
  text = replaceWithArticle(text, "§CODES§", "elementos en pantalla", "los elementos en pantalla");
  text = replaceWithArticle(text, "§URL§", "enlace en pantalla", "el enlace en pantalla");
  text = replaceWithArticle(text, "§URLS§", "enlaces en pantalla", "los enlaces en pantalla");
  text = replaceWithArticle(text, "§EMAIL§", "correo indicado", "el correo indicado");
  text = replaceWithArticle(text, "§EMAILS§", "correos indicados", "los correos indicados");
  text = replaceWithArticle(text, "§HANDLE§", "usuario indicado", "el usuario indicado");

  // 6. Bloques visuales (deduplicar menciones consecutivas)
  text = text.replace(/(?:§CODEBLOCK§\s*){2,}/g, "§CODEBLOCK§ ");
  text = text.replace(/(?:§TABLE§\s*){2,}/g, "§TABLE§ ");
  text = text.replace(/(?:§LIST_ON_SCREEN§\s*){2,}/g, "§LIST_ON_SCREEN§ ");

  text = text.replace(/§CODEBLOCK§/g, "Consulta el código en pantalla.");
  text = text.replace(/§TABLE§/g, "Consulta la tabla en pantalla.");
  text = text.replace(/§LIST_ON_SCREEN§/g, "Puedes ver la lista en pantalla.");

  // 7. Contracciones y limpieza gramatical
  text = text.replace(/\bde el\b/g, "del").replace(/\bDe el\b/g, "Del");
  text = text.replace(/\ba el\b/g, "al").replace(/\bA el\b/g, "Al");
  text = text.replace(/\b(el|la|los|las|en|de)\s+\1\b/gi, "$1");
  text = text.replace(/(en pantalla)\s*[,.]?\s*\1/gi, "$1");

  return text;
}

function splitTrailingSentencePunct(raw: string): { core: string; trail: string } {
  const m = raw.match(/([.,;:!?]+)$/);
  if (!m) return { core: raw, trail: "" };
  return { core: raw.slice(0, -m[1].length), trail: m[1] };
}

function classifyPathMatch(raw: string): string {
  const { core, trail } = splitTrailingSentencePunct(raw);
  if (!core) return raw;
  if (core.endsWith("/") || core.endsWith("\\")) return `§DIR§${trail}`;
  const lastSeg = core.split(/[/\\]/).filter(Boolean).pop() ?? "";
  return `${looksLikeKnownFileName(lastSeg) ? "§FILE§" : "§DIR§"}${trail}`;
}

export function cleanTextForSpeech(raw: string, opts?: CleanSpeechOptions): string {
  const streaming = Boolean(opts?.streaming);
  const maxLength = opts?.maxLength ?? 1800;
  let text = raw || "";

  // 1. Eliminar bloques internos de pensamiento/protocolo
  text = text.replace(/<(?:think|thought|analysis|analisis|canvas|lienzo|acciones|actions)\b[^>]*>[\s\S]*?<\/(?:think|thought|analysis|analisis|canvas|lienzo|acciones|actions)>/gi, " ");
  if (streaming) {
    text = text.replace(/<(?:think|thought|analysis|analisis|canvas|lienzo|acciones|actions)\b[\s\S]*$/gi, "");
    text = text.replace(/```[\s\S]*$/g, "");
    text = text.replace(/~~~[\s\S]*$/g, "");
  }

  // Entidades HTML comunes
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, " y ")
    .replace(/&lt;/gi, " ")
    .replace(/&gt;/gi, " ")
    .replace(/&quot;|&#39;|&apos;/gi, "")
    .replace(/&mdash;|&ndash;/gi, ", ")
    .replace(/&hellip;/gi, ".");

  // Eliminar etiquetas HTML/XML residuales
  text = text.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^<>]*)?>/g, " ");

  // 2. Bloques de código cerrados y tablas Markdown
  text = text.replace(/```[\s\S]*?```/g, "\n§CODEBLOCK§\n");
  text = text.replace(/~~~[\s\S]*?~~~/g, "\n§CODEBLOCK§\n");
  text = replaceMarkdownTables(text);

  // En streaming, retener construcciones aún abiertas al final
  if (streaming) {
    // Retener enlace/imagen abierto
    text = text.replace(/!?\[[^\]]*(?:\]\([^)]*)?$/g, "");
    // Retener backtick inline abierto si hay número impar de backticks
    const btCount = (text.match(/`/g) ?? []).length;
    if (btCount % 2 === 1) {
      text = text.replace(/`[^`]*$/g, "");
    }
    // Retener URL/ruta abierta al final
    text = text.replace(/(?:https?:\/\/|file:\/\/|\/[\w.-]+|~\/|\.\.?\/)\S*$/g, "");
    // Retener fila de tabla aún incompleta al final
    text = text.replace(/(?:^|\n)\s*\|[^\n]*$/g, "");
    text = text.replace(/\n\s*(?:\d+[.)]?|[-*•#]+)\s*$/g, "\n");
  }

  // 3. Imágenes y enlaces Markdown
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, target: string) => {
    const cleanLabel = label.trim().replace(/^`|`$/g, "");
    const cleanTarget = target.trim();
    if (
      /^file:\/\//i.test(cleanTarget) ||
      looksLikePath(cleanLabel) ||
      looksLikeKnownFileName(cleanLabel)
    ) {
      return cleanTarget.endsWith("/") || cleanLabel.endsWith("/") ? "§DIR§" : "§FILE§";
    }
    if (looksLikeUrl(cleanLabel)) return "§URL§";
    if (looksLikeEmail(cleanLabel)) return "§EMAIL§";
    if (!cleanLabel.includes(" ") && isCodeIdentifierToken(cleanLabel)) return "§CODE§";
    return cleanLabel;
  });

  // 4. Código inline entre backticks (clasificar antes de quitar backticks)
  text = text.replace(/`([^`\n]+)`/g, (_, inner: string) => {
    const classified = classifyInlineCode(inner);
    return classified ? ` ${classified} ` : " ";
  });
  text = text.replace(/`/g, "");

  // 5. URLs, correos, rutas y nombres de archivo sin backticks
  text = text.replace(/file:\/\/\/[^\s,;()[\]{}"'<>]+/gi, (m) => classifyPathMatch(m));
  text = text.replace(/(?:https?|ftp|wss?):\/\/[^\s,;()[\]{}"'<>]+/gi, (m) => {
    const { trail } = splitTrailingSentencePunct(m);
    return `§URL§${trail}`;
  });
  text = text.replace(/mailto:[^\s,;()[\]{}"'<>]+/gi, (m) => {
    const { trail } = splitTrailingSentencePunct(m);
    return `§EMAIL§${trail}`;
  });
  text = text.replace(/\bwww\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s,;()[\]{}"'<>]*)?/gi, (m) => {
    const { trail } = splitTrailingSentencePunct(m);
    return `§URL§${trail}`;
  });
  text = text.replace(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s,;()[\]{}"'<>]*)?/gi, (m) => {
    const { trail } = splitTrailingSentencePunct(m);
    return `§URL§${trail}`;
  });
  text = text.replace(
    /\b(?:github\.com|gitlab\.com|huggingface\.co|npmjs\.com|docs\.rs|vercel\.com)\/[^\s,;()[\]{}"'<>]+/gi,
    (m) => {
      const { trail } = splitTrailingSentencePunct(m);
      return `§URL§${trail}`;
    }
  );
  text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "§EMAIL§");

  // Paquetes scoped (@tauri-apps/api/core) y menciones (@usuario)
  text = text.replace(/(?<!\w)@[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+/g, (m) => {
    const { trail } = splitTrailingSentencePunct(m);
    return `§CODE§${trail}`;
  });
  text = text.replace(/(?<!\w)@[A-Za-z0-9_.-]{2,}\b/g, "§HANDLE§");

  // Archivos entrecomillados con posibles espacios ("Reporte de Ventas 2026.pdf")
  const quotedFileRe = new RegExp(
    `["'«“]([^"'»”\\n]{1,120}\\.(?:${KNOWN_EXT_PATTERN}))["'»”]`,
    "gi"
  );
  text = text.replace(quotedFileRe, "§FILE§");

  // Rutas Windows (C:\Users\...)
  text = text.replace(/\b[A-Za-z]:\\[^\s,;()[\]{}"'<>]+/g, (m) => classifyPathMatch(m));

  // Rutas Unix/macOS absolutas, home o relativas (~/..., ./..., ../..., /Users/...)
  text = text.replace(
    /(?<![\w/:])(?:~\/|\.\.?\/|\/(?:Users|home|var|tmp|etc|opt|usr|Applications|Library|System|Volumes|Desktop|Documents|Downloads|src|dist|app|api)\/)[A-Za-z0-9._@+\/-]+(?::\d+(?::\d+)?)?(?:#L\d+(?:-L?\d+)?)?/gi,
    (m) => classifyPathMatch(m)
  );

  // Rutas relativas multi-segmento (src-ui/features/tts-voice/ttsClient.ts)
  text = text.replace(
    /(?<![\w/])\.?[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._-]+){2,}(?::\d+(?::\d+)?)?(?:#L\d+(?:-L?\d+)?)?\/?/g,
    (m) => classifyPathMatch(m)
  );

  // Ruta de 1 barra con extensión conocida (empresa/perfil.json, src/App.tsx:10)
  const oneSlashFileRe = new RegExp(
    `(?<![\\w/])\\.?[A-Za-z0-9_-]+\\/[A-Za-z0-9._-]+\\.(?:${KNOWN_EXT_PATTERN})(?::\\d+(?::\\d+)?)?(?:#L\\d+(?:-L?\\d+)?)?(?![\\w/])`,
    "gi"
  );
  text = text.replace(oneSlashFileRe, "§FILE§");

  // Ruta de 1 barra con prefijo técnico o directorio oculto (.xook/xook.db, feat/tts-fix, src-ui/App)
  text = text.replace(
    /(?<![\w/])(?:\.[A-Za-z0-9_-]+|(?:src-[a-z]+|src|dist|scripts|skills|slices|features|components|utils|config|assets|public|node_modules|target|feat|fix|chore|docs|refactor))\/[A-Za-z0-9._-]+\/?/gi,
    (m) => {
      const { core, trail } = splitTrailingSentencePunct(m);
      const lastSeg = core.split("/").filter(Boolean).pop() ?? "";
      if (looksLikeKnownFileName(lastSeg)) return `§FILE§${trail}`;
      return `${/^(?:feat|fix|chore|docs|refactor)\//i.test(core) ? "§CODE§" : "§DIR§"}${trail}`;
    }
  );

  // Dotfiles sueltos (.env, .env.local, .gitignore, .DS_Store)
  text = text.replace(
    /(?<![\w/])\.(?:env(?:\.[A-Za-z0-9_-]+)?|gitignore|gitattributes|DS_Store|eslintrc(?:\.[A-Za-z]+)?|prettierrc(?:\.[A-Za-z]+)?|babelrc|npmrc|nvmrc|editorconfig|dockerignore|bashrc|zshrc|profile|xook)\b/gi,
    "§FILE§"
  );

  // Nombres de archivo sueltos con extensión conocida (reporte_ventas_2026.pdf, App.tsx:1863)
  const bareFileRe = new RegExp(
    `(?<![\\w/.])[A-Za-z0-9][A-Za-z0-9._-]*\\.(?:${KNOWN_EXT_PATTERN})(?::\\d+(?::\\d+)?)?(?:#L\\d+(?:-L?\\d+)?)?(?![\\w/])`,
    "gi"
  );
  text = text.replace(bareFileRe, "§FILE§");

  // Paréntesis técnicos de líneas: "(L10-L20)", "(#L10-L20)"
  text = text.replace(/\(\s*#?L\d+(?:\s*[-–]\s*L?\d+)?\s*\)/gi, " ");

  // 6. Identificadores técnicos y símbolos de código fuera de backticks
  // UUIDs, hex, colores CSS hex, SHAs de git
  text = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "§CODE§");
  text = text.replace(/\b0x[0-9a-f]{2,}\b/gi, "§CODE§");
  text = text.replace(/(?<!\w)#[0-9a-f]{3,8}\b/gi, "§CODE§");
  text = text.replace(/\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, "§CODE§");

  // Llamadas a función: foo(), cleanTextForSpeech(raw), ttsPlayer.stop()
  text = text.replace(/\b[A-Za-z_][A-Za-z0-9_.]*\(\s*\)/g, "§CODE§");
  text = text.replace(
    /\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z0-9]+_[A-Za-z0-9_]+|[a-z_]\w*\.[a-z_]\w*)\([^)\n]{0,60}\)/g,
    "§CODE§"
  );

  // Namespaces :: (std::sync::Mutex)
  text = text.replace(/\b[A-Za-z_]\w*(?:::[A-Za-z_]\w*)+\b/g, "§CODE§");

  // Flags CLI (--auto, --force)
  text = text.replace(/(?<!\w)--[a-zA-Z][a-zA-Z0-9-]*(?:=\S+)?\b/g, "§CMD§");

  // Dot-chains técnicos (window.speechSynthesis.cancel, console.log, com.xook.app)
  text = text.replace(
    /\b[a-z_][A-Za-z0-9_]*\.[a-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\b/g,
    (m) => {
      if (/^(?:e\.g|i\.e|p\.ej|a\.m|p\.m)$/i.test(m)) return m;
      return "§CODE§";
    }
  );

  // CONSTANT_CASE y snake_case técnicos
  text = text.replace(/\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/g, "§CODE§");
  text = text.replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/gi, "§CODE§");

  // camelCase y PascalCase técnicos (respetando marcas conocidas)
  text = text.replace(/\b[a-z]+[A-Z][A-Za-z0-9]*\b/g, (m) =>
    KNOWN_BRAND_CAMEL.has(m.toLowerCase()) ? m : "§CODE§"
  );
  text = text.replace(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+){1,}\b/g, (m) => {
    if (KNOWN_BRAND_CAMEL.has(m.toLowerCase())) return m;
    const humps = m.match(/[A-Z][a-z0-9]+/g)?.length ?? 0;
    if (humps >= 3 || CODE_PASCAL_SUFFIX_RE.test(m)) return "§CODE§";
    return m;
  });

  // 7. Procesamiento por líneas: encabezados, listas, bullets de solo archivos y pausas
  const rawLines = text.split("\n");
  const processedLines: string[] = [];
  let skippedPureListItems = false;

  const flushPureListNotice = () => {
    if (!skippedPureListItems) return;
    skippedPureListItems = false;
    const prev = processedLines[processedLines.length - 1] ?? "";
    if (!/en pantalla[.!?]?$/i.test(prev.trim())) {
      processedLines.push("§LIST_ON_SCREEN§");
    }
  };

  for (const rawLine of rawLines) {
    let line = rawLine.trim();
    if (!line) {
      flushPureListNotice();
      continue;
    }
    if (/^[-*_]{3,}$/.test(line)) {
      flushPureListNotice();
      continue;
    }
    if (line === "§CODEBLOCK§" || line === "§TABLE§") {
      flushPureListNotice();
      processedLines.push(line);
      continue;
    }

    const isHeading = /^#{1,6}\s+/.test(line);
    const isListItem = /^(?:[-*•▪▫▸▹◆◇■□✓✔✕✖→➜➡]+|\d+[.)])\s+/.test(line);

    if (isListItem && isPureSentinelLine(line)) {
      skippedPureListItems = true;
      continue;
    }

    flushPureListNotice();

    // Quitar prefijos markdown de encabezados, citas y listas
    line = line.replace(/^#{1,6}\s+/, "");
    line = line.replace(/^>\s*/, "");
    line = line.replace(/^(?:[-*•▪▫▸▹◆◇■□✓✔✕✖→➜➡]+|\d+[.)])\s+/, "");

    // Si una línea/viñeta empieza con "<archivo/código>: descripción", omite la etiqueta técnica inicial
    line = line.replace(
      new RegExp(`^[*_]*\\s*${SENTINEL_ANY}\\s*[*_]*\\s*(?::|—|–|-)\\s*(.+)$`, "i"),
      "$1"
    );

    // También si la línea completa (sin ser bullet) es únicamente un sentinel suelto en un listado
    if (!isHeading && isPureSentinelLine(line) && processedLines.length > 0) {
      skippedPureListItems = true;
      continue;
    }

    // Separar pipes sueltos si quedara alguno
    line = line.replace(/\|+/g, ", ");

    // Asegurar pausa natural al cerrar encabezados o elementos de lista
    if ((isHeading || isListItem) && line.length > 0) {
      if (line.endsWith(":")) {
        line = `${line.slice(0, -1)}.`;
      } else if (!/[.!?…,;]$/.test(line)) {
        line = `${line}.`;
      }
    }

    processedLines.push(line);
  }
  flushPureListNotice();

  text = processedLines.join(" ");

  // 8. Resolver sentinels con gramática española natural
  text = resolveSentinelsInSpanish(text);

  // 9. Quitar formato Markdown residual
  text = text.replace(/\*\*/g, "").replace(/__/g, "").replace(/~~/g, "");
  text = text.replace(/(?<!\w)[*_]([^*_]+)[*_](?!\w)/g, "$1");
  text = text.replace(/[-_]{3,}/g, " ");

  // 10. Fechas, horas, moneda, versiones, unidades, abreviaturas y símbolos
  text = formatDateIsoOrSlash(text);
  text = formatTimes(text);
  text = formatCurrency(text);

  // Versiones: "versión v2.14.0-beta.3" / "v1.2.3" / "2.14.0"
  text = text.replace(
    /\b(versi[óo]n\s+)?v(\d+)\.(\d+)(?:\.(\d+))?(?:-[A-Za-z0-9.]+)?\b/gi,
    (full, _prev: string | undefined, maj: string, min: string, patch?: string) => {
      const label = full.startsWith("V") ? "Versión" : "versión";
      const p = patch && Number(patch) > 0 ? ` punto ${patch}` : "";
      return `${label} ${maj} punto ${min}${p}`;
    }
  );
  text = text.replace(
    /\b(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.]+)?\b/g,
    (_, maj: string, min: string, patch: string) => {
      const p = Number(patch) > 0 ? ` punto ${patch}` : "";
      return `${maj} punto ${min}${p}`;
    }
  );

  // Porcentajes y multiplicadores
  text = text.replace(/([+-]?)\s*(\d+(?:[.,]\d+)?)\s*%/g, (_, sign: string, num: string) => {
    const prefix = sign === "+" ? "más " : sign === "-" ? "menos " : "";
    return `${prefix}${num.replace(",", ".")} por ciento`;
  });
  text = text.replace(/\b(\d+)\s*[×x]\s*(\d+)\b/gi, "$1 por $2");
  text = text.replace(/\b(\d+(?:\.\d+)?)x\b/gi, (_, num: string) => num.replace(".", " punto "));

  // Unidades comunes junto a números
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*TB\b/g, "$1 terabytes");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*GB\b/g, "$1 gigabytes");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*MB\b/g, "$1 megabytes");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*KB\b/g, "$1 kilobytes");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*ms\b/g, "$1 milisegundos");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*fps\b/gi, "$1 cuadros por segundo");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*°\s*[CF]?\b/g, "$1 grados");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*km\b/gi, "$1 kilómetros");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*cm\b/gi, "$1 centímetros");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*kg\b/gi, "$1 kilogramos");
  text = text.replace(/\b(\d+(?:[.,]\d+)?)\s*px\b/gi, "$1 píxeles");

  // Rangos numéricos (10-20 -> 10 a 20), fracciones (3/5 -> 3 de 5), miles y decimales
  text = text.replace(/\b(\d+)\s*[-–—]\s*(\d+)\b/g, "$1 a $2");
  text = text.replace(/\b(\d+)\s*\/\s*(\d+)\b/g, "$1 de $2");
  text = text.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (m) => m.replace(/,/g, ""));
  text = text.replace(/\b(\d+)\.(\d+)\b/g, "$1 punto $2");
  text = text.replace(/(?<!\w)\+(\d+)/g, "más $1");
  text = text.replace(/(?<![\w)])-(\d+)/g, "menos $1");
  text = text.replace(/(?<!\w)#(\d+)\b/g, "número $1");
  text = text.replace(/(?:~|≈)\s*(\d+)/g, "aproximadamente $1");

  // Abreviaturas comunes en español (evita puntos internos)
  text = text
    .replace(/\bp\.\s*ej\./gi, "por ejemplo")
    .replace(/\bej\./gi, "por ejemplo")
    .replace(/\betc\./gi, "etcétera")
    .replace(/\bvs\./gi, "contra")
    .replace(/\baprox\./gi, "aproximadamente")
    .replace(/\bm[íi]n\./gi, "mínimo")
    .replace(/\bm[áa]x\./gi, "máximo")
    .replace(/\bn[úu]m\./gi, "número")
    .replace(/\bn\.?º|\bn°/gi, "número")
    .replace(/\bp[áa]gs\./gi, "páginas")
    .replace(/\bp[áa]g\./gi, "página")
    .replace(/\bDr\./g, "Doctor")
    .replace(/\bDra\./g, "Doctora")
    .replace(/\bSr\./g, "Señor")
    .replace(/\bSra\./g, "Señora")
    .replace(/\bSrta\./g, "Señorita")
    .replace(/\bIng\./g, "Ingeniero")
    .replace(/\bLic\./g, "Licenciado")
    .replace(/\bArq\./g, "Arquitecto")
    .replace(/\bProf\./g, "Profesor")
    .replace(/\ba\.\s*m\./gi, "de la mañana")
    .replace(/\bp\.\s*m\./gi, "de la tarde")
    .replace(/\bEE\.\s*UU\./g, "Estados Unidos");

  // Marcas y nombres frecuentes
  text = text
    .replace(/\bWi-?Fi\b/gi, "wifi")
    .replace(/\bQuickBar\b/g, "barra rápida")
    .replace(/\bXLSX?\b/g, "Excel")
    .replace(/\bDOCX?\b/g, "Word")
    .replace(/\bPPTX?\b/g, "PowerPoint");

  // Flechas, operadores y símbolos
  text = text
    .replace(/<->|->|=>|<-|[→⇒←➜➡↔]/g, ", ")
    .replace(/>=|≥/g, " mayor o igual que ")
    .replace(/<=|≤/g, " menor o igual que ")
    .replace(/!==?|≠/g, " distinto de ")
    .replace(/===?|=/g, " igual a ")
    .replace(/&&/g, " y ")
    .replace(/\|\|/g, " o ")
    .replace(/&/g, " y ")
    .replace(/±/g, " más menos ")
    .replace(/÷/g, " entre ")
    .replace(/\+/g, " más ")
    .replace(/°/g, " grados ");

  // Pares de palabras con barra (negocio/empresa -> negocio o empresa)
  text = text.replace(
    /\b([A-Za-zÁÉÍÓÚáéíóúñÑ]{2,})\s*\/\s*([A-Za-zÁÉÍÓÚáéíóúñÑ]{2,})\b/g,
    "$1 o $2"
  );

  // Guiones dentro de palabras (auto-play -> auto play)
  text = text.replace(/([A-Za-zÁÉÍÓÚáéíóúñÑ])-([A-Za-zÁÉÍÓÚáéíóúñÑ])/g, "$1 $2");

  // Quitar emojis y símbolos gráficos Unicode
  text = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ");

  // Quitar símbolos residuales no pronunciables
  text = text.replace(/[{}\[\]<>\\|^~`@#*$€£¥©®™§•▪▫▸▹◆◇■□★☆✓✔✕✖_\/]/g, " ");

  // Corregir punto pegado entre dos palabras (ej. "análisis.Ahora" -> "análisis. Ahora")
  text = text.replace(/([A-Za-zÁÉÍÓÚáéíóúñÑ])\.([A-ZÁÉÍÓÚÑ][a-záéíóúñ])/g, "$1. $2");
  text = text.replace(/([A-Za-z0-9ÁÉÍÓÚáéíóúñÑ])\.([A-Za-z0-9ÁÉÍÓÚáéíóúñÑ])/g, "$1 $2");

  // Limpiar puntuación duplicada o huérfana
  text = text
    .replace(/\(\s*\)/g, " ")
    .replace(/\s*:\s*\./g, ".")
    .replace(/,\s*,+/g, ",")
    .replace(/\.\s*\.+/g, ".")
    .replace(/,\s*\./g, ".")
    .replace(/\.\s*,/g, ".")
    .replace(/^\s*[,.!?;:]+\s*/, "")
    .replace(/\s+([,.;:!?])/g, "$1");

  const hadTrailingSpace = /\s$/.test(text);
  text = text.replace(/\s+/g, " ");
  text = opts?.preserveTrailingSpace && hadTrailingSpace ? text.trimStart() : text.trim();

  if (maxLength > 0 && text.length > maxLength) {
    const slice = text.slice(0, maxLength);
    const punct = Math.max(slice.lastIndexOf("."), slice.lastIndexOf("!"), slice.lastIndexOf("?"));
    text = punct > 400 ? slice.slice(0, punct + 1) : `${slice.trim()}.`;
  }
  return text;
}

export function hasSpeakableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text || "");
}

export function detectScreenNoticeKind(text: string): ScreenNoticeKind {
  const norm = (text || "").trim().toLowerCase();
  if (norm === "consulta el código en pantalla." || norm === "consulta el codigo en pantalla.") {
    return "code";
  }
  if (norm === "consulta la tabla en pantalla.") {
    return "table";
  }
  if (norm === "puedes ver la lista en pantalla.") {
    return "list";
  }
  return null;
}

export function splitSpeechSegments(
  cleanText: string,
  firstMaxChars = 200,
  nextMaxChars = 340
): string[] {
  const sentences = cleanText
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => hasSpeakableContent(s));

  if (sentences.length === 0) return [];
  const segments: string[] = [];
  let buf = "";

  for (const s of sentences) {
    const limit = segments.length === 0 ? firstMaxChars : nextMaxChars;
    if (!buf) {
      buf = s;
    } else if (buf.length + 1 + s.length <= limit) {
      buf = `${buf} ${s}`;
    } else {
      segments.push(buf);
      buf = s;
    }
  }
  if (buf) segments.push(buf);
  return segments;
}

/**
 * Encuentra el último índice seguro en el Markdown crudo acumulado donde
 * ya cerró una oración o párrafo fuera de bloques de código, backticks inline,
 * enlaces, paréntesis, etiquetas de pensamiento o tablas Markdown.
 * Permite consumir el stream sin corromper offsets ni cortar palabras.
 */
export function findSafeRawSpeechCutoff(raw: string, startOffset: number): number {
  const n = raw.length;
  if (startOffset >= n) return startOffset;

  let i = startOffset;
  let inCodeFence: string | null = null;
  let inInlineCode = false;
  let inHiddenTag: string | null = null;
  let bracketDepth = 0;
  let parenDepth = 0;
  let inTableBlock = false;
  let atLineStart = startOffset === 0 || raw[startOffset - 1] === "\n";
  let lastSafeCutoff = startOffset;

  const isTopLevel = () =>
    !inCodeFence &&
    !inInlineCode &&
    !inHiddenTag &&
    bracketDepth === 0 &&
    parenDepth === 0 &&
    !inTableBlock;

  while (i < n) {
    // 1. Etiquetas ocultas (<think>, <thought>, <analysis>, <canvas>, <acciones>)
    if (!inCodeFence && !inInlineCode && raw[i] === "<") {
      if (inHiddenTag) {
        const closeRe = new RegExp(`^<\\s*/\\s*${inHiddenTag}\\s*>`, "i");
        const m = closeRe.exec(raw.slice(i, i + 32));
        if (m) {
          i += m[0].length;
          inHiddenTag = null;
          atLineStart = false;
          continue;
        }
      } else {
        const openM = /^<\s*(think|thought|analysis|analisis|canvas|lienzo|acciones|actions)\b[^>]*>/i.exec(
          raw.slice(i, i + 40)
        );
        if (openM) {
          inHiddenTag = openM[1].toLowerCase();
          i += openM[0].length;
          atLineStart = false;
          continue;
        }
      }
    }

    if (inHiddenTag) {
      atLineStart = raw[i] === "\n";
      i += 1;
      continue;
    }

    // 2. Bloques de código cercados (``` o ~~~)
    if (!inInlineCode && (raw.startsWith("```", i) || raw.startsWith("~~~", i))) {
      const fence = raw.slice(i, i + 3);
      if (!inCodeFence) {
        inCodeFence = fence;
      } else if (inCodeFence === fence) {
        inCodeFence = null;
        const endPos = i + 3;
        if (isTopLevel() && endPos < n && /\s/.test(raw[endPos])) {
          lastSafeCutoff = endPos + 1;
        }
      }
      i += 3;
      atLineStart = false;
      continue;
    }

    if (inCodeFence) {
      atLineStart = raw[i] === "\n";
      i += 1;
      continue;
    }

    // 3. Inicio de línea: detectar comienzo o cierre de tabla Markdown
    if (atLineStart) {
      const lineEndIdx = raw.indexOf("\n", i);
      const linePreview = lineEndIdx === -1 ? raw.slice(i) : raw.slice(i, lineEndIdx);
      const trimmedLine = linePreview.trim();
      const looksLikeTableRow =
        trimmedLine.startsWith("|") ||
        (trimmedLine.includes("|") && (trimmedLine.match(/\|/g)?.length ?? 0) >= 2);

      if (looksLikeTableRow) {
        inTableBlock = true;
      } else if (inTableBlock && trimmedLine.length > 0) {
        inTableBlock = false;
        if (isTopLevel()) {
          lastSafeCutoff = i;
        }
      } else if (inTableBlock && trimmedLine.length === 0 && lineEndIdx !== -1) {
        inTableBlock = false;
        if (isTopLevel()) {
          lastSafeCutoff = lineEndIdx + 1;
        }
      }
    }

    const ch = raw[i];

    // Recuperación en doble salto de línea: las construcciones inline no cruzan párrafos
    if (ch === "\n" && i + 1 < n && raw[i + 1] === "\n") {
      inInlineCode = false;
      bracketDepth = 0;
      parenDepth = 0;
      inTableBlock = false;
      let nextPos = i + 2;
      while (nextPos < n && raw[nextPos] === "\n") nextPos += 1;
      lastSafeCutoff = nextPos;
      i = nextPos;
      atLineStart = true;
      continue;
    }

    // 4. Backtick inline
    if (ch === "`") {
      inInlineCode = !inInlineCode;
      i += 1;
      atLineStart = false;
      continue;
    }

    if (inInlineCode) {
      atLineStart = ch === "\n";
      i += 1;
      continue;
    }

    // 5. Corchetes y paréntesis (enlaces Markdown y notas entre paréntesis)
    if (ch === "[") {
      bracketDepth += 1;
    } else if (ch === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (ch === "(") {
      parenDepth += 1;
    } else if (ch === ")" && parenDepth > 0) {
      parenDepth -= 1;
    }

    // 6. Puntos de corte seguros a nivel superior
    if (isTopLevel()) {
      if ((ch === "." || ch === "!" || ch === "?" || ch === "…") && i + 1 < n && /\s/.test(raw[i + 1])) {
        const beforeSlice = raw.slice(Math.max(startOffset, i - 16), i + 1);
        const isNumberedListMarker =
          ch === "." && /(?:^|\n)\s*\d+\.$/.test(beforeSlice);
        const isAbbreviation = ch === "." && ABBREV_END_RE.test(beforeSlice);
        // Evitar cortar en un punto suelto justo antes de un número o extensión sin espacio
        if (!isNumberedListMarker && !isAbbreviation) {
          let nextPos = i + 1;
          while (nextPos < n && (raw[nextPos] === " " || raw[nextPos] === "\t")) {
            nextPos += 1;
          }
          // Si sigue salto de línea simple, incluirlo para mantener atLineStart limpio
          if (nextPos < n && raw[nextPos] === "\n") {
            nextPos += 1;
          }
          lastSafeCutoff = nextPos;
        }
      }
    }

    atLineStart = ch === "\n";
    i += 1;
  }

  return lastSafeCutoff;
}
