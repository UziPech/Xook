import React, { useEffect, useState } from "react";
import { isTauriRuntime } from "./aiClient";

// Espejo de `secret_store::StorageStatus` (Rust).
type SecretStorageStatus =
  | { kind: "secure"; backend: "keychain" | "credential_manager" | "secret_service" | string }
  | { kind: "sessionOnly"; reason: string };

const BACKEND_LABELS: Record<string, string> = {
  keychain: "en el Llavero de macOS",
  credential_manager: "en el Administrador de credenciales de Windows",
  secret_service: "en el llavero del sistema",
};

const NEVER_SENT = "Nunca se envían en prompts ni al historial.";

/** Pie de Ajustes: dónde quedan guardadas las claves en este equipo. */
export const SecretStorageNote: React.FC = () => {
  const [status, setStatus] = useState<SecretStorageStatus | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const next = await invoke<SecretStorageStatus>("get_secret_storage_status");
        if (!cancelled) setStatus(next);
      } catch {
        // Sin estado se muestra el texto genérico.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status?.kind === "sessionOnly") {
    return (
      <span className="text-amber-300/80" title={status.reason}>
        Tus claves se guardan solo durante esta sesión: este equipo no tiene un llavero disponible.
      </span>
    );
  }
  if (status?.kind === "secure") {
    const where = BACKEND_LABELS[status.backend] ?? "en el almacén seguro del sistema";
    return (
      <span>
        Tus claves se guardan {where}. {NEVER_SENT}
      </span>
    );
  }
  return <span>Las claves nunca se envían en prompts ni al historial.</span>;
};
