export interface GlobalXoxProfile {
  agentName: string;
  activeRole: string;
  personality: string;
  toneTags: string[];
  initialInstructions: string;
  globalRules: string[];
  likes: string[];
  workflows: string[];
  donts: string[];
  accentPreset: string;
  updatedAt: string;
}

export type SaveGlobalXoxProfilePayload = Partial<Omit<GlobalXoxProfile, "updatedAt">>;

export interface XoxSkillEntry {
  slug: string;
  name: string;
  description: string;
  role: string;
  domain: string;
  scope: "global" | "workspace" | "builtin" | string;
  relPath: string;
  enabled: boolean;
  source: string;
  updatedAt: string;
  rawMarkdown: string;
}

export interface SaveXoxSkillPayload {
  scope?: "global" | "workspace";
  slug?: string;
  name: string;
  rawMarkdown: string;
}

export interface OfficialSkillCandidate {
  id: string;
  source: string;
  publisher: string;
  skill_id: string;
  name: string;
  installs: number;
  skills_sh_url: string;
}

export interface DiscoverOfficialSkillsResult {
  ok: boolean;
  query?: string;
  official_publishers?: string[];
  results?: OfficialSkillCandidate[];
  filtered_unofficial_count?: number;
  error?: string;
}

export const DEFAULT_GLOBAL_XOX_PROFILE: GlobalXoxProfile = {
  agentName: "Xox",
  activeRole: "Asistente Co-Constructor",
  personality: "Cercano, claro, práctico y directo.",
  toneTags: ["Cercano", "Directo", "Práctico"],
  initialInstructions: "",
  globalRules: [],
  likes: [],
  workflows: [],
  donts: [],
  accentPreset: "classic",
  updatedAt: "",
};

const PREVIEW_PROFILE_KEY = "xook.global_xox_profile.v1";
const PREVIEW_SKILLS_KEY = "xook.global_xox_skills.v1";

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

function readPreviewProfile(): GlobalXoxProfile {
  try {
    const raw = localStorage.getItem(PREVIEW_PROFILE_KEY);
    if (!raw) return { ...DEFAULT_GLOBAL_XOX_PROFILE };
    return { ...DEFAULT_GLOBAL_XOX_PROFILE, ...(JSON.parse(raw) as Partial<GlobalXoxProfile>) };
  } catch {
    return { ...DEFAULT_GLOBAL_XOX_PROFILE };
  }
}

function readPreviewSkills(): XoxSkillEntry[] {
  try {
    const raw = localStorage.getItem(PREVIEW_SKILLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as XoxSkillEntry[]) : [];
  } catch {
    return [];
  }
}

export async function getGlobalXoxProfile(): Promise<GlobalXoxProfile> {
  if (!isTauriRuntime()) {
    return readPreviewProfile();
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GlobalXoxProfile>("get_global_xox_profile_cmd");
}

export async function saveGlobalXoxProfile(
  payload: SaveGlobalXoxProfilePayload
): Promise<GlobalXoxProfile> {
  if (!isTauriRuntime()) {
    const next: GlobalXoxProfile = {
      ...readPreviewProfile(),
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(PREVIEW_PROFILE_KEY, JSON.stringify(next));
    } catch {
      // Ignorar si no hay almacenamiento
    }
    return next;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<GlobalXoxProfile>("save_global_xox_profile_cmd", { payload });
}

export async function listXoxSkills(): Promise<XoxSkillEntry[]> {
  if (!isTauriRuntime()) {
    return readPreviewSkills();
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<XoxSkillEntry[]>("list_xox_skills_cmd");
}

export async function saveXoxSkill(payload: SaveXoxSkillPayload): Promise<XoxSkillEntry> {
  if (!isTauriRuntime()) {
    const slug = (payload.slug || payload.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "habilidad";
    const entry: XoxSkillEntry = {
      slug,
      name: payload.name,
      description: "",
      role: "",
      domain: "general",
      scope: payload.scope || "global",
      relPath: `global:xox-skills/${slug}/SKILL.md`,
      enabled: !/enabled:\s*false/i.test(payload.rawMarkdown),
      source: "learned-from-user",
      updatedAt: new Date().toISOString(),
      rawMarkdown: payload.rawMarkdown,
    };
    const next = [...readPreviewSkills().filter((s) => s.slug !== slug), entry];
    try {
      localStorage.setItem(PREVIEW_SKILLS_KEY, JSON.stringify(next));
    } catch {
      // Ignorar
    }
    return entry;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<XoxSkillEntry>("save_xox_skill_cmd", { payload });
}

export async function deleteXoxSkill(scope: string, slug: string): Promise<void> {
  if (!isTauriRuntime()) {
    const next = readPreviewSkills().filter((s) => !(s.slug === slug && s.scope === scope));
    try {
      localStorage.setItem(PREVIEW_SKILLS_KEY, JSON.stringify(next));
    } catch {
      // Ignorar
    }
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("delete_xox_skill_cmd", { payload: { scope, slug } });
}

export async function discoverOfficialSkills(
  query: string,
  limit = 8
): Promise<DiscoverOfficialSkillsResult> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      error: "La búsqueda de habilidades oficiales requiere la app de escritorio.",
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DiscoverOfficialSkillsResult>("discover_official_skills_cmd", {
    query,
    limit,
  });
}

export async function installOfficialSkill(
  source: string,
  skillId: string,
  scope: "global" | "workspace" = "global",
  localSlug?: string
): Promise<{ ok: boolean; slug?: string; error?: string }> {
  if (!isTauriRuntime()) {
    return { ok: false, error: "La instalación requiere la app de escritorio." };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("install_official_skill_cmd", {
    source,
    skillId,
    scope,
    localSlug: localSlug || null,
  });
}

export async function subscribeGlobalXoxProfile(
  onProfileUpdated: (profile: GlobalXoxProfile) => void
): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<GlobalXoxProfile>("xox-profile-updated", (event) => {
    if (event.payload) {
      onProfileUpdated(event.payload);
    }
  });
}
