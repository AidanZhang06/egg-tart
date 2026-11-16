"use strict";
// desk-pet: idle activities also draw from the theme's idleAnimations pool, so
// a theme's hobby scenes (reading, crocheting, …) join the random rotation.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createIdleActivityController,
  listIdleActivityCandidates,
  IDLE_ACTIVITY_FREQUENCIES,
} = require("../src/idle-activity");

const THEME = {
  states: {
    idle: ["idle.svg"],
    sleeping: ["sleep.svg"],
    thinking: ["think.svg"],
  },
  idleAnimations: [
    { file: "hobby-read.svg", duration: 8000 },
    { file: "idle.svg", duration: 4000 },
    { file: "hobby-long.svg", duration: 30000 },
    { file: "hobby-short.svg", duration: 500 },
    { duration: 4000 },
    null,
  ],
};

test("candidates are the activity states plus usable idleAnimations entries", () => {
  assert.deepEqual(listIdleActivityCandidates(THEME), [
    { state: "thinking", files: ["think.svg"] },
    { state: "idle", files: ["hobby-read.svg"], duration: 8000 },
    { state: "idle", files: ["hobby-long.svg"], duration: 15000 },
    { state: "idle", files: ["hobby-short.svg"], duration: 2000 },
  ]);
  assert.deepEqual(listIdleActivityCandidates(null), []);
  assert.deepEqual(listIdleActivityCandidates({ states: { idle: ["idle.svg"] } }), []);
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

function playOnce(randomValue) {
  const clock = fakeClock();
  const sent = [];
  const restores = [];
  let generation = 0;
  const controller = createIdleActivityController({
    getTheme: () => THEME,
    getCurrentState: () => "idle",
    canPlay: () => true,
    restoreIdleVisual: () => restores.push(clock.now()),
    isVisualGenerationCurrent: (value) => value === generation,
    sendToRenderer: (...args) => { generation += 1; sent.push({ args, visualGeneration: generation }); return { visualGeneration: generation }; },
    random: () => randomValue,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  controller.setEnabled(true);
  controller.tick();
  clock.advance(IDLE_ACTIVITY_FREQUENCIES.medium.first[1]);
  controller.tick();
  assert.equal(sent.length, 1, "one activity started");
  const request = sent[0];
  request.args[3].onLogicalSettlement({ status: "committed", visualGeneration: request.visualGeneration });
  return { clock, request, restores };
}

test("plays a hobby scene for its own declared duration", () => {
  // 4 candidates; random 0.3 → index 1 → hobby-read.svg (8000 ms).
  const { clock, request, restores } = playOnce(0.3);
  assert.deepEqual(request.args.slice(0, 3), ["state-change", "idle", "hobby-read.svg"]);
  const startedAt = clock.now();
  clock.advance(7999);
  assert.deepEqual(restores, []);
  clock.advance(1);
  assert.deepEqual(restores, [startedAt + 8000]);
});

test("clamps hobby durations to 2–15 s", () => {
  const long = playOnce(0.6); // index 2 → hobby-long.svg, 30000 → 15000
  assert.equal(long.request.args[2], "hobby-long.svg");
  const longStart = long.clock.now();
  long.clock.advance(15000);
  assert.deepEqual(long.restores, [longStart + 15000]);

  const short = playOnce(0.9); // index 3 → hobby-short.svg, 500 → 2000
  assert.equal(short.request.args[2], "hobby-short.svg");
  const shortStart = short.clock.now();
  short.clock.advance(2000);
  assert.deepEqual(short.restores, [shortStart + 2000]);
});

const GROUPED_THEME = {
  states: { idle: ["idle.svg"], thinking: ["think.svg"] },
  idleAnimations: [
    { file: "sign-a.svg", duration: 8000, activityGroup: "signs" },
    { file: "hobby-read.svg", duration: 9600 },
    { file: "sign-b.svg", duration: 8000, activityGroup: "signs" },
  ],
};

test("entries sharing an activityGroup collapse into one candidate", () => {
  assert.deepEqual(listIdleActivityCandidates(GROUPED_THEME), [
    { state: "thinking", files: ["think.svg"] },
    { state: "idle", files: ["sign-a.svg", "sign-b.svg"], duration: 8000 },
    { state: "idle", files: ["hobby-read.svg"], duration: 9600 },
  ]);
});

test("a grouped candidate plays a random member", () => {
  const clock = fakeClock();
  const sent = [];
  const controller = createIdleActivityController({
    getTheme: () => GROUPED_THEME,
    getCurrentState: () => "idle",
    canPlay: () => true,
    isVisualGenerationCurrent: () => true,
    sendToRenderer: (...args) => { sent.push(args); return { visualGeneration: 1 }; },
    random: () => 0.5, // candidate 1 of 3 → the sign group; member 1 of 2 → sign-b
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  controller.setEnabled(true);
  controller.tick();
  clock.advance(IDLE_ACTIVITY_FREQUENCIES.medium.first[1]);
  controller.tick();
  assert.deepEqual(sent.map((args) => args[2]), ["sign-b.svg"]);
});
