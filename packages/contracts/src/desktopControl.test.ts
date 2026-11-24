import test from "node:test";
import assert from "node:assert/strict";
import {
  desktopOperationToRiskTier,
  isBlockedKeyCombo,
  isElectronOrChromiumApp,
  isHighRiskUiTargetLabel,
  isQualifiedDesktopRef,
} from "./desktopControl.ts";

test("isQualifiedDesktopRef accepts qualified sN:@eM refs and rejects bare refs", () => {
  assert.equal(isQualifiedDesktopRef("s1:@e1"), true);
  assert.equal(isQualifiedDesktopRef("s42:@e108"), true);
  assert.equal(isQualifiedDesktopRef("@e1"), false);
  assert.equal(isQualifiedDesktopRef("s0:@e1"), false);
  assert.equal(isQualifiedDesktopRef("s1:@e0"), false);
  assert.equal(isQualifiedDesktopRef(""), false);
});

test("isHighRiskUiTargetLabel flags commit and destructive UI buttons", () => {
  assert.equal(isHighRiskUiTargetLabel("Enviar correo"), true);
  assert.equal(isHighRiskUiTargetLabel("Delete Row"), true);
  assert.equal(isHighRiskUiTargetLabel("Confirmar pago"), true);
  assert.equal(isHighRiskUiTargetLabel("Cerrar sesión"), true);
  assert.equal(isHighRiskUiTargetLabel("Guardar borrador"), false);
  assert.equal(isHighRiskUiTargetLabel("Buscar archivo"), false);
});

test("isHighRiskUiTargetLabel flags assignment turn-in buttons", () => {
  assert.equal(isHighRiskUiTargetLabel("Entregar"), true);
  assert.equal(isHighRiskUiTargetLabel("Turn in assignment"), true);
  assert.equal(isHighRiskUiTargetLabel("Hand in"), true);
  assert.equal(isHighRiskUiTargetLabel("Submit"), true);
  assert.equal(isHighRiskUiTargetLabel("Ver tareas entregadas"), false);
  assert.equal(isHighRiskUiTargetLabel("Adjuntar archivo"), false);
});

test("isBlockedKeyCombo catches dangerous macOS shortcuts and modifier supersets", () => {
  assert.equal(isBlockedKeyCombo("cmd+q"), true);
  assert.equal(isBlockedKeyCombo("Shift+Command+Q"), true);
  assert.equal(isBlockedKeyCombo("option+cmd+escape"), true);
  assert.equal(isBlockedKeyCombo("cmd+shift+backspace"), true);
  assert.equal(isBlockedKeyCombo("cmd+return"), false);
  assert.equal(isBlockedKeyCombo("return"), false);
  assert.equal(isBlockedKeyCombo("cmd+l"), false);
});

test("desktopOperationToRiskTier maps operations to agentPolicy risk tiers", () => {
  assert.equal(desktopOperationToRiskTier("list_windows"), "read_safe");
  assert.equal(desktopOperationToRiskTier("snapshot"), "read_sensitive");
  assert.equal(desktopOperationToRiskTier("find"), "read_sensitive");
  assert.equal(desktopOperationToRiskTier("scroll_to"), "write_local");
  assert.equal(desktopOperationToRiskTier("type_text", false), "write_protected_hitl");
  assert.equal(desktopOperationToRiskTier("type_text", true), "destructive");
  assert.equal(desktopOperationToRiskTier("press_key", true), "destructive");
});

test("isElectronOrChromiumApp detects Antigravity, VS Code, Chrome, Slack and ignores native macOS apps", () => {
  assert.equal(isElectronOrChromiumApp("com.google.antigravity", "Antigravity"), true);
  assert.equal(isElectronOrChromiumApp("com.microsoft.VSCode", "Code"), true);
  assert.equal(isElectronOrChromiumApp("com.tinyspeck.slackmacgap", "Slack"), true);
  assert.equal(isElectronOrChromiumApp("", "Google Chrome"), true);
  assert.equal(isElectronOrChromiumApp("com.apple.finder", "Finder"), false);
  assert.equal(isElectronOrChromiumApp("com.apple.Notes", "Notes"), false);
});
