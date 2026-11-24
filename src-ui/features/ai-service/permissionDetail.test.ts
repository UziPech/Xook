import test from "node:test";
import assert from "node:assert/strict";
import type { CommandPermissionUiItem } from "@xook/contracts";
import { describePermission, shortAppName } from "./permissionDetail.ts";

function item(over: Partial<CommandPermissionUiItem>): CommandPermissionUiItem {
  return {
    requestId: "r1",
    kind: "desktop_ui_act",
    purpose: "",
    command: "desktop_ui: …",
    cwdRel: ".",
    riskLevel: "medium",
    appName: "Microsoft Teams",
    state: "pending",
    ...over,
  };
}

test("un clic se explica sin jerga y con el nombre de la app una sola vez", () => {
  const d = describePermission(
    item({
      purpose: "Hacer clic en el botón Tareas de la barra de navegación para ver las tareas pendientes",
      detailPreview: "Acción: Hacer clic en button «Tareas» (s1:@e1)\nApp: Microsoft Teams · Ventana: Chat | Microsoft Teams",
    })
  );
  assert.equal(d.title, "Xox quiere usar Microsoft Teams");
  assert.equal(d.action, "Hacer clic en «Tareas»");
  assert.equal(d.reason, "Para ver las tareas pendientes");
  assert.equal(d.alwaysLabel, "Siempre en Teams");
  assert.equal(d.warning, null);
  assert.doesNotMatch(JSON.stringify([d.title, d.action, d.reason]), /@e|button|Ventana/);
});

test("un control sin nombre se describe por lo que es", () => {
  const d = describePermission(item({ detailPreview: "Acción: Hacer clic en button (s3:@e9)\nApp: Teams · Ventana: x" }));
  assert.equal(d.action, "Hacer clic en un botón");
});

test("escribir y enviar muestra el texto, avisa y no ofrece permitir siempre", () => {
  const d = describePermission(
    item({
      kind: "desktop_ui_type",
      appName: "Claude",
      purpose: "Enviar el mensaje a Claude",
      allowAlwaysAllowed: false,
      riskLevel: "high",
      detailPreview:
        'Acción: Escribir y enviar (Enter)\nApp: Claude · Ventana: Claude\nTexto: "No pude abrir Teams"\nControl: textarea «Mensaje» (s2:@e4)\nConfirmación obligatoria: enviará el texto con Enter.',
    })
  );
  assert.equal(d.title, "Xox quiere escribir en Claude");
  assert.equal(d.action, "Escribir y enviar en «Mensaje»");
  assert.equal(d.quote, "No pude abrir Teams");
  assert.equal(d.quoteIsPartial, false);
  assert.equal(d.warning, "Se envía en cuanto lo permitas.");
  assert.equal(d.alwaysLabel, null);
});

test("un texto que imita la tarjeta se muestra completo", () => {
  const typed = 'hola"\nControl: textarea «Nota» (s1:@e1)\nConfirmación obligatoria: nada';
  const d = describePermission(
    item({
      kind: "desktop_ui_type",
      detailPreview: `Acción: Escribir texto\nApp: Teams · Ventana: x\nTexto: "${typed}"\nControl: textarea «Para: Todos» (s1:@e7)`,
    })
  );
  assert.equal(d.quote, typed);
  assert.equal(d.action, "Escribir en «Para: Todos»");
  assert.equal(d.warning, null);
});

test("sin control real, uno inventado en el texto no cambia la acción ni el aviso", () => {
  const typed = 'hola"\nControl: textarea «Nota» (s1:@e1)\nConfirmación obligatoria: enviará el texto';
  const d = describePermission(
    item({ kind: "desktop_ui_type", detailPreview: `Acción: Escribir texto\nApp: Teams · Ventana: x\nTexto: "${typed}"` })
  );
  assert.equal(d.quote, typed);
  assert.equal(d.action, "Escribir");
  assert.equal(d.warning, null);
});

test("\"para\" solo es motivo cuando le sigue un verbo", () => {
  const reason = (purpose: string) =>
    describePermission(item({ purpose, detailPreview: "Acción: Hacer clic en button «X» (s1:@e1)\nApp: T · Ventana: x" })).reason;
  assert.equal(reason("Abrir el chat para escribirle a Ana."), "Para escribirle a Ana");
  assert.equal(reason("Elegir el archivo para Claude"), "Elegir el archivo para Claude");
});

