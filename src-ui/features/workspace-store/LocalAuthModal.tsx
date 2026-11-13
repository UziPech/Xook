import React, { useEffect, useState } from "react";
import { CloudOff, LogOut, Store, UserCheck, X } from "lucide-react";
import {
  LocalUserProfile,
  clearLocalUserProfile,
  saveLocalUserProfile,
} from "./localStore";

interface LocalAuthModalProps {
  isOpen: boolean;
  user: LocalUserProfile | null;
  defaultStoreName?: string;
  onClose: () => void;
  onUserUpdated: (user: LocalUserProfile | null) => void;
}

const ROLE_OPTIONS = ["Administrador", "Compras / Stock", "Operaciones", "Dueño"];

export const LocalAuthModal: React.FC<LocalAuthModalProps> = ({
  isOpen,
  user,
  defaultStoreName = "Mi Tienda",
  onClose,
  onUserUpdated,
}) => {
  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState(defaultStoreName);
  const [role, setRole] = useState("Administrador");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(user?.name ?? "");
    setStoreName(user?.storeName ?? defaultStoreName);
    setRole(user?.role ?? "Administrador");
    setError(null);
  }, [isOpen, user, defaultStoreName]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Escribe tu nombre para personalizar tu sesión local.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveLocalUserProfile({
        name: name.trim(),
        storeName: storeName.trim() || defaultStoreName,
        role: role.trim() || "Administrador",
      });
      onUserUpdated(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el perfil.");
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setSaving(true);
    try {
      await clearLocalUserProfile();
      onUserUpdated(null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[#0b0d13] border border-white/10 shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-400/25 flex items-center justify-center">
              <UserCheck className="w-4 h-4 text-sky-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {user ? "Tu perfil local" : "Registro local en XOOK"}
              </h2>
              <p className="text-[11px] text-zinc-400">
                Guarda tu sesión y el historial de conversaciones en este equipo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.07] px-3 py-2.5 flex items-start gap-2.5 text-[11px] text-zinc-300 leading-relaxed">
            <CloudOff className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              <strong className="text-white">Modo local activo:</strong> tu cuenta e historial de chats
              se guardan directamente en tu dispositivo. La sincronización en la nube se podrá conectar
              después sin perder tus conversaciones.
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-zinc-300">
              Tu nombre
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Uziel Castillo"
              autoFocus
              className="w-full px-3.5 py-2 rounded-xl bg-black/50 border border-white/10 focus:border-sky-400/40 focus:outline-none text-sm text-white placeholder:text-zinc-600"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-zinc-300">
              Nombre del negocio o sucursal
            </label>
            <div className="relative">
              <Store className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="Mi Empresa"
                className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-black/50 border border-white/10 focus:border-sky-400/40 focus:outline-none text-sm text-white placeholder:text-zinc-600"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-zinc-300">
              Tu rol
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setRole(opt)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors cursor-pointer ${
                    role === opt
                      ? "bg-sky-500/15 border-sky-400/35 text-sky-200 font-medium"
                      : "bg-white/[0.02] border-white/[0.08] text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-[11.5px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="pt-1 flex items-center justify-between gap-2">
            {user ? (
              <button
                type="button"
                onClick={handleSignOut}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Salir de sesión local</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 rounded-xl text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                Ahora no
              </button>
            )}

            <button
              type="submit"
              disabled={saving}
              className="xook-approve-btn px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? "Guardando…" : user ? "Actualizar perfil" : "Crear perfil local"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

