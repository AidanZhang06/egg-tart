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
    // The built-in Egg Tart theme (themes/egg-tart) is this build's pet.
    theme: "egg-tart",
    freeRoam: true,
    idleActivities: true,
    // "high" = an activity every 30–50 s, so the pet is busy rather than
    // mostly resting. Adjustable in Settings → Pet.
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

module.exports = {
  DESK_PET_EDITION,
  applyDeskPetFirstRunDefaults,
  applyDeskPetToLoadResult,
  gateUpdaterForDeskPet,
};
