"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createEditorHistory } = require("../../src/renderer/editorHistory.js");
const {
  PROJECT_SCHEMA_VERSION,
  buildBaselineParagraphs,
  collectSourceSegmentRefs,
  createTranscriptSync,
  mergeTiming,
  migrateProjectProvenance,
  normalizeTiming,
  rescaleTiming,
  sanitizeTiming,
  splitTiming,
} = require("../../src/renderer/transcriptSync.js");

const baseline = [
  { text: "первый", start: 0, end: 1 },
  { text: "второй", start: 3, end: 4 },
  { text: "третий", start: 5, end: 6 },
];

function refs(paragraph) {
  return collectSourceSegmentRefs(paragraph).map((ref) => ref.index);
}

function paragraph(id, text, timing) {
  return { id, type: "text", text, speakerId: null, start: timing[0]?.start ?? null, timing };
}

test("baseline creates explicit sourceSegmentRefs for every timed ASR segment", () => {
  const [document] = buildBaselineParagraphs(baseline);

  assert.equal(document.text, "первый второй третий");
  assert.deepEqual(refs(document), [0, 1, 2]);
  assert.deepEqual(document.timing.map((part) => part.sourceSegmentRefs), [
    [{ kind: "baseline-segment", index: 0 }],
    [{ kind: "baseline-segment", index: 1 }],
    [{ kind: "baseline-segment", index: 2 }],
  ]);
});

test("v1 edits migrate uniquely resolvable timing starts and preserve ambiguous parts as best effort", () => {
  const project = {
    schemaVersion: 1,
    paragraphs: [{
      id: 1,
      type: "text",
      text: "первый второй",
      speakerId: null,
      start: 0,
      timing: [
        { from: 0, to: 6, start: 0 },
        { from: 7, to: 13, start: 3 },
      ],
    }],
    speakers: [],
  };

  const migrated = migrateProjectProvenance(project, baseline);
  assert.equal(migrated.project.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.project.paragraphs[0].timing.map((part) => part.sourceSegmentRefs[0]?.index), [0, 1]);

  const ambiguous = migrateProjectProvenance(project, [
    { text: "a", start: 0, end: 1 },
    { text: "b", start: 0, end: 2 },
    ...baseline.slice(1),
  ]);
  assert.equal(ambiguous.unresolvedParts, 1);
  assert.deepEqual(ambiguous.project.paragraphs[0].timing[0].sourceSegmentRefs, []);
});

test("ordinary text edits preserve source anchors while character association remains approximate", () => {
  const [document] = buildBaselineParagraphs(baseline);
  const editedTiming = rescaleTiming(document.timing, document.text.length, `${document.text} исправлено`.length);
  const edited = paragraph(1, `${document.text} исправлено`, editedTiming);

  assert.deepEqual(refs(edited), [0, 1, 2]);
  assert.equal(edited.timing[0].sourceSegmentRefs[0].kind, "baseline-segment");
});

test("speaker assignment changes replica metadata without changing provenance", () => {
  const [document] = buildBaselineParagraphs(baseline);
  const replica = { ...document, type: "replica", speakerId: 7 };

  assert.deepEqual(refs(replica), [0, 1, 2]);
});

test("split inside one source segment keeps that segment reference on both transcript parts", () => {
  const [document] = buildBaselineParagraphs([{ text: "длинный сегмент", start: 10, end: 14 }]);
  const { left, right } = splitTiming(document.timing, 7, document.start);
  const parts = [paragraph(1, "длинный", left), paragraph(2, "сегмент", right)];
  const sync = createTranscriptSync({ baselineSegments: [{ text: "длинный сегмент", start: 10, end: 14 }], getParagraphs: () => parts });

  assert.deepEqual(refs(parts[0]), [0]);
  assert.deepEqual(refs(parts[1]), [0]);
  assert.deepEqual(sync.activeAt(12).map(({ paragraph: active }) => active.id), [1, 2]);
  assert.equal(sync.seekTarget(parts[1]), 10);
});

