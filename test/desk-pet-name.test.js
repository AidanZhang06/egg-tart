"use strict";
// desk-pet: the standalone build is called "Egg Tart" everywhere she can see.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DESK_PET_APP_NAME, renameForDeskPet } = require("../src/desk-pet-name");

const SRC = path.join(__dirname, "..", "src");

describe("renameForDeskPet", () => {
  it("swaps the brand name for Egg Tart", () => {
    assert.equal(DESK_PET_APP_NAME, "Egg Tart");
    assert.equal(renameForDeskPet("Clawd Settings"), "Egg Tart Settings");
    assert.equal(renameForDeskPet("Start Clawd automatically when you log in."), "Start Egg Tart automatically when you log in.");
    assert.equal(renameForDeskPet("Clawd on Desk is open source"), "Egg Tart is open source");
    assert.equal(renameForDeskPet("Wake Clawd"), "Wake Egg Tart");
    assert.equal(renameForDeskPet("Clawd 设置"), "Egg Tart 设置");
  });

  it("leaves file names, env vars and non-strings alone", () => {
    assert.equal(renameForDeskPet("Restore clawd-prefs.json"), "Restore clawd-prefs.json");
    assert.equal(renameForDeskPet("set CLAWD_TG_PROXY"), "set CLAWD_TG_PROXY");
    assert.equal(renameForDeskPet(undefined), undefined);
    assert.equal(renameForDeskPet(42), 42);
  });
});

describe("Egg Tart naming is wired in", () => {
  it("names the packaged app Egg Tart", () => {
    const pkg = require("../package.json");
    assert.equal(pkg.build.productName, "Egg Tart");
    assert.equal(pkg.build.mac.artifactName, "Egg-Tart-${version}-${arch}.${ext}");
  });

  it("loads the renamer before the Settings text code and uses it in t()", () => {
    const html = fs.readFileSync(path.join(SRC, "settings.html"), "utf8");
    const nameAt = html.indexOf('<script src="desk-pet-name.js"></script>');
    assert.ok(nameAt >= 0 && nameAt < html.indexOf('<script src="settings-ui-core.js"></script>'));
    const core = fs.readFileSync(path.join(SRC, "settings-ui-core.js"), "utf8");
    assert.match(core, /root\.ClawdDeskPetName/);
    assert.match(core, /function t\(key\) \{[\s\S]{0,200}renameText\(/);
  });

  it("titles the Settings window with the pet's name", () => {
    const main = fs.readFileSync(path.join(SRC, "main.js"), "utf8");
    assert.ok(main.includes('getTitle: () => (DESK_PET_EDITION ? renameForDeskPet(translate("settingsWindowTitle")) : translate("settingsWindowTitle")),'));
  });
});
