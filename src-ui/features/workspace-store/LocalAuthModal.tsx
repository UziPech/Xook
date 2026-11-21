import React, { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  Check,
  ChevronDown,
  ChevronUp,
  Crown,
  Loader2,
  LogOut,
  Package,
  Shield,
  Sparkles,
  Store,
  Trash2,
  User,
  X,
  Zap,
} from "lucide-react";
import { JellyPillTrack } from "../../components/JellyPillTrack";
import { LiquidGlassBackdrop } from "../../components/LiquidGlassBackdrop";
import { waitTopLayerAnimations } from "../../utils/topLayerDialog";
import {
  LocalUserProfile,
  UserMemoryFact,
  clearLocalUserProfile,
  deleteUserMemoryFact,
  listUserMemoryFacts,
  saveLocalUserProfile,
  subscribeUserMemoryUpdated,
} from "./localStore";

interface LocalAuthModalProps {
  isOpen: boolean;
  user: LocalUserProfile | null;
  defaultStoreName?: string;
  onClose: () => void;
  onUserUpdated: (user: LocalUserProfile | null) => void;
}

interface RoleItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ROLES: RoleItem[] = [
  { id: "Administrador", icon: Shield },
  { id: "Compras / Stock", icon: Package },
  { id: "Operaciones", icon: Zap },
  { id: "Dueño", icon: Crown },
];

const MEMORY_CATEGORY_LABELS: Record<string, string> = {
  identity: "Identidad",
  preference: "Preferencia",
  work: "Trabajo",
  contact: "Contacto",
  routine: "Rutina",
  project: "Proyecto",
  other: "Dato",
};