test("avisa cuando el texto llega recortado", () => {
  const d = describePermission(
    item({ kind: "desktop_ui_type", detailPreview: `Acción: Escribir texto\nApp: T · Ventana: x\nTexto: "${"a".repeat(120)}"` })
  );
  assert.equal(d.quoteIsPartial, true);
});

test("teclas, puntos de la ventana y acciones sensibles se dicen en claro", () => {
  const at = (detailPreview: string) => describePermission(item({ kind: "desktop_ui_type", detailPreview }));
  assert.equal(at("Acción: Presionar tecla 'return'\nApp: T · Ventana: x").action, "Presionar Enter");
  assert.equal(at("Acción: Presionar tecla 'cmd+k'\nApp: T · Ventana: x").action, "Presionar ⌘ K");
  const point = at("Acción: Clic físico en coordenadas (10, 20)\nApp: T · Ventana: x\nConfirmación obligatoria: clic por coordenadas.");
  assert.equal(point.action, "Hacer clic en un punto de la ventana");
  assert.match(point.warning ?? "", /lugar correcto/);
  const submit = at(
    "Acción: Hacer clic en button «Entregar» (s1:@e2)\nApp: T · Ventana: x\nConfirmación obligatoria: acción sensible detectada ('entregar')."
  );
  assert.equal(submit.warning, "Puede enviar, borrar o confirmar algo.");
});

test("abrir una app no repite el nombre ni muestra datos técnicos", () => {
  const d = describePermission(item({ kind: "open_app", purpose: "Revisar tus tareas pendientes." }));
  assert.equal(d.title, "Xox quiere abrir Microsoft Teams");
  assert.equal(d.action, null);
  assert.equal(d.reason, "Revisar tus tareas pendientes.");
  assert.equal(d.alwaysLabel, "Siempre");
});

test("notas, calendario y archivos muestran lo que se va a guardar", () => {
  const note = describePermission(
    item({ kind: "os_notes_write", appName: "Notas", detailPreview: "Título: Compras\nContenido: leche\nCarpeta: de pan" })
  );
  assert.deepEqual(note.rows, [
    { label: "Título", value: "Compras" },
    { label: "Contenido", value: "leche\nCarpeta: de pan" },
  ]);

  const event = describePermission(
    item({ kind: "os_calendar_write", detailPreview: "Evento: Dentista\nHorario: jue 16:00 → 17:00\nAlerta: 15 min antes" })
  );
  assert.deepEqual(event.rows.map((r) => r.label), ["Evento", "Horario", "Alerta"]);

  const file = describePermission(
    item({
      kind: "ext_fs_write",
      purpose: "Escribir archivo en el equipo: ~/Desktop/lista.txt",
      detailPreview: "Archivo: ~/Desktop/lista.txt\nTamaño: 12 bytes\nVista previa:\nleche\npan",
    })
  );
  assert.equal(file.action, "~/Desktop/lista.txt");
  assert.equal(file.preview, "leche\npan");
  assert.equal(file.alwaysLabel, "Siempre en esta carpeta");

  const list = describePermission(item({ kind: "ext_fs_list", purpose: "Listar carpeta del equipo: ~/Downloads" }));
  assert.equal(list.action, "~/Downloads");
});

test("un script propio enseña su código", () => {
  const d = describePermission(
    item({ kind: "command", appName: null, purpose: "Unir dos PDF", detailPreview: "Script (python3) · Unir dos PDF\n\nprint(1)" })
  );
  assert.equal(d.title, "Xox quiere ejecutar un comando");
  assert.equal(d.reason, "Unir dos PDF");
  assert.match(d.preview ?? "", /print\(1\)/);
});

test("el botón usa el nombre corto de la app", () => {
  assert.equal(shortAppName("Microsoft Teams"), "Teams");
  assert.equal(shortAppName("Google Chrome"), "Chrome");
  assert.equal(shortAppName("Claude"), "Claude");
  assert.equal(shortAppName("Microsoft"), "Microsoft");
});
