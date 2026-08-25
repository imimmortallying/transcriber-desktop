"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveActiveFragments, resolveFragment } = require("../../src/renderer/timedTextPresentation.js");

const firstRef = { kind: "baseline-segment", index: 0 };
const secondRef = { kind: "baseline-segment", index: 1 };
const paragraph = {
  id: 1,
  text: "первый второй",
  timing: [
    { from: 0, to: 6, sourceSegmentRefs: [firstRef] },
    { from: 7, to: 13, sourceSegmentRefs: [secondRef] },
  ],
};
const timedRanges = [
  { sourceSegmentRef: firstRef, start: 0, end: 1 },
  { sourceSegmentRef: secondRef, start: 3, end: 4 },
];

test("presentation resolves the pointer coverage part, not the whole paragraph", () => {
  assert.deepEqual(resolveFragment(paragraph, timedRanges, 8), {
    from: 7,
    to: 13,
    timedRange: timedRanges[1],
  });
  assert.equal(resolveFragment(paragraph, timedRanges, 6), null);
});

test("presentation exposes all active fragments and leaves VAD gaps unhighlighted", () => {
  const activeStates = [{ paragraph, timedRanges }];
  assert.deepEqual(resolveActiveFragments(activeStates, 3.5).map(({ from, to }) => [from, to]), [[7, 13]]);
  assert.deepEqual(resolveActiveFragments(activeStates, 2), []);
});

test("split source segments may present simultaneous ranges without changing document parts", () => {
  const split = [
    { ...paragraph, id: 1, timing: [{ from: 0, to: 3, sourceSegmentRefs: [firstRef] }] },
    { ...paragraph, id: 2, timing: [{ from: 0, to: 3, sourceSegmentRefs: [firstRef] }] },
  ];
  const fragments = resolveActiveFragments(split.map((item) => ({ paragraph: item, timedRanges: [timedRanges[0]] })), 0.5);
  assert.deepEqual(fragments.map(({ paragraph: item }) => item.id), [1, 2]);
});

test("context menu navigation uses the first usable ref from deliberately broad coverage", () => {
  const multiCoverage = {
    ...paragraph,
    timing: [{ from: 0, to: 13, sourceSegmentRefs: [secondRef, firstRef] }],
  };
  assert.deepEqual(resolveFragment(multiCoverage, timedRanges, 8), {
    from: 0,
    to: 13,
    timedRange: timedRanges[0],
  });
});