function getInitials(name: string): string {
  const clean = name.trim().replace(/[^\p{L}\s]/gu, "");
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "XO";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const LocalAuthModal: React.FC<LocalAuthModalProps> = ({
  isOpen,
  user,
  defaultStoreName = "Mi Tienda",
  onClose,
  onUserUpdated,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const closeSeqRef = useRef(0);
  const pressedOutsideRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const onCloseRef = useRef(onClose);
  isOpenRef.current = isOpen;
  onCloseRef.current = onClose;

  const [dialogRendered, setDialogRendered] = useState(isOpen);
  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState(defaultStoreName);
  const [role, setRole] = useState("Administrador");
  const [occupation, setOccupation] = useState("");
  const [memoryFacts, setMemoryFacts] = useState<UserMemoryFact[]>([]);
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [showMemoryList, setShowMemoryList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const titleId = useId();
  const nameInputId = useId();
  const storeInputId = useId();
  const occupationInputId = useId();
  const shouldRenderBody = isOpen || dialogRendered;

  useEffect(() => {
    if (!isOpen) return;
    setName(user?.name ?? "");
    setStoreName(user?.storeName ?? defaultStoreName);
    setRole(user?.role ?? "Administrador");
    setOccupation(user?.occupation ?? "");
    setError(null);
    setConfirmSignOut(false);

    let disposed = false;
    let unsubMem: (() => void) | null = null;
    setLoadingMemory(true);
    void listUserMemoryFacts()
      .then((facts) => {
        if (!disposed) setMemoryFacts(facts);
      })
      .catch(() => {})
      .finally(() => {
        if (!disposed) setLoadingMemory(false);
      });

    void subscribeUserMemoryUpdated(() => {
      void listUserMemoryFacts()
        .then((facts) => {
          if (!disposed) setMemoryFacts(facts);
        })
        .catch(() => {});
    }).then((fn) => {
      if (disposed) fn();
      else unsubMem = fn;
    });

    return () => {
      disposed = true;
      unsubMem?.();
    };
  }, [isOpen, user, defaultStoreName]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      closeSeqRef.current += 1;
      dialog.removeAttribute("data-closing");
      setDialogRendered(true);
      if (!dialog.open) {
        dialog.showModal();
      }
      const focusTimer = window.setTimeout(() => {
        nameInputRef.current?.focus({ preventScroll: true });
      }, 90);
      return () => window.clearTimeout(focusTimer);
    }

    if (!dialog.open) {
      setDialogRendered(false);
      return;
    }

    const seq = ++closeSeqRef.current;
    void (async () => {
      dialog.setAttribute("data-closing", "");
      await waitTopLayerAnimations(dialog, 240);
      if (closeSeqRef.current !== seq) return;
      dialog.removeAttribute("data-closing");
      if (dialog.open) dialog.close();
      setDialogRendered(false);
    })();
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Escribe tu nombre para guardar tu perfil.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveLocalUserProfile({
        name: name.trim(),
        storeName: storeName.trim() || defaultStoreName,
        role: role.trim() || "Administrador",
        occupation: occupation.trim(),
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

  const handleForgetFact = async (id: string) => {
    try {
      const remaining = await deleteUserMemoryFact(id, "settings");
      setMemoryFacts(remaining);
    } catch {
      // Ignora error puntual al olvidar
    }
  };

  const initials = getInitials(name || user?.name || "XO");
  const ActiveRoleIcon = ROLES.find((r) => r.id === role)?.icon ?? Shield;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: "any" } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = "";
        }
        if (isOpenRef.current) {
          onCloseRef.current();
        }
      }}
      onPointerDown={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
        const r = dialog.getBoundingClientRect();
        pressedOutsideRef.current =
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom;
      }}
      onPointerUp={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
        const r = dialog.getBoundingClientRect();
        const releasedOutside =
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom;
        if (pressedOutsideRef.current && releasedOutside) {
          onCloseRef.current();
        }
        pressedOutsideRef.current = false;
      }}
      className="xook-profile-dialog select-none"
    >
      {shouldRenderBody && (
        <>
          <LiquidGlassBackdrop variant="menu" />

          {/* Capas difuminadas en tonos obsidiana-grafito dentro de la card */}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none overflow-hidden rounded-[inherit]"
          >
            <div className="absolute -top-16 -left-14 w-64 h-44 rounded-full bg-zinc-400/[0.045] blur-3xl" />
            <div className="absolute -bottom-16 -right-12 w-60 h-44 rounded-full bg-zinc-600/[0.04] blur-3xl" />
          </div>

          {/* Cabecera */}
          <header className="relative z-[1] px-5 pt-5 pb-4 flex items-center justify-between gap-3 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* Avatar circular en Liquid Glass monocromático */}
              <div className="xook-profile-avatar-glass w-12 h-12 shrink-0 flex items-center justify-center select-none">
                <span className="relative z-10 font-semibold text-sm text-white tracking-wider">
                  {initials}
                </span>
              </div>

              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="text-sm font-semibold text-white tracking-tight"
                >
                  {user ? "Perfil local" : "Crear perfil local"}
                </h2>
                <p className="text-[11.5px] text-zinc-400 mt-0.5 flex items-center gap-1.5 min-w-0">
                  <Store className="w-3 h-3 text-zinc-500 shrink-0" />
                  <span className="truncate">{storeName.trim() || defaultStoreName}</span>
                  <span className="text-zinc-600 shrink-0">·</span>
                  <ActiveRoleIcon className="w-3 h-3 text-zinc-500 shrink-0" />
                  <span className="shrink-0">{role}</span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </header>

          {/* Formulario */}
          <form
            onSubmit={handleSubmit}
            className="relative z-[1] p-5 space-y-4 max-h-[calc(85vh-5rem)] overflow-y-auto"
          >
            {/* Nombre */}
            <div className="space-y-1.5">
              <label
                htmlFor={nameInputId}
                className="block text-xs font-medium text-zinc-300"
              >
                Nombre
              </label>
              <div className="relative group">
                <User className="w-3.5 h-3.5 text-zinc-500 group-focus-within:text-zinc-200 transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={nameInputRef}
                  id={nameInputId}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tu nombre"
                  autoFocus
                  className="xook-profile-input w-full pl-9 pr-3.5 py-2.5 rounded-xl text-sm text-white placeholder:text-zinc-600"
                />
              </div>
            </div>

            {/* Negocio o sucursal */}
            <div className="space-y-1.5">
              <label
                htmlFor={storeInputId}
                className="block text-xs font-medium text-zinc-300"
              >
                Negocio o sucursal
              </label>
              <div className="relative group">
                <Store className="w-3.5 h-3.5 text-zinc-500 group-focus-within:text-zinc-200 transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id={storeInputId}
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="Nombre del negocio"
                  className="xook-profile-input w-full pl-9 pr-3.5 py-2.5 rounded-xl text-sm text-white placeholder:text-zinc-600"
                />
              </div>
            </div>

            {/* Ocupación o contexto opcional */}
            <div className="space-y-1.5">
              <label
                htmlFor={occupationInputId}
                className="block text-xs font-medium text-zinc-300"
              >
                Ocupación o contexto <span className="text-zinc-500 font-normal">(opcional)</span>
              </label>
              <div className="relative group">
                <Briefcase className="w-3.5 h-3.5 text-zinc-500 group-focus-within:text-zinc-200 transition-colors absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id={occupationInputId}
                  type="text"
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                  placeholder="Ej. Diseño, desarrollo de software, retail..."
                  className="xook-profile-input w-full pl-9 pr-3.5 py-2.5 rounded-xl text-sm text-white placeholder:text-zinc-600"
                />
              </div>
            </div>

            {/* Selector de Rol con iconos monocromáticos y píldora deslizante */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-300">
                Rol
              </label>
              <JellyPillTrack
                activeKey={role}
                role="radiogroup"
                aria-label="Rol"
                pillRadius="0.625rem"
                variant="quick"
                className="xook-profile-role-track flex flex-wrap items-center gap-1 p-1 rounded-xl"
              >
                {ROLES.map(({ id, icon: RoleIcon }) => {
                  const isSelected = role === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      data-jelly-active={isSelected ? "true" : undefined}
                      onClick={() => setRole(id)}
                      className={`xook-jelly-tab flex-auto inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-[10px] text-[11.5px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        isSelected
                          ? "text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <RoleIcon
                        className={`w-3 h-3 shrink-0 transition-colors ${
                          isSelected ? "text-zinc-100" : "text-zinc-500"
                        }`}
                      />
                      <span>{id}</span>
                    </button>
                  );
                })}
              </JellyPillTrack>
            </div>

            {/* Lo que recuerda Xox */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
              <button
                type="button"
                onClick={() => setShowMemoryList((prev) => !prev)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
              >
                <span className="inline-flex items-center gap-2 text-xs font-medium text-zinc-200">
                  <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Lo que recuerda Xox</span>
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/[0.07] text-zinc-300">
                    {loadingMemory ? "..." : memoryFacts.length}
                  </span>
                </span>
                {showMemoryList ? (
                  <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                )}
              </button>

              {showMemoryList && (
                <div className="border-t border-white/[0.06] px-3 py-2.5 max-h-40 overflow-y-auto space-y-1.5">
                  {memoryFacts.length === 0 ? (
                    <p className="text-[11.5px] text-zinc-500 py-1">
                      Xox aún no ha guardado datos personales entre tus sesiones. Cuando le cuentes cómo trabajas o qué prefieres, aparecerá aquí.
                    </p>
                  ) : (
                    memoryFacts.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-2 rounded-lg px-2.5 py-1.5 bg-white/[0.03] border border-white/[0.04]"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="inline-block text-[10px] uppercase tracking-wider text-zinc-400 mr-1.5">
                            {MEMORY_CATEGORY_LABELS[item.category] ?? "Dato"}
                          </span>
                          <p className="text-[11.5px] text-zinc-200 leading-snug select-text break-words">
                            {item.value}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleForgetFact(item.id)}
                          aria-label="Olvidar dato"
                          title="Olvidar este dato"
                          className="p-1 rounded-md text-zinc-500 hover:text-rose-300 hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Pie de acciones */}
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-3">
              {user ? (
                confirmSignOut ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmSignOut(false)}
                      autoFocus
                      className="px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white bg-white/[0.06] hover:bg-white/[0.1] transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      disabled={saving}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-500/20 text-rose-200 border border-rose-500/30 hover:bg-rose-500/30 transition-colors cursor-pointer"
                    >
                      Confirmar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmSignOut(true)}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Salir de sesión</span>
                  </button>
                )
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim()}
                  className="xook-profile-save-btn px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>{user ? "Guardar cambios" : "Crear perfil"}</span>
                </button>
              </div>
            </div>
          </form>
        </>
      )}
    </dialog>
  );
};
