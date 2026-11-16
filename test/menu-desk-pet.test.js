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

describe("desk pet walk-around toggle", () => {
  function findWalk(template) {
    return template.find((item) => item && item.label === t("walkAround"));
  }

  it("shows a Walk Around checkbox in both menus that mirrors and changes free roam", () => {
    for (const walking of [true, false]) {
      const initMenu = loadMenu();
      const ctx = buildCtx({ deskPetEdition: true, freeRoam: walking });
      const menu = initMenu(ctx);
      menu.createTray();
      menu.buildContextMenu();
      for (const template of [ctx.tray.contextMenu.template, ctx.contextMenu.template]) {
        const item = findWalk(template);
        assert.ok(item, "Walk Around item present");
        assert.equal(item.type, "checkbox");
        assert.equal(item.checked, walking);
        item.click({ checked: !walking });
        assert.equal(ctx.freeRoam, !walking);
        ctx.freeRoam = walking;
      }
    }
  });

  it("is not added to the upstream menus", () => {
    const { tray, context } = buildBoth({ freeRoam: true });
    assert.ok(!tray.includes(t("walkAround")));
    assert.ok(!context.includes(t("walkAround")));
  });
});

describe("desk pet size menu", () => {
  const PRESETS = [
    ["petSizeSmall", "P:6"],
    ["petSizeMedium", "P:9"],
    ["petSizeLarge", "P:13"],
    ["petSizeExtraLarge", "P:18"],
  ];

  function sizeCtx(overrides = {}) {
    const applied = [];
    const ctx = buildCtx({
      deskPetEdition: true,
      currentSize: "P:9",
      getPixelSizeFor: (key) => ({ width: Number(key.slice(2)) * 10, height: Number(key.slice(2)) * 10 }),
      miniHandleResize: () => false,
      getPetWindowBounds: () => ({ x: 100, y: 100, width: 90, height: 90 }),
      clampToScreenVisual: (x, y) => ({ x, y }),
      applyPetWindowBounds: (bounds) => applied.push(bounds),
      syncHitWin() {},
      repositionBubbles() {},
      flushRuntimeStateToPrefs() {},
      ...overrides,
    });
    return { ctx, applied };
  }

  it("offers Small, Medium, Large and Extra Large in both menus, checking the current size", () => {
    const initMenu = loadMenu();
    const { ctx } = sizeCtx({ currentSize: "P:13" });
    const menu = initMenu(ctx);
    menu.createTray();
    menu.buildContextMenu();
    for (const template of [ctx.tray.contextMenu.template, ctx.contextMenu.template]) {
      const sizeItem = template.find((item) => item && item.label === t("size"));
      assert.ok(sizeItem && Array.isArray(sizeItem.submenu), "Size submenu present");
      assert.deepEqual(sizeItem.submenu.map((item) => item.label), PRESETS.map(([key]) => t(key)));
      assert.ok(sizeItem.submenu.every((item) => item.type === "radio"));
      assert.deepEqual(sizeItem.submenu.map((item) => item.checked), [false, false, true, false]);
    }
  });

  it("resizes and saves the chosen size", () => {
    const initMenu = loadMenu();
    const { ctx, applied } = sizeCtx();
    const menu = initMenu(ctx);
    menu.buildContextMenu();
    const sizeItem = ctx.contextMenu.template.find((item) => item && item.label === t("size"));
    sizeItem.submenu.find((item) => item.label === t("petSizeExtraLarge")).click();
    assert.equal(ctx.currentSize, "P:18");
    assert.deepEqual(applied.at(-1), { x: 100, y: 100, width: 180, height: 180 });
  });

  it("is not added to the upstream menus", () => {
    const { tray, context } = buildBoth({});
    assert.ok(!tray.includes(t("size")));
    assert.ok(!context.includes(t("size")));
  });
});