test("activeAt uses half-open segment ranges, so a shared boundary selects only the next segment", () => {
  const contiguousBaseline = [
    { text: "one", start: 0, end: 1 },
    { text: "two", start: 1, end: 2 },
  ];
  const [document] = buildBaselineParagraphs(contiguousBaseline);
  const first = paragraph(1, "one", [document.timing[0]]);
  const second = paragraph(2, "two", [document.timing[1]]);
  const sync = createTranscriptSync({ baselineSegments: contiguousBaseline, getParagraphs: () => [first, second] });

  assert.deepEqual(sync.activeAt(1).map(({ paragraph: active }) => active.id), [2]);
});

test("missing, invalid and out-of-range refs resolve fail-soft without an invented seek time", () => {
  const unresolved = paragraph(1, "нет provenance", [{
    from: 0,
    to: 14,
    start: 0,
    sourceSegmentRefs: [
      { kind: "baseline-segment", index: 99 },
      { kind: "unknown", index: 0 },
    ],
  }]);
  const sync = createTranscriptSync({ baselineSegments: baseline, getParagraphs: () => [unresolved] });

  assert.deepEqual(sync.timedRanges(unresolved), []);
  assert.equal(sync.seekTarget(unresolved), null);
  assert.deepEqual(sync.activeAt(0), []);

  const persisted = sanitizeTiming(unresolved.timing, baseline);
  assert.equal(persisted.droppedRefs, 2);
  assert.deepEqual(persisted.timing[0].sourceSegmentRefs, []);
});

test("split at a source boundary assigns refs naturally without inventing a split time", () => {
  const [document] = buildBaselineParagraphs(baseline.slice(0, 2));
  const { left, right, point } = splitTiming(document.timing, "первый".length, document.start);
  const leftParagraph = paragraph(1, "первый", left);
  const rightParagraph = paragraph(2, " второй", right);

  assert.deepEqual(refs(leftParagraph), [0]);
  assert.deepEqual(refs(rightParagraph), [1]);
  assert.equal(point, 3);
});

test("merge keeps a union of source refs and does not turn a VAD gap into a continuous range", () => {
  const [document] = buildBaselineParagraphs(baseline.slice(0, 2));
  const merged = paragraph(1, document.text, mergeTiming([document.timing[0]], [document.timing[1]], "первый ".length));
  const sync = createTranscriptSync({ baselineSegments: baseline, getParagraphs: () => [merged] });

  assert.deepEqual(refs(merged), [0, 1]);
  assert.deepEqual(sync.timedRanges(merged).map((range) => [range.start, range.end]), [[0, 1], [3, 4]]);
  assert.deepEqual(sync.activeAt(2), []);
  assert.equal(sync.seekTarget(merged), 0);
});

test("history, save/reopen and restore original retain or rebuild provenance as document state", () => {
  const [original] = buildBaselineParagraphs(baseline.slice(0, 2));
  const { left, right } = splitTiming(original.timing, "первый".length, original.start);
  const splitState = {
    paragraphs: [paragraph(1, "первый", left), paragraph(2, " второй", right)],
    nextParagraphId: 3,
  };
  const history = createEditorHistory();
  history.initialize({ paragraphs: [original], nextParagraphId: 2 }, null);
  history.record(splitState, null, { kind: "split" });

  assert.deepEqual(refs(history.undo().document.paragraphs[0]), [0, 1]);
  assert.deepEqual(history.redo().document.paragraphs.map(refs), [[0], [1]]);

  const reopened = JSON.parse(JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION, paragraphs: splitState.paragraphs, speakers: [] }));
  const afterReopen = migrateProjectProvenance(reopened, baseline);
  assert.equal(afterReopen.migrated, false);
  assert.deepEqual(afterReopen.project.paragraphs.map(refs), [[0], [1]]);

  const [restored] = buildBaselineParagraphs(baseline.slice(0, 2));
  assert.deepEqual(refs(restored), [0, 1]);
});

test("split, merge and persistence normalize refs without duplicates in baseline order", () => {
  const [document] = buildBaselineParagraphs([{ text: "длинный сегмент", start: 0, end: 2 }]);
  const { left, right } = splitTiming(document.timing, 7, document.start);
  const merged = mergeTiming(left, right, 7);
  const reopened = JSON.parse(JSON.stringify(normalizeTiming(merged)));

  assert.equal(reopened.length, 1);
  assert.deepEqual(reopened[0].sourceSegmentRefs, [{ kind: "baseline-segment", index: 0 }]);
  assert.deepEqual(refs(paragraph(1, document.text, reopened)), [0]);
});
