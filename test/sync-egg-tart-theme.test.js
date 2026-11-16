"use strict";
// desk-pet: scripts/sync-egg-tart-theme.js pulls the Egg Tart art into
// themes/egg-tart, driving the encouragement signs from signs.json.
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { syncEggTartTheme, SIGN_GROUP } = require("../scripts/sync-egg-tart-theme");

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function fixture({ signs, sourceFiles, themeFiles, theme }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "egg-tart-sync-"));
  tempDirs.push(root);
  const sourceDir = path.join(root, "source");
  const themeDir = path.join(root, "theme");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(path.join(themeDir, "assets"), { recursive: true });
  for (const [file, body] of Object.entries(sourceFiles)) fs.writeFileSync(path.join(sourceDir, file), body);
  for (const [file, body] of Object.entries(themeFiles)) fs.writeFileSync(path.join(themeDir, "assets", file), body);
  fs.writeFileSync(path.join(sourceDir, "signs.json"), JSON.stringify(signs));
  fs.writeFileSync(path.join(themeDir, "theme.json"), JSON.stringify(theme));
  return { sourceDir, themeDir };
}

const BASE_THEME = {
  states: { idle: ["idle.svg"], working: ["working.svg"] },
  reactions: { drag: { file: "drag.svg" } },
  idleAnimations: [
    { file: "hobby-read.svg", duration: 9600, mirrorOnRightSide: true },
    { file: "sign-old.svg", duration: 8000, activityGroup: SIGN_GROUP },
  ],
};

