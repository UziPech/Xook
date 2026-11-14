import { common, createLowlight } from "lowlight";
import type { LanguageFn, HLJSApi } from "highlight.js";
import type { Root } from "hast";

export interface CodeLanguageMeta {
  /** Canonical highlight.js / custom grammar id */
  id: string;
  /** Human-friendly label shown in the code block header (e.g. "C#", "C++", "TypeScript") */
  displayName: string;
  /** Default file extension with leading dot ("" for extensionless files like Dockerfile/Makefile) */
  extension: string;
  /** Preferred fallback filename stem when no symbol/hint is extracted */
  defaultStem?: string;
  /** Full filename override (e.g. "Dockerfile", "Makefile", "config.env") */
  defaultFilename?: string;
  /** Known aliases and extensions mapped to this language */
  aliases?: string[];
}

export interface ParsedFenceInfo {
  language: string;
  filenameHint?: string;
}

export interface HighlightCodeResult {
  hast: Root;
  canonicalId: string;
  displayName: string;
  extension: string;
  needsExtendedPack: boolean;
}

const MAX_HIGHLIGHT_CHARS = 120_000;
const MAX_AUTO_DETECT_CHARS = 8_000;

// ---------------------------------------------------------------------------
// Custom lightweight Highlight.js grammars (MIT-compatible) for modern formats
// not bundled in highlight.js 11.x core/all.
// ---------------------------------------------------------------------------

function terraformGrammar(hljs: HLJSApi) {
  const STRING = {
    className: "string",
    begin: '"',
    end: '"',
    contains: [
      hljs.BACKSLASH_ESCAPE,
      {
        className: "subst",
        begin: "\\$\\{",
        end: "\\}",
        contains: [hljs.NUMBER_MODE],
      },
    ],
  };
  const HEREDOC = {
    className: "string",
    begin: /<<-?[A-Za-z_][A-Za-z0-9_]*/,
    end: /^\s*[A-Za-z_][A-Za-z0-9_]*$/,
  };
  return {
    name: "Terraform",
    aliases: ["tf", "tfvars", "hcl"],
    keywords: {
      keyword:
        "resource data variable output locals module provider terraform required_providers backend " +
        "required_version dynamic content lifecycle moved import check precondition postcondition " +
        "for_each count depends_on connection provisioner for in if",
      literal: "true false null",
      built_in: "var local module each self path count",
      type: "string number bool list set map object tuple any",
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      STRING,
      HEREDOC,
      hljs.C_NUMBER_MODE,
      {
        className: "title.function",
        begin: /\b[a-z_][a-z0-9_]*(?=\()/,
      },
      {
        className: "attr",
        begin: /\b[A-Za-z_][A-Za-z0-9_-]*(?=\s*=[^=])/,
      },
    ],
  };
}

function solidityGrammar(hljs: HLJSApi) {
  return {
    name: "Solidity",
    aliases: ["sol"],
    keywords: {
      keyword:
        "pragma solidity import from as contract interface library abstract is struct enum event error " +
        "modifier function constructor fallback receive returns return mapping storage memory calldata " +
        "public private internal external view pure payable virtual override immutable constant indexed " +
        "emit revert require assert using for if else while do break continue try catch new delete " +
        "unchecked assembly anonymous",
      literal: "true false wei gwei ether seconds minutes hours days weeks",
      type:
        "address bool string bytes bytes1 bytes2 bytes4 bytes8 bytes16 bytes20 bytes32 " +
        "uint uint8 uint16 uint32 uint64 uint128 uint256 int int8 int16 int32 int64 int128 int256",
      built_in: "msg block tx abi keccak256 sha256 ripemd160 ecrecover addmod mulmod selfdestruct",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.APOS_STRING_MODE,
      hljs.QUOTE_STRING_MODE,
      {
        className: "number",
        begin: /\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/,
        relevance: 0,
      },
      {
        className: "title.class",
        begin: /\b(?:contract|interface|library|struct|enum|event|error)\s+/,
        end: /[{(;]/,
        excludeBegin: true,
        excludeEnd: true,
        keywords: "",
        contains: [{ className: "title.class", begin: /[A-Za-z_]\w*/ }],
      },
    ],
  };
}

function zigGrammar(hljs: HLJSApi) {
  return {
    name: "Zig",
    aliases: ["zig"],
    keywords: {
      keyword:
        "const var fn pub struct enum union error errdefer defer try catch orelse if else switch " +
        "while for break continue return comptime inline noinline extern export packed align " +
        "async await suspend resume nosuspend test usingnamespace threadlocal volatile allowzero " +
        "linksection addrspace callconv and or unreachable",
      literal: "true false null undefined",
      type:
        "void noreturn type anyerror anyopaque anyframe anytype bool " +
        "u1 u4 u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f16 f32 f64 f80 f128 comptime_int comptime_float",
      built_in: "std",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      {
        className: "comment",
        begin: /\/\/[!\/]/,
        end: /$/,
      },
      hljs.QUOTE_STRING_MODE,
      {
        className: "string",
        begin: /\\\\/,
        end: /$/,
      },
      {
        className: "char",
        begin: /'(?:[^'\\]|\\.)+'/,
      },
      {
        className: "built_in",
        begin: /@[A-Za-z_][A-Za-z0-9_]*/,
      },
      {
        className: "number",
        begin: /\b(?:0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)\b/,
        relevance: 0,
      },
    ],
  };
}

function prismaGrammar(hljs: HLJSApi) {
  return {
    name: "Prisma",
    aliases: ["prisma"],
    keywords: {
      keyword: "datasource generator model enum type view",
      type: "String Boolean Int BigInt Float Decimal DateTime Json Bytes Unsupported",
      literal: "true false null",
      built_in: "autoincrement cuid uuid now env dbgenerated relation map fields references onDelete onUpdate",
    },
    contains: [
      { className: "comment", begin: /\/\/.*$/ },
      hljs.QUOTE_STRING_MODE,
      { className: "meta", begin: /@@?[A-Za-z_][A-Za-z0-9_.]*/ },
      { className: "number", begin: /\b\d+\b/, relevance: 0 },
    ],
  };
}

function mermaidGrammar(hljs: HLJSApi) {
  return {
    name: "Mermaid",
    aliases: ["mmd", "mermaid"],
    keywords: {
      keyword:
        "graph flowchart sequenceDiagram classDiagram stateDiagram stateDiagram-v2 erDiagram " +
        "gantt pie journey gitGraph mindmap timeline quadrantChart requirementDiagram C4Context " +
        "subgraph end participant actor activate deactivate Note loop alt else opt par and " +
        "critical break option class style classDef linkStyle click direction " +
        "TD TB BT RL LR left right of over",
    },
    contains: [
      { className: "comment", begin: /%%.*$/ },
      hljs.QUOTE_STRING_MODE,
      {
        className: "operator",
        begin: /-->|-.->|==>|---|-.-|==>|<--|-->>|->>|--x|--\)/,
      },
    ],
  };
}

