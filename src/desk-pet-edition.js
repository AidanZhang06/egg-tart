"use strict";

// src/desk-pet-edition.js — standalone desk pet fork switch.
//
// This fork ships Clawd as a plain desktop pet for someone who does not use
// any AI coding tool. Everything fork-specific is driven from here, plus a few
// small gates marked `// desk-pet:` elsewhere, so upstream merges stay easy:
//   • first-run prefs: walk around AND play idle activities, every agent
//     integration off (nothing is written to ~/.claude, ~/.codex, …), no
//     onboarding tutorial, no update checks;
//   • main.js skips the VS Code/Cursor extension auto-install and the update
//     scheduler, and turns manual update checks into a no-op;
//   • menu.js hides the AI-tool items (dashboard, recap, new session,
//     permission automation, hide bubbles, updates).

const DESK_PET_EDITION = true;

// The built-in theme this build ships as its pet (themes/<id>). The bunny
// branch ships the white bunny; the egg tart stays selectable in Settings.
const DESK_PET_THEME_ID = "bunny";

// Idle-activity spacing for the standalone pet (ms). Tighter than upstream's
// scale, which is tuned to sit quietly beside a coding agent, so the pet is
// rarely idle for long. Same keys as Settings → Pet → How often.
const DESK_PET_IDLE_ACTIVITY_FREQUENCIES = Object.freeze({
  low: Object.freeze({ first: Object.freeze([20000, 30000]), repeat: Object.freeze([45000, 75000]) }),
  medium: Object.freeze({ first: Object.freeze([10000, 15000]), repeat: Object.freeze([20000, 35000]) }),
  high: Object.freeze({ first: Object.freeze([5000, 10000]), repeat: Object.freeze([10000, 20000]) }),
});

// Applied only when prefs fell back to defaults (no file yet, or an unusable
// one). A returning user's saved choices are never overwritten.
function applyDeskPetFirstRunDefaults(snapshot) {
  const base = snapshot && typeof snapshot === "object" ? snapshot : {};
  const agents = {};
  const sourceAgents = base.agents && typeof base.agents === "object" ? base.agents : {};
  for (const [id, entry] of Object.entries(sourceAgents)) {
    agents[id] = { ...(entry && typeof entry === "object" ? entry : {}), integrationInstalled: false, enabled: false };
  }
  return {
    ...base,
    agents,
    // The built-in bunny theme (themes/bunny) is this build's pet.
    theme: DESK_PET_THEME_ID,
    freeRoam: true,
    idleActivities: true,
    // "high" = an activity every 10–20 s on the desk pet's own scale
    // (DESK_PET_IDLE_ACTIVITY_FREQUENCIES), so it is rarely idle for long.
    // Adjustable in Settings → Pet → How often.
    idleActivityFrequency: "high",
    manageClaudeHooksAutomatically: false,
    autoStartWithClaude: false,
    autoStartWithCodex: false,
    tutorialSeen: true,
    autoUpdateCheck: false,
  };
}

function applyDeskPetToLoadResult(loadResult) {
  if (!loadResult || (loadResult.fresh !== true && loadResult.recovered !== true)) return loadResult;
  return { ...loadResult, snapshot: applyDeskPetFirstRunDefaults(loadResult.snapshot) };
}

// The build must never fetch or install an upstream release (it would replace
// this fork). Wrapping the updater API once closes every route to it: the
// startup scheduler, the About "automatically check" toggle, the About button
// and the menu item. package.json also sets build.publish to null so no
// app-update.yml feed is bundled.
function gateUpdaterForDeskPet(updater) {
  if (!DESK_PET_EDITION) return updater;
  return {
    ...updater,
    setupAutoUpdater: () => {},
    startUpdateScheduler: () => {},
    checkForUpdates: async () => ({ state: "idle" }),
    getUpdateMenuItem: () => null,
  };
}

// Turn on Start on Login by itself, once, the first time the app runs from
// the Applications folder (a login item pointing into the .dmg would break
// once it is ejected). The marker makes it one-time, so turning the setting
// off later sticks. Returns "enabled" | "already" | "not-installed" | "failed".
async function enableLoginItemOnce({ markerExists, isInApplicationsFolder, enable, writeMarker }) {
  if (markerExists()) return "already";
  if (!isInApplicationsFolder()) return "not-installed";
  let result;
  try {
    result = await enable();
  } catch {
    return "failed";
  }
  if (result && result.status === "error") return "failed";
  writeMarker();
  return "enabled";
}

module.exports = {
  DESK_PET_EDITION,
  DESK_PET_THEME_ID,
  enableLoginItemOnce,
  DESK_PET_IDLE_ACTIVITY_FREQUENCIES,
  applyDeskPetFirstRunDefaults,
  applyDeskPetToLoadResult,
  gateUpdaterForDeskPet,
};
