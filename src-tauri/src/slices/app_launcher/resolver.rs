use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,
    pub display_name: String,
    pub fs_name: String,
    pub bundle_id: Option<String>,
    pub app_path: String,
    pub aliases: Vec<String>,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum AppResolution {
    Resolved {
        app: InstalledApp,
    },
    Ambiguous {
        query: String,
        candidates: Vec<InstalledApp>,
    },
    NotFound {
        query: String,
        suggestions: Vec<InstalledApp>,
    },
    InvalidTarget {
        query: String,
        reason: String,
    },
}

#[derive(Debug, Clone)]
pub struct AppScanRoot {
    pub path: PathBuf,
    pub category: String,
}

pub fn default_app_roots() -> Vec<AppScanRoot> {
    let mut roots = Vec::new();
    #[cfg(target_os = "macos")]
    {
        roots.push(AppScanRoot {
            path: PathBuf::from("/Applications"),
            category: "applications".to_string(),
        });
        if let Some(home) = std::env::var_os("HOME") {
            roots.push(AppScanRoot {
                path: PathBuf::from(home).join("Applications"),
                category: "user".to_string(),
            });
        }
        roots.push(AppScanRoot {
            path: PathBuf::from("/System/Applications"),
            category: "system".to_string(),
        });
        roots.push(AppScanRoot {
            path: PathBuf::from("/System/Applications/Utilities"),
            category: "utilities".to_string(),
        });
    }
    roots
}