function wgslGrammar(hljs: HLJSApi) {
  return {
    name: "WGSL",
    aliases: ["wgsl"],
    keywords: {
      keyword:
        "fn struct var let const override return if else for while loop continuing break continue " +
        "switch case default discard enable diagnostic alias uniform storage read write read_write " +
        "private workgroup function",
      type:
        "bool i32 u32 f32 f16 vec2 vec3 vec4 vec2f vec3f vec4f vec2i vec3i vec4i vec2u vec3u vec4u " +
        "mat2x2 mat3x3 mat4x4 mat4x4f array ptr sampler sampler_comparison texture_2d texture_3d texture_cube",
      literal: "true false",
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      { className: "meta", begin: /@[A-Za-z_][A-Za-z0-9_]*/ },
      hljs.C_NUMBER_MODE,
    ],
  };
}

function dotenvGrammar(hljs: HLJSApi) {
  return {
    name: "Env",
    aliases: ["dotenv", "env"],
    contains: [
      hljs.HASH_COMMENT_MODE,
      {
        className: "keyword",
        begin: /^\s*export\b/,
      },
      {
        className: "attr",
        begin: /^[A-Za-z_][A-Za-z0-9_.-]*(?==)/,
      },
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      {
        className: "subst",
        begin: /\$\{[A-Za-z_][A-Za-z0-9_]*\}/,
      },
    ],
  };
}

