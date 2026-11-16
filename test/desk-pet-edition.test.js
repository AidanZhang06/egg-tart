"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const prefs = require("../src/prefs");
const {
  DESK_PET_EDITION,
  applyDeskPetFirstRunDefaults,
  applyDeskPetToLoadResult,
  gateUpdaterForDeskPet,
} = require("../src/desk-pet-edition");

describe("desk pet edition", () => {
  it("is switched on in this fork", () => {
    assert.strictEqual(DESK_PET_EDITION, true);
  });
});

describe("desk pet first-run defaults", () => {
  it("seed turns on walking and activities", () => {
    const seed = applyDeskPetFirstRunDefaults(prefs.getDefaults());
    assert.strictEqual(seed.freeRoam, true);
    assert.strictEqual(seed.idleActivities, true);
    assert.strictEqual(seed.idleActivityFrequency, "medium");
  });

  it("seed disables every agent integration", () => {
    const seed = applyDeskPetFirstRunDefaults(prefs.getDefaults());
    const ids = Object.keys(seed.agents);
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.strictEqual(seed.agents[id].integrationInstalled, false, `${id}.integrationInstalled`);
      assert.strictEqual(seed.agents[id].enabled, false, `${id}.enabled`);
    }
    assert.strictEqual(seed.agents["claude-code"].enabled, false);
    assert.strictEqual(seed.agents.codex.enabled, false);
  });

  it("seed turns off agent automation, tutorial and updates", () => {
    const seed = applyDeskPetFirstRunDefaults(prefs.getDefaults());
    assert.strictEqual(seed.manageClaudeHooksAutomatically, false);
    assert.strictEqual(seed.autoStartWithClaude, false);
    assert.strictEqual(seed.autoStartWithCodex, false);
    assert.strictEqual(seed.tutorialSeen, true);
    assert.strictEqual(seed.autoUpdateCheck, false);
  });

  it("seed survives prefs.validate", () => {
    const v = prefs.validate(applyDeskPetFirstRunDefaults(prefs.getDefaults()));
    assert.strictEqual(v.freeRoam, true);
    assert.strictEqual(v.idleActivities, true);
    assert.strictEqual(v.manageClaudeHooksAutomatically, false);
    assert.strictEqual(v.tutorialSeen, true);
    assert.strictEqual(v.autoUpdateCheck, false);
    assert.strictEqual(v.agents["claude-code"].integrationInstalled, false);
    assert.strictEqual(v.agents["claude-code"].enabled, false);
    assert.strictEqual(v.agents.codex.integrationInstalled, false);
    assert.strictEqual(v.agents.codex.enabled, false);
  });

  it("seed does not mutate input", () => {
    const input = prefs.getDefaults();
    const before = structuredClone(input);
    applyDeskPetFirstRunDefaults(input);
    assert.deepStrictEqual(input, before);
  });
});

describe("desk pet load-result seeding", () => {
  it("load result is seeded only when fresh or recovered", () => {
    for (const flags of [{ fresh: true }, { recovered: true }, { recovered: true, locked: true }]) {
      const loadResult = { snapshot: prefs.getDefaults(), ...flags };
      const out = applyDeskPetToLoadResult(loadResult);
      assert.strictEqual(out.snapshot.freeRoam, true, JSON.stringify(flags));
      assert.strictEqual(out.snapshot.agents["claude-code"].enabled, false, JSON.stringify(flags));
      for (const [key, value] of Object.entries(flags)) assert.strictEqual(out[key], value);
    }
    for (const flags of [{}, { locked: true }]) {
      const loadResult = { snapshot: prefs.getDefaults(), ...flags };
      assert.strictEqual(applyDeskPetToLoadResult(loadResult), loadResult, JSON.stringify(flags));
    }
  });
});

describe("desk pet updater gate", () => {
  function fakeUpdater(calls) {
    const record = (name, value) => (...args) => { calls.push(name); return value; };
    return {
      setupAutoUpdater: record("setupAutoUpdater"),
      startUpdateScheduler: record("startUpdateScheduler"),
      stopUpdateScheduler: record("stopUpdateScheduler"),
      checkForUpdates: record("checkForUpdates", Promise.resolve({ state: "available" })),
      getUpdateMenuItem: record("getUpdateMenuItem", { label: "Check for Updates" }),
      getUpdateCheckSnapshot: record("getUpdateCheckSnapshot", { state: "idle" }),
    };
  }

  it("never reaches the real scheduler, setup, check or menu item", async () => {
    const calls = [];
    const gated = gateUpdaterForDeskPet(fakeUpdater(calls));
    gated.setupAutoUpdater();
    gated.startUpdateScheduler();
    assert.deepStrictEqual(await gated.checkForUpdates(true), { state: "idle" });
    assert.deepStrictEqual(await gated.checkForUpdates({ trigger: "scheduled", intent: "download" }), { state: "idle" });
    assert.strictEqual(gated.getUpdateMenuItem(), null);
    assert.deepStrictEqual(calls, []);
  });

  it("passes through harmless read and stop helpers", () => {
    const calls = [];
    const gated = gateUpdaterForDeskPet(fakeUpdater(calls));
    gated.stopUpdateScheduler();
    assert.deepStrictEqual(gated.getUpdateCheckSnapshot(), { state: "idle" });
    assert.deepStrictEqual(calls, ["stopUpdateScheduler", "getUpdateCheckSnapshot"]);
  });
});

describe("desk pet package config", () => {
  it("ships no update feed (build.publish is null)", () => {
    const pkg = require("../package.json");
    assert.strictEqual(pkg.build.publish, null);
  });
});
