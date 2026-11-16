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
    freeRoam: true,
    idleActivities: true,
    idleActivityFrequency: "medium",
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

module.exports = {
  DESK_PET_EDITION,
  applyDeskPetFirstRunDefaults,
  applyDeskPetToLoadResult,
};
