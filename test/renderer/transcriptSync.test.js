"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createEditorHistory } = require("../../src/renderer/editorHistory.js");
const {
  PROJECT_SCHEMA_VERSION,
  buildBaselineParagraphs,
  collectSourceSegmentRefs,
  createTranscriptSync,
  deriveTextReplace,
  mapTemporalCoverage,
  mergeTiming,
  migrateProjectProvenance,
  normalizeTiming,
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
  const nextText = `${document.text} исправлено`;
  const editedTiming = mapTemporalCoverage(document.timing, {
    ...deriveTextReplace(document.text, nextText),
    text: document.text,
  });
  const edited = paragraph(1, nextText, editedTiming);

  assert.deepEqual(refs(edited), [0, 1, 2]);
  assert.deepEqual(edited.timing.map((part) => [part.from, part.to, part.sourceSegmentRefs.map((ref) => ref.index)]), [
    [0, 6, [0]],
    [7, 13, [1]],
    [14, nextText.length, [2]],
  ]);
});

function coverage(index, from, to) {
  return {
    from,
    to,
    start: baseline[index].start,
    sourceSegmentRefs: [{ kind: "baseline-segment", index }],
  };
}

function coverageShape(timing) {
  return timing.map((part) => [part.from, part.to, part.sourceSegmentRefs.map((ref) => ref.index)]);
}

test("coverage mapper shifts untouched text and lets edits inside one segment keep that segment", () => {
  const timing = [coverage(0, 0, 4), coverage(1, 4, 8)];

  assert.deepEqual(coverageShape(mapTemporalCoverage(timing, {
    from: 2,
    to: 2,
    insertedText: "XX",
    text: "aaaabbbb",
  })), [[0, 6, [0]], [6, 10, [1]]]);
  assert.deepEqual(coverageShape(mapTemporalCoverage(timing, {
    from: 1,
    to: 3,
    insertedText: "",
    text: "aaaabbbb",
  })), [[0, 2, [0]], [2, 6, [1]]]);
  assert.deepEqual(coverageShape(mapTemporalCoverage(timing, {
    from: 0,
    to: 4,
    insertedText: "исправлено",
    text: "aaaabbbb",
  })), [[0, 10, [0]], [10, 14, [1]]]);
});

test("coverage mapper inherits union only from the edited range or its immediate boundary", () => {
  const timing = [coverage(0, 0, 4), coverage(1, 4, 8), coverage(2, 8, 12), coverage(0, 12, 16)];

  assert.deepEqual(coverageShape(mapTemporalCoverage(timing, {
    from: 4,
    to: 4,
    insertedText: "новое",
    text: "aaaabbbbccccdddd",
  })), [[0, 4, [0]], [4, 9, [0, 1]], [9, 13, [1]], [13, 17, [2]], [17, 21, [0]]]);
  assert.deepEqual(coverageShape(mapTemporalCoverage(timing, {
    from: 2,
    to: 14,
    insertedText: "X",
    text: "aaaabbbbccccdddd",
  })), [[0, 2, [0]], [2, 3, [0, 1, 2]], [3, 5, [0]]]);
});

test("whole inserted paragraph between source fragments keeps their immediate union without moving either fragment", () => {
  const timing = [coverage(0, 0, 4), coverage(1, 5, 9)];
  const insertedText = "\nновый абзац\n";
  const mapped = mapTemporalCoverage(timing, {
    from: 5,
    to: 5,
    insertedText,
    text: "aaaa bbbb",
  });

  assert.deepEqual(coverageShape(mapped), [
    [0, 4, [0]],
    [5, 5 + insertedText.length, [0, 1]],
    [5 + insertedText.length, 9 + insertedText.length, [1]],
  ]);
});

test("unanchored text stays unanchored and multi-segment coverage remains deliberately broad", () => {
  const union = [{
    from: 0,
    to: 4,
    start: 0,
    sourceSegmentRefs: [
      { kind: "baseline-segment", index: 1 },
      { kind: "baseline-segment", index: 0 },
      { kind: "baseline-segment", index: 1 },
    ],
  }];
  assert.deepEqual(coverageShape(mapTemporalCoverage(union, {
    from: 2,
    to: 2,
    insertedText: "X",
    text: "aaaa",
  })), [[0, 5, [0, 1]]]);
  assert.deepEqual(coverageShape(mapTemporalCoverage([coverage(0, 2, 4)], {
    from: 0,
    to: 0,
    insertedText: "X",
    text: "xxaa",
  })), [[0, 1, []], [3, 5, [0]]]);
});

test("minimal replace fallback gives paste and IME commits the same local coverage contract", () => {
  assert.deepEqual(deriveTextReplace("я приехал вчера", "я приехал сегодня"), {
    from: 10,
    to: 15,
    insertedText: "сегодня",
  });
  const timing = [coverage(0, 0, 8), coverage(1, 8, 16)];
  const replacement = deriveTextReplace("aaaabbbbccccdddd", "aaaaИМЕccccdddd");
  assert.deepEqual(coverageShape(mapTemporalCoverage(timing, { ...replacement, text: "aaaabbbbccccdddd" })), [
    [0, 7, [0]],
    [7, 15, [1]],
  ]);
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

test("untouched baseline transcript exposes its current exact segment range without a split", () => {
  const [baselineParagraph] = buildBaselineParagraphs(baseline);
  const untouched = { ...baselineParagraph, id: 1 };
  const sync = createTranscriptSync({ baselineSegments: baseline, getParagraphs: () => [untouched] });

  const [active] = sync.activeAt(3.5);
  assert.equal(active.paragraph.id, untouched.id);
  assert.deepEqual(active.timedRanges.find((range) => range.start === 3), {
    sourceSegmentRef: { kind: "baseline-segment", index: 1 },
    start: 3,
    end: 4,
  });
  assert.deepEqual(sync.activeAt(2), []);
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

test("coverage edits are restored by the existing history snapshot and v2 reopen", () => {
  const timing = [coverage(0, 0, 4), coverage(1, 4, 8)];
  const original = paragraph(1, "aaaabbbb", timing);
  const edited = paragraph(1, "aaaaновоеbbbb", mapTemporalCoverage(timing, {
    from: 4,
    to: 4,
    insertedText: "новое",
    text: original.text,
  }));
  const history = createEditorHistory();
  history.initialize({ paragraphs: [original], nextParagraphId: 2 }, null);
  history.record({ paragraphs: [edited], nextParagraphId: 2 }, null, { kind: "typing" });

  assert.deepEqual(coverageShape(history.undo().document.paragraphs[0].timing), [[0, 4, [0]], [4, 8, [1]]]);
  assert.deepEqual(coverageShape(history.redo().document.paragraphs[0].timing), [[0, 4, [0]], [4, 9, [0, 1]], [9, 13, [1]]]);

  const reopened = migrateProjectProvenance({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    paragraphs: [edited],
    speakers: [],
  }, baseline);
  assert.equal(reopened.migrated, false);
  assert.deepEqual(coverageShape(reopened.project.paragraphs[0].timing), [[0, 4, [0]], [4, 9, [0, 1]], [9, 13, [1]]]);
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
