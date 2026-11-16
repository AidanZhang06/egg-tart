"use strict";
// desk-pet: the standalone pet uses a tighter idle-activity scale so it is
// rarely idle for long ("Often" = an activity every 10–20 s).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createIdleActivityController } = require("../src/idle-activity");
const { DESK_PET_IDLE_ACTIVITY_FREQUENCIES } = require("../src/desk-pet-edition");

test("the desk pet frequency scale", () => {
  assert.deepEqual(DESK_PET_IDLE_ACTIVITY_FREQUENCIES, {
    low: { first: [20000, 30000], repeat: [45000, 75000] },
    medium: { first: [10000, 15000], repeat: [20000, 35000] },
    high: { first: [5000, 10000], repeat: [10000, 20000] },
  });
});

function fakeClock() {
  let nowMs = 0;
  let nextId = 0;
  const timers = [];
  return {
    now: () => nowMs,
    setTimeout(fn, ms) { const t = { id: ++nextId, at: nowMs + ms, fn }; timers.push(t); return t.id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    advance(ms) {
      const target = nowMs + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        nowMs = due.at;
        due.fn();
      }
      nowMs = target;
    },
  };
}

test("the controller schedules from supplied frequency ranges", () => {
  const clock = fakeClock();
  const starts = [];
  let generation = 0;
  const controller = createIdleActivityController({
    getTheme: () => ({ states: { idle: ["idle.svg"], thinking: ["think.svg"] } }),
    getCurrentState: () => "idle",
    canPlay: () => true,
    isVisualGenerationCurrent: (value) => value === generation,
    sendToRenderer: (...args) => {
      generation += 1;
      starts.push(clock.now());
      const visualGeneration = generation;
      args[3].onLogicalSettlement({ status: "committed", visualGeneration });
      return { visualGeneration };
    },
    random: () => 0,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    frequencies: DESK_PET_IDLE_ACTIVITY_FREQUENCIES,
  });
  controller.setFrequency("high");
  controller.setEnabled(true);
  // Tick once a second, like the main tick loop.
  for (let i = 0; i <= 40; i += 1) {
    controller.tick();
    clock.advance(1000);
  }
  // First beat 5 s after idle; each 2.55 s thinking beat is followed by a 10 s gap.
  assert.deepEqual(starts.slice(0, 3), [5000, 18000, 31000]);
});

test("main.js gives the desk pet its frequency scale", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const start = source.indexOf('const _idleActivity = require("./idle-activity").createIdleActivityController({');
  assert.ok(start >= 0);
  const block = source.slice(start, source.indexOf("});", start));
  assert.ok(block.includes("frequencies: DESK_PET_EDITION ? DESK_PET_IDLE_ACTIVITY_FREQUENCIES : undefined,"));
});
