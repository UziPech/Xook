use super::run_static_jxa;
use serde::{Deserialize, Serialize};

const MAX_TITLE_CHARS: usize = 200;
const MAX_BODY_CHARS: usize = 20_000;
const MAX_FOLDER_CHARS: usize = 120;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesListQuery {
    pub query: String,
    pub folder: Option<String>,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: Option<String>,
    pub title: String,
    pub folder: String,
    pub account: String,
    pub snippet: String,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesListOutcome {
    pub ok: bool,
    pub folders: Vec<String>,
    pub notes: Vec<NoteSummary>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesCreateInput {
    pub title: String,
    pub body: String,
    pub folder: Option<String>,
    pub open_after: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesCreateOutcome {
    pub ok: bool,
    pub id: Option<String>,
    pub title: String,
    pub folder: String,
    pub account: String,
    pub opened: bool,
    pub message: Option<String>,
    pub error: Option<String>,
}

fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

pub fn format_note_html(title: &str, body: &str) -> String {
    let clean_title = title.trim();
    let mut html = format!("<h1>{}</h1>", escape_html(clean_title));
    let mut lines: Vec<&str> = body.lines().collect();
    if let Some(first) = lines.first() {
        if first.trim().eq_ignore_ascii_case(clean_title) {
            lines.remove(0);
            if lines.first().map(|s| s.trim().is_empty()).unwrap_or(false) {
                lines.remove(0);
            }
        }
    }
    for line in lines {
        let trimmed_end = line.trim_end();
        if trimmed_end.trim().is_empty() {
            html.push_str("<div><br></div>");
        } else {
            html.push_str(&format!("<div>{}</div>", escape_html(trimmed_end)));
        }
    }
    html
}

pub fn validate_note_create_input(
    title: &str,
    body: &str,
    folder: Option<&str>,
    open_after: bool,
) -> Result<NotesCreateInput, String> {
    let clean_title = title
        .replace('\0', "")
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string();
    if clean_title.is_empty() {
        return Err("Debes indicar un título para la nota.".to_string());
    }
    if clean_title.chars().count() > MAX_TITLE_CHARS {
        return Err(format!(
            "El título de la nota no puede exceder {MAX_TITLE_CHARS} caracteres."
        ));
    }

    let clean_body = body.replace('\0', "").trim().to_string();
    if clean_body.chars().count() > MAX_BODY_CHARS {
        return Err(format!(
            "El contenido de la nota es demasiado extenso (máximo {MAX_BODY_CHARS} caracteres)."
        ));
    }

    let clean_folder = folder
        .map(|f| f.replace('\0', "").trim().to_string())
        .filter(|f| !f.is_empty());
    if let Some(ref f) = clean_folder {
        if f.chars().count() > MAX_FOLDER_CHARS {
            return Err("El nombre de la carpeta es demasiado largo.".to_string());
        }
    }

    Ok(NotesCreateInput {
        title: clean_title,
        body: clean_body,
        folder: clean_folder,
        open_after,
    })
}

pub fn validate_notes_list_query(
    query: Option<&str>,
    folder: Option<&str>,
    limit: Option<usize>,
) -> NotesListQuery {
    let clean_query = query
        .unwrap_or("")
        .replace('\0', "")
        .trim()
        .chars()
        .take(120)
        .collect();
    let clean_folder = folder
        .map(|f| f.replace('\0', "").trim().to_string())
        .filter(|f| !f.is_empty());
    let clean_limit = limit.unwrap_or(15).clamp(1, 30);
    NotesListQuery {
        query: clean_query,
        folder: clean_folder,
        limit: clean_limit,
    }
}

const NOTES_LIST_JXA: &str = r#"
function run(argv) {
  var req = JSON.parse(argv[0]);
  var Notes = Application("/System/Applications/Notes.app");
  Notes.includeStandardAdditions = false;

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function isTrashFolder(name, id) {
    var n = norm(name);
    var i = String(id || "").toLowerCase();
    return i.indexOf("trash") !== -1 ||
      n === "recently deleted" ||
      n === "eliminado recientemente" ||
      n === "eliminadas recientemente" ||
      n === "papelera";
  }

  var accounts = Notes.accounts();
  var folderNames = [];
  var targetFolders = [];
  var wantedFolder = norm(req.folder || "");

  for (var a = 0; a < accounts.length; a++) {
    var acct = accounts[a];
    var acctName = String(acct.name());
    var folders = acct.folders();
    for (var f = 0; f < folders.length; f++) {
      var fl = folders[f];
      var flName = String(fl.name());
      var flId = "";
      try { flId = String(fl.id()); } catch (_) {}
      if (isTrashFolder(flName, flId)) continue;
      folderNames.push(flName);
      if (!wantedFolder || norm(flName) === wantedFolder || norm(flName).indexOf(wantedFolder) !== -1) {
        targetFolders.push({ folder: fl, folderName: flName, accountName: acctName });
      }
    }
  }

  if (wantedFolder && targetFolders.length === 0) {
    return JSON.stringify({
      ok: false,
      folders: folderNames,
      notes: [],
      error: "No encontré la carpeta '" + req.folder + "' en Notas."
    });
  }

  var q = norm(req.query || "");
  var out = [];
  var limit = Math.max(1, Math.min(30, Number(req.limit || 15)));

  for (var idx = 0; idx < targetFolders.length && out.length < limit; idx++) {
    var entry = targetFolders[idx];
    var titles = [];
    try { titles = entry.folder.notes.name(); } catch (_) { titles = []; }
    if (!titles || !titles.length) continue;

    var noteIds = [];
    var modDates = [];
    try { noteIds = entry.folder.notes.id(); } catch (_) {}
    try { modDates = entry.folder.notes.modificationDate(); } catch (_) {}

    var scanCap = Math.min(titles.length, q ? 80 : limit);
    for (var i = 0; i < scanCap && out.length < limit; i++) {
      var title = String(titles[i] || "(Sin título)");
      var matchTitle = !q || norm(title).indexOf(q) !== -1;
      var snippet = "";
      if (matchTitle || q) {
        try {
          var plain = String(entry.folder.notes[i].plaintext() || "").trim();
          if (q && !matchTitle && norm(plain).indexOf(q) === -1) {
            continue;
          }
          snippet = plain.replace(/\s+/g, " ").slice(0, 240);
        } catch (_) {
          if (!matchTitle) continue;
        }
      }
      var modIso = null;
      try {
        if (modDates[i]) modIso = new Date(modDates[i]).toISOString();
      } catch (_) {}
      out.push({
        id: noteIds[i] ? String(noteIds[i]) : null,
        title: title,
        folder: entry.folderName,
        account: entry.accountName,
        snippet: snippet,
        modifiedAt: modIso
      });
    }
  }

  return JSON.stringify({
    ok: true,
    folders: folderNames,
    notes: out,
    error: null
  });
}
"#;

const NOTES_CREATE_JXA: &str = r#"
function run(argv) {
  var req = JSON.parse(argv[0]);
  var Notes = Application("/System/Applications/Notes.app");
  Notes.includeStandardAdditions = false;

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function isTrashFolder(name, id) {
    var n = norm(name);
    var i = String(id || "").toLowerCase();
    return i.indexOf("trash") !== -1 ||
      n === "recently deleted" ||
      n === "eliminado recientemente" ||
      n === "eliminadas recientemente" ||
      n === "papelera";
  }

  var accounts = Notes.accounts();
  if (!accounts || accounts.length === 0) {
    return JSON.stringify({
      ok: false,
      id: null,
      title: req.title,
      folder: "",
      account: "",
      opened: false,
      message: null,
      error: "No hay cuentas configuradas en Notas de macOS."
    });
  }

  var defAccount = null;
  try { defAccount = Notes.defaultAccount(); } catch (_) { defAccount = accounts[0]; }
  if (!defAccount) defAccount = accounts[0];

  var targetFolder = null;
  var targetFolderName = "";
  var targetAccountName = "";

  if (req.folder) {
    var wanted = norm(req.folder);
    var available = [];
    var searchOrder = [defAccount];
    for (var a = 0; a < accounts.length; a++) {
      if (String(accounts[a].name()) !== String(defAccount.name())) {
        searchOrder.push(accounts[a]);
      }
    }
    for (var s = 0; s < searchOrder.length && !targetFolder; s++) {
      var acct = searchOrder[s];
      var fls = acct.folders();
      for (var f = 0; f < fls.length; f++) {
        var flName = String(fls[f].name());
        var flId = "";
        try { flId = String(fls[f].id()); } catch (_) {}
        if (isTrashFolder(flName, flId)) continue;
        available.push(flName);
        if (norm(flName) === wanted) {
          targetFolder = fls[f];
          targetFolderName = flName;
          targetAccountName = String(acct.name());
          break;
        }
      }
    }
    if (!targetFolder) {
      return JSON.stringify({
        ok: false,
        id: null,
        title: req.title,
        folder: "",
        account: "",
        opened: false,
        message: null,
        error: "No encontré la carpeta '" + req.folder + "' en Notas. Disponibles: " + available.join(", ")
      });
    }
  } else {
    try { targetFolder = defAccount.defaultFolder(); } catch (_) {}
    if (!targetFolder) {
      var dFolders = defAccount.folders();
      for (var k = 0; k < dFolders.length; k++) {
        var fn = String(dFolders[k].name());
        if (!isTrashFolder(fn, "")) {
          targetFolder = dFolders[k];
          break;
        }
      }
    }
    if (!targetFolder) {
      return JSON.stringify({
        ok: false,
        id: null,
        title: req.title,
        folder: "",
        account: "",
        opened: false,
        message: null,
        error: "No se encontró una carpeta predeterminada válida en Notas."
      });
    }
    targetFolderName = String(targetFolder.name());
    targetAccountName = String(defAccount.name());
  }

  var note = Notes.Note({ body: req.htmlBody });
  targetFolder.notes.push(note);

  var createdId = null;
  var createdRef = null;
  try {
    createdRef = targetFolder.notes[0];
    createdId = String(createdRef.id());
  } catch (_) {}

  var opened = false;
  if (req.openAfter) {
    try {
      if (createdRef) Notes.show(createdRef);
      Notes.activate();
      opened = true;
    } catch (_) {}
  }

  return JSON.stringify({
    ok: true,
    id: createdId,
    title: req.title,
    folder: targetFolderName,
    account: targetAccountName,
    opened: opened,
    message: "Se creó la nota '" + req.title + "' en la carpeta '" + targetFolderName + "'.",
    error: null
  });
}
"#;

pub fn list_notes(query: &NotesListQuery) -> Result<NotesListOutcome, String> {
    let payload = serde_json::json!({
        "query": query.query,
        "folder": query.folder,
        "limit": query.limit,
    });
    let outcome: NotesListOutcome = run_static_jxa(NOTES_LIST_JXA, &payload.to_string())?;
    if !outcome.ok {
        return Err(outcome
            .error
            .unwrap_or_else(|| "No se pudo consultar la aplicación Notas.".to_string()));
    }
    Ok(outcome)
}

pub fn create_note(input: &NotesCreateInput) -> Result<NotesCreateOutcome, String> {
    let html_body = format_note_html(&input.title, &input.body);
    let payload = serde_json::json!({
        "title": input.title,
        "htmlBody": html_body,
        "folder": input.folder,
        "openAfter": input.open_after,
    });
    let outcome: NotesCreateOutcome = run_static_jxa(NOTES_CREATE_JXA, &payload.to_string())?;
    if !outcome.ok {
        return Err(outcome
            .error
            .unwrap_or_else(|| "No se pudo crear la nota en Notas.".to_string()));
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_html_safely_and_dedups_leading_title_line() {
        let html = format_note_html(
            "Lista <Urgente> & \"Compras\"",
            "Lista <Urgente> & \"Compras\"\n\n- Café en grano\n- Leche <sin lactosa>",
        );
        assert!(html.starts_with("<h1>Lista &lt;Urgente&gt; &amp; &quot;Compras&quot;</h1>"));
        assert!(!html.contains("<script"));
        assert!(html.contains("<div>- Café en grano</div>"));
        assert!(html.contains("<div>- Leche &lt;sin lactosa&gt;</div>"));
    }

    #[test]
    fn validates_note_inputs() {
        assert!(validate_note_create_input("   \n ", "texto", None, false).is_err());
        let ok = validate_note_create_input("  Revisión semanal \n subtítulo", "Detalle", Some(" Trabajo "), true).unwrap();
        assert_eq!(ok.title, "Revisión semanal");
        assert_eq!(ok.folder.as_deref(), Some("Trabajo"));
        assert!(ok.open_after);

        let too_long = "x".repeat(MAX_TITLE_CHARS + 1);
        assert!(validate_note_create_input(&too_long, "ok", None, false).is_err());
    }
}

