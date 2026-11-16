"use strict";

const assert = require("node:assert");
const Module = require("node:module");
const { describe, it } = require("node:test");
const { createTranslator } = require("../src/i18n");

const MENU_MODULE_PATH = require.resolve("../src/menu");
const t = createTranslator(() => "en");

function loadMenu(platform = "darwin") {
  delete require.cache[MENU_MODULE_PATH];
  const fakeElectron = {
    app: { quit: () => {}, setActivationPolicy: () => {}, dock: { show: () => {}, hide: () => {} } },
    BrowserWindow: function BrowserWindow() {},
    Menu: { buildFromTemplate: (template) => ({ template }) },
    Tray: function Tray() {
      this.setToolTip = () => {};
      this.setContextMenu = (menu) => { this.contextMenu = menu; };
      this.destroy = () => {};
    },
    nativeImage: {
      createFromPath() {
        return { resize() { return this; }, setTemplateImage() {} };
      },
    },
    screen: {
      getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ id: 1 }),
    },
  };
  const originalLoad = Module._load;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
  Module._load = function patchedLoad(request) {
    if (request === "electron") return fakeElectron;
    return originalLoad.apply(this, arguments);
  };
  try {
    return require("../src/menu");
  } finally {
    Module._load = originalLoad;
    Object.defineProperty(process, "platform", originalPlatform);
  }
}

function buildCtx(overrides = {}) {
  return {
    win: { isDestroyed: () => false },
    sessions: new Map(),
    currentSize: "P:15",
    doNotDisturb: false,
    lang: "en",
    showTray: true,
    showDock: false,
    openAtLogin: false,
    hideBubbles: false,
    soundMuted: false,
    petHidden: false,
    tray: null,
    contextMenu: null,
    getMiniMode: () => false,
    getMiniTransitioning: () => false,
    getDisableMiniMode: () => false,
    getActiveThemeCapabilities: () => ({ miniMode: true }),
    getPermissionAutomationMode: () => "ask",
    getUpdateMenuItem: () => ({ label: "UPDATE-ITEM", click: () => {} }),
    openDashboard: () => {},
    openSettingsWindow: () => {},
    setPetVisibility: () => {},
    bringPetToPrimaryDisplay: () => {},
    enableDoNotDisturb: () => {},
    disableDoNotDisturb: () => {},
    enterMiniViaMenu: () => {},
    exitMiniMode: () => {},
    ...overrides,
  };
}

function labelsOf(template) {
  return template.filter((item) => item && typeof item.label === "string").map((item) => item.label);
}

function buildBoth(ctxOverrides) {
  const initMenu = loadMenu();
  const ctx = buildCtx(ctxOverrides);
  const menu = initMenu(ctx);
  menu.createTray();
  menu.buildContextMenu();
  return { tray: labelsOf(ctx.tray.contextMenu.template), context: labelsOf(ctx.contextMenu.template) };
}

const AI_LABELS = [t("openDashboard"), t("openRecap"), t("newSession"), t("hideBubbles"), "UPDATE-ITEM"];

describe("desk pet menus", () => {
  it("hides AI-tool and update items from the tray and right-click menus", () => {
    const { tray, context } = buildBoth({ deskPetEdition: true });
    for (const [name, labels] of [["tray", tray], ["context", context]]) {
      for (const hidden of AI_LABELS) {
        assert.ok(!labels.includes(hidden), `${name} menu should not contain ${hidden}`);
      }
      assert.ok(!labels.some((label) => label.startsWith(t("menuPermissionAutomation"))),
        `${name} menu should not contain permission handling`);
      for (const kept of [t("settings"), t("quit"), t("sleep"), t("hidePet"), t("miniMode")]) {
        assert.ok(labels.includes(kept), `${name} menu should keep ${kept}`);
      }
    }
    for (const kept of [t("soundEffects"), t("startOnLogin")]) {
      assert.ok(tray.includes(kept), `tray menu should keep ${kept}`);
    }
  });

  it("keeps the upstream items when the edition flag is unset", () => {
    const { tray, context } = buildBoth({});
    assert.ok(tray.includes(t("openDashboard")));
    assert.ok(context.includes(t("openDashboard")));
    assert.ok(context.includes("UPDATE-ITEM"));
  });
});

describe("desk pet menu templates", () => {
  it("never hands Electron an empty or null menu entry", () => {
    const initMenu = loadMenu();
    const ctx = buildCtx({ deskPetEdition: true });
    const menu = initMenu(ctx);
    menu.createTray();
    menu.buildContextMenu();
    for (const template of [ctx.tray.contextMenu.template, ctx.contextMenu.template]) {
      for (const item of template) assert.ok(item && typeof item === "object", "menu entries are objects");
      for (let i = 1; i < template.length; i += 1) {
        assert.ok(!(template[i].type === "separator" && template[i - 1].type === "separator"), "no doubled separators");
      }
    }
  });
});
