"use strict";
// desk-pet: the menus' Walk Around checkbox reads and writes the freeRoam
// preference through the settings controller, and redraws when it changes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { it } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8").replace(/\r\n/g, "\n");

it("exposes free roam to the menu through the settings controller", () => {
  const start = source.indexOf("const _menuCtx = {");
  const end = source.indexOf('const _menu = require("./menu")(_menuCtx);', start);
  assert.ok(start >= 0 && end > start, "missing menu context");
  const menuCtx = source.slice(start, end);
  assert.ok(menuCtx.includes('get freeRoam() { return _settingsController.get("freeRoam") === true; },'));
  assert.ok(menuCtx.includes('set freeRoam(v) { _settingsController.applyUpdate("freeRoam", v === true); },'));
});

it("redraws the menus when free roam changes", () => {
  const start = source.indexOf('_settingsController.subscribeKey("freeRoam", (value) => {');
  assert.ok(start >= 0, "missing freeRoam subscriber");
  const body = source.slice(start, source.indexOf("});", start));
  assert.ok(body.includes("_roam.setEnabled(value === true);"));
  assert.ok(body.includes("rebuildAllMenus();"), "the Walk Around checkbox must follow Settings changes");
});
