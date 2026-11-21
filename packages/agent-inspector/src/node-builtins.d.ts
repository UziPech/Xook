declare module "node:fs" {
  export interface Stats {
    size: number;
    mtimeMs: number;
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function existsSync(path: string): boolean;
  export function statSync(path: string): Stats;
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function openSync(path: string, flags: string): number;
  export function readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ): number;
  export function closeSync(fd: number): void;
  export function watchFile(
    path: string,
    options: { interval?: number },
    listener: (curr: Stats, prev: Stats) => void
  ): void;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function basename(path: string, suffix?: string): string;
  export function dirname(path: string): string;
}

declare module "node:process" {
  const proc: {
    argv: string[];
    cwd(): string;
    env: Record<string, string | undefined>;
    exit(code?: number): never;
    stdout: { write(chunk: string): boolean };
    stderr: { write(chunk: string): boolean };
    on(event: string, listener: () => void): void;
  };
  export default proc;
}

declare class TextDecoder {
  constructor(label?: string);
  decode(input?: Uint8Array): string;
}

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
