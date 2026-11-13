#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/src-tauri/target"
MAX_TARGET_MB="${XOOK_MAX_TARGET_MB:-3072}"

MODE="safe"
for arg in "$@"; do
  case "$arg" in
    --auto) MODE="auto" ;;
    --debug) MODE="debug" ;;
    --all) MODE="all" ;;
    --check) MODE="check" ;;
    -h|--help)
      cat <<'EOF'
Uso: bash scripts/clean-workspace.sh [--check | --auto | --debug | --all]
  (sin flags)  Limpia cachés ligeras (.DS_Store, __pycache__, .pytest_cache).
  --check      Solo reporta tamaño actual del workspace y src-tauri/target.
  --auto       Limpia cachés ligeras y borra src-tauri/target/debug si target > XOOK_MAX_TARGET_MB (3072 MB).
  --debug      Limpia cachés ligeras y borra src-tauri/target/debug (conserva release).
  --all        Limpia cachés ligeras, dist/ y ejecuta cargo clean completo en src-tauri.
EOF
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg" >&2
      exit 1
      ;;
  esac
done

dir_size_mb() {
  local p="$1"
  if [[ -d "$p" ]]; then
    du -sm "$p" | awk '{print $1}'
  else
    echo 0
  fi
}

print_summary() {
  local label="$1"
  echo "[$label] Workspace: $(du -sh "$ROOT_DIR" | awk '{print $1}') | src-tauri/target: $([[ -d "$TARGET_DIR" ]] && du -sh "$TARGET_DIR" | awk '{print $1}' || echo '0B')"
}

print_summary "antes"

if [[ "$MODE" == "check" ]]; then
  exit 0
fi

# 1. Limpieza segura de archivos/cachés regenerables sin tocar .git, node_modules, .venv ni target
# Nota: usamos -exec rm en lugar de -delete porque en macOS/BSD find, -delete activa -depth e invalida -prune.
find "$ROOT_DIR" \
  \( -path "$ROOT_DIR/.git" -o -path "$ROOT_DIR/node_modules" -o -path "$ROOT_DIR/src-brain/.venv" -o -path "$TARGET_DIR" \) -prune \
  -o \( -name ".DS_Store" -type f -exec rm -f {} + \) \
  -o \( -name "__pycache__" -type d -prune -exec rm -rf {} + \) \
  -o \( -name ".pytest_cache" -type d -prune -exec rm -rf {} + \)

# 2. Limpieza de artefactos Rust según el modo
if [[ "$MODE" == "all" || "$MODE" == "debug" || "$MODE" == "auto" ]]; then
  if pgrep -f "Xook/node_modules/.bin/tauri dev" >/dev/null 2>&1 \
    || pgrep -f "target/debug/xook" >/dev/null 2>&1 \
    || pgrep -f "cargo.*(build|run|test)" >/dev/null 2>&1; then
    echo "[aviso] Hay una compilación o 'tauri dev' activa; cierra 'tauri dev' antes de limpiar src-tauri/target."
    print_summary "después"
    exit 0
  fi
fi

if [[ "$MODE" == "all" ]]; then
  rm -rf "$ROOT_DIR/dist"
  if [[ -f "$ROOT_DIR/src-tauri/Cargo.toml" ]]; then
    cargo clean --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml"
  fi
elif [[ "$MODE" == "debug" ]]; then
  rm -rf "$TARGET_DIR/debug"
elif [[ "$MODE" == "auto" ]]; then
  target_mb="$(dir_size_mb "$TARGET_DIR")"
  if (( target_mb > MAX_TARGET_MB )); then
    echo "[auto] src-tauri/target (${target_mb} MB) excede ${MAX_TARGET_MB} MB; limpiando debug..."
    rm -rf "$TARGET_DIR/debug"
  fi
fi

print_summary "después"
