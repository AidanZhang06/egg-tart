#!/usr/bin/env node
"use strict";

// desk-pet: pull the white bunny's art into themes/bunny.
//
//   node scripts/sync-bunny-theme.js <art-assets-folder> [theme-folder]
//
// <art-assets-folder> is the bunny's built SVG folder (`node build.mjs` writes
// it). Re-run this after every rebuild. The script
//   • mirrors the folder: copies every *.svg into themes/bunny/assets and
//     deletes theme SVGs the art folder no longer has;
//   • binds each state to <state>.svg when the art exists, and otherwise to its
//     fallback (STATE_FALLBACKS), so new state art is picked up by name;
//   • registers every hobby-*.svg as an idle animation that plays whole loops of
//     its own animation (the longest CSS animation in the file), about 12 s;
//     hand-set fields on an existing entry (mirrorOnRightSide, activityGroup)
//     are kept, and new hobbies mirror near the right screen edge;
//   • binds the click reactions to react-left/right/double.svg when they exist,
//     and otherwise to the happy hop (attention.svg);
//   • switches to the full yawn/doze/collapse sleep sequence once all its art
//     exists, and writes about-hero.svg (idle, cropped) for Settings → About.
// Everything else in theme.json (layout, hit boxes, timings, eye tracking) is
// hand-maintained. Run `node scripts/validate-theme.js themes/bunny` afterwards.

const fs = require("fs");
const path = require("path");

