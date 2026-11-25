"use strict";
// desk-pet: scripts/sync-bunny-theme.js pulls each rebuild of the bunny art
// into themes/bunny, and scripts/make-bunny-icons.js redraws the app icons.
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { syncBunnyTheme, loopMs, hobbyDuration } = require("../scripts/sync-bunny-theme");
const { makeBunnyIcons, svgRects, ICO_SIZES } = require("../scripts/make-bunny-icons");

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

const anim = (seconds) => `<svg><defs><style>.a { animation: a ${seconds}s infinite linear; } .b { animation: b 1.4s infinite; }</style></defs></svg>`;

function fixture({ art, themeAssets = {}, theme = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bunny-sync-"));
  tempDirs.push(root);
  const sourceDir = path.join(root, "art");
  const themeDir = path.join(root, "theme");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(path.join(themeDir, "assets"), { recursive: true });
  for (const [file, body] of Object.entries(art)) fs.writeFileSync(path.join(sourceDir, file), body);
  for (const [file, body] of Object.entries(themeAssets)) fs.writeFileSync(path.join(themeDir, "assets", file), body);
  fs.writeFileSync(path.join(themeDir, "theme.json"), JSON.stringify({
    name: "Bun",
    eyeTracking: { enabled: true, states: ["idle"] },
    timings: { mouseSleepTimeout: 60000 },
    ...theme,
  }));
  const read = () => JSON.parse(fs.readFileSync(path.join(themeDir, "theme.json"), "utf8"));
  return { sourceDir, themeDir, read };
}

describe("loop lengths", () => {
  it("reads the longest CSS animation in a file", () => {
    assert.equal(loopMs(anim(12)), 12000);
    assert.equal(loopMs(anim(13.8)), 13800);
    assert.equal(loopMs("<style>.x { animation: x 900ms infinite; }</style>"), 900);
    assert.equal(loopMs("<svg/>"), 0);
  });

  it("plays whole loops close to 12 s and never past 20 s", () => {
    assert.equal(hobbyDuration(12000), 12000);
    assert.equal(hobbyDuration(14000), 14000);
    assert.equal(hobbyDuration(13800), 13800);
    assert.equal(hobbyDuration(7200), 14400);
    assert.equal(hobbyDuration(4000), 12000);
    assert.equal(hobbyDuration(25000), 20000);
    assert.equal(hobbyDuration(0), 12000);
  });
});

describe("syncBunnyTheme", () => {
  it("mirrors the art, registers every hobby and falls back where art is missing", () => {
    const { sourceDir, themeDir, read } = fixture({
      art: {
        "idle.svg": "<svg>idle v2</svg>",
        "attention.svg": anim(2.8),
        "hobby-carrot.svg": anim(12),
        "hobby-grooming.svg": anim(13.8),
      },
      themeAssets: { "idle.svg": "<svg>idle v1</svg>", "hobby-old.svg": "<svg>old</svg>" },
      theme: { idleAnimations: [{ file: "hobby-grooming.svg", duration: 8000, mirrorOnRightSide: false }] },
    });

    const result = syncBunnyTheme({ sourceDir, themeDir });

    assert.deepEqual(result.removed, ["hobby-old.svg"]);
    assert.deepEqual(fs.readdirSync(path.join(themeDir, "assets")).sort(),
      ["attention.svg", "hobby-carrot.svg", "hobby-grooming.svg", "idle.svg"]);
    assert.equal(fs.readFileSync(path.join(themeDir, "assets", "idle.svg"), "utf8"), "<svg>idle v2</svg>");
    const theme = read();
    assert.deepEqual(theme.idleAnimations, [
      { file: "hobby-carrot.svg", duration: 12000, mirrorOnRightSide: true },
      // a hand-set mirror choice is kept; the length follows the art
      { file: "hobby-grooming.svg", duration: 13800, mirrorOnRightSide: false },
    ]);
    assert.deepEqual(theme.states, {
      idle: ["idle.svg"],
      attention: ["attention.svg"],
      working: ["idle.svg"],
      thinking: ["idle.svg"],
      roam: { fallbackTo: "idle" },
      sleeping: { fallbackTo: "idle" },
      error: { fallbackTo: "attention" },
      notification: { fallbackTo: "attention" },
    });
    assert.deepEqual(theme.sleepSequence, { mode: "direct" });
    assert.deepEqual(theme.reactions.double, { files: ["attention.svg"], duration: 2800 });
    assert.deepEqual(theme.reactions.clickLeft, { file: "attention.svg", duration: 2800 });
    assert.equal(theme.reactions.drag, undefined);
    assert.equal(theme.timings.mouseSleepTimeout, 60000, "hand-maintained fields stay");
    // Settings → About gets the idle pose, cropped around the bunny.
    const hero = fs.readFileSync(path.join(themeDir, "about-hero.svg"), "utf8");
    assert.equal(hero, "<svg>idle v2</svg>");
  });

  it("picks up new state art by name and the full sleep sequence once it is complete", () => {
    const art = {
      "idle.svg": '<svg viewBox="-20 -34 60 60" width="500" height="500"></svg>',
      "roam.svg": anim(1.4),
      "working.svg": anim(2),
      "sleeping.svg": anim(4),
      "react-left.svg": anim(1),
      "drag.svg": anim(1),
    };
    const partial = fixture({ art: { ...art, "yawning.svg": anim(3) } });
    syncBunnyTheme(partial);
    let theme = partial.read();
    assert.deepEqual(theme.states.roam, ["roam.svg"]);
    assert.deepEqual(theme.states.working, ["working.svg"]);
    assert.deepEqual(theme.states.thinking, ["idle.svg"]);
    assert.deepEqual(theme.states.sleeping, ["sleeping.svg"]);
    assert.deepEqual(theme.states.yawning, ["yawning.svg"]);
    assert.deepEqual(theme.sleepSequence, { mode: "direct" }, "dozing/collapsing/waking still missing");
    assert.deepEqual(theme.sleepingHitboxFiles, ["sleeping.svg"]);
    assert.deepEqual(theme.reactions.clickLeft, { file: "react-left.svg", duration: 2500 });
    assert.equal(theme.reactions.clickRight, undefined, "no attention.svg to borrow");
    assert.deepEqual(theme.reactions.drag, { file: "drag.svg" });
    assert.deepEqual(theme.states.attention, { fallbackTo: "idle" }, "no happy art yet");
    const hero = fs.readFileSync(path.join(partial.themeDir, "about-hero.svg"), "utf8");
    assert.match(hero, /viewBox="-5\.6 -3\.5 31\.25 25" width="500" height="400"/);

    const full = fixture({ art: {
      ...art, "yawning.svg": anim(3), "dozing.svg": anim(4), "collapsing.svg": anim(2.4), "waking.svg": anim(1.5),
    } });
    syncBunnyTheme(full);
    theme = full.read();
    assert.deepEqual(theme.sleepSequence, { mode: "full" });
    assert.deepEqual(theme.eyeTracking.states, ["idle", "dozing"]);
  });

  it("refuses an art folder without idle.svg or with unsafe names", () => {
    const noIdle = fixture({ art: { "attention.svg": anim(2.8) } });
    assert.throws(() => syncBunnyTheme(noIdle), /no idle\.svg/);
    const unsafe = fixture({ art: { "idle.svg": "<svg/>", "Bad Name.svg": "<svg/>" } });
    assert.throws(() => syncBunnyTheme(unsafe), /Unsafe SVG file name/);
    assert.deepEqual(fs.readdirSync(path.join(unsafe.themeDir, "assets")), [], "nothing copied");
  });
});

describe("bunny app icons", () => {
  const ROOT = path.join(__dirname, "..");

  it("reads the idle pose as flat rects", () => {
    const rects = svgRects('<svg><defs><style>.x{}</style></defs><g transform="translate(1 2) scale(0.5)"><g fill="#abc"><rect x="2" y="4" width="2" height="2"/></g></g><rect x="0" y="0" width="1" height="1" fill="#000" opacity="0.5"/></svg>');
    assert.deepEqual(rects, [
      { x0: 2, y0: 4, x1: 3, y1: 5, fill: "#AABBCC", opacity: 1 },
      { x0: 0, y0: 0, x1: 1, y1: 1, fill: "#000000", opacity: 0.5 },
    ]);
  });

  it("are drawn from the shipped idle pose (re-run the sync or icons:bunny after art changes)", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "bunny-icons-"));
    tempDirs.push(out);
    const written = makeBunnyIcons({ themeDir: path.join(ROOT, "themes", "bunny"), assetsDir: out });
    assert.ok(written.includes("icon.ico") && written.includes("icon.png") && written.includes("dock-icon.png"));
    // The .ico holds uncompressed bitmaps, so it is byte-for-byte reproducible.
    assert.ok(
      fs.readFileSync(path.join(out, "icon.ico")).equals(fs.readFileSync(path.join(ROOT, "assets", "icon.ico"))),
      "assets/icon.ico is out of date: run npm run icons:bunny",
    );
    const ico = fs.readFileSync(path.join(ROOT, "assets", "icon.ico"));
    assert.equal(ico.readUInt16LE(2), 1, "icon resource");
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256);
    assert.deepEqual(sizes, ICO_SIZES);
    const png = fs.readFileSync(path.join(ROOT, "assets", "icon.png"));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1024, 1024]);
  });
});
