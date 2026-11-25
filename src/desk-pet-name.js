"use strict";

// src/desk-pet-name.js — desk-pet: the standalone build is named after its pet
// (this branch: "Bun", the white bunny; the Mac egg tart build: "Egg Tart").
//
// Upstream UI text says "Clawd" / "Clawd on Desk". renameForDeskPet swaps that
// capitalised brand word for the pet's name wherever the menus, the Settings
// window and its title show text. Lower-case file names (clawd-prefs.json) and
// CLAWD_* environment variables are left untouched.
//
// Loaded both as a CommonJS module (main process) and as a classic <script> in
// settings.html (exposed as globalThis.ClawdDeskPetName).

(function initDeskPetName(root) {
  const DESK_PET_APP_NAME = "Bun";
  const BRAND_RE = /\bClawd on Desk\b|\bClawd\b/g;

  function renameForDeskPet(text) {
    return typeof text === "string" ? text.replace(BRAND_RE, DESK_PET_APP_NAME) : text;
  }

  const api = Object.freeze({ DESK_PET_APP_NAME, renameForDeskPet });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ClawdDeskPetName = api;
})(typeof globalThis !== "undefined" ? globalThis : null);
