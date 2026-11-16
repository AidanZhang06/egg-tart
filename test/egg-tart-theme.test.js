"use strict";
// desk-pet: the built-in Egg Tart theme is the standalone pet's default look.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { listIdleActivityCandidates } = require("../src/idle-activity");

const THEME_DIR = path.join(__dirname, "..", "themes", "egg-tart");
const ASSETS_DIR = path.join(THEME_DIR, "assets");

function loadTheme() {
  return JSON.parse(fs.readFileSync(path.join(THEME_DIR, "theme.json"), "utf8"));
}

function referencedFiles(theme) {
  const files = new Set();
  for (const binding of Object.values(theme.states)) {
    const list = Array.isArray(binding) ? binding : (binding && binding.files) || [];
    for (const file of list) files.add(file);
  }
  for (const reaction of Object.values(theme.reactions || {})) {
    if (reaction.file) files.add(reaction.file);
    for (const file of reaction.files || []) files.add(file);
  }
  for (const entry of theme.idleAnimations || []) files.add(entry.file);
  return [...files];
}

describe("egg tart theme", () => {
  it("passes the real theme validator", () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "validate-theme.js"), THEME_DIR], {
      encoding: "utf8",
      timeout: 60000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });

  it("ships every asset it references", () => {
    for (const file of referencedFiles(loadTheme())) {
      assert.ok(fs.existsSync(path.join(ASSETS_DIR, file)), `missing asset ${file}`);
    }
  });

  it("gives each activity its own distinct animation", () => {
    const theme = loadTheme();
    const activityStates = listIdleActivityCandidates(theme)
      .filter((candidate) => candidate.state !== "idle")
      .map((candidate) => candidate.state)
      .sort();
    assert.deepEqual(activityStates, ["attention", "carrying", "juggling", "sweeping", "thinking", "working"]);
    const files = activityStates.map((state) => theme.states[state][0]);
    assert.equal(new Set(files).size, files.length, "activity states must not share a file");
  });

  it("walks, sleeps, wakes and tracks the cursor with its own art", () => {
    const theme = loadTheme();
    for (const state of ["idle", "roam", "sleeping", "waking"]) {
      assert.ok(Array.isArray(theme.states[state]) && theme.states[state].length > 0, state);
    }
    assert.notEqual(theme.states.roam[0], theme.states.idle[0]);
    const idleSvg = fs.readFileSync(path.join(ASSETS_DIR, theme.states.idle[0]), "utf8");
    assert.match(idleSvg, /id="eyes-js"/);
  });
});
