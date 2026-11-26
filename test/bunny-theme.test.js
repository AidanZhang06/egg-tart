"use strict";
// desk-pet: the built-in white bunny theme (themes/bunny) is this build's pet.
// Its art is still growing (scripts/sync-bunny-theme.js pulls each rebuild in),
// so these checks hold for any set of hobbies and any states that have art.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { listIdleActivityCandidates, pickDuration } = require("../src/idle-activity");
const { loopMs, animationDurations, isAmbientAnimation } = require("../scripts/sync-bunny-theme");
const { DESK_PET_THEME_ID } = require("../src/desk-pet-edition");

const THEME_DIR = path.join(__dirname, "..", "themes", "bunny");
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

describe("bunny theme", () => {
  it("is the pet this build ships", () => {
    assert.equal(DESK_PET_THEME_ID, "bunny");
  });

  it("passes the real theme validator", () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "validate-theme.js"), THEME_DIR], {
      encoding: "utf8",
      timeout: 60000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });

  it("ships every asset it references, and nothing stale", () => {
    const theme = loadTheme();
    const referenced = referencedFiles(theme);
    for (const file of referenced) {
      assert.ok(fs.existsSync(path.join(ASSETS_DIR, file)), `missing asset ${file}`);
    }
    // The sync mirrors the art folder; every shipped hobby is registered.
    const hobbies = fs.readdirSync(ASSETS_DIR).filter((file) => /^hobby-.*\.svg$/.test(file)).sort();
    assert.deepEqual(theme.idleAnimations.map((entry) => entry.file).filter((file) => file.startsWith("hobby-")).sort(), hobbies);
    assert.ok(hobbies.length >= 3, "carrot, washing up and dandelion at least");
    // Nothing in assets/ sits unused: every file is a state, a reaction or a hobby.
    const unused = fs.readdirSync(ASSETS_DIR).filter((file) => file.endsWith(".svg") && !referenced.includes(file));
    assert.deepEqual(unused, []);
  });

  it("uses the egg tart's canvas, ground and eye tracking", () => {
    const theme = loadTheme();
    assert.deepEqual(theme.viewBox, { x: -20, y: -34, width: 60, height: 60 });
    assert.equal(theme.layout.centerX, 10);
    assert.equal(theme.eyeTracking.maxOffset, 2);
    assert.equal(theme.eyeTracking.shadowOrigin, "10px 20px");
    assert.deepEqual(
      { eyes: theme.eyeTracking.ids.eyes, body: theme.eyeTracking.ids.body, shadow: theme.eyeTracking.ids.shadow },
      { eyes: "eyes-js", body: "body-js", shadow: "shadow-js" },
    );
    const idleSvg = fs.readFileSync(path.join(ASSETS_DIR, theme.states.idle[0]), "utf8");
    for (const id of ["eyes-js", "body-js", "shadow-js"]) assert.match(idleSvg, new RegExp(`id="${id}"`), id);
    assert.match(idleSvg, /viewBox="-20 -34 60 60"/);
  });

  it("can be grabbed by its ears", () => {
    const theme = loadTheme();
    // Ear tips reach y −2.8; the body spans x 0.4–19.6 and stands on y 20.
    for (const name of ["default", "sleeping"]) {
      const box = theme.hitBoxes[name];
      assert.ok(box.y <= -2.8, `${name} hit box top ${box.y}`);
      assert.ok(box.y + box.h >= 20, `${name} hit box bottom`);
      assert.ok(box.x <= 0.4 && box.x + box.w >= 19.6, `${name} hit box sides`);
    }
    const content = theme.layout.contentBox;
    assert.ok(content.y <= -2.8 && content.y + content.height >= 20);
  });

  it("plays each hobby and sign as whole loops of its animation", () => {
    const theme = loadTheme();
    for (const entry of theme.idleAnimations) {
      const svg = fs.readFileSync(path.join(ASSETS_DIR, entry.file), "utf8");
      assert.ok(loopMs(svg) > 0, `${entry.file} has an animation`);
      assert.ok(entry.duration >= 2000 && entry.duration <= 20000, `${entry.file}: ${entry.duration}`);
      // Every looping scene animation (all but the shared ear bob/twitch)
      // ends on a whole cycle, counted from when it starts.
      for (const { name, ms, delayMs, infinite } of animationDurations(svg)) {
        if (isAmbientAnimation(name) || !infinite) continue;
        assert.equal((entry.duration - delayMs) % ms, 0,
          `${entry.file}: ${name || "animation"} (${ms} ms from ${delayMs} ms) stops mid-cycle at ${entry.duration} ms`);
      }
    }
    // Each hobby is its own rotation slot at its own length.
    const hobbies = theme.idleAnimations.filter((entry) => entry.file.startsWith("hobby-"));
    const slots = listIdleActivityCandidates(theme).filter((candidate) => candidate.files[0].startsWith("hobby-"));
    assert.deepEqual(
      slots.map((slot) => [slot.files, slot.duration]),
      hobbies.map((entry) => [[entry.file], entry.duration]),
    );
  });

  it("holds up each kind of sign from signs.json as its own rotation slot, never mirrored", () => {
    const theme = loadTheme();
    const doc = JSON.parse(fs.readFileSync(path.join(THEME_DIR, "signs.json"), "utf8"));
    const listed = doc.signs.map((sign) => sign.file);
    const shipped = fs.readdirSync(ASSETS_DIR).filter((file) => file.startsWith("sign-")).sort();
    assert.deepEqual(shipped, [...listed].sort(), "no stale or missing sign files");
    const entries = theme.idleAnimations.filter((entry) => entry.file.startsWith("sign-"));
    assert.deepEqual(entries.map((entry) => entry.file), listed);
    for (const sign of doc.signs) {
      const entry = entries.find((candidate) => candidate.file === sign.file);
      assert.equal(entry.activityGroup, `signs-${sign.kind}`, sign.file);
      assert.notEqual(entry.mirrorOnRightSide, true, `${sign.file} has text and must never mirror`);
      // The board has risen and swayed at least once before the bunny puts it down.
      assert.ok(entry.duration >= doc.riseMs + doc.loopMs, `${sign.file}: ${entry.duration} ms`);
    }
    // One slot per kind, weighted like one hobby, holding exactly that kind's signs.
    const kinds = [...new Set(doc.signs.map((sign) => sign.kind))];
    const slots = listIdleActivityCandidates(theme).filter((candidate) => candidate.files[0].startsWith("sign-"));
    assert.deepEqual(
      slots.map((slot) => slot.files),
      kinds.map((kind) => doc.signs.filter((sign) => sign.kind === kind).map((sign) => sign.file)),
    );
  });

  it("borrows idle for states it has no art for, without no-op activity beats", () => {
    const theme = loadTheme();
    const idleFile = theme.states.idle[0];
    for (const state of ["working", "thinking"]) {
      const own = `${state}.svg`;
      const expected = fs.existsSync(path.join(ASSETS_DIR, own)) ? [own] : [idleFile];
      assert.deepEqual(theme.states[state], expected, state);
    }
    for (const candidate of listIdleActivityCandidates(theme)) {
      assert.ok(!candidate.files.includes(idleFile), `${candidate.state} would just show idle`);
    }
    // error and notification borrow the happy hop, like the egg tart.
    assert.deepEqual(theme.states.error, { fallbackTo: "attention" });
    assert.deepEqual(theme.states.notification, { fallbackTo: "attention" });
  });

  it("hops happily for whole 2.8 s sways", () => {
    const theme = loadTheme();
    const happy = fs.readFileSync(path.join(ASSETS_DIR, "attention.svg"), "utf8");
    assert.match(happy, /animation: hop 1\.4s/);
    assert.match(happy, /animation: sway 2\.8s/);
    assert.equal(pickDuration(theme, "attention", Math.random), 11200);
    assert.equal(theme.timings.autoReturn.attention % 1400, 0);
    for (const name of ["clickLeft", "clickRight", "double"]) {
      const reaction = theme.reactions[name];
      const files = reaction.files || [reaction.file];
      if (files[0] === "attention.svg") assert.equal(reaction.duration % 1400, 0, name);
    }
  });
});
