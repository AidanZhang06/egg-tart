"use strict";
// desk-pet: the bunny build is called "Bun" everywhere she can see.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DESK_PET_APP_NAME, renameForDeskPet } = require("../src/desk-pet-name");

const SRC = path.join(__dirname, "..", "src");

describe("renameForDeskPet", () => {
  it("swaps the brand name for Bun", () => {
    assert.equal(DESK_PET_APP_NAME, "Bun");
    assert.equal(renameForDeskPet("Clawd Settings"), "Bun Settings");
    assert.equal(renameForDeskPet("Start Clawd automatically when you log in."), "Start Bun automatically when you log in.");
    assert.equal(renameForDeskPet("Clawd on Desk is open source"), "Bun is open source");
    assert.equal(renameForDeskPet("Wake Clawd"), "Wake Bun");
    assert.equal(renameForDeskPet("Clawd 设置"), "Bun 设置");
  });

  it("leaves file names, env vars and non-strings alone", () => {
    assert.equal(renameForDeskPet("Restore clawd-prefs.json"), "Restore clawd-prefs.json");
    assert.equal(renameForDeskPet("set CLAWD_TG_PROXY"), "set CLAWD_TG_PROXY");
    assert.equal(renameForDeskPet(undefined), undefined);
    assert.equal(renameForDeskPet(42), 42);
  });
});

describe("Bun naming is wired in", () => {
  it("names the packaged app and its installers Bun", () => {
    const pkg = require("../package.json");
    assert.equal(pkg.build.productName, "Bun");
    // Its own app id, so it installs beside (never over) an Egg Tart build.
    assert.equal(pkg.build.appId, "com.clawd.desk-pet.bun");
    assert.equal(pkg.build.win.artifactName, "Bun-Setup-${version}-${arch}.${ext}");
    assert.equal(pkg.build.mac.artifactName, "Bun-${version}-${arch}.${ext}");
    assert.equal(pkg.build.win.icon, "assets/icon.ico");
    assert.equal(pkg.build.mac.icon, "assets/dock-icon.png");
  });

  it("loads the renamer before the Settings text code and uses it in t()", () => {
    const html = fs.readFileSync(path.join(SRC, "settings.html"), "utf8").replace(/\r\n/g, "\n");
    const nameAt = html.indexOf('<script src="desk-pet-name.js"></script>');
    assert.ok(nameAt >= 0 && nameAt < html.indexOf('<script src="settings-ui-core.js"></script>'));
    const core = fs.readFileSync(path.join(SRC, "settings-ui-core.js"), "utf8").replace(/\r\n/g, "\n");
    assert.match(core, /root\.ClawdDeskPetName/);
    assert.match(core, /function t\(key\) \{[\s\S]{0,200}renameText\(/);
  });

  it("shows the bunny in Settings → About", () => {
    const main = fs.readFileSync(path.join(SRC, "main.js"), "utf8").replace(/\r\n/g, "\n");
    assert.ok(main.includes('aboutHeroSvgPath: DESK_PET_EDITION\n    ? path.join(__dirname, "..", "themes", DESK_PET_THEME_ID, "about-hero.svg")'));
    assert.equal(require("../src/desk-pet-edition").DESK_PET_THEME_ID, "bunny");
    assert.ok(fs.existsSync(path.join(SRC, "..", "themes", "bunny", "about-hero.svg")));
  });

  it("titles the Settings window with the pet's name", () => {
    const main = fs.readFileSync(path.join(SRC, "main.js"), "utf8").replace(/\r\n/g, "\n");
    assert.ok(main.includes('getTitle: () => (DESK_PET_EDITION ? renameForDeskPet(translate("settingsWindowTitle")) : translate("settingsWindowTitle")),'));
  });
});
