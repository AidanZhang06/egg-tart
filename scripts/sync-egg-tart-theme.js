#!/usr/bin/env node
"use strict";

// desk-pet: pull the Egg Tart art into themes/egg-tart.
//
//   node scripts/sync-egg-tart-theme.js <art-folder> [theme-folder]
//
// <art-folder> holds the exported SVGs plus signs.json
// ({ loopMs, riseMs, signs: [{ file, phrase }] }). The script
//   • refreshes every file theme.json already references (states, reactions,
//     hobby idleAnimations) when the art folder has a newer copy;
//   • makes the signs match signs.json exactly: copies every listed
//     sign-*.svg, deletes sign-*.svg files no longer listed, and rewrites the
//     sign entries in theme.json. Each sign kind (encouragement, love, …) gets
//     its own activityGroup "signs-<kind>", so every kind is one rotation slot;
//     signs without a kind share the group "signs";
//   • copies signs.json next to theme.json so the phrase list travels along.
// It also writes about-hero.svg (the idle animation cropped around the tart)
// for Settings → About. Hobby entries (durations, mirrorOnRightSide) stay
// hand-maintained in theme.json. Run `node scripts/validate-theme.js themes/egg-tart` afterwards.

const fs = require("fs");
const path = require("path");

const SIGN_GROUP = "signs";
const SIGN_FILE_RE = /^sign-[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/;
const SIGN_KIND_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ASSET_FILE_RE = /^[a-z0-9][a-z0-9-]*\.svg$/;
// Rise once, then sway whole loops for about 12 s, ending on a loop boundary.
const SIGN_TARGET_MS = 12000;

function signDuration({ loopMs, riseMs }) {
  const loop = Number.isFinite(loopMs) && loopMs > 0 ? loopMs : 2000;
  const rise = Number.isFinite(riseMs) && riseMs >= 0 ? riseMs : 0;
  return rise + loop * Math.max(1, Math.round((SIGN_TARGET_MS - rise) / loop));
}

function isSignEntry(entry) {
  if (!entry) return false;
  const group = entry.activityGroup;
  return (typeof entry.file === "string" && SIGN_FILE_RE.test(entry.file))
    || group === SIGN_GROUP
    || (typeof group === "string" && group.startsWith(`${SIGN_GROUP}-`));
}

function signGroup(sign, kinds) {
  if (sign.kind === undefined) return SIGN_GROUP;
  const declared = kinds && typeof kinds === "object" && Object.prototype.hasOwnProperty.call(kinds, sign.kind);
  if (typeof sign.kind !== "string" || !SIGN_KIND_RE.test(sign.kind) || !declared) {
    throw new Error(`Unknown or unsafe sign kind for ${sign.file}: ${JSON.stringify(sign.kind)}`);
  }
  return `${SIGN_GROUP}-${sign.kind}`;
}

function referencedFiles(theme) {
  const files = new Set();
  for (const binding of Object.values(theme.states || {})) {
    const list = Array.isArray(binding) ? binding : (binding && binding.files) || [];
    for (const file of list) files.add(file);
  }
  for (const reaction of Object.values(theme.reactions || {})) {
    if (reaction && reaction.file) files.add(reaction.file);
    for (const file of (reaction && reaction.files) || []) files.add(file);
  }
  for (const entry of theme.idleAnimations || []) {
    if (entry && !isSignEntry(entry)) files.add(entry.file);
  }
  return [...files].filter((file) => typeof file === "string" && ASSET_FILE_RE.test(file));
}

// Settings → About shows a 140×112 picture; crop the idle canvas to a 5:4 box
// around the tart (x 0.5–19.5, y 4.4–20 plus its shadow).
const ABOUT_HERO_VIEWBOX = "-2.5 2 25 20";

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

function syncEggTartTheme({ sourceDir, themeDir }) {
  const assetsDir = path.join(themeDir, "assets");
  const themePath = path.join(themeDir, "theme.json");
  const signsDoc = JSON.parse(fs.readFileSync(path.join(sourceDir, "signs.json"), "utf8"));
  const signs = Array.isArray(signsDoc.signs) ? signsDoc.signs : [];
  const theme = JSON.parse(fs.readFileSync(themePath, "utf8"));

  // Validate everything before touching the theme folder.
  for (const sign of signs) {
    const file = sign && sign.file;
    if (typeof file !== "string" || !SIGN_FILE_RE.test(file)) {
      throw new Error(`Unsafe sign file name in signs.json: ${JSON.stringify(file)}`);
    }
    if (!fs.existsSync(path.join(sourceDir, file))) {
      throw new Error(`signs.json lists ${file}, but it is not in ${sourceDir}`);
    }
    signGroup(sign, signsDoc.kinds);
  }

  const copied = [];
  const removed = [];
  const listed = new Set(signs.map((sign) => sign.file));
  for (const file of fs.readdirSync(assetsDir)) {
    if (SIGN_FILE_RE.test(file) && !listed.has(file)) {
      fs.rmSync(path.join(assetsDir, file));
      removed.push(file);
    }
  }
  for (const file of [...referencedFiles(theme), ...listed]) {
    const from = path.join(sourceDir, file);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(assetsDir, file));
    copied.push(file);
  }

  const duration = signDuration(signsDoc);
  theme.idleAnimations = [
    ...(theme.idleAnimations || []).filter((entry) => entry && !isSignEntry(entry)),
    ...signs.map((sign) => ({ file: sign.file, duration, activityGroup: signGroup(sign, signsDoc.kinds) })),
  ];
  fs.writeFileSync(themePath, JSON.stringify(theme, null, 2) + "\n");
  fs.writeFileSync(path.join(themeDir, "signs.json"), JSON.stringify(signsDoc, null, 2) + "\n");
  writeAboutHero(theme, themeDir);
  return { copied, removed, signs: signs.length, signDuration: duration };
}

module.exports = { syncEggTartTheme, signDuration, SIGN_GROUP };

if (require.main === module) {
  const [sourceArg, themeArg] = process.argv.slice(2);
  if (!sourceArg) {
    console.error("Usage: node scripts/sync-egg-tart-theme.js <art-folder> [theme-folder]");
    process.exit(2);
  }
  const themeDir = path.resolve(themeArg || path.join(__dirname, "..", "themes", "egg-tart"));
  try {
    const result = syncEggTartTheme({ sourceDir: path.resolve(sourceArg), themeDir });
    console.log(`Copied ${result.copied.length} file(s); removed ${result.removed.length} stale sign(s)` +
      `${result.removed.length ? ` (${result.removed.join(", ")})` : ""}; ${result.signs} sign(s) at ${result.signDuration} ms.`);
  } catch (err) {
    console.error(`Sync failed: ${err.message}`);
    process.exit(1);
  }
}
