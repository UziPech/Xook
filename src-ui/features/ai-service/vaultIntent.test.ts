import test from "node:test";
import assert from "node:assert/strict";
import { detectVaultConfigRequest } from "./vaultIntent.ts";

function isVault(text: string): boolean {
  return detectVaultConfigRequest(text).isVaultRequest;
}

test("un mensaje que nombra a una IA no abre el formulario de claves", () => {
  for (const text of [
    "dile a claude que no puedes abrir mi app, con el pormpt que te di y el porque de porque no pudiste hacerlo",
    "claude esta en la app que tienes abierto es el chat",
    "abre chatgpt",
    "abre la app de claude y pregúntale qué hora es",
    "usa claude para escribirle un correo a mi jefe",
    "pon en gemini este mensaje: ya voy",
    "agrega a mi presentación una comparación entre OpenAI y Anthropic",
    "guarda un resumen sobre deepseek en mis notas",
    "pasa esto a claude",
    "pon a claude a revisar el documento",
    "cambia el título de la diapositiva de Gemini",
    "dile a claude que guarde mi api key",
    "busca noticias de openai y guárdalas",
    "compara gemini vs groq",
    "¿cuánto cuesta deepseek?",
  ]) {
    assert.equal(isVault(text), false, text);
  }
});

test("una clave que no es de IA se queda en la conversación", () => {
  for (const text of [
    "guarda la clave del wifi en mis notas",
    "cambia la clave de la puerta",
    "agrega la clave para entrar al salón",
  ]) {
    assert.equal(isVault(text), false, text);
  }
});

test("pedir una clave o la bóveda sí abre el formulario", () => {
  for (const [text, provider] of [
    ["configura mi api key de openai", "openai"],
    ["quiero agregar mi clave de anthropic", "anthropic"],
    ["guarda mi key de claude", "anthropic"],
    ["deja configurar tu api key de gemini", "gemini"],
    ["guarda mi clave", null],
    ["abre la bóveda", null],
    ["ver la bóveda", null],
    ["conecta openrouter", "openrouter"],
    ["agrega anthropic", "anthropic"],
    ["configura groq por favor", "groq"],
    ["conecta google ai studio", "gemini"],
    ["pon deepseek como proveedor", "deepseek"],
  ] as const) {
    const res = detectVaultConfigRequest(text);
    assert.equal(res.isVaultRequest, true, text);
    assert.equal(res.providerHint, provider, text);
    assert.notEqual(res.intentKind, "switch_provider", text);
  }
});

test("cambiar de proveedor sigue siendo inmediato", () => {
  for (const [text, provider] of [
    ["usa deepseek", "deepseek"],
    ["cambia a gemini por favor", "gemini"],
    ["cámbiate a claude", "anthropic"],
    ["cambia el modelo a gemini 2.5 flash", "gemini"],
    ["usa claude opus 5.5", "anthropic"],
    ["puedes usar groq?", "groq"],
    ["usa gpt-5.5 ahora", "openai"],
    ["selecciona kimi en este chat", "kimi"],
  ] as const) {
    const res = detectVaultConfigRequest(text);
    assert.equal(res.isVaultRequest, true, text);
    assert.equal(res.providerHint, provider, text);
    assert.equal(res.intentKind, "switch_provider", text);
  }
});

test("el código de otro proyecto no se confunde con XOOK", () => {
  assert.equal(isVault("configura mi api key de openai en python"), false);
  assert.equal(isVault("configura la api key de openai en xook, no en python"), true);
});
