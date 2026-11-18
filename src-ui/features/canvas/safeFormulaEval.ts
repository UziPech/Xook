export type FormulaPrimitive = number | string | boolean | null;
export type FormulaValue =
  | FormulaPrimitive
  | FormulaValue[]
  | { [key: string]: FormulaValue };

const BLOCKED_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

type TokenType =
  | "number"
  | "string"
  | "ident"
  | "op"
  | "paren_open"
  | "paren_close"
  | "bracket_open"
  | "bracket_close"
  | "comma"
  | "dot"
  | "question"
  | "colon"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
}

type AstNode =
  | { kind: "literal"; value: FormulaPrimitive }
  | { kind: "ident"; name: string }
  | { kind: "member"; object: AstNode; property: string }
  | { kind: "index"; object: AstNode; index: AstNode }
  | { kind: "array"; elements: AstNode[] }
  | { kind: "unary"; op: "!" | "-" | "+"; arg: AstNode }
  | { kind: "binary"; op: string; left: AstNode; right: AstNode }
  | { kind: "ternary"; cond: AstNode; whenTrue: AstNode; whenFalse: AstNode }
  | { kind: "call"; callee: string; args: AstNode[] };

const MAX_EXPR_LENGTH = 2000;
const MAX_AST_CACHE = 400;
const astCache = new Map<string, AstNode>();

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }

    // Numbers: 123, 12.34, .5, 1e-3
    if (
      (ch >= "0" && ch <= "9") ||
      (ch === "." && i + 1 < len && expr[i + 1] >= "0" && expr[i + 1] <= "9")
    ) {
      const start = i;
      let hasDot = ch === ".";
      i += 1;
      while (i < len) {
        const c = expr[i];
        if (c >= "0" && c <= "9") {
          i += 1;
        } else if (c === "." && !hasDot) {
          hasDot = true;
          i += 1;
        } else if (
          (c === "e" || c === "E") &&
          i + 1 < len &&
          ((expr[i + 1] >= "0" && expr[i + 1] <= "9") ||
            ((expr[i + 1] === "+" || expr[i + 1] === "-") &&
              i + 2 < len &&
              expr[i + 2] >= "0" &&
              expr[i + 2] <= "9"))
        ) {
          i += 1;
          if (expr[i] === "+" || expr[i] === "-") i += 1;
        } else {
          break;
        }
      }
      tokens.push({ type: "number", value: expr.slice(start, i) });
      continue;
    }

    // Strings: "..." or '...'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      let out = "";
      let closed = false;
      while (i < len) {
        const c = expr[i];
        if (c === "\\") {
          i += 1;
          if (i >= len) break;
          const esc = expr[i];
          if (esc === "n") out += "\n";
          else if (esc === "t") out += "\t";
          else if (esc === "r") out += "\r";
          else out += esc;
          i += 1;
        } else if (c === quote) {
          closed = true;
          i += 1;
          break;
        } else {
          out += c;
          i += 1;
        }
      }
      if (!closed) {
        throw new Error("Cadena sin cerrar en fórmula");
      }
      tokens.push({ type: "string", value: out });
      continue;
    }

    // Identifiers
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
      const start = i;
      i += 1;
      while (i < len) {
        const c = expr[i];
        if (
          (c >= "a" && c <= "z") ||
          (c >= "A" && c <= "Z") ||
          (c >= "0" && c <= "9") ||
          c === "_" ||
          c === "$"
        ) {
          i += 1;
        } else {
          break;
        }
      }
      tokens.push({ type: "ident", value: expr.slice(start, i) });
      continue;
    }

    // 3-char operators
    const three = expr.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      tokens.push({ type: "op", value: three });
      i += 3;
      continue;
    }

    // 2-char operators
    const two = expr.slice(i, i + 2);
    if (
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">=" ||
      two === "&&" ||
      two === "||"
    ) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }

    // Single-char punctuation & operators
    if (ch === "(") {
      tokens.push({ type: "paren_open", value: ch });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "paren_close", value: ch });
      i += 1;
      continue;
    }
    if (ch === "[") {
      tokens.push({ type: "bracket_open", value: ch });
      i += 1;
      continue;
    }
    if (ch === "]") {
      tokens.push({ type: "bracket_close", value: ch });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch });
      i += 1;
      continue;
    }
    if (ch === ".") {
      tokens.push({ type: "dot", value: ch });
      i += 1;
      continue;
    }
    if (ch === "?") {
      tokens.push({ type: "question", value: ch });
      i += 1;
      continue;
    }
    if (ch === ":") {
      tokens.push({ type: "colon", value: ch });
      i += 1;
      continue;
    }
    if ("+-*/%<>!".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }

    throw new Error(`Carácter no permitido en fórmula: ${ch}`);
  }

  tokens.push({ type: "eof", value: "" });
  return tokens;
}