const ASSET_FILE_RE = /^[a-z0-9][a-z0-9-]*\.svg$/;
const HOBBY_FILE_RE = /^hobby-[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/;

// Hobby beats aim for about 12 s of whole loops, and never pass the app's
// 20 s ceiling for an idle animation (src/idle-activity.js).
const HOBBY_TARGET_MS = 12000;
const HOBBY_MAX_MS = 20000;

// What a state shows while it has no art of its own. An array is a file
// binding; { fallbackTo } borrows another state's visual. null = left out.
// idle, working and thinking must always have files (theme validator).
const STATE_FALLBACKS = {
  idle: null, // required art
  attention: { fallbackTo: "idle" },
  working: ["idle.svg"],
  thinking: ["idle.svg"],
  roam: { fallbackTo: "idle" },
  sleeping: { fallbackTo: "idle" },
  error: { fallbackTo: "attention" },
  notification: { fallbackTo: "attention" },
  juggling: null,
  sweeping: null,
  carrying: null,
  yawning: null,
  dozing: null,
  collapsing: null,
  waking: null,
  dizzy: null,
};
const FULL_SLEEP_STATES = ["yawning", "dozing", "collapsing", "waking"];

// Click reactions: own art when it exists, else the happy hop (two 1.4 s hops).
const REACTION_ART = {
  clickLeft: { file: "react-left.svg", duration: 2500 },
  clickRight: { file: "react-right.svg", duration: 2500 },
  double: { files: ["react-double.svg"], duration: 3500 },
};
const REACTION_FALLBACK_FILE = "attention.svg";
const REACTION_FALLBACK_MS = 2800;

/** The longest CSS animation duration in an SVG, in ms (0 when none). */
function loopMs(svgText) {
  let longest = 0;
  const decls = String(svgText).match(/animation(?:-duration)?\s*:[^;}"]*/g) || [];
  for (const decl of decls) {
    for (const m of decl.matchAll(/(?:^|[\s,:])(\d+(?:\.\d+)?|\.\d+)(ms|s)\b/g)) {
      const ms = m[2] === "ms" ? Number(m[1]) : Number(m[1]) * 1000;
      if (Number.isFinite(ms) && ms > longest) longest = ms;
    }
  }
  return Math.round(longest);
}

/** Whole loops of `loop` ms, close to HOBBY_TARGET_MS and within HOBBY_MAX_MS. */
function hobbyDuration(loop) {
  if (!Number.isFinite(loop) || loop <= 0) return HOBBY_TARGET_MS;
  if (loop >= HOBBY_MAX_MS) return HOBBY_MAX_MS;
  const loops = Math.min(Math.floor(HOBBY_MAX_MS / loop), Math.max(1, Math.round(HOBBY_TARGET_MS / loop)));
  return Math.round(loop * loops);
}

// Settings → About shows a 140×112 picture: a 5:4 crop of the idle canvas
// around the bunny (arms x −1.4–21.4, ear tips y −2.8, shadow to y 21).
const ABOUT_HERO_VIEWBOX = "-5.6 -3.5 31.25 25";

function writeAboutHero(theme, themeDir) {
  const idle = theme.states && Array.isArray(theme.states.idle) ? theme.states.idle[0] : null;
  const idlePath = idle && ASSET_FILE_RE.test(idle) ? path.join(themeDir, "assets", idle) : null;
  if (!idlePath || !fs.existsSync(idlePath)) return false;
  const svg = fs.readFileSync(idlePath, "utf8").replace(/<svg\b[^>]*>/, (tag) => tag
    .replace(/\sviewBox="[^"]*"/, ` viewBox="${ABOUT_HERO_VIEWBOX}"`)
    .replace(/\swidth="[^"]*"/, ' width="500"')
    .replace(/\sheight="[^"]*"/, ' height="400"'));
  fs.writeFileSync(path.join(themeDir, "about-hero.svg"), svg);
  return true;
}

function syncBunnyTheme({ sourceDir, themeDir }) {
  const assetsDir = path.join(themeDir, "assets");
  const themePath = path.join(themeDir, "theme.json");
  const theme = JSON.parse(fs.readFileSync(themePath, "utf8"));

  const art = fs.readdirSync(sourceDir).filter((file) => file.endsWith(".svg")).sort();
  const unsafe = art.filter((file) => !ASSET_FILE_RE.test(file));
  if (unsafe.length) throw new Error(`Unsafe SVG file name(s) in ${sourceDir}: ${unsafe.join(", ")}`);
  if (!art.includes("idle.svg")) throw new Error(`${sourceDir} has no idle.svg`);
  const has = new Set(art);

  // Mirror the SVGs.
  fs.mkdirSync(assetsDir, { recursive: true });
  const removed = [];
  for (const file of fs.readdirSync(assetsDir)) {
    if (file.endsWith(".svg") && !has.has(file)) {
      fs.rmSync(path.join(assetsDir, file));
      removed.push(file);
    }
  }
  for (const file of art) fs.copyFileSync(path.join(sourceDir, file), path.join(assetsDir, file));

  // States: own art, else the fallback.
  const states = {};
  for (const [state, fallback] of Object.entries(STATE_FALLBACKS)) {
    if (has.has(`${state}.svg`)) states[state] = [`${state}.svg`];
    else if (fallback) states[state] = Array.isArray(fallback) ? [...fallback] : { ...fallback };
  }
  theme.states = states;
  const fullSleep = FULL_SLEEP_STATES.every((state) => has.has(`${state}.svg`));
  theme.sleepSequence = { mode: fullSleep ? "full" : "direct" };

  // Eye tracking follows the cursor in idle, and in dozing once it has art.
  if (theme.eyeTracking && typeof theme.eyeTracking === "object") {
    theme.eyeTracking.states = has.has("dozing.svg") ? ["idle", "dozing"] : ["idle"];
  }

  // Hobbies: every hobby-*.svg, whole loops, hand-set fields kept.
  const previous = new Map((theme.idleAnimations || [])
    .filter((entry) => entry && typeof entry.file === "string")
    .map((entry) => [entry.file, entry]));
  const hobbies = art.filter((file) => HOBBY_FILE_RE.test(file)).map((file) => {
    const loop = loopMs(fs.readFileSync(path.join(sourceDir, file), "utf8"));
    const { file: _file, duration: _duration, ...kept } = previous.get(file) || { mirrorOnRightSide: true };
    return { file, duration: hobbyDuration(loop), ...kept, loop };
  });
  theme.idleAnimations = hobbies.map(({ loop, ...entry }) => entry);

  // Click reactions.
  const reactions = {};
  for (const [name, own] of Object.entries(REACTION_ART)) {
    const ownFile = own.file || own.files[0];
    if (has.has(ownFile)) reactions[name] = { ...own };
    else if (has.has(REACTION_FALLBACK_FILE)) {
      reactions[name] = own.files
        ? { files: [REACTION_FALLBACK_FILE], duration: REACTION_FALLBACK_MS }
        : { file: REACTION_FALLBACK_FILE, duration: REACTION_FALLBACK_MS };
    }
  }
  if (has.has("drag.svg")) reactions.drag = { file: "drag.svg" };
  if (Object.keys(reactions).length) theme.reactions = reactions;
  else delete theme.reactions;
  if (has.has("sleeping.svg")) theme.sleepingHitboxFiles = ["sleeping.svg"];
  else delete theme.sleepingHitboxFiles;

  fs.writeFileSync(themePath, JSON.stringify(theme, null, 2) + "\n");
  writeAboutHero(theme, themeDir);
  return {
    copied: art,
    removed,
    hobbies: hobbies.map(({ file, duration, loop }) => ({ file, duration, loop })),
    sleepMode: theme.sleepSequence.mode,
  };
}

module.exports = { syncBunnyTheme, loopMs, hobbyDuration, STATE_FALLBACKS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const noIcons = args.includes("--no-icons");
  const [sourceArg, themeArg] = args.filter((arg) => arg !== "--no-icons");
  if (!sourceArg) {
    console.error("Usage: node scripts/sync-bunny-theme.js <art-assets-folder> [theme-folder] [--no-icons]");
    process.exit(2);
  }
  const themeDir = path.resolve(themeArg || path.join(__dirname, "..", "themes", "bunny"));
  try {
    const result = syncBunnyTheme({ sourceDir: path.resolve(sourceArg), themeDir });
    // The app icons are drawn from the idle pose, so they follow the art too.
    if (!noIcons && !themeArg) {
      const { makeBunnyIcons } = require("./make-bunny-icons");
      const written = makeBunnyIcons({ themeDir, assetsDir: path.join(__dirname, "..", "assets") });
      console.log(`Redrew ${written.length} app icon file(s) from the idle pose.`);
    }
    console.log(`Copied ${result.copied.length} SVG(s); removed ${result.removed.length}` +
      `${result.removed.length ? ` (${result.removed.join(", ")})` : ""}; sleep sequence: ${result.sleepMode}.`);
    for (const hobby of result.hobbies) {
      const loops = hobby.loop > 0 ? Math.round(hobby.duration / hobby.loop) : 0;
      console.log(`  ${hobby.file}: ${hobby.duration} ms (${loops} × ${hobby.loop} ms loop)`);
    }
  } catch (err) {
    console.error(`Sync failed: ${err.message}`);
    process.exit(1);
  }
}
