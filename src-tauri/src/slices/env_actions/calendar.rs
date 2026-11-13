use super::run_static_jxa;
use chrono::{DateTime, Duration, Local, NaiveDate, NaiveDateTime, TimeZone};
use serde::{Deserialize, Serialize};

const MAX_EVENT_TITLE_CHARS: usize = 200;
const MAX_LOCATION_CHARS: usize = 300;
const MAX_DESC_CHARS: usize = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    pub id: Option<String>,
    pub name: String,
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventItem {
    pub uid: Option<String>,
    pub title: String,
    pub calendar: String,
    pub start_iso: String,
    pub end_iso: String,
    pub all_day: bool,
    pub location: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarListQuery {
    pub start_epoch_ms: i64,
    pub end_epoch_ms: i64,
    pub start_label: String,
    pub end_label: String,
    pub calendar_name: Option<String>,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarListOutcome {
    pub ok: bool,
    pub calendars: Vec<CalendarInfo>,
    pub events: Vec<CalendarEventItem>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarCreateInput {
    pub title: String,
    pub start_epoch_ms: i64,
    pub end_epoch_ms: i64,
    pub start_label: String,
    pub end_label: String,
    pub all_day: bool,
    pub calendar_name: Option<String>,
    pub location: Option<String>,
    pub description: Option<String>,
    pub reminder_minutes_before: Option<i32>,
    pub open_after: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarCreateOutcome {
    pub ok: bool,
    pub uid: Option<String>,
    pub title: String,
    pub calendar: String,
    pub start_iso: Option<String>,
    pub end_iso: Option<String>,
    pub all_day: bool,
    pub opened: bool,
    pub alarm_set: bool,
    pub message: Option<String>,
    pub error: Option<String>,
}

fn local_datetime_from_naive(ndt: NaiveDateTime) -> Result<DateTime<Local>, String> {
    Local
        .from_local_datetime(&ndt)
        .earliest()
        .or_else(|| Local.from_local_datetime(&ndt).latest())
        .ok_or_else(|| "La fecha/hora local especificada no es válida en esta zona horaria.".to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParsedDateKind {
    DateTime(DateTime<Local>),
    DateOnly(NaiveDate),
}

fn parse_flexible_local_datetime(raw: &str) -> Result<ParsedDateKind, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("La fecha de inicio no puede estar vacía.".to_string());
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(ParsedDateKind::DateTime(dt.with_timezone(&Local)));
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(trimmed, fmt) {
            return Ok(ParsedDateKind::DateTime(local_datetime_from_naive(ndt)?));
        }
    }
    if let Ok(d) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        return Ok(ParsedDateKind::DateOnly(d));
    }
    Err(format!(
        "No se pudo interpretar la fecha '{trimmed}'. Usa formato ISO como '2026-11-14T15:00:00' o '2026-11-14'."
    ))
}

fn format_human_datetime_es(dt: DateTime<Local>, all_day: bool) -> String {
    if all_day {
        dt.format("%Y-%m-%d (todo el día)").to_string()
    } else {
        dt.format("%Y-%m-%d %H:%M").to_string()
    }
}

pub fn validate_calendar_list_query(
    start_iso: Option<&str>,
    end_iso: Option<&str>,
    calendar_name: Option<&str>,
    limit: Option<usize>,
) -> Result<CalendarListQuery, String> {
    let now = Local::now();
    let start_dt = match start_iso.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => match parse_flexible_local_datetime(raw)? {
            ParsedDateKind::DateTime(dt) => dt,
            ParsedDateKind::DateOnly(d) => {
                local_datetime_from_naive(d.and_hms_opt(0, 0, 0).unwrap())?
            }
        },
        None => {
            let today = now.date_naive();
            local_datetime_from_naive(today.and_hms_opt(0, 0, 0).unwrap())?
        }
    };

    let end_dt = match end_iso.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => match parse_flexible_local_datetime(raw)? {
            ParsedDateKind::DateTime(dt) => dt,
            ParsedDateKind::DateOnly(d) => {
                local_datetime_from_naive(d.and_hms_opt(23, 59, 59).unwrap())?
            }
        },
        None => start_dt + Duration::days(7),
    };

    if end_dt < start_dt {
        return Err("La fecha final no puede ser anterior a la fecha inicial.".to_string());
    }
    if end_dt.signed_duration_since(start_dt) > Duration::days(90) {
        return Err("El rango máximo de consulta en Calendario es de 90 días.".to_string());
    }

    let clean_cal = calendar_name
        .map(|s| s.replace('\0', "").trim().to_string())
        .filter(|s| !s.is_empty());

    Ok(CalendarListQuery {
        start_epoch_ms: start_dt.timestamp_millis(),
        end_epoch_ms: end_dt.timestamp_millis(),
        start_label: start_dt.format("%Y-%m-%d %H:%M").to_string(),
        end_label: end_dt.format("%Y-%m-%d %H:%M").to_string(),
        calendar_name: clean_cal,
        limit: limit.unwrap_or(40).clamp(1, 100),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn validate_calendar_create_input(
    title: &str,
    start_iso: &str,
    end_iso: Option<&str>,
    all_day: bool,
    calendar_name: Option<&str>,
    location: Option<&str>,
    description: Option<&str>,
    reminder_minutes_before: Option<i32>,
    open_after: bool,
) -> Result<CalendarCreateInput, String> {
    let clean_title = title.replace('\0', "").trim().to_string();
    if clean_title.is_empty() {
        return Err("Debes indicar un título para el evento del calendario.".to_string());
    }
    if clean_title.chars().count() > MAX_EVENT_TITLE_CHARS {
        return Err(format!(
            "El título del evento no puede exceder {MAX_EVENT_TITLE_CHARS} caracteres."
        ));
    }

    let parsed_start = parse_flexible_local_datetime(start_iso)?;
    let (start_dt, effective_all_day) = match parsed_start {
        ParsedDateKind::DateTime(dt) => {
            if all_day {
                let d = dt.date_naive();
                (
                    local_datetime_from_naive(d.and_hms_opt(0, 0, 0).unwrap())?,
                    true,
                )
            } else {
                (dt, false)
            }
        }
        ParsedDateKind::DateOnly(d) => (
            local_datetime_from_naive(d.and_hms_opt(0, 0, 0).unwrap())?,
            true,
        ),
    };

    let end_dt = match end_iso.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => match parse_flexible_local_datetime(raw)? {
            ParsedDateKind::DateTime(dt) => {
                if effective_all_day {
                    let d = dt.date_naive();
                    local_datetime_from_naive(d.and_hms_opt(23, 59, 59).unwrap())?
                } else {
                    dt
                }
            }
            ParsedDateKind::DateOnly(d) => {
                local_datetime_from_naive(d.and_hms_opt(23, 59, 59).unwrap())?
            }
        },
        None => {
            if effective_all_day {
                local_datetime_from_naive(start_dt.date_naive().and_hms_opt(23, 59, 59).unwrap())?
            } else {
                start_dt + Duration::hours(1)
            }
        }
    };

    if end_dt <= start_dt {
        return Err("La hora de fin del evento debe ser posterior a la hora de inicio.".to_string());
    }

    let clean_cal = calendar_name
        .map(|s| s.replace('\0', "").trim().to_string())
        .filter(|s| !s.is_empty());
    let clean_loc = location
        .map(|s| {
            s.replace('\0', "")
                .trim()
                .chars()
                .take(MAX_LOCATION_CHARS)
                .collect::<String>()
        })
        .filter(|s| !s.is_empty());
    let clean_desc = description
        .map(|s| {
            s.replace('\0', "")
                .trim()
                .chars()
                .take(MAX_DESC_CHARS)
                .collect::<String>()
        })
        .filter(|s| !s.is_empty());
    let clean_reminder = reminder_minutes_before.map(|m| m.clamp(0, 10_080));

    Ok(CalendarCreateInput {
        title: clean_title,
        start_epoch_ms: start_dt.timestamp_millis(),
        end_epoch_ms: end_dt.timestamp_millis(),
        start_label: format_human_datetime_es(start_dt, effective_all_day),
        end_label: format_human_datetime_es(end_dt, effective_all_day),
        all_day: effective_all_day,
        calendar_name: clean_cal,
        location: clean_loc,
        description: clean_desc,
        reminder_minutes_before: clean_reminder,
        open_after,
    })
}

const CALENDAR_LIST_JXA: &str = r#"
function run(argv) {
  var req = JSON.parse(argv[0]);
  var Cal = Application("/System/Applications/Calendar.app");
  Cal.includeStandardAdditions = false;

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  var cals = Cal.calendars();
  var calMeta = [];
  for (var i = 0; i < cals.length; i++) {
    var name = String(cals[i].name());
    var cid = null;
    var writable = false;
    try { cid = String(cals[i].calendarIdentifier()); } catch (_) {}
    try { writable = Boolean(cals[i].writable()); } catch (_) {}
    calMeta.push({ ref: cals[i], info: { id: cid, name: name, writable: writable } });
  }

  var wanted = norm(req.calendarName || "");
  var targetCals = calMeta;
  if (wanted) {
    targetCals = calMeta.filter(function (c) {
      return norm(c.info.name) === wanted || norm(c.info.name).indexOf(wanted) !== -1;
    });
    if (targetCals.length === 0) {
      return JSON.stringify({
        ok: false,
        calendars: calMeta.map(function (c) { return c.info; }),
        events: [],
        error: "No encontré el calendario '" + req.calendarName + "'."
      });
    }
  }

  var startDt = new Date(Number(req.startEpochMs));
  var endDt = new Date(Number(req.endEpochMs));
  var limit = Math.max(1, Math.min(100, Number(req.limit || 40)));
  var events = [];

  for (var cIdx = 0; cIdx < targetCals.length && events.length < limit; cIdx++) {
    var calEntry = targetCals[cIdx];
    var calName = calEntry.info.name;
    var matched;
    try {
      matched = calEntry.ref.events.whose({
        _and: [
          { startDate: { _lessThanEquals: endDt } },
          { endDate: { _greaterThanEquals: startDt } }
        ]
      });
      var summaries = matched.summary();
      if (!summaries || !summaries.length) continue;
      var starts = matched.startDate();
      var ends = matched.endDate();
      var allDays = [];
      var locs = [];
      var descs = [];
      var uids = [];
      try { allDays = matched.alldayEvent(); } catch (_) {}
      try { locs = matched.location(); } catch (_) {}
      try { descs = matched.description(); } catch (_) {}
      try { uids = matched.uid(); } catch (_) {}

      for (var e = 0; e < summaries.length && events.length < limit; e++) {
        var sDt = starts[e] ? new Date(starts[e]) : null;
        var eDt = ends[e] ? new Date(ends[e]) : null;
        if (!sDt || !eDt) continue;
        events.push({
          uid: uids[e] ? String(uids[e]) : null,
          title: String(summaries[e] || "(Sin título)"),
          calendar: calName,
          startIso: sDt.toISOString(),
          endIso: eDt.toISOString(),
          allDay: Boolean(allDays[e]),
          location: locs[e] ? String(locs[e]) : null,
          description: descs[e] ? String(descs[e]).slice(0, 300) : null
        });
      }
    } catch (_) {
      continue;
    }
  }

  events.sort(function (a, b) {
    return a.startIso < b.startIso ? -1 : a.startIso > b.startIso ? 1 : 0;
  });
  if (events.length > limit) events = events.slice(0, limit);

  return JSON.stringify({
    ok: true,
    calendars: calMeta.map(function (c) { return c.info; }),
    events: events,
    error: null
  });
}
"#;

const CALENDAR_CREATE_EVENT_JXA: &str = r#"
function run(argv) {
  var req = JSON.parse(argv[0]);
  var Cal = Application("/System/Applications/Calendar.app");
  Cal.includeStandardAdditions = false;

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function isSecondaryAutoCal(name) {
    var n = norm(name);
    return n.indexOf("cumpleanos") !== -1 ||
      n.indexOf("birthday") !== -1 ||
      n.indexOf("festivos") !== -1 ||
      n.indexOf("holiday") !== -1 ||
      n.indexOf("siri") !== -1 ||
      n.indexOf("found in") !== -1 ||
      n.indexOf("sugerencias") !== -1;
  }

  var cals = Cal.calendars();
  var meta = [];
  for (var i = 0; i < cals.length; i++) {
    var name = String(cals[i].name());
    var writable = false;
    try { writable = Boolean(cals[i].writable()); } catch (_) {}
    meta.push({ ref: cals[i], name: name, writable: writable });
  }

  var writableCals = meta.filter(function (c) { return c.writable; });
  if (writableCals.length === 0) {
    return JSON.stringify({
      ok: false,
      uid: null,
      title: req.title,
      calendar: "",
      startIso: null,
      endIso: null,
      allDay: Boolean(req.allDay),
      opened: false,
      alarmSet: false,
      message: null,
      error: "No hay calendarios con permiso de escritura disponibles en Calendario."
    });
  }

  var target = null;
  if (req.calendarName) {
    var wanted = norm(req.calendarName);
    target = writableCals.find(function (c) { return norm(c.name) === wanted; }) ||
      writableCals.find(function (c) { return norm(c.name).indexOf(wanted) !== -1; }) ||
      null;
    if (!target) {
      var readOnlyHit = meta.find(function (c) {
        return !c.writable && (norm(c.name) === wanted || norm(c.name).indexOf(wanted) !== -1);
      });
      var writableList = writableCals.map(function (c) { return c.name; }).join(", ");
      return JSON.stringify({
        ok: false,
        uid: null,
        title: req.title,
        calendar: "",
        startIso: null,
        endIso: null,
        allDay: Boolean(req.allDay),
        opened: false,
        alarmSet: false,
        message: null,
        error: readOnlyHit
          ? "El calendario '" + readOnlyHit.name + "' es de solo lectura. Calendarios editables: " + writableList
          : "No encontré el calendario editable '" + req.calendarName + "'. Disponibles: " + writableList
      });
    }
  } else {
    var preferredNames = ["calendario", "calendar", "personal", "casa", "home", "trabajo", "work"];
    for (var p = 0; p < preferredNames.length && !target; p++) {
      target = writableCals.find(function (c) { return norm(c.name) === preferredNames[p]; }) || null;
    }
    if (!target) {
      target = writableCals.find(function (c) { return !isSecondaryAutoCal(c.name); }) || writableCals[0];
    }
  }

  var startDt = new Date(Number(req.startEpochMs));
  var endDt = new Date(Number(req.endEpochMs));
  var props = {
    summary: req.title,
    startDate: startDt,
    endDate: endDt,
    alldayEvent: Boolean(req.allDay)
  };
  if (req.location) props.location = req.location;
  if (req.description) props.description = req.description;

  var evt = Cal.Event(props);
  var newLen = target.ref.events.push(evt);

  var createdUid = null;
  var createdRef = null;
  try {
    var idx = Number(newLen) - 1;
    if (idx >= 0) {
      var cand = target.ref.events[idx];
      if (cand && String(cand.summary()) === String(req.title)) {
        createdRef = cand;
      }
    }
  } catch (_) {}

  if (!createdRef) {
    try {
      var hits = target.ref.events.whose({
        _and: [
          { summary: req.title },
          { startDate: startDt }
        ]
      });
      if (hits && hits.length > 0) {
        createdRef = hits[hits.length - 1];
      }
    } catch (_) {}
  }

  if (createdRef) {
    try { createdUid = String(createdRef.uid()); } catch (_) {}
  }

  var alarmSet = false;
  if (req.reminderMinutesBefore !== null && req.reminderMinutesBefore !== undefined && createdRef) {
    try {
      var mins = -Math.abs(Number(req.reminderMinutesBefore));
      var alarm = Cal.DisplayAlarm({ triggerInterval: mins });
      createdRef.displayAlarms.push(alarm);
      alarmSet = true;
    } catch (_) {}
  }

  var opened = false;
  if (req.openAfter) {
    try {
      Cal.viewCalendar({ at: startDt });
      if (createdRef) {
        try { Cal.show(createdRef); } catch (_) {}
      }
      Cal.activate();
      opened = true;
    } catch (_) {}
  }

  return JSON.stringify({
    ok: true,
    uid: createdUid,
    title: req.title,
    calendar: target.name,
    startIso: startDt.toISOString(),
    endIso: endDt.toISOString(),
    allDay: Boolean(req.allDay),
    opened: opened,
    alarmSet: alarmSet,
    message: "Se agendó '" + req.title + "' en el calendario '" + target.name + "'.",
    error: null
  });
}
"#;

pub fn list_calendar_events(query: &CalendarListQuery) -> Result<CalendarListOutcome, String> {
    let payload = serde_json::json!({
        "startEpochMs": query.start_epoch_ms,
        "endEpochMs": query.end_epoch_ms,
        "calendarName": query.calendar_name,
        "limit": query.limit,
    });
    let outcome: CalendarListOutcome = run_static_jxa(CALENDAR_LIST_JXA, &payload.to_string())?;
    if !outcome.ok {
        return Err(outcome
            .error
            .unwrap_or_else(|| "No se pudo consultar la aplicación Calendario.".to_string()));
    }
    Ok(outcome)
}

pub fn create_calendar_event(input: &CalendarCreateInput) -> Result<CalendarCreateOutcome, String> {
    let payload = serde_json::json!({
        "title": input.title,
        "startEpochMs": input.start_epoch_ms,
        "endEpochMs": input.end_epoch_ms,
        "allDay": input.all_day,
        "calendarName": input.calendar_name,
        "location": input.location,
        "description": input.description,
        "reminderMinutesBefore": input.reminder_minutes_before,
        "openAfter": input.open_after,
    });
    let outcome: CalendarCreateOutcome =
        run_static_jxa(CALENDAR_CREATE_EVENT_JXA, &payload.to_string())?;
    if !outcome.ok {
        return Err(outcome
            .error
            .unwrap_or_else(|| "No se pudo crear el evento en Calendario.".to_string()));
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dates_and_defaults_durations_cleanly() {
        let timed = validate_calendar_create_input(
            "Junta de seguimiento",
            "2026-11-14T15:30:00",
            None,
            false,
            Some("Trabajo"),
            Some("Oficina central"),
            Some("Revisar entregas"),
            Some(15),
            false,
        )
        .unwrap();
        assert!(!timed.all_day);
        assert_eq!(timed.end_epoch_ms - timed.start_epoch_ms, 3_600_000);
        assert_eq!(timed.reminder_minutes_before, Some(15));
        assert_eq!(timed.calendar_name.as_deref(), Some("Trabajo"));

        let all_day = validate_calendar_create_input(
            "Inventario general",
            "2026-11-20",
            None,
            true,
            None,
            None,
            None,
            None,
            false,
        )
        .unwrap();
        assert!(all_day.all_day);
        assert!(all_day.end_epoch_ms > all_day.start_epoch_ms);
        assert_eq!(all_day.start_label, "2026-11-20 (todo el día)");
    }

    #[test]
    fn rejects_invalid_event_ranges_and_titles() {
        assert!(
            validate_calendar_create_input("", "2026-11-14T10:00", None, false, None, None, None, None, false)
                .is_err()
        );
        assert!(
            validate_calendar_create_input(
                "Cita",
                "2026-11-14T15:00",
                Some("2026-11-14T14:00"),
                false,
                None,
                None,
                None,
                None,
                false
            )
            .is_err()
        );
        assert!(
            validate_calendar_list_query(Some("2026-11-20"), Some("2026-11-10"), None, None)
                .is_err()
        );
        let q = validate_calendar_list_query(Some("2026-11-14"), Some("2026-11-14"), None, None)
            .unwrap();
        assert!(q.end_epoch_ms > q.start_epoch_ms);
    }
}