class FormulaParser {
  private pos = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "eof", value: "" };
  }

  private consume(): Token {
    const tok = this.peek();
    this.pos += 1;
    return tok;
  }

  private matchOp(...ops: string[]): string | null {
    const tok = this.peek();
    if (tok.type === "op" && ops.includes(tok.value)) {
      this.pos += 1;
      return tok.value;
    }
    return null;
  }

  parse(): AstNode {
    const node = this.parseTernary();
    if (this.peek().type !== "eof") {
      throw new Error(`Token inesperado en fórmula: ${this.peek().value}`);
    }
    return node;
  }

  private parseTernary(): AstNode {
    const cond = this.parseOr();
    if (this.peek().type === "question") {
      this.consume();
      const whenTrue = this.parseTernary();
      if (this.peek().type !== "colon") {
        throw new Error("Se esperaba ':' en operador ternario");
      }
      this.consume();
      const whenFalse = this.parseTernary();
      return { kind: "ternary", cond, whenTrue, whenFalse };
    }
    return cond;
  }

  private parseOr(): AstNode {
    let left = this.parseAnd();
    while (this.matchOp("||")) {
      const right = this.parseAnd();
      left = { kind: "binary", op: "||", left, right };
    }
    return left;
  }

  private parseAnd(): AstNode {
    let left = this.parseEquality();
    while (this.matchOp("&&")) {
      const right = this.parseEquality();
      left = { kind: "binary", op: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): AstNode {
    let left = this.parseRelational();
    let op: string | null;
    while ((op = this.matchOp("==", "===", "!=", "!=="))) {
      const right = this.parseRelational();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseRelational(): AstNode {
    let left = this.parseAdditive();
    let op: string | null;
    while ((op = this.matchOp("<", "<=", ">", ">="))) {
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative();
    let op: string | null;
    while ((op = this.matchOp("+", "-"))) {
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): AstNode {
    let left = this.parseUnary();
    let op: string | null;
    while ((op = this.matchOp("*", "/", "%"))) {
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): AstNode {
    const op = this.matchOp("!", "-", "+");
    if (op === "!" || op === "-" || op === "+") {
      return { kind: "unary", op, arg: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): AstNode {
    let node = this.parsePrimary();
    while (true) {
      if (this.peek().type === "dot") {
        this.consume();
        const propTok = this.peek();
        if (propTok.type !== "ident") {
          throw new Error("Se esperaba nombre de propiedad después de '.'");
        }
        this.consume();
        node = { kind: "member", object: node, property: propTok.value };
        continue;
      }
      if (this.peek().type === "bracket_open") {
        this.consume();
        const index = this.parseTernary();
        if (this.peek().type !== "bracket_close") {
          throw new Error("Se esperaba ']'");
        }
        this.consume();
        node = { kind: "index", object: node, index };
        continue;
      }
      break;
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const tok = this.peek();

    if (tok.type === "number") {
      this.consume();
      const num = Number(tok.value);
      return { kind: "literal", value: Number.isFinite(num) ? num : 0 };
    }

    if (tok.type === "string") {
      this.consume();
      return { kind: "literal", value: tok.value };
    }

    if (tok.type === "ident") {
      this.consume();
      if (tok.value === "true") return { kind: "literal", value: true };
      if (tok.value === "false") return { kind: "literal", value: false };
      if (tok.value === "null" || tok.value === "undefined") {
        return { kind: "literal", value: null };
      }

      // Function call
      if (this.peek().type === "paren_open") {
        this.consume();
        const args: AstNode[] = [];
        if (this.peek().type !== "paren_close") {
          args.push(this.parseTernary());
          while (this.peek().type === "comma") {
            this.consume();
            args.push(this.parseTernary());
          }
        }
        if (this.peek().type !== "paren_close") {
          throw new Error("Se esperaba ')' al cerrar llamada a función");
        }
        this.consume();
        return { kind: "call", callee: tok.value, args };
      }

      return { kind: "ident", name: tok.value };
    }

    if (tok.type === "paren_open") {
      this.consume();
      const inner = this.parseTernary();
      if (this.peek().type !== "paren_close") {
        throw new Error("Se esperaba ')'");
      }
      this.consume();
      return inner;
    }

    if (tok.type === "bracket_open") {
      this.consume();
      const elements: AstNode[] = [];
      if (this.peek().type !== "bracket_close") {
        elements.push(this.parseTernary());
        while (this.peek().type === "comma") {
          this.consume();
          if (this.peek().type === "bracket_close") break;
          elements.push(this.parseTernary());
        }
      }
      if (this.peek().type !== "bracket_close") {
        throw new Error("Se esperaba ']'");
      }
      this.consume();
      return { kind: "array", elements };
    }

    throw new Error(`Expresión inválida cerca de '${tok.value || "fin"}'`);
  }
}

function parseFormula(expr: string): AstNode {
  if (expr.length > MAX_EXPR_LENGTH) {
    throw new Error("Fórmula demasiado larga");
  }
  const cached = astCache.get(expr);
  if (cached) return cached;
  const ast = new FormulaParser(tokenize(expr)).parse();
  if (astCache.size >= MAX_AST_CACHE) {
    const firstKey = astCache.keys().next().value;
    if (firstKey !== undefined) astCache.delete(firstKey);
  }
  astCache.set(expr, ast);
  return ast;
}

function toNum(val: unknown): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (typeof val === "boolean") return val ? 1 : 0;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isTruthy(val: unknown): boolean {
  return Boolean(val);
}

function flattenNumbers(values: unknown[]): number[] {
  const out: number[] = [];
  for (const item of values) {
    if (Array.isArray(item)) {
      out.push(...flattenNumbers(item));
    } else if (typeof item === "number" && Number.isFinite(item)) {
      out.push(item);
    } else if (typeof item === "boolean") {
      out.push(item ? 1 : 0);
    } else if (typeof item === "string") {
      const parsed = Number(item.trim());
      if (item.trim() !== "" && Number.isFinite(parsed)) {
        out.push(parsed);
      }
    }
  }
  return out;
}

function safeReadOwn(obj: unknown, key: string): unknown {
  if (BLOCKED_KEYS.has(key)) return undefined;
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    if (key === "length") return obj.length;
    const idx = Number(key);
    if (Number.isInteger(idx) && idx >= 0 && idx < obj.length) {
      return obj[idx];
    }
    return undefined;
  }
  if (typeof obj === "string") {
    if (key === "length") return obj.length;
    return undefined;
  }
  if (typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rec, key)) {
      return rec[key];
    }
  }
  return undefined;
}

function callBuiltin(name: string, argNodes: AstNode[], evalNode: (n: AstNode) => unknown): unknown {
  const fn = name.toLowerCase();

  if (fn === "if") {
    if (argNodes.length < 2) return null;
    return isTruthy(evalNode(argNodes[0]))
      ? evalNode(argNodes[1])
      : argNodes[2]
        ? evalNode(argNodes[2])
        : null;
  }

  const args = argNodes.map(evalNode);

  switch (fn) {
    case "min": {
      const nums = flattenNumbers(args);
      return nums.length > 0 ? Math.min(...nums) : 0;
    }
    case "max": {
      const nums = flattenNumbers(args);
      return nums.length > 0 ? Math.max(...nums) : 0;
    }
    case "sum": {
      const nums = flattenNumbers(args);
      return nums.reduce((acc, n) => acc + n, 0);
    }
    case "avg": {
      const nums = flattenNumbers(args);
      if (nums.length === 0) return 0;
      return nums.reduce((acc, n) => acc + n, 0) / nums.length;
    }
    case "round": {
      const val = toNum(args[0]);
      const decimals = Math.max(0, Math.min(8, Math.trunc(toNum(args[1] ?? 0))));
      const factor = 10 ** decimals;
      return Math.round((val + Number.EPSILON) * factor) / factor;
    }
    case "floor":
      return Math.floor(toNum(args[0]));
    case "ceil":
      return Math.ceil(toNum(args[0]));
    case "abs":
      return Math.abs(toNum(args[0]));
    case "clamp": {
      const val = toNum(args[0]);
      const lo = toNum(args[1] ?? 0);
      const hi = toNum(args[2] ?? lo);
      const minV = Math.min(lo, hi);
      const maxV = Math.max(lo, hi);
      return Math.min(maxV, Math.max(minV, val));
    }
    case "len": {
      const target = args[0];
      if (Array.isArray(target) || typeof target === "string") return target.length;
      if (target && typeof target === "object") return Object.keys(target).length;
      return 0;
    }
    case "count": {
      const target = args[0];
      const filter = args[1];
      if (!Array.isArray(target)) return target ? 1 : 0;
      if (filter === undefined || filter === null || filter === "") {
        return target.filter((item) => {
          if (item && typeof item === "object" && "done" in item) {
            return Boolean((item as { done?: unknown }).done);
          }
          return Boolean(item);
        }).length;
      }
      if (typeof filter === "boolean") {
        return target.filter((item) => {
          if (item && typeof item === "object" && "done" in item) {
            return Boolean((item as { done?: unknown }).done) === filter;
          }
          return Boolean(item) === filter;
        }).length;
      }
      const filterStr = String(filter).toLowerCase();
      return target.filter((item) => {
        if (item && typeof item === "object") {
          const rec = item as Record<string, unknown>;
          if (filterStr === "done" || filterStr === "completed" || filterStr === "true") {
            return rec.done === true || String(rec.status || "").toLowerCase() === "done";
          }
          if (filterStr === "pending" || filterStr === "todo" || filterStr === "false") {
            return rec.done === false || String(rec.status || "").toLowerCase() === "todo";
          }
          return (
            String(rec.status ?? "").toLowerCase() === filterStr ||
            String(rec.column ?? "").toLowerCase() === filterStr ||
            String(rec.stage ?? "").toLowerCase() === filterStr
          );
        }
        return String(item ?? "").toLowerCase() === filterStr;
      }).length;
    }
    default:
      throw new Error(`Función no permitida: ${name}`);
  }
}

export interface SafeFormulaResult {
  value: FormulaPrimitive;
  error?: string;
}

export function evaluateSafeFormula(
  formula: string,
  state: Record<string, unknown>,
): SafeFormulaResult {
  const expr = formula.trim();
  if (!expr) return { value: null };

  try {
    const ast = parseFormula(expr);
    let depth = 0;
    const evalNode = (node: AstNode): unknown => {
      depth += 1;
      if (depth > 200) {
        throw new Error("Profundidad máxima de fórmula excedida");
      }
      try {
        switch (node.kind) {
          case "literal":
            return node.value;
          case "ident": {
            if (BLOCKED_KEYS.has(node.name)) return undefined;
            if (node.name === "state") return state;
            return safeReadOwn(state, node.name) ?? null;
          }
          case "member": {
            const obj = evalNode(node.object);
            return safeReadOwn(obj, node.property) ?? null;
          }
          case "index": {
            const obj = evalNode(node.object);
            const idx = evalNode(node.index);
            if (idx === null || idx === undefined) return null;
            return safeReadOwn(obj, String(idx)) ?? null;
          }
          case "array":
            return node.elements.map(evalNode);
          case "unary": {
            const val = evalNode(node.arg);
            if (node.op === "!") return !isTruthy(val);
            if (node.op === "-") return -toNum(val);
            return +toNum(val);
          }
          case "ternary": {
            return isTruthy(evalNode(node.cond))
              ? evalNode(node.whenTrue)
              : evalNode(node.whenFalse);
          }
          case "call":
            return callBuiltin(node.callee, node.args, evalNode);
          case "binary": {
            if (node.op === "&&") {
              const left = evalNode(node.left);
              return isTruthy(left) ? evalNode(node.right) : left;
            }
            if (node.op === "||") {
              const left = evalNode(node.left);
              return isTruthy(left) ? left : evalNode(node.right);
            }
            const left = evalNode(node.left);
            const right = evalNode(node.right);
            switch (node.op) {
              case "+":
                if (typeof left === "string" || typeof right === "string") {
                  return `${left ?? ""}${right ?? ""}`;
                }
                return toNum(left) + toNum(right);
              case "-":
                return toNum(left) - toNum(right);
              case "*":
                return toNum(left) * toNum(right);
              case "/": {
                const denom = toNum(right);
                return denom === 0 ? 0 : toNum(left) / denom;
              }
              case "%": {
                const denom = toNum(right);
                return denom === 0 ? 0 : toNum(left) % denom;
              }
              case "==":
                // eslint-disable-next-line eqeqeq
                return left == right;
              case "===":
                return left === right;
              case "!=":
                // eslint-disable-next-line eqeqeq
                return left != right;
              case "!==":
                return left !== right;
              case "<":
                return typeof left === "string" && typeof right === "string"
                  ? left < right
                  : toNum(left) < toNum(right);
              case "<=":
                return typeof left === "string" && typeof right === "string"
                  ? left <= right
                  : toNum(left) <= toNum(right);
              case ">":
                return typeof left === "string" && typeof right === "string"
                  ? left > right
                  : toNum(left) > toNum(right);
              case ">=":
                return typeof left === "string" && typeof right === "string"
                  ? left >= right
                  : toNum(left) >= toNum(right);
              default:
                return null;
            }
          }
        }
      } finally {
        depth -= 1;
      }
    };

    const raw = evalNode(ast);
    if (
      raw === null ||
      raw === undefined ||
      typeof raw === "number" ||
      typeof raw === "string" ||
      typeof raw === "boolean"
    ) {
      if (typeof raw === "number" && !Number.isFinite(raw)) {
        return { value: 0 };
      }
      return { value: raw ?? null };
    }
    return { value: JSON.stringify(raw) };
  } catch (err) {
    return {
      value: null,
      error: err instanceof Error ? err.message : "Error evaluando fórmula",
    };
  }
}

export function formatComputedValue(
  value: FormulaPrimitive,
  format?: "number" | "currency" | "percent" | "text",
  unit?: string,
): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string") return unit ? `${value} ${unit}` : value;

  if (!Number.isFinite(value)) return "—";

  if (format === "currency") {
    const formatted = new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 2,
    }).format(value);
    return unit && unit !== "MXN" && unit !== "$" ? `${formatted} ${unit}` : formatted;
  }

  if (format === "percent") {
    const pct = Math.abs(value) <= 1 ? value * 100 : value;
    return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(pct)}%`;
  }

  const formattedNum = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 2,
  }).format(value);
  return unit ? `${formattedNum} ${unit}` : formattedNum;
}