describe("syncEggTartTheme", () => {
  it("copies listed signs, drops stale ones, and rewrites the sign group from signs.json", () => {
    const { sourceDir, themeDir } = fixture({
      signs: { loopMs: 2000, riseMs: 550, signs: [
        { file: "sign-keep-going.svg", phrase: "Keep going!" },
        { file: "sign-you-got-this.svg", phrase: "You got this!" },
      ] },
      sourceFiles: {
        "sign-keep-going.svg": "<svg>keep</svg>",
        "sign-you-got-this.svg": "<svg>got</svg>",
        "working.svg": "<svg>whisk v2</svg>",
        "hobby-read.svg": "<svg>read v2</svg>",
      },
      themeFiles: {
        "sign-old.svg": "<svg>old</svg>",
        "working.svg": "<svg>whisk v1</svg>",
        "idle.svg": "<svg>idle</svg>",
      },
      theme: BASE_THEME,
    });

    const result = syncEggTartTheme({ sourceDir, themeDir });

    const assets = fs.readdirSync(path.join(themeDir, "assets")).sort();
    assert.deepEqual(assets, ["hobby-read.svg", "idle.svg", "sign-keep-going.svg", "sign-you-got-this.svg", "working.svg"]);
    assert.equal(fs.readFileSync(path.join(themeDir, "assets", "working.svg"), "utf8"), "<svg>whisk v2</svg>");
    assert.deepEqual(result.removed, ["sign-old.svg"]);

    const theme = JSON.parse(fs.readFileSync(path.join(themeDir, "theme.json"), "utf8"));
    // Hobbies keep their hand-set metadata and order; signs follow, in list
    // order, played for the rise plus whole sway loops (550 + 6 × 2000).
    assert.deepEqual(theme.idleAnimations, [
      { file: "hobby-read.svg", duration: 9600, mirrorOnRightSide: true },
      { file: "sign-keep-going.svg", duration: 12550, activityGroup: SIGN_GROUP },
      { file: "sign-you-got-this.svg", duration: 12550, activityGroup: SIGN_GROUP },
    ]);
    assert.deepEqual(theme.states, BASE_THEME.states);
    // The phrase list travels with the theme for reference.
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(themeDir, "signs.json"), "utf8")).signs.map((s) => s.phrase),
      ["Keep going!", "You got this!"]);
  });

  it("gives each sign kind its own group and prunes signs from the old naming", () => {
    const { sourceDir, themeDir } = fixture({
      signs: {
        loopMs: 2000,
        riseMs: 550,
        kinds: {
          encouragement: { name: "Encouragement", filePrefix: "sign-cheer-" },
          love: { name: "Love & sweet", filePrefix: "sign-love-" },
        },
        signs: [
          { file: "sign-cheer-keep-going.svg", phrase: "Keep going!", kind: "encouragement" },
          { file: "sign-love-i-love-you.svg", phrase: "I love you", kind: "love" },
          { file: "sign-cheer-almost-there.svg", phrase: "Almost there!", kind: "encouragement" },
        ],
      },
      sourceFiles: {
        "sign-cheer-keep-going.svg": "<svg/>",
        "sign-love-i-love-you.svg": "<svg/>",
        "sign-cheer-almost-there.svg": "<svg/>",
      },
      themeFiles: { "sign-old.svg": "<svg>old</svg>", "idle.svg": "<svg/>" },
      theme: BASE_THEME,
    });

    const result = syncEggTartTheme({ sourceDir, themeDir });

    assert.deepEqual(result.removed, ["sign-old.svg"]);
    const theme = JSON.parse(fs.readFileSync(path.join(themeDir, "theme.json"), "utf8"));
    assert.deepEqual(theme.idleAnimations, [
      { file: "hobby-read.svg", duration: 9600, mirrorOnRightSide: true },
      { file: "sign-cheer-keep-going.svg", duration: 12550, activityGroup: "signs-encouragement" },
      { file: "sign-love-i-love-you.svg", duration: 12550, activityGroup: "signs-love" },
      { file: "sign-cheer-almost-there.svg", duration: 12550, activityGroup: "signs-encouragement" },
    ]);
  });

  it("refuses a sign kind that is unsafe or not declared in kinds", () => {
    for (const kind of ["../x", "Love", "unknown"]) {
      const { sourceDir, themeDir } = fixture({
        signs: {
          loopMs: 2000, riseMs: 550,
          kinds: { love: { name: "Love", filePrefix: "sign-love-" } },
          signs: [{ file: "sign-love-a.svg", phrase: "x", kind }],
        },
        sourceFiles: { "sign-love-a.svg": "<svg/>" },
        themeFiles: { "sign-old.svg": "<svg>old</svg>" },
        theme: BASE_THEME,
      });
      assert.throws(() => syncEggTartTheme({ sourceDir, themeDir }), /sign kind/i, kind);
      assert.deepEqual(fs.readdirSync(path.join(themeDir, "assets")), ["sign-old.svg"], `${kind}: nothing changed`);
    }
  });

  it("refuses unsafe or non-sign file names from signs.json", () => {
    for (const file of ["../evil.svg", "sign-a/../../x.svg", "hobby-read.svg", "sign-UPPER.svg", "sign-a.png"]) {
      const { sourceDir, themeDir } = fixture({
        signs: { loopMs: 2000, riseMs: 550, signs: [{ file, phrase: "x" }] },
        sourceFiles: {},
        themeFiles: {},
        theme: BASE_THEME,
      });
      assert.throws(() => syncEggTartTheme({ sourceDir, themeDir }), /unsafe sign file/i, file);
    }
  });

  it("fails before changing anything when a listed sign file is missing", () => {
    const { sourceDir, themeDir } = fixture({
      signs: { loopMs: 2000, riseMs: 550, signs: [{ file: "sign-missing.svg", phrase: "x" }] },
      sourceFiles: {},
      themeFiles: { "sign-old.svg": "<svg>old</svg>" },
      theme: BASE_THEME,
    });
    assert.throws(() => syncEggTartTheme({ sourceDir, themeDir }), /sign-missing\.svg/);
    assert.deepEqual(fs.readdirSync(path.join(themeDir, "assets")), ["sign-old.svg"]);
  });
});
