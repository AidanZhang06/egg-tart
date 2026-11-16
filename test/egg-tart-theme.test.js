"use strict";
// desk-pet: the built-in Egg Tart theme is the standalone pet's default look.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { listIdleActivityCandidates, pickDuration } = require("../src/idle-activity");

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

  it("plays its hobby scenes in the activity rotation for whole loops", () => {
    const theme = loadTheme();
    const hobbies = listIdleActivityCandidates(theme)
      .filter((candidate) => candidate.files[0].startsWith("hobby-"))
      .map((candidate) => [candidate.files[0], candidate.duration]);
    // Whole loops: 4.8 s and 4 s loops play three times, 8 s loops twice.
    assert.deepEqual(hobbies, [
      ["hobby-crochet.svg", 14400],
      ["hobby-reading.svg", 14400],
      ["hobby-music.svg", 12000],
      ["hobby-bubbletea.svg", 12000],
      ["hobby-science.svg", 12000],
      ["hobby-painting.svg", 16000],
      ["hobby-gardening.svg", 16000],
    ]);
    // Scenes whose effects reach right mirror near the right screen edge;
    // bubble tea's heart floats up-left, so it never needs to.
    const mirrored = theme.idleAnimations
      .filter((entry) => entry.mirrorOnRightSide === true)
      .map((entry) => entry.file);
    assert.deepEqual(mirrored, [
      "hobby-crochet.svg", "hobby-reading.svg", "hobby-music.svg",
      "hobby-science.svg", "hobby-painting.svg", "hobby-gardening.svg",
    ]);
  });

  it("holds up each kind of sign from signs.json as its own rotation slot", () => {
    const theme = loadTheme();
    const doc = JSON.parse(fs.readFileSync(path.join(THEME_DIR, "signs.json"), "utf8"));
    const kinds = Object.keys(doc.kinds);
    assert.deepEqual(kinds.sort(), ["encouragement", "love", "missing"]);
    const signSlots = listIdleActivityCandidates(theme).filter((candidate) => candidate.files[0].startsWith("sign-"));
    // One slot per kind, each weighted like one hobby, holding exactly that kind's signs.
    assert.equal(signSlots.length, kinds.length);
    for (const kind of kinds) {
      const expected = doc.signs.filter((sign) => sign.kind === kind).map((sign) => sign.file);
      assert.ok(expected.length > 0, kind);
      assert.ok(signSlots.some((slot) => JSON.stringify(slot.files) === JSON.stringify(expected)), `slot for ${kind}`);
    }
    // 550 ms rise plus six whole 2 s sways.
    for (const slot of signSlots) assert.equal(slot.duration, 12550);
    const listed = doc.signs.map((sign) => sign.file);
    const shipped = fs.readdirSync(ASSETS_DIR).filter((file) => file.startsWith("sign-")).sort();
    assert.deepEqual(shipped, [...listed].sort(), "no stale or missing sign files");
    for (const entry of theme.idleAnimations.filter((e) => e.file.startsWith("sign-"))) {
      assert.notEqual(entry.mirrorOnRightSide, true, `${entry.file} has text and must never mirror`);
    }
  });

  it("falls asleep through the full yawn, doze and collapse sequence", () => {
    const theme = loadTheme();
    assert.equal(theme.sleepSequence.mode, "full");
    for (const state of ["yawning", "dozing", "collapsing"]) {
      assert.deepEqual(theme.states[state], [`${state}.svg`], state);
    }
    // yawning.svg plays for 3 s; collapsing.svg hands off to sleeping at 2.4 s.
    assert.ok(theme.timings.yawnDuration >= 3000);
    assert.equal(theme.timings.collapseDuration, 2400);
    // Dozing keeps cursor eye tracking and opens its eyes smoothly on wake.
    assert.ok(theme.eyeTracking.states.includes("dozing"));
    const dozing = fs.readFileSync(path.join(ASSETS_DIR, "dozing.svg"), "utf8");
    assert.match(dozing, /id="eyes-js"/);
    assert.match(dozing, /id="eyes-doze"/);
  });

  it("reacts to double-clicks and to being spun dizzy", () => {
    const theme = loadTheme();
    assert.deepEqual(theme.reactions.double, { files: ["react-double.svg"], duration: 3500 });
    assert.deepEqual(theme.states.dizzy, ["dizzy.svg"]);
    assert.equal(theme.timings.autoReturn.dizzy, 6000);
  });

  it("plays each activity for about ten seconds of whole loops", () => {
    const theme = loadTheme();
    // thinking 4.8 s ×2, working 1.6 s ×6, juggling 2 s ×5, attention 2.8 s ×4,
    // sweeping 10 s ×1, carrying 3 s ×4.
    const expected = { thinking: 9600, working: 9600, juggling: 10000, attention: 11200, sweeping: 10000, carrying: 12000 };
    for (const [state, ms] of Object.entries(expected)) {
      assert.equal(pickDuration(theme, state, Math.random), ms, state);
    }
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