pub fn extra_known_system_bundles() -> Vec<(PathBuf, &'static str)> {
    #[cfg(target_os = "macos")]
    {
        vec![(
            PathBuf::from("/System/Library/CoreServices/Finder.app"),
            "system",
        )]
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

pub fn validate_app_query(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Debes indicar el nombre de la aplicación que deseas abrir.".to_string());
    }
    if trimmed.len() > 140 {
        return Err("El nombre de la aplicación es demasiado largo.".to_string());
    }
    if trimmed
        .chars()
        .any(|c| c.is_control() || c == '\0')
    {
        return Err("El nombre de la aplicación contiene caracteres de control inválidos.".to_string());
    }
    if trimmed.starts_with('-') {
        return Err("No se permiten banderas ni opciones en el nombre de la aplicación.".to_string());
    }
    if trimmed.contains("://")
        || trimmed.to_ascii_lowercase().starts_with("mailto:")
        || trimmed.to_ascii_lowercase().starts_with("javascript:")
    {
        return Err("Solo se permite abrir aplicaciones instaladas, no URLs ni enlaces.".to_string());
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed.starts_with('~')
    {
        return Err("Indica el nombre de la aplicación (no rutas arbitrarias del sistema).".to_string());
    }
    Ok(trimmed.to_string())
}

fn fold_diacritic(ch: char) -> char {
    match ch {
        'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' | 'Á' | 'À' | 'Ä' | 'Â' | 'Ã' | 'Å' => 'a',
        'é' | 'è' | 'ë' | 'ê' | 'É' | 'È' | 'Ë' | 'Ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' | 'Í' | 'Ì' | 'Ï' | 'Î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' | 'ø' | 'Ó' | 'Ò' | 'Ö' | 'Ô' | 'Õ' | 'Ø' => 'o',
        'ú' | 'ù' | 'ü' | 'û' | 'Ú' | 'Ù' | 'Ü' | 'Û' => 'u',
        'ñ' | 'Ñ' => 'n',
        'ç' | 'Ç' => 'c',
        _ => ch,
    }
}

pub fn normalize_app_token(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if s.len() > 4 && s[s.len() - 4..].eq_ignore_ascii_case(".app") {
        s.truncate(s.len() - 4);
    }
    let lowered: String = s
        .chars()
        .map(fold_diacritic)
        .flat_map(|c| c.to_lowercase())
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    let mut normalized = lowered.split_whitespace().collect::<Vec<_>>().join(" ");
    for prefix in ["la app de ", "app de ", "aplicacion de ", "la app ", "app ", "aplicacion "] {
        if let Some(rest) = normalized.strip_prefix(prefix) {
            if !rest.is_empty() {
                normalized = rest.to_string();
                break;
            }
        }
    }
    normalized
}

fn known_aliases(bundle_id: Option<&str>, fs_name: &str, display_name: &str) -> Vec<String> {
    let bid = bundle_id.unwrap_or("").to_ascii_lowercase();
    let fs_norm = normalize_app_token(fs_name);
    let disp_norm = normalize_app_token(display_name);

    let table: &[(&str, &str, &[&str])] = &[
        ("com.apple.notes", "notes", &["notas", "nota", "notes", "apple notes", "bloc de notas"]),
        ("com.apple.ical", "calendar", &["calendario", "calendar", "ical", "agenda apple"]),
        ("com.apple.reminders", "reminders", &["recordatorios", "recordatorio", "reminders"]),
        ("com.apple.calculator", "calculator", &["calculadora", "calculator"]),
        ("com.apple.clock", "clock", &["reloj", "clock", "alarmas"]),
        (
            "com.apple.systempreferences",
            "system settings",
            &[
                "ajustes del sistema",
                "ajustes",
                "configuracion",
                "preferencias del sistema",
                "preferencias",
                "system settings",
                "system preferences",
            ],
        ),
        ("com.apple.mail", "mail", &["correo", "mail", "apple mail"]),
        ("com.apple.mobilesms", "messages", &["mensajes", "messages", "imessage"]),
        ("com.apple.addressbook", "contacts", &["contactos", "contacts"]),
        ("com.apple.photos", "photos", &["fotos", "photos"]),
        ("com.apple.music", "music", &["musica", "music", "apple music"]),
        ("com.apple.maps", "maps", &["mapas", "maps"]),
        ("com.apple.weather", "weather", &["clima", "tiempo", "weather"]),
        ("com.apple.stocks", "stocks", &["bolsa", "stocks"]),
        ("com.apple.voicememos", "voice memos", &["notas de voz", "grabadora", "voice memos"]),
        ("com.apple.preview", "preview", &["vista previa", "preview"]),
        (
            "com.apple.activitymonitor",
            "activity monitor",
            &["monitor de actividad", "activity monitor"],
        ),
        ("com.apple.diskutility", "disk utility", &["utilidad de discos", "disk utility"]),
        ("com.apple.terminal", "terminal", &["terminal"]),
        ("com.apple.finder", "finder", &["finder", "explorador", "archivos de mac"]),
        ("com.apple.safari", "safari", &["safari"]),
        ("com.apple.appstore", "app store", &["app store"]),
        ("com.apple.ibooksx", "books", &["libros", "books"]),
        ("com.apple.freeform", "freeform", &["freeform"]),
        ("com.apple.facetime", "facetime", &["facetime"]),
        ("com.apple.home", "home", &["casa", "home"]),
        ("com.apple.shortcuts", "shortcuts", &["atajos", "shortcuts"]),
        ("com.apple.textedit", "textedit", &["textedit", "editor de texto"]),
        ("com.apple.dictionary", "dictionary", &["diccionario", "dictionary"]),
        (
            "com.apple.screenshot.launcher",
            "screenshot",
            &["captura de pantalla", "captura", "screenshot"],
        ),
        ("com.microsoft.vscode", "visual studio code", &["vscode", "vs code", "code"]),
        ("com.microsoft.excel", "microsoft excel", &["excel"]),
        ("com.microsoft.word", "microsoft word", &["word"]),
        ("com.microsoft.powerpoint", "microsoft powerpoint", &["powerpoint"]),
        ("com.google.chrome", "google chrome", &["chrome", "google chrome"]),
    ];

    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for &(entry_bid, entry_fs, aliases) in table {
        if (!bid.is_empty() && bid == entry_bid) || fs_norm == entry_fs || disp_norm == entry_fs {
            for alias in aliases {
                let norm = normalize_app_token(alias);
                if !norm.is_empty() && seen.insert(norm.clone()) {
                    out.push((*alias).to_string());
                }
            }
        }
    }
    out
}

fn is_app_bundle_dir(path: &Path) -> bool {
    path.is_dir()
        && path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("app"))
            .unwrap_or(false)
}

#[derive(Debug, Default, Clone)]
struct BundleMeta {
    bundle_id: Option<String>,
    display_name: Option<String>,
}

fn strip_mdls_value(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "(null)" {
        return None;
    }
    if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2 {
        let inner = &trimmed[1..trimmed.len() - 1];
        let unescaped = inner.replace("\\\"", "\"").replace("\\\\", "\\");
        let cleaned = unescaped.trim().to_string();
        return if cleaned.is_empty() {
            None
        } else {
            Some(cleaned)
        };
    }
    Some(trimmed.to_string())
}

#[cfg(target_os = "macos")]
fn batch_mdls_metadata(paths: &[PathBuf]) -> HashMap<PathBuf, BundleMeta> {
    let mut map = HashMap::new();
    if paths.is_empty() {
        return map;
    }
    for chunk in paths.chunks(60) {
        let mut cmd = Command::new("/usr/bin/mdls");
        cmd.args([
            "-name",
            "kMDItemCFBundleIdentifier",
            "-name",
            "kMDItemDisplayName",
            "-name",
            "kMDItemFSName",
        ]);
        for p in chunk {
            cmd.arg(p);
        }
        let Ok(output) = cmd.output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() != chunk.len() * 3 {
            continue;
        }
        for (idx, path) in chunk.iter().enumerate() {
            let block = &lines[idx * 3..(idx + 1) * 3];
            let mut meta = BundleMeta::default();
            let mut mdls_fs_name: Option<String> = None;
            for line in block {
                if let Some((k, v)) = line.split_once('=') {
                    let key = k.trim();
                    let val = strip_mdls_value(v);
                    match key {
                        "kMDItemCFBundleIdentifier" => meta.bundle_id = val,
                        "kMDItemDisplayName" => meta.display_name = val,
                        "kMDItemFSName" => mdls_fs_name = val,
                        _ => {}
                    }
                }
            }
            if let Some(ref fs_expected) = mdls_fs_name {
                let actual = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if actual != fs_expected {
                    continue;
                }
            }
            map.insert(path.clone(), meta);
        }
    }
    map
}

#[cfg(not(target_os = "macos"))]
fn batch_mdls_metadata(_paths: &[PathBuf]) -> HashMap<PathBuf, BundleMeta> {
    HashMap::new()
}

fn read_info_plist_meta(app_dir: &Path) -> BundleMeta {
    let plist_path = app_dir.join("Contents/Info.plist");
    if !plist_path.is_file() {
        return BundleMeta::default();
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("/usr/bin/plutil")
            .args(["-convert", "json", "-o", "-"])
            .arg(&plist_path)
            .output()
        {
            if output.status.success() {
                if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                    let bundle_id = val
                        .get("CFBundleIdentifier")
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                    let display_name = val
                        .get("CFBundleDisplayName")
                        .or_else(|| val.get("CFBundleName"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                    return BundleMeta {
                        bundle_id,
                        display_name,
                    };
                }
            }
        }
    }

    let Ok(raw) = fs::read_to_string(&plist_path) else {
        return BundleMeta::default();
    };
    BundleMeta {
        bundle_id: extract_xml_plist_string(&raw, "CFBundleIdentifier"),
        display_name: extract_xml_plist_string(&raw, "CFBundleDisplayName")
            .or_else(|| extract_xml_plist_string(&raw, "CFBundleName")),
    }
}

fn extract_xml_plist_string(xml: &str, key: &str) -> Option<String> {
    let needle = format!("<key>{key}</key>");
    let start = xml.find(&needle)? + needle.len();
    let rest = &xml[start..];
    let str_open = rest.find("<string>")? + "<string>".len();
    let after_open = &rest[str_open..];
    let str_close = after_open.find("</string>")?;
    let val = after_open[..str_close].trim();
    if val.is_empty() {
        None
    } else {
        Some(val.to_string())
    }
}

pub fn discover_apps_in_roots(
    roots: &[AppScanRoot],
    extra_bundles: &[(PathBuf, &str)],
    use_os_spotlight: bool,
) -> Vec<InstalledApp> {
    let mut candidates: Vec<(PathBuf, String)> = Vec::new();
    let mut seen_paths: HashSet<PathBuf> = HashSet::new();

    for root in roots {
        if !root.path.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&root.path) else {
            continue;
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if is_app_bundle_dir(&entry_path) {
                let canonical = fs::canonicalize(&entry_path).unwrap_or(entry_path);
                if seen_paths.insert(canonical.clone()) {
                    candidates.push((canonical, root.category.clone()));
                }
                continue;
            }
            if entry_path.is_dir() {
                let Ok(sub_entries) = fs::read_dir(&entry_path) else {
                    continue;
                };
                for sub in sub_entries.flatten() {
                    let sub_path = sub.path();
                    if is_app_bundle_dir(&sub_path) {
                        let canonical = fs::canonicalize(&sub_path).unwrap_or(sub_path);
                        if seen_paths.insert(canonical.clone()) {
                            candidates.push((canonical, root.category.clone()));
                        }
                    }
                }
            }
        }
    }

    for (bundle_path, cat) in extra_bundles {
        if is_app_bundle_dir(bundle_path) {
            let canonical = fs::canonicalize(bundle_path).unwrap_or_else(|_| bundle_path.clone());
            if seen_paths.insert(canonical.clone()) {
                candidates.push((canonical, (*cat).to_string()));
            }
        }
    }

    let path_list: Vec<PathBuf> = candidates.iter().map(|(p, _)| p.clone()).collect();
    let mdls_map = if use_os_spotlight {
        batch_mdls_metadata(&path_list)
    } else {
        HashMap::new()
    };

    let mut apps = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for (app_path, category) in candidates {
        let fs_name = app_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if fs_name.is_empty() {
            continue;
        }

        let mut meta = mdls_map.get(&app_path).cloned().unwrap_or_default();
        if meta.bundle_id.is_none() || meta.display_name.is_none() {
            let plist_meta = read_info_plist_meta(&app_path);
            if meta.bundle_id.is_none() {
                meta.bundle_id = plist_meta.bundle_id;
            }
            if meta.display_name.is_none() {
                meta.display_name = plist_meta.display_name;
            }
        }

        let display_name = meta
            .display_name
            .map(|s| s.strip_suffix(".app").unwrap_or(&s).trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| fs_name.clone());

        let bundle_id = meta.bundle_id;
        let id = bundle_id
            .clone()
            .unwrap_or_else(|| normalize_app_token(&fs_name));

        if !seen_ids.insert(id.to_ascii_lowercase()) {
            continue;
        }

        let aliases = known_aliases(bundle_id.as_deref(), &fs_name, &display_name);

        apps.push(InstalledApp {
            id,
            display_name,
            fs_name,
            bundle_id,
            app_path: app_path.to_string_lossy().to_string(),
            aliases,
            category,
        });
    }

    apps.sort_by(|a, b| {
        a.display_name
            .to_ascii_lowercase()
            .cmp(&b.display_name.to_ascii_lowercase())
    });
    apps
}

pub fn discover_installed_apps() -> Vec<InstalledApp> {
    discover_apps_in_roots(&default_app_roots(), &extra_known_system_bundles(), true)
}

fn match_tier_for_app(app: &InstalledApp, raw_query: &str, query_norm: &str) -> Option<u8> {
    let raw_lower = raw_query.trim().to_ascii_lowercase();
    if let Some(ref bid) = app.bundle_id {
        if bid.to_ascii_lowercase() == raw_lower {
            return Some(4);
        }
    }

    let mut names = Vec::with_capacity(2 + app.aliases.len());
    names.push(normalize_app_token(&app.display_name));
    names.push(normalize_app_token(&app.fs_name));
    for alias in &app.aliases {
        names.push(normalize_app_token(alias));
    }

    if names.iter().any(|n| !n.is_empty() && n == query_norm) {
        return Some(3);
    }

    if query_norm.len() >= 2
        && names.iter().any(|n| {
            !n.is_empty()
                && (n.starts_with(query_norm)
                    || n.split_whitespace().any(|word| word == query_norm))
        })
    {
        return Some(2);
    }

    if query_norm.len() >= 3 && names.iter().any(|n| n.contains(query_norm)) {
        return Some(1);
    }

    None
}

fn suggestion_score(app: &InstalledApp, query_norm: &str) -> usize {
    let query_words: Vec<&str> = query_norm.split_whitespace().collect();
    if query_words.is_empty() {
        return 0;
    }
    let hay = format!(
        "{} {} {}",
        normalize_app_token(&app.display_name),
        normalize_app_token(&app.fs_name),
        app.aliases
            .iter()
            .map(|a| normalize_app_token(a))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let mut score = 0usize;
    for w in &query_words {
        if w.len() >= 2 && hay.contains(w) {
            score += w.len() * 4;
        } else if w.len() >= 3 && hay.contains(&w[..3]) {
            score += 3;
        }
    }
    score
}

pub fn resolve_app_in_catalog(catalog: &[InstalledApp], raw_query: &str) -> AppResolution {
    let validated = match validate_app_query(raw_query) {
        Ok(q) => q,
        Err(reason) => {
            return AppResolution::InvalidTarget {
                query: raw_query.to_string(),
                reason,
            };
        }
    };

    let query_norm = normalize_app_token(&validated);
    if query_norm.is_empty() {
        return AppResolution::InvalidTarget {
            query: raw_query.to_string(),
            reason: "No se pudo interpretar el nombre de la aplicación.".to_string(),
        };
    }

    let mut best_tier: u8 = 0;
    let mut matches: Vec<InstalledApp> = Vec::new();

    for app in catalog {
        if let Some(tier) = match_tier_for_app(app, &validated, &query_norm) {
            if tier > best_tier {
                best_tier = tier;
                matches.clear();
                matches.push(app.clone());
            } else if tier == best_tier {
                matches.push(app.clone());
            }
        }
    }

    if matches.len() == 1 {
        return AppResolution::Resolved {
            app: matches.into_iter().next().unwrap(),
        };
    }
    if matches.len() > 1 {
        matches.truncate(8);
        return AppResolution::Ambiguous {
            query: validated,
            candidates: matches,
        };
    }

    let mut scored: Vec<(usize, InstalledApp)> = catalog
        .iter()
        .filter_map(|app| {
            let s = suggestion_score(app, &query_norm);
            if s > 0 {
                Some((s, app.clone()))
            } else {
                None
            }
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.display_name.cmp(&b.1.display_name)));
    let suggestions = scored.into_iter().take(5).map(|(_, app)| app).collect();

    AppResolution::NotFound {
        query: validated,
        suggestions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_fake_bundle(root: &Path, name: &str, bundle_id: &str, display_name: &str) {
        let contents = root.join(format!("{name}.app")).join("Contents");
        fs::create_dir_all(&contents).unwrap();
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>{bundle_id}</string>
<key>CFBundleName</key><string>{name}</string>
<key>CFBundleDisplayName</key><string>{display_name}</string>
</dict></plist>"#
        );
        fs::write(contents.join("Info.plist"), plist).unwrap();
    }

    #[test]
    fn resolves_spanish_and_english_names_without_spotlight() {
        let tmp = std::env::temp_dir().join(format!(
            "xook_app_resolver_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(1)
        ));
        let sys_dir = tmp.join("SystemApps");
        let apps_dir = tmp.join("Apps");
        fs::create_dir_all(&sys_dir).unwrap();
        fs::create_dir_all(&apps_dir).unwrap();

        make_fake_bundle(&sys_dir, "Notes", "com.apple.Notes", "Notas");
        make_fake_bundle(&sys_dir, "Calendar", "com.apple.iCal", "Calendario");
        make_fake_bundle(&sys_dir, "VoiceMemos", "com.apple.VoiceMemos", "Notas de Voz");
        make_fake_bundle(&apps_dir, "Microsoft Word", "com.microsoft.Word", "Microsoft Word");
        make_fake_bundle(&apps_dir, "Microsoft Excel", "com.microsoft.Excel", "Microsoft Excel");

        let catalog = discover_apps_in_roots(
            &[
                AppScanRoot {
                    path: sys_dir,
                    category: "system".to_string(),
                },
                AppScanRoot {
                    path: apps_dir,
                    category: "applications".to_string(),
                },
            ],
            &[],
            false,
        );
        assert_eq!(catalog.len(), 5);

        match resolve_app_in_catalog(&catalog, "notas") {
            AppResolution::Resolved { app } => {
                assert_eq!(app.bundle_id.as_deref(), Some("com.apple.Notes"));
            }
            other => panic!("expected Notes resolved, got {other:?}"),
        }

        match resolve_app_in_catalog(&catalog, "Calendario") {
            AppResolution::Resolved { app } => {
                assert_eq!(app.bundle_id.as_deref(), Some("com.apple.iCal"));
            }
            other => panic!("expected Calendar resolved, got {other:?}"),
        }

        match resolve_app_in_catalog(&catalog, "com.apple.iCal") {
            AppResolution::Resolved { app } => {
                assert_eq!(app.fs_name, "Calendar");
            }
            other => panic!("expected bundle id resolved, got {other:?}"),
        }

        match resolve_app_in_catalog(&catalog, "microsoft") {
            AppResolution::Ambiguous { candidates, .. } => {
                assert_eq!(candidates.len(), 2);
            }
            other => panic!("expected ambiguous microsoft apps, got {other:?}"),
        }

        match resolve_app_in_catalog(&catalog, "../etc/passwd") {
            AppResolution::InvalidTarget { .. } => {}
            other => panic!("expected invalid target for path traversal, got {other:?}"),
        }

        match resolve_app_in_catalog(&catalog, "https://example.com") {
            AppResolution::InvalidTarget { .. } => {}
            other => panic!("expected invalid target for URL, got {other:?}"),
        }

        let _ = fs::remove_dir_all(&tmp);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_host_discovers_and_resolves_notes_and_calendar() {
        let catalog = discover_installed_apps();
        if Path::new("/System/Applications/Notes.app").exists() {
            match resolve_app_in_catalog(&catalog, "notas") {
                AppResolution::Resolved { app } => {
                    assert_eq!(app.bundle_id.as_deref(), Some("com.apple.Notes"));
                }
                other => panic!("expected Notas to resolve on macOS host, got {other:?}"),
            }
        }
        if Path::new("/System/Applications/Calendar.app").exists() {
            match resolve_app_in_catalog(&catalog, "calendario") {
                AppResolution::Resolved { app } => {
                    assert_eq!(app.bundle_id.as_deref(), Some("com.apple.iCal"));
                }
                other => panic!("expected Calendario to resolve on macOS host, got {other:?}"),
            }
        }
    }
}