function csvGrammar() {
  return {
    name: "CSV",
    aliases: ["tsv"],
    contains: [
      {
        className: "string",
        begin: /"(?:""|[^"])*"/,
      },
      {
        className: "number",
        begin: /(?<=^|[,\t])\s*-?\d+(?:\.\d+)?(?=\s*(?:[,\t]|$))/m,
        relevance: 0,
      },
      {
        className: "punctuation",
        begin: /[,\t]/,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Language catalog & lookup maps
// ---------------------------------------------------------------------------

const LANGUAGE_ENTRIES: CodeLanguageMeta[] = [
  // Systems & compiled
  { id: "c", displayName: "C", extension: ".c", defaultStem: "main", aliases: ["h"] },
  {
    id: "cpp",
    displayName: "C++",
    extension: ".cpp",
    defaultStem: "main",
    aliases: ["c++", "cc", "cxx", "hpp", "hxx", "hh", "cuda", "cu"],
  },
  {
    id: "csharp",
    displayName: "C#",
    extension: ".cs",
    defaultStem: "Program",
    aliases: ["c#", "cs", "dotnet"],
  },
  { id: "rust", displayName: "Rust", extension: ".rs", defaultStem: "main", aliases: ["rs"] },
  { id: "go", displayName: "Go", extension: ".go", defaultStem: "main", aliases: ["golang"] },
  { id: "zig", displayName: "Zig", extension: ".zig", defaultStem: "main" },
  { id: "swift", displayName: "Swift", extension: ".swift", defaultStem: "Main" },
  { id: "kotlin", displayName: "Kotlin", extension: ".kt", defaultStem: "Main", aliases: ["kt", "kts"] },
  { id: "java", displayName: "Java", extension: ".java", defaultStem: "Main" },
  { id: "scala", displayName: "Scala", extension: ".scala", defaultStem: "Main", aliases: ["sc"] },
  {
    id: "objectivec",
    displayName: "Objective-C",
    extension: ".m",
    defaultStem: "Main",
    aliases: ["objc", "obj-c", "objective-c", "mm"],
  },
  { id: "d", displayName: "D", extension: ".d", defaultStem: "main", aliases: ["dlang"] },
  { id: "nim", displayName: "Nim", extension: ".nim", defaultStem: "main" },
  { id: "crystal", displayName: "Crystal", extension: ".cr", defaultStem: "main", aliases: ["cr"] },
  { id: "fortran", displayName: "Fortran", extension: ".f90", defaultStem: "main", aliases: ["f90", "f95"] },
  { id: "cobol", displayName: "COBOL", extension: ".cob", defaultStem: "program", aliases: ["cob", "cbl"] },
  {
    id: "x86asm",
    displayName: "Assembly",
    extension: ".asm",
    defaultStem: "program",
    aliases: ["asm", "nasm", "masm", "armasm", "assembly"],
  },
  { id: "wasm", displayName: "WebAssembly", extension: ".wat", defaultStem: "module", aliases: ["wat", "wast"] },
  { id: "arduino", displayName: "Arduino", extension: ".ino", defaultStem: "sketch", aliases: ["ino"] },

  // Web / JS / TS / UI Frameworks
  {
    id: "javascript",
    displayName: "JavaScript",
    extension: ".js",
    defaultStem: "index",
    aliases: ["js", "mjs", "cjs", "node", "nodejs"],
  },
  { id: "jsx", displayName: "JSX", extension: ".jsx", defaultStem: "Component" },
  {
    id: "typescript",
    displayName: "TypeScript",
    extension: ".ts",
    defaultStem: "index",
    aliases: ["ts", "mts", "cts"],
  },
  { id: "tsx", displayName: "TSX", extension: ".tsx", defaultStem: "Component" },
  { id: "html", displayName: "HTML", extension: ".html", defaultStem: "index", aliases: ["htm", "xhtml"] },
  {
    id: "xml",
    displayName: "XML",
    extension: ".xml",
    defaultStem: "data",
    aliases: ["plist", "xaml", "csproj", "rss", "atom"],
  },
  { id: "svg", displayName: "SVG", extension: ".svg", defaultStem: "graphic" },
  { id: "vue", displayName: "Vue", extension: ".vue", defaultStem: "Component" },
  { id: "svelte", displayName: "Svelte", extension: ".svelte", defaultStem: "Component" },
  { id: "astro", displayName: "Astro", extension: ".astro", defaultStem: "Page" },
  { id: "css", displayName: "CSS", extension: ".css", defaultStem: "styles" },
  { id: "scss", displayName: "SCSS", extension: ".scss", defaultStem: "styles", aliases: ["sass"] },
  { id: "less", displayName: "Less", extension: ".less", defaultStem: "styles" },
  { id: "graphql", displayName: "GraphQL", extension: ".graphql", defaultStem: "schema", aliases: ["gql"] },

  // Dynamic & Scripting
  {
    id: "python",
    displayName: "Python",
    extension: ".py",
    defaultStem: "main",
    aliases: ["py", "py3", "python3", "pyi"],
  },
  { id: "python-repl", displayName: "Python REPL", extension: ".py", defaultStem: "session", aliases: ["pycon"] },
  { id: "ruby", displayName: "Ruby", extension: ".rb", defaultStem: "main", aliases: ["rb", "rake", "gemspec"] },
  { id: "php", displayName: "PHP", extension: ".php", defaultStem: "index", aliases: ["php8", "phtml"] },
  { id: "php-template", displayName: "PHP", extension: ".php", defaultStem: "index" },
  { id: "perl", displayName: "Perl", extension: ".pl", defaultStem: "script", aliases: ["pl", "pm"] },
  { id: "lua", displayName: "Lua", extension: ".lua", defaultStem: "main" },
  { id: "r", displayName: "R", extension: ".r", defaultStem: "analysis", aliases: ["rlang", "splus"] },
  { id: "julia", displayName: "Julia", extension: ".jl", defaultStem: "main", aliases: ["jl", "julia-repl"] },
  { id: "matlab", displayName: "MATLAB", extension: ".m", defaultStem: "script", aliases: ["octave"] },
  { id: "dart", displayName: "Dart", extension: ".dart", defaultStem: "main", aliases: ["flutter"] },
  { id: "groovy", displayName: "Groovy", extension: ".groovy", defaultStem: "script", aliases: ["gradle"] },
  { id: "tcl", displayName: "Tcl", extension: ".tcl", defaultStem: "script" },
  { id: "awk", displayName: "Awk", extension: ".awk", defaultStem: "script" },

  // .NET & Functional
  { id: "fsharp", displayName: "F#", extension: ".fs", defaultStem: "Program", aliases: ["f#", "fs", "fsx"] },
  { id: "vbnet", displayName: "VB.NET", extension: ".vb", defaultStem: "Module1", aliases: ["vb", "vb.net"] },
  { id: "elixir", displayName: "Elixir", extension: ".ex", defaultStem: "main", aliases: ["ex", "exs"] },
  { id: "erlang", displayName: "Erlang", extension: ".erl", defaultStem: "main", aliases: ["erl"] },
  { id: "haskell", displayName: "Haskell", extension: ".hs", defaultStem: "Main", aliases: ["hs"] },
  { id: "ocaml", displayName: "OCaml", extension: ".ml", defaultStem: "main", aliases: ["ml", "mli"] },
  { id: "clojure", displayName: "Clojure", extension: ".clj", defaultStem: "core", aliases: ["clj", "cljs", "edn"] },
  { id: "lisp", displayName: "Lisp", extension: ".lisp", defaultStem: "main", aliases: ["elisp", "commonlisp"] },
  { id: "scheme", displayName: "Scheme", extension: ".scm", defaultStem: "main", aliases: ["scm", "racket"] },
  { id: "elm", displayName: "Elm", extension: ".elm", defaultStem: "Main" },
  { id: "nix", displayName: "Nix", extension: ".nix", defaultStem: "flake" },

  // Shell, DevOps, Infra & Config
  {
    id: "bash",
    displayName: "Bash",
    extension: ".sh",
    defaultStem: "script",
    aliases: ["sh", "zsh", "fish", "ksh"],
  },
  {
    id: "shell",
    displayName: "Shell",
    extension: ".sh",
    defaultStem: "commands",
    aliases: ["console", "terminal", "shellsession"],
  },
  {
    id: "powershell",
    displayName: "PowerShell",
    extension: ".ps1",
    defaultStem: "script",
    aliases: ["ps1", "pwsh", "ps"],
  },
  { id: "dos", displayName: "Batch", extension: ".bat", defaultStem: "script", aliases: ["bat", "cmd", "batch"] },
  {
    id: "dockerfile",
    displayName: "Dockerfile",
    extension: "",
    defaultFilename: "Dockerfile",
    aliases: ["docker", "containerfile"],
  },
  {
    id: "makefile",
    displayName: "Makefile",
    extension: "",
    defaultFilename: "Makefile",
    aliases: ["make", "mk"],
  },
  { id: "cmake", displayName: "CMake", extension: ".cmake", defaultStem: "CMakeLists" },
  {
    id: "terraform",
    displayName: "Terraform",
    extension: ".tf",
    defaultStem: "main",
    aliases: ["tf", "tfvars", "hcl", "opentofu"],
  },
  { id: "nginx", displayName: "Nginx", extension: ".conf", defaultStem: "nginx", aliases: ["nginxconf"] },
  { id: "apache", displayName: "Apache", extension: ".conf", defaultStem: "httpd", aliases: ["apacheconf"] },
  { id: "yaml", displayName: "YAML", extension: ".yml", defaultStem: "config", aliases: ["yml"] },
  { id: "toml", displayName: "TOML", extension: ".toml", defaultStem: "config" },
  { id: "ini", displayName: "INI", extension: ".ini", defaultStem: "config", aliases: ["conf", "cfg"] },
  {
    id: "dotenv",
    displayName: "Env",
    extension: ".env",
    defaultFilename: "config.env",
    aliases: ["env"],
  },
  { id: "properties", displayName: "Properties", extension: ".properties", defaultStem: "application" },
  {
    id: "json",
    displayName: "JSON",
    extension: ".json",
    defaultStem: "data",
    aliases: ["jsonc", "json5", "geojson", "jsonl", "ndjson"],
  },

  // Data, DB, Contracts & Shaders
  {
    id: "sql",
    displayName: "SQL",
    extension: ".sql",
    defaultStem: "query",
    aliases: ["mysql", "sqlite", "tsql", "mssql"],
  },
  {
    id: "pgsql",
    displayName: "PostgreSQL",
    extension: ".sql",
    defaultStem: "query",
    aliases: ["postgres", "postgresql", "plpgsql"],
  },
  { id: "prisma", displayName: "Prisma", extension: ".prisma", defaultStem: "schema" },
  { id: "protobuf", displayName: "Protobuf", extension: ".proto", defaultStem: "schema", aliases: ["proto"] },
  { id: "solidity", displayName: "Solidity", extension: ".sol", defaultStem: "Contract", aliases: ["sol"] },
  {
    id: "glsl",
    displayName: "GLSL",
    extension: ".glsl",
    defaultStem: "shader",
    aliases: ["vert", "frag", "hlsl"],
  },
  { id: "wgsl", displayName: "WGSL", extension: ".wgsl", defaultStem: "shader" },
  { id: "verilog", displayName: "Verilog", extension: ".v", defaultStem: "module", aliases: ["systemverilog", "sv"] },
  { id: "vhdl", displayName: "VHDL", extension: ".vhd", defaultStem: "entity", aliases: ["vhd"] },
  { id: "csv", displayName: "CSV", extension: ".csv", defaultStem: "data", aliases: ["tsv"] },

  // Docs, Diagrams, Diffs & Plaintext
  { id: "markdown", displayName: "Markdown", extension: ".md", defaultStem: "document", aliases: ["md", "mdx"] },
  { id: "latex", displayName: "LaTeX", extension: ".tex", defaultStem: "document", aliases: ["tex"] },
  { id: "mermaid", displayName: "Mermaid", extension: ".mmd", defaultStem: "diagram", aliases: ["mmd"] },
  { id: "diff", displayName: "Diff", extension: ".diff", defaultStem: "changes", aliases: ["patch"] },
  { id: "http", displayName: "HTTP", extension: ".http", defaultStem: "request", aliases: ["https", "rest"] },
  { id: "plaintext", displayName: "Texto", extension: ".txt", defaultStem: "codigo", aliases: ["text", "txt", "plain", "log", "output"] },
];

const BY_ID_OR_ALIAS = new Map<string, CodeLanguageMeta>();
for (const entry of LANGUAGE_ENTRIES) {
  BY_ID_OR_ALIAS.set(entry.id.toLowerCase(), entry);
  for (const alias of entry.aliases || []) {
    BY_ID_OR_ALIAS.set(alias.toLowerCase(), entry);
  }
}

// Specific display-name overrides for aliases whose brand differs slightly
const ALIAS_DISPLAY_OVERRIDES: Record<string, string> = {
  zsh: "Zsh",
  fish: "Fish",
  sh: "Shell",
  mysql: "MySQL",
  sqlite: "SQLite",
  tsql: "T-SQL",
  mssql: "T-SQL",
  cuda: "CUDA",
  cu: "CUDA",
  hlsl: "HLSL",
  jsonc: "JSONC",
  json5: "JSON5",
  mdx: "MDX",
  tsv: "TSV",
  xaml: "XAML",
  plist: "Plist",
  gradle: "Gradle",
  csv: "CSV",
  svg: "SVG",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  html: "HTML",
  xml: "XML",
};

const EXTENSION_TO_LANG: Record<string, string> = {
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cu: "cuda",
  cs: "csharp",
  rs: "rust",
  go: "go",
  zig: "zig",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  java: "java",
  scala: "scala",
  m: "objectivec",
  mm: "objectivec",
  d: "d",
  nim: "nim",
  cr: "crystal",
  f90: "fortran",
  f95: "fortran",
  cob: "cobol",
  asm: "x86asm",
  wat: "wasm",
  ino: "arduino",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "svg",
  xaml: "xaml",
  plist: "plist",
  csproj: "xml",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  graphql: "graphql",
  gql: "graphql",
  py: "python",
  pyi: "python",
  rb: "ruby",
  php: "php",
  pl: "perl",
  pm: "perl",
  lua: "lua",
  r: "r",
  jl: "julia",
  dart: "dart",
  groovy: "groovy",
  gradle: "gradle",
  tcl: "tcl",
  awk: "awk",
  fs: "fsharp",
  fsx: "fsharp",
  vb: "vbnet",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  mli: "ocaml",
  clj: "clojure",
  cljs: "clojure",
  edn: "clojure",
  lisp: "lisp",
  scm: "scheme",
  elm: "elm",
  nix: "nix",
  sh: "bash",
  bash: "bash",
  zsh: "zsh",
  fish: "fish",
  ps1: "powershell",
  bat: "dos",
  cmd: "dos",
  cmake: "cmake",
  tf: "terraform",
  tfvars: "terraform",
  hcl: "terraform",
  conf: "ini",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  env: "dotenv",
  properties: "properties",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  sql: "sql",
  prisma: "prisma",
  proto: "protobuf",
  sol: "solidity",
  glsl: "glsl",
  vert: "glsl",
  frag: "glsl",
  hlsl: "hlsl",
  wgsl: "wgsl",
  sv: "verilog",
  vhd: "vhdl",
  csv: "csv",
  tsv: "tsv",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  tex: "latex",
  mmd: "mermaid",
  diff: "diff",
  patch: "diff",
  http: "http",
  txt: "plaintext",
  log: "plaintext",
};

const lowlight = createLowlight(common);

// Register common aliases missing from highlight.js default alias map
lowlight.register("terraform", terraformGrammar as unknown as LanguageFn);
lowlight.register("solidity", solidityGrammar as unknown as LanguageFn);
lowlight.register("zig", zigGrammar as unknown as LanguageFn);
lowlight.register("prisma", prismaGrammar as unknown as LanguageFn);
lowlight.register("mermaid", mermaidGrammar as unknown as LanguageFn);
lowlight.register("wgsl", wgslGrammar as unknown as LanguageFn);
lowlight.register("dotenv", dotenvGrammar as unknown as LanguageFn);
lowlight.register("csv", csvGrammar as unknown as LanguageFn);

lowlight.registerAlias({
  bash: ["zsh", "fish", "ksh"],
  shell: ["console", "terminal", "shellsession"],
  cpp: ["cuda", "cu", "hpp", "cxx"],
  csharp: ["dotnet"],
  javascript: ["mjs", "cjs", "node", "nodejs"],
  typescript: ["mts", "cts"],
  json: ["jsonc", "json5", "geojson", "jsonl", "ndjson"],
  xml: ["vue", "svelte", "astro", "svg", "xaml", "plist", "csproj"],
  markdown: ["mdx"],
  sql: ["mysql", "sqlite", "tsql", "mssql", "pgsql", "postgres", "postgresql", "plpgsql"],
  ini: ["conf", "cfg"],
  terraform: ["tf", "tfvars", "hcl", "opentofu"],
  solidity: ["sol"],
  mermaid: ["mmd"],
  csv: ["tsv"],
  dotenv: ["env"],
});

// JSX / TSX share JS/TS highlight.js grammars
lowlight.registerAlias({
  javascript: ["jsx"],
  typescript: ["tsx"],
});

const CUSTOM_LANGUAGE_IDS = new Set([
  "terraform",
  "tf",
  "tfvars",
  "hcl",
  "opentofu",
  "solidity",
  "sol",
  "zig",
  "prisma",
  "mermaid",
  "mmd",
  "wgsl",
  "dotenv",
  "env",
  "csv",
  "tsv",
]);

let fullLanguagesLoaded = false;
let fullLanguagesPromise: Promise<boolean> | null = null;

export function isFullLanguagePackLoaded(): boolean {
  return fullLanguagesLoaded;
}

/** Lazily loads all 192 highlight.js grammars on demand so initial bundle stays lean. */
export function ensureFullLanguagesLoaded(): Promise<boolean> {
  if (fullLanguagesLoaded) {
    return Promise.resolve(true);
  }
  if (!fullLanguagesPromise) {
    fullLanguagesPromise = import("highlight.js")
      .then((hljsMod) => {
        const fullHljs = (hljsMod.default ?? hljsMod) as unknown as HLJSApi;
        for (const langId of fullHljs.listLanguages()) {
          if (!CUSTOM_LANGUAGE_IDS.has(langId) && !lowlight.registered(langId)) {
            const langObj = fullHljs.getLanguage(langId) as
              | { rawDefinition?: () => ReturnType<LanguageFn> }
              | undefined;
            if (langObj?.rawDefinition) {
              const defFn = langObj.rawDefinition;
              lowlight.register(langId, (() => defFn()) as unknown as LanguageFn);
            }
          }
        }
        // Extended aliases over newly registered full-pack grammars
        if (lowlight.registered("x86asm")) {
          lowlight.registerAlias("x86asm", ["asm", "nasm", "masm", "armasm", "assembly"]);
        }
        if (lowlight.registered("glsl")) {
          lowlight.registerAlias("glsl", ["hlsl", "vert", "frag"]);
        }
        if (lowlight.registered("dockerfile")) {
          lowlight.registerAlias("dockerfile", ["docker", "containerfile"]);
        }
        if (lowlight.registered("powershell")) {
          lowlight.registerAlias("powershell", ["ps1", "pwsh", "ps"]);
        }
        if (lowlight.registered("dos")) {
          lowlight.registerAlias("dos", ["bat", "cmd", "batch"]);
        }
        if (lowlight.registered("fsharp")) {
          lowlight.registerAlias("fsharp", ["f#", "fs", "fsx"]);
        }
        if (lowlight.registered("elixir")) {
          lowlight.registerAlias("elixir", ["ex", "exs"]);
        }
        if (lowlight.registered("haskell")) {
          lowlight.registerAlias("haskell", ["hs"]);
        }
        if (lowlight.registered("scala")) {
          lowlight.registerAlias("scala", ["sc"]);
        }
        if (lowlight.registered("dart")) {
          lowlight.registerAlias("dart", ["flutter"]);
        }
        if (lowlight.registered("latex")) {
          lowlight.registerAlias("latex", ["tex"]);
        }
        if (lowlight.registered("julia")) {
          lowlight.registerAlias("julia", ["jl"]);
        }
        if (lowlight.registered("clojure")) {
          lowlight.registerAlias("clojure", ["clj", "cljs", "edn"]);
        }
        if (lowlight.registered("groovy")) {
          lowlight.registerAlias("groovy", ["gradle"]);
        }
        if (lowlight.registered("protobuf")) {
          lowlight.registerAlias("protobuf", ["proto"]);
        }
        if (lowlight.registered("nginx")) {
          lowlight.registerAlias("nginx", ["nginxconf"]);
        }
        if (lowlight.registered("apache")) {
          lowlight.registerAlias("apache", ["apacheconf"]);
        }
        if (lowlight.registered("fortran")) {
          lowlight.registerAlias("fortran", ["f90", "f95"]);
        }
        if (lowlight.registered("ocaml")) {
          lowlight.registerAlias("ocaml", ["ml", "mli"]);
        }
        if (lowlight.registered("scheme")) {
          lowlight.registerAlias("scheme", ["scm", "racket"]);
        }
        fullLanguagesLoaded = true;
        return true;
      })
      .catch(() => false);
  }
  return fullLanguagesPromise;
}

function cleanLanguageToken(token: string): string {
  return token
    .trim()
    .replace(/^\{+|\}+$/g, "")
    .replace(/^\.?language-/i, "")
    .replace(/^lang-/i, "");
}

function inferLanguageFromFilename(filename: string): string | undefined {
  const base = filename.split("/").pop()?.trim() || "";
  if (!base) return undefined;
  const lower = base.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith(".dockerfile")) return "dockerfile";
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";
  if (lower === "cmakelists.txt") return "cmake";
  if (lower === ".env" || lower.startsWith(".env.")) return "dotenv";
  const dot = lower.lastIndexOf(".");
  if (dot > 0 && dot < lower.length - 1) {
    const ext = lower.slice(dot + 1);
    return EXTENSION_TO_LANG[ext];
  }
  return undefined;
}

function looksLikeFilename(candidate: string): boolean {
  const clean = candidate.trim().replace(/^["'`]|["'`]$/g, "");
  if (!clean) return false;
  if (inferLanguageFromFilename(clean)) return true;
  return /^[A-Za-z0-9_.\-/]+\.[A-Za-z0-9]{1,10}$/.test(clean);
}

/**
 * Parses fenced code info strings across Markdown dialects:
 * - `csharp`, `c#`, `c++`
 * - `csharp:CuentaBancaria.cs`, `ts:src/app.ts`
 * - `python title="script.py"`, `bash filename="deploy.sh"`
 * - `Dockerfile`, `CuentaBancaria.cs`, `{.language-ts}`
 */
export function parseCodeFenceInfo(rawInfo: string): ParsedFenceInfo {
  const trimmed = (rawInfo || "").trim();
  if (!trimmed) return { language: "" };

  let filenameHint: string | undefined;
  const attrMatch = trimmed.match(/(?:title|file|filename|name|path)\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  if (attrMatch) {
    filenameHint = (attrMatch[1] || attrMatch[2] || attrMatch[3] || "").trim();
  }

  const firstToken = cleanLanguageToken(trimmed.split(/\s+/)[0] || "");
  if (!firstToken) {
    return {
      language: filenameHint ? inferLanguageFromFilename(filenameHint) || "" : "",
      filenameHint,
    };
  }

  // Handle `lang:path/to/file.ext` (without breaking `c++` or single tokens without extension)
  const colonIdx = firstToken.indexOf(":");
  if (colonIdx > 0 && colonIdx < firstToken.length - 1) {
    const left = cleanLanguageToken(firstToken.slice(0, colonIdx));
    const right = firstToken.slice(colonIdx + 1).trim();
    if (looksLikeFilename(right)) {
      return {
        language: left || inferLanguageFromFilename(right) || "",
        filenameHint: filenameHint || right,
      };
    }
  }

  // Handle second bare token when it looks like a filename (`python main.py`)
  if (!filenameHint) {
    const restParts = trimmed.split(/\s+/).slice(1);
    const second = restParts[0];
    if (second && !second.includes("=") && looksLikeFilename(second)) {
      filenameHint = second.replace(/^["'`]|["'`]$/g, "");
    }
  }

  // Handle pure filename as info string (`Dockerfile`, `CuentaBancaria.cs`, `.env`)
  if (!BY_ID_OR_ALIAS.has(firstToken.toLowerCase()) && looksLikeFilename(firstToken)) {
    const inferred = inferLanguageFromFilename(firstToken);
    if (inferred) {
      return {
        language: inferred,
        filenameHint: filenameHint || firstToken,
      };
    }
  }

  return {
    language: firstToken,
    filenameHint,
  };
}

export function resolveLanguageMeta(rawLang?: string | null, filenameHint?: string): CodeLanguageMeta {
  const cleaned = cleanLanguageToken(rawLang || "");
  const lower = cleaned.toLowerCase();

  const direct = lower ? BY_ID_OR_ALIAS.get(lower) : undefined;
  if (direct) {
    const override = ALIAS_DISPLAY_OVERRIDES[lower];
    return override ? { ...direct, displayName: override } : direct;
  }

  if (filenameHint) {
    const fromFile = inferLanguageFromFilename(filenameHint);
    if (fromFile) {
      const meta = BY_ID_OR_ALIAS.get(fromFile.toLowerCase());
      if (meta) return meta;
    }
  }

  if (!cleaned) {
    return { id: "plaintext", displayName: "Código", extension: ".txt", defaultStem: "codigo" };
  }

  // Graceful fallback for any niche language tag highlight.js may know natively
  const pretty = cleaned.length <= 4 && /^[a-z0-9]+$/i.test(cleaned)
    ? cleaned.toUpperCase()
    : cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return {
    id: lower,
    displayName: pretty,
    extension: /^[a-z0-9]{1,8}$/i.test(cleaned) ? `.${lower}` : ".txt",
    defaultStem: "snippet",
  };
}

export function getLanguageMetaForExtension(extension?: string | null, filename?: string | null): CodeLanguageMeta | null {
  const fromName = filename ? inferLanguageFromFilename(filename) : undefined;
  if (fromName) {
    return resolveLanguageMeta(fromName, filename || undefined);
  }
  const cleanExt = (extension || "").trim().replace(/^\./, "").toLowerCase();
  if (!cleanExt) return null;
  const langId = EXTENSION_TO_LANG[cleanExt];
  if (!langId) return null;
  return resolveLanguageMeta(langId);
}

// Fast structural heuristics before/alongside auto-detect for unlabeled code fences
function detectLanguageHeuristically(code: string): string | null {
  const sample = code.slice(0, 2400).trimStart();
  if (!sample) return null;

  if (/^<!doctype\s+html/i.test(sample) || /<(?:html|head|body|main|section|article)\b/i.test(sample)) {
    return "html";
  }
  if (/^<svg\b/i.test(sample)) return "svg";
  if (/^<\?xml\b/i.test(sample)) return "xml";
  if (/^<\?php\b/i.test(sample)) return "php";
  if (/^#!/m.test(sample)) {
    if (/python/i.test(sample.split("\n", 1)[0])) return "python";
    if (/node|deno|bun/i.test(sample.split("\n", 1)[0])) return "javascript";
    return "bash";
  }
  if (/^\s*FROM\s+[A-Za-z0-9._/:@-]+(?:\s+AS\s+\S+)?\s*$/im.test(sample) && /^\s*(?:RUN|COPY|WORKDIR|CMD|ENTRYPOINT|ENV|EXPOSE)\b/m.test(sample)) {
    return "dockerfile";
  }
  if (/^\s*(?:\{|\[)[\s\S]*"[^"]+"\s*:/.test(sample)) {
    try {
      JSON.parse(code);
      return "json";
    } catch {
      // Fall through in case of JSONC or JS object
    }
  }
  if (/\busing\s+System(?:\.[A-Za-z0-9_.]+)?\s*;/.test(sample) || /\bpublic\s+(?:sealed\s+|abstract\s+|static\s+)?(?:class|record|interface)\s+\w+/.test(sample) && /\b(?:decimal|string|bool)\s+\w+\s*\{\s*get\s*;/.test(sample)) {
    return "csharp";
  }
  if (/^\s*package\s+main\b/m.test(sample) && /\bfunc\s+\w+\s*\(/.test(sample)) return "go";
  if (/^\s*(?:pub\s+)?fn\s+[a-z_]\w*\s*\(/m.test(sample) && /\blet\s+(?:mut\s+)?\w+/.test(sample)) return "rust";
  if (/^\s*(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|VIEW|INDEX|DATABASE)|ALTER\s+TABLE)\b/im.test(sample)) {
    return "sql";
  }
  if (/^\s*resource\s+"[^"]+"\s+"[^"]+"\s*\{/m.test(sample) || /^\s*provider\s+"[^"]+"\s*\{/m.test(sample)) {
    return "terraform";
  }
  if (/^\s*pragma\s+solidity\b/im.test(sample)) return "solidity";
  if (/^\s*(?:def|class|async\s+def)\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:->\s*[^:]+)?:\s*$/m.test(sample)) {
    return "python";
  }
  return null;
}

/**
 * Highlights source code into a safe HAST Root node (no HTML strings).
 * Returns `needsExtendedPack = true` when the language lives in the lazy 192-language bundle
 * (or auto-detection on unlabeled code can benefit from loading the extended pack).
 */
export function highlightCodeToHast(
  code: string,
  rawLang?: string | null,
  filenameHint?: string
): HighlightCodeResult {
  const safeCode = code.length > MAX_HIGHLIGHT_CHARS ? code.slice(0, MAX_HIGHLIGHT_CHARS) : code;
  const explicitMeta = resolveLanguageMeta(rawLang, filenameHint);
  const hasExplicitLang = Boolean(cleanLanguageToken(rawLang || "") || filenameHint);

  if (hasExplicitLang) {
    if (explicitMeta.id === "plaintext") {
      return {
        hast: { type: "root", children: [{ type: "text", value: safeCode }] },
        canonicalId: "plaintext",
        displayName: explicitMeta.displayName,
        extension: explicitMeta.extension,
        needsExtendedPack: false,
      };
    }

    if (lowlight.registered(explicitMeta.id)) {
      try {
        const hast = lowlight.highlight(explicitMeta.id, safeCode);
        return {
          hast,
          canonicalId: explicitMeta.id,
          displayName: explicitMeta.displayName,
          extension: explicitMeta.extension,
          needsExtendedPack: false,
        };
      } catch {
        // Fallback to plain text if grammar throws on malformed partial streaming tokens
      }
    }

    const lowerRaw = cleanLanguageToken(rawLang || "").toLowerCase();
    if (lowerRaw && lowlight.registered(lowerRaw)) {
      try {
        const hast = lowlight.highlight(lowerRaw, safeCode);
        return {
          hast,
          canonicalId: lowerRaw,
          displayName: explicitMeta.displayName,
          extension: explicitMeta.extension,
          needsExtendedPack: false,
        };
      } catch {
        // Ignore grammar errors on incomplete fragments
      }
    }

    return {
      hast: { type: "root", children: [{ type: "text", value: safeCode }] },
      canonicalId: explicitMeta.id,
      displayName: explicitMeta.displayName,
      extension: explicitMeta.extension,
      needsExtendedPack: !fullLanguagesLoaded,
    };
  }

  // Unlabeled code fence: apply crisp structural heuristics first, then highlightAuto
  const heuristicId = detectLanguageHeuristically(safeCode);
  if (heuristicId && lowlight.registered(heuristicId)) {
    const hMeta = resolveLanguageMeta(heuristicId);
    try {
      return {
        hast: lowlight.highlight(heuristicId, safeCode),
        canonicalId: hMeta.id,
        displayName: hMeta.displayName,
        extension: hMeta.extension,
        needsExtendedPack: false,
      };
    } catch {
      // Continue to auto
    }
  }

  try {
    const sample = safeCode.length > MAX_AUTO_DETECT_CHARS ? safeCode.slice(0, MAX_AUTO_DETECT_CHARS) : safeCode;
    const autoPreview = lowlight.highlightAuto(sample);
    const detectedId = autoPreview.data?.language;
    const relevance = autoPreview.data?.relevance ?? 0;

    if (detectedId && relevance >= 4 && lowlight.registered(detectedId)) {
      const detectedMeta = resolveLanguageMeta(detectedId);
      const hast =
        safeCode.length <= MAX_AUTO_DETECT_CHARS
          ? autoPreview
          : lowlight.highlight(detectedId, safeCode);
      return {
        hast,
        canonicalId: detectedMeta.id,
        displayName: detectedMeta.displayName,
        extension: detectedMeta.extension,
        needsExtendedPack: false,
      };
    }
  } catch {
    // Fallback below
  }

  return {
    hast: { type: "root", children: [{ type: "text", value: safeCode }] },
    canonicalId: "plaintext",
    displayName: "Código",
    extension: ".txt",
    needsExtendedPack: !fullLanguagesLoaded && safeCode.length >= 24,
  };
}

function sanitizeStem(raw: string): string {
  return raw
    .trim()
    .replace(/^.*\//, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function extractSymbolStem(code: string, canonicalId: string): string | null {
  const head = code.slice(0, 2500);

  if (["csharp", "java", "kotlin", "scala", "dart", "php", "swift"].includes(canonicalId)) {
    const match = head.match(
      /\b(?:public|internal|private|protected|sealed|abstract|final|data|open|static|partial|\s)*\s*(?:class|interface|record|struct|enum|object)\s+([A-Za-z_][A-Za-z0-9_]*)/
    );
    if (match?.[1]) return match[1];
  }

  if (["typescript", "tsx", "javascript", "jsx", "vue", "svelte", "astro"].includes(canonicalId)) {
    const match = head.match(
      /\bexport\s+(?:default\s+)?(?:async\s+)?(?:class|interface|type|function|const)\s+([A-Za-z_][A-Za-z0-9_]*)/
    );
    if (match?.[1]) return match[1];
    const fnMatch = head.match(/\b(?:class|function)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (fnMatch?.[1]) return fnMatch[1];
  }

  if (canonicalId === "python") {
    const cls = head.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/m);
    if (cls?.[1]) return cls[1];
    const def = head.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/m);
    if (def?.[1] && def[1] !== "main") return def[1];
  }

  if (canonicalId === "rust") {
    const rs = head.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/m);
    if (rs?.[1]) return rs[1];
  }

  if (canonicalId === "go") {
    const goType = head.match(/^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:struct|interface)\b/m);
    if (goType?.[1]) return goType[1];
    const goPkg = head.match(/^\s*package\s+([a-z_][a-z0-9_]*)\b/m);
    if (goPkg?.[1] && goPkg[1] !== "main") return goPkg[1];
  }

  if (canonicalId === "solidity") {
    const sol = head.match(/^\s*(?:abstract\s+)?(?:contract|interface|library)\s+([A-Za-z_][A-Za-z0-9_]*)/m);
    if (sol?.[1]) return sol[1];
  }

  if (["sql", "pgsql"].includes(canonicalId)) {
    const tbl = head.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[A-Za-z_]\w*\.)?["`[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?/i);
    if (tbl?.[1]) return tbl[1];
  }

  return null;
}

/**
 * Computes a clean, collision-friendly filename with canonical extension for downloading any code block.
 */
export function suggestCodeFilename(
  code: string,
  rawLang?: string | null,
  filenameHint?: string,
  detectedCanonicalId?: string
): string {
  const effectiveLang = rawLang || detectedCanonicalId || "";
  const meta = resolveLanguageMeta(effectiveLang, filenameHint);

  if (filenameHint) {
    const cleanHint = filenameHint
      .trim()
      .split("/")
      .pop()
      ?.replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+/, "");
    if (cleanHint) {
      if (cleanHint.includes(".") || !meta.extension) {
        return cleanHint;
      }
      return `${cleanHint}${meta.extension}`;
    }
  }

  if (meta.defaultFilename) {
    return meta.defaultFilename;
  }

  const symbol = extractSymbolStem(code, meta.id);
  const stem = sanitizeStem(symbol || meta.defaultStem || "snippet") || "snippet";
  return `${stem}${meta.extension || ".txt"}`;
}
