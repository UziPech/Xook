import test from "node:test";
import assert from "node:assert/strict";
import {
  containsSecretMaterial,
  formatUserMemoryForPrompt,
  normalizeMemoryKey,
  sanitizeUserFactValue,
  upsertUserMemoryFacts,
  type UserMemoryFact,
} from "./userDataStore.ts";

test("normalizeMemoryKey normaliza tildes, espacios y longitud", () => {
  assert.equal(normalizeMemoryKey("Ciudad Favorita!", "preference", "CDMX"), "ciudad_favorita");
  assert.equal(
    normalizeMemoryKey("", "identity", "Prefiere respuestas en español directo"),
    "identity_prefiere_respuestas_en_espanol_directo"
  );
  assert.ok(normalizeMemoryKey("x".repeat(120), "other", "v").length <= 64);
});

test("containsSecretMaterial y sanitizeUserFactValue bloquean secretos reales", () => {
  assert.equal(containsSecretMaterial("Mi token es sk-or-v1-abcdef1234567890"), true);
  assert.equal(containsSecretMaterial("token ghp_1234567890abcdef123456"), true);
  assert.equal(containsSecretMaterial("-----BEGIN RSA PRIVATE KEY-----"), true);
  assert.equal(containsSecretMaterial("Mi ciudad es Guadalajara y uso TypeScript"), false);

  const rejected = sanitizeUserFactValue("Usa mi clave sk-proj-secret1234567890abcd");
  assert.equal(rejected.ok, false);

  const accepted = sanitizeUserFactValue("  Me llamo   Uziel Castillo  ");
  assert.deepEqual(accepted, { ok: true, value: "Me llamo Uziel Castillo" });
});

test("upsertUserMemoryFacts deduplica por key o valor y preserva pinned al recortar", () => {
  const first = upsertUserMemoryFacts(
    [],
    {
      key: "preferred_city",
      category: "identity",
      value: "Vivo en Monterrey",
      scope: "global",
      sourceWindow: "main",
      pinned: true,
    },
    "2026-11-21T10:00:00Z",
    3
  );
  assert.equal(first.facts.length, 1);

  // Actualizar misma key desde QuickBar preserva id, createdAt y pinned
  const updated = upsertUserMemoryFacts(
    first.facts,
    {
      key: "preferred_city",
      category: "identity",
      value: "Vivo en Guadalajara",
      scope: "global",
      sourceWindow: "quick",
      pinned: false,
    },
    "2026-11-21T11:00:00Z",
    3
  );
  assert.equal(updated.facts.length, 1);
  assert.equal(updated.saved.id, first.saved.id);
  assert.equal(updated.saved.createdAt, "2026-11-21T10:00:00Z");
  assert.equal(updated.saved.pinned, true);
  assert.equal(updated.saved.value, "Vivo en Guadalajara");

  // Duplicado por valor aunque cambie la key
  const dupByVal = upsertUserMemoryFacts(
    updated.facts,
    {
      key: "otra_key",
      category: "identity",
      value: "vivo en guadalajara",
      scope: "global",
      sourceWindow: "main",
      pinned: false,
    },
    "2026-11-21T11:05:00Z",
    3
  );
  assert.equal(dupByVal.facts.length, 1);

  // Al superar maxItems=3, el hecho pinned sigue conservándose
  let state: UserMemoryFact[] = dupByVal.facts;
  for (let i = 1; i <= 4; i += 1) {
    state = upsertUserMemoryFacts(
      state,
      {
        key: `nota_${i}`,
        category: "other",
        value: `Dato temporal numero ${i}`,
        scope: "global",
        sourceWindow: "main",
        pinned: false,
      },
      `2026-11-21T12:0${i}:00Z`,
      3
    ).facts;
  }
  assert.equal(state.length, 3);
  assert.ok(state.some((f) => f.key === "preferred_city" && f.pinned));
});

test("formatUserMemoryForPrompt prioriza pinned y respeta maxChars", () => {
  const facts: UserMemoryFact[] = [
    {
      id: "1",
      key: "reciente",
      category: "work",
      value: "Trabaja con React y Tauri en proyectos desktop",
      scope: "global",
      sourceWindow: "main",
      pinned: false,
      createdAt: "2026-11-21T10:00:00Z",
      updatedAt: "2026-11-21T12:00:00Z",
    },
    {
      id: "2",
      key: "nombre",
      category: "identity",
      value: "Se llama Uziel",
      scope: "global",
      sourceWindow: "quick",
      pinned: true,
      createdAt: "2026-11-21T09:00:00Z",
      updatedAt: "2026-11-21T09:00:00Z",
    },
  ];
  const block = formatUserMemoryForPrompt(facts, 70);
  assert.ok(block.startsWith("- [identity] (nombre): Se llama Uziel"));
  assert.ok(block.length <= 70);
});
