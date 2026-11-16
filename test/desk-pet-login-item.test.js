"use strict";
// desk-pet: Egg Tart turns on Start on Login by itself, once, the first time it
// runs from the Applications folder, so she doesn't have to find the setting.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { enableLoginItemOnce } = require("../src/desk-pet-edition");

function deps(overrides = {}) {
  const calls = { enable: 0, marker: 0 };
  return {
    calls,
    markerExists: () => false,
    isInApplicationsFolder: () => true,
    enable: () => { calls.enable += 1; return { status: "ok" }; },
    writeMarker: () => { calls.marker += 1; },
    ...overrides,
  };
}

describe("enableLoginItemOnce", () => {
  it("turns Start on Login on the first run from Applications and remembers it", async () => {
    const d = deps();
    assert.equal(await enableLoginItemOnce(d), "enabled");
    assert.deepEqual(d.calls, { enable: 1, marker: 1 });
  });

  it("does nothing once it has run, so turning it off sticks", async () => {
    const d = deps({ markerExists: () => true });
    assert.equal(await enableLoginItemOnce(d), "already");
    assert.deepEqual(d.calls, { enable: 0, marker: 0 });
  });

  it("waits while the app runs from the disk image instead of Applications", async () => {
    const d = deps({ isInApplicationsFolder: () => false });
    assert.equal(await enableLoginItemOnce(d), "not-installed");
    assert.deepEqual(d.calls, { enable: 0, marker: 0 });
  });

  it("retries next launch if the system refuses", async () => {
    for (const enable of [
      () => ({ status: "error", message: "denied" }),
      () => Promise.resolve({ status: "error", message: "denied" }),
      () => { throw new Error("boom"); },
      () => Promise.reject(new Error("boom")),
    ]) {
      const d = deps({ enable });
      assert.equal(await enableLoginItemOnce(d), "failed");
      assert.equal(d.calls.marker, 0);
    }
  });

  it("accepts an asynchronous success", async () => {
    const d = deps({ enable: () => Promise.resolve({ status: "ok" }) });
    assert.equal(await enableLoginItemOnce(d), "enabled");
    assert.equal(d.calls.marker, 1);
  });
});

describe("main.js wiring", () => {
  it("tries it right after the login setting is read from the system", () => {
    const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
    const at = main.indexOf("    hydrateSystemBackedSettings();\n");
    assert.ok(at >= 0);
    const next = main.slice(at, at + 400);
    assert.ok(next.includes("maybeEnableDeskPetLoginItem();"), "called after hydration");
    assert.match(main, /function maybeEnableDeskPetLoginItem\(\) \{\n  if \(!DESK_PET_EDITION \|\| !isMac\) return;/);
    assert.ok(main.includes('_settingsController.applyUpdate("openAtLogin", true)'));
    assert.ok(main.includes("app.isInApplicationsFolder()"));
  });
});
