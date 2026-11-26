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
//     its own animation (the scene's longest CSS animation, not counting the
//     shared ear bob/twitch), about 12 s;
//     hand-set fields on an existing entry (mirrorOnRightSide, activityGroup)
//     are kept, and new hobbies mirror near the right screen edge;
//   • holds up the signs listed in signs.json the way the egg tart does: each
//     kind (love, encouragement, …) is one rotation slot ("signs-<kind>"),
//     signs never mirror (they carry text), and each plays its rise and then
//     whole sways; sign-*.svg files signs.json does not list are left out, and
//     signs.json is copied next to theme.json;
//   • binds the click reactions to react-left/right/double.svg when they exist,
//     and otherwise to the happy hop (attention.svg);
//   • switches to the full yawn/doze/collapse sleep sequence once all its art
//     exists, and writes about-hero.svg (idle, cropped) for Settings → About.
// Everything else in theme.json (layout, hit boxes, timings, eye tracking) is
// hand-maintained. Run `node scripts/validate-theme.js themes/bunny` afterwards.

const fs = require("fs");
const path = require("path");
const { signGroup, SIGN_FILE_RE } = require("./sync-egg-tart-theme");

const ASSET_FILE_RE = /^[a-z0-9][a-z0-9-]*\.svg$/;
const HOBBY_FILE_RE = /^hobby-[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/;
const SIGNS_MANIFEST = "signs.json";

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

// Every bunny frame carries the same ear layer (bob-* 1.4 s, twitch-* 7 s) on
// its own clock. It says nothing about how long the scene loops — the weights
// scene loops every 4 s under a 7 s ear twitch — so loop lengths skip it.
const AMBIENT_ANIMATION_RE = /^(?:bob|twitch)-/;

/**
 * Every CSS animation in an SVG as { name, ms, delayMs, infinite } (name is
 * null for a bare animation-duration, which counts as looping). In the
 * shorthand the first time is the duration and a second one the delay.
 */
function animationDurations(svgText) {
  const out = [];
  const decls = String(svgText).match(/animation(?:-duration)?\s*:[^;}"]*/g) || [];
  for (const decl of decls) {
    const shorthand = /^animation\s*:/.test(decl);
    for (const part of decl.slice(decl.indexOf(":") + 1).split(",")) {
      const times = [...part.matchAll(/(?:^|\s)(\d+(?:\.\d+)?|\.\d+)(ms|s)\b/g)]
        .map((time) => (time[2] === "ms" ? Number(time[1]) : Number(time[1]) * 1000));
      const ms = times[0];
      if (!Number.isFinite(ms) || ms <= 0) continue;
      const name = shorthand ? (part.trim().match(/^([A-Za-z_][\w-]*)/) || [])[1] || null : null;
      const delayMs = shorthand && Number.isFinite(times[1]) ? times[1] : 0;
      const infinite = shorthand ? /\binfinite\b/.test(part) : true;
      out.push({ name, ms, delayMs, infinite });
    }
  }
  return out;
}

/** An animation that belongs to the shared ear layer, not to the scene. */
function isAmbientAnimation(name) {
  return typeof name === "string" && AMBIENT_ANIMATION_RE.test(name);
}

/**
 * A scene's loop in ms: its longest CSS animation, leaving out the shared ear
 * layer (or the longest of all when the file has nothing else). 0 when none.
 */
function loopMs(svgText) {
  const all = animationDurations(svgText);
  const scene = all.filter((animation) => !isAmbientAnimation(animation.name));
  const longest = (list) => list.reduce((max, animation) => Math.max(max, animation.ms), 0);
  return Math.round(longest(scene) || longest(all));
}

/** Whole loops of `loop` ms, close to HOBBY_TARGET_MS and within HOBBY_MAX_MS. */
function hobbyDuration(loop) {
  if (!Number.isFinite(loop) || loop <= 0) return HOBBY_TARGET_MS;
  if (loop >= HOBBY_MAX_MS) return HOBBY_MAX_MS;
  const loops = Math.min(Math.floor(HOBBY_MAX_MS / loop), Math.max(1, Math.round(HOBBY_TARGET_MS / loop)));
  return Math.round(loop * loops);
}

/**
 * How long a sign plays: its rise once, then whole sways, about 12 s, ending
 * where a sway ends. `start` is when the sways begin (their animation-delay):
 * the egg tart's sways wait for the rise, the bunny's run from the first frame
 * with the rise on top, so its sways end at whole loops from 0.
 */
function signDuration({ loopMs: loop, riseMs: rise, start = 0 }) {
  const sway = Number.isFinite(loop) && loop > 0 ? loop : HOBBY_TARGET_MS;
  const up = Number.isFinite(rise) && rise > 0 ? rise : 0;
  let loops = Math.max(1, Math.round((HOBBY_TARGET_MS - start) / sway));
  while (start + loops * sway <= up) loops += 1; // the board is up before it goes
  while (loops > 1 && start + loops * sway > HOBBY_MAX_MS) loops -= 1;
  return Math.min(HOBBY_MAX_MS, Math.round(start + loops * sway));
}

/** When a sign's sways (its looping `loop` ms scene animations) begin, in ms. */
function swayStart(svgText, loop) {
  const sways = animationDurations(svgText)
    .filter((animation) => animation.infinite && !isAmbientAnimation(animation.name) && Math.round(animation.ms) === loop);
  return sways.reduce((max, animation) => Math.max(max, animation.delayMs), 0);
}

/**
 * The signs signs.json lists, checked before anything is copied: names, files
 * and kinds. null when the art folder has no signs.json.
 */
function readSigns(sourceDir, has) {
  const manifestPath = path.join(sourceDir, SIGNS_MANIFEST);
  if (!fs.existsSync(manifestPath)) return null;
  const doc = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const signs = Array.isArray(doc.signs) ? doc.signs : [];
  for (const sign of signs) {
    const file = sign && sign.file;
    if (typeof file !== "string" || !SIGN_FILE_RE.test(file)) {
      throw new Error(`Unsafe sign file name in ${SIGNS_MANIFEST}: ${JSON.stringify(file)}`);
    }
    if (!has.has(file)) throw new Error(`${SIGNS_MANIFEST} lists ${file}, but it is not in ${sourceDir}`);
    signGroup(sign, doc.kinds);
  }
  return { doc, signs };
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
  const signed = readSigns(sourceDir, new Set(art));
  const signs = signed ? signed.signs : [];
  const listedSigns = new Set(signs.map((sign) => sign.file));
  // Only the signs signs.json lists ship; any other sign-*.svg is left out.
  const skipped = art.filter((file) => SIGN_FILE_RE.test(file) && !listedSigns.has(file));
  const shipped = art.filter((file) => !skipped.includes(file));
  const has = new Set(shipped);

  // Mirror the SVGs.
  fs.mkdirSync(assetsDir, { recursive: true });
  const removed = [];
  for (const file of fs.readdirSync(assetsDir)) {
    if (file.endsWith(".svg") && !has.has(file)) {
      fs.rmSync(path.join(assetsDir, file));
      removed.push(file);
    }
  }
  for (const file of shipped) fs.copyFileSync(path.join(sourceDir, file), path.join(assetsDir, file));

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

  // Signs: one slot per kind, the manifest's sway and rise, never mirrored.
  let signMs = 0;
  if (signs.length) {
    const texts = signs.map((sign) => fs.readFileSync(path.join(sourceDir, sign.file), "utf8"));
    const declared = Number(signed.doc.loopMs);
    const loop = Number.isFinite(declared) && declared > 0 ? Math.round(declared) : loopMs(texts[0]);
    const starts = [...new Set(texts.map((text) => swayStart(text, loop)))];
    if (starts.length > 1) throw new Error(`Signs disagree on when their ${loop} ms sway starts: ${starts.join(", ")} ms`);
    signMs = signDuration({ loopMs: loop, riseMs: Number(signed.doc.riseMs), start: starts[0] });
  }
  theme.idleAnimations = [
    ...hobbies.map(({ loop, ...entry }) => entry),
    ...signs.map((sign) => ({ file: sign.file, duration: signMs, activityGroup: signGroup(sign, signed.doc.kinds) })),
  ];
  const signsPath = path.join(themeDir, SIGNS_MANIFEST);
  if (signed) fs.writeFileSync(signsPath, JSON.stringify(signed.doc, null, 2) + "\n");
  else fs.rmSync(signsPath, { force: true });

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
    copied: shipped,
    removed,
    skipped,
    hobbies: hobbies.map(({ file, duration, loop }) => ({ file, duration, loop })),
    signs: signs.map((sign) => ({ file: sign.file, duration: signMs, activityGroup: signGroup(sign, signed.doc.kinds) })),
    sleepMode: theme.sleepSequence.mode,
  };
}

module.exports = {
  syncBunnyTheme, loopMs, hobbyDuration, signDuration, swayStart, animationDurations, isAmbientAnimation, STATE_FALLBACKS,
};

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
    for (const sign of result.signs) console.log(`  ${sign.file}: ${sign.duration} ms (${sign.activityGroup})`);
    if (result.skipped.length) console.log(`Left out sign(s) signs.json does not list: ${result.skipped.join(", ")}`);
  } catch (err) {
    console.error(`Sync failed: ${err.message}`);
    process.exit(1);
  }
}
