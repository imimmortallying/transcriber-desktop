(function attachTranscriptSync(global) {
  "use strict";

  const PROJECT_SCHEMA_VERSION = 2;
  const SOURCE_SEGMENT_REF_KIND = "baseline-segment";

  function createSourceSegmentRef(index) {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error("Некорректная ссылка на исходный ASR-сегмент.");
    }
    return { kind: SOURCE_SEGMENT_REF_KIND, index };
  }

  function isSourceSegmentRef(value) {
    return Boolean(value)
      && typeof value === "object"
      && !Array.isArray(value)
      && value.kind === SOURCE_SEGMENT_REF_KIND
      && Number.isSafeInteger(value.index)
      && value.index >= 0;
  }

  function cloneSourceSegmentRefs(refs) {
    return Array.isArray(refs) ? refs.map((ref) => ({ ...ref })) : [];
  }

  function normalizeSourceSegmentRefs(refs) {
    const unique = new Map();
    for (const ref of refs || []) {
      if (!isSourceSegmentRef(ref)) {
        continue;
      }
      unique.set(`${ref.kind}:${ref.index}`, { ...ref });
    }
    return [...unique.values()].sort((left, right) => left.index - right.index);
  }

  function areSameSourceSegmentRefs(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function normalizeTiming(timing) {
    const normalized = [];
    for (const part of timing || []) {
      const next = { ...part, sourceSegmentRefs: normalizeSourceSegmentRefs(part.sourceSegmentRefs) };
      const previous = normalized.at(-1);
      if (previous
        && previous.to === next.from
        && previous.start === next.start
        && areSameSourceSegmentRefs(previous.sourceSegmentRefs, next.sourceSegmentRefs)) {
        previous.to = next.to;
      } else {
        normalized.push(next);
      }
    }
    return normalized;
  }

  function sanitizeTiming(timing, baselineSegments) {
    const baselineLength = Array.isArray(baselineSegments) ? baselineSegments.length : 0;
    let droppedRefs = 0;
    const sanitized = (timing || []).map((part) => {
      const rawRefs = Array.isArray(part.sourceSegmentRefs) ? part.sourceSegmentRefs : [];
      if (!Array.isArray(part.sourceSegmentRefs)) {
        droppedRefs += 1;
      }
      const sourceSegmentRefs = rawRefs.filter((ref) => {
        const usable = isSourceSegmentRef(ref) && ref.index < baselineLength;
        if (!usable) {
          droppedRefs += 1;
        }
        return usable;
      });
      return { ...part, sourceSegmentRefs };
    });
    return { timing: normalizeTiming(sanitized), droppedRefs };
  }

  function buildBaselineParagraphs(segments, transcript = "") {
    const timing = [];
    let text = "";
    for (const [index, segment] of segments.entries()) {
      const segmentText = segment.text.trim();
      if (!segmentText) {
        continue;
      }
      if (text) {
        text += " ";
      }
      const from = text.length;
      text += segmentText;
      timing.push({
        from,
        to: text.length,
        start: segment.start,
        sourceSegmentRefs: [createSourceSegmentRef(index)],
      });
    }
    const normalizedTiming = normalizeTiming(timing);
    return text
      ? [{ type: "text", text, timing: normalizedTiming, start: normalizedTiming[0]?.start ?? null }]
      : transcript.trim() ? [{ type: "text", text: transcript, timing: [], start: null }] : [];
  }

  function sourceRefsForLegacyStart(start, refsByStart) {
    if (!Number.isFinite(start)) {
      return [];
    }
    const candidates = refsByStart.get(start) || [];
    return candidates.length === 1 ? [createSourceSegmentRef(candidates[0])] : [];
  }

  function migrateProjectProvenance(project, baselineSegments) {
    if (project?.schemaVersion !== 1) {
      return { project, migrated: false, unresolvedParts: 0 };
    }

    const refsByStart = new Map();
    for (const [index, segment] of baselineSegments.entries()) {
      if (!Number.isFinite(segment.start)) {
        continue;
      }
      const indexes = refsByStart.get(segment.start) || [];
      indexes.push(index);
      refsByStart.set(segment.start, indexes);
    }

    let unresolvedParts = 0;
    const paragraphs = Array.isArray(project.paragraphs)
      ? project.paragraphs.map((paragraph) => ({
        ...paragraph,
        timing: Array.isArray(paragraph.timing) ? paragraph.timing.map((part) => {
          const sourceSegmentRefs = sourceRefsForLegacyStart(part?.start, refsByStart);
          if (!sourceSegmentRefs.length) {
            unresolvedParts += 1;
          }
          return { ...part, sourceSegmentRefs };
        }) : paragraph.timing,
      }))
      : project.paragraphs;

    return {
      project: { ...project, schemaVersion: PROJECT_SCHEMA_VERSION, paragraphs },
      migrated: true,
      unresolvedParts,
    };
  }

  function splitTiming(timing, offset, fallbackStart = null) {
    const left = [];
    const right = [];
    for (const part of timing) {
      if (part.to <= offset) {
        left.push({ ...part, sourceSegmentRefs: cloneSourceSegmentRefs(part.sourceSegmentRefs) });
      } else if (part.from >= offset) {
        right.push({
          ...part,
          from: part.from - offset,
          to: part.to - offset,
          sourceSegmentRefs: cloneSourceSegmentRefs(part.sourceSegmentRefs),
        });
      } else {
        left.push({ ...part, to: offset, sourceSegmentRefs: cloneSourceSegmentRefs(part.sourceSegmentRefs) });
        right.push({
          ...part,
          from: 0,
          to: part.to - offset,
          sourceSegmentRefs: cloneSourceSegmentRefs(part.sourceSegmentRefs),
        });
      }
    }
    const normalizedLeft = normalizeTiming(left);
    const normalizedRight = normalizeTiming(right);
    return { left: normalizedLeft, right: normalizedRight, point: normalizedRight[0]?.start ?? fallbackStart };
  }

  function mergeTiming(leftTiming, rightTiming, splitOffset) {
    return normalizeTiming([
      ...leftTiming.map((part) => ({ ...part, sourceSegmentRefs: cloneSourceSegmentRefs(part.sourceSegmentRefs) })),
      ...rightTiming.map((part) => ({
        ...part,
        from: part.from + splitOffset,
        to: part.to + splitOffset,
        sourceSegmentRefs: cloneSourceSegmentRefs(part.sourceSegmentRefs),
      })),
    ]);
  }

  function rescaleTiming(timing, previousLength, nextLength) {
    if (!previousLength || previousLength === nextLength) {
      return normalizeTiming(timing);
    }
    const ratio = nextLength / previousLength;
    return normalizeTiming(timing.map((part) => ({
      ...part,
      from: Math.round(part.from * ratio),
      to: Math.round(part.to * ratio),
      sourceSegmentRefs: cloneSourceSegmentRefs(part.sourceSegmentRefs),
    })));
  }

  function collectSourceSegmentRefs(paragraph) {
    const refs = [];
    const keys = new Set();
    for (const part of paragraph?.timing || []) {
      for (const ref of normalizeSourceSegmentRefs(part.sourceSegmentRefs)) {
        const key = `${ref.kind}:${ref.index}`;
        if (!keys.has(key)) {
          keys.add(key);
          refs.push({ ...ref });
        }
      }
    }
    return refs;
  }

  function resolveTimedRanges(paragraph, baselineSegments) {
    const ranges = [];
    const keys = new Set();
    for (const ref of collectSourceSegmentRefs(paragraph)) {
      const segment = baselineSegments[ref.index];
      if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)) {
        continue;
      }
      const key = `${ref.kind}:${ref.index}`;
      if (!keys.has(key)) {
        keys.add(key);
        ranges.push({ sourceSegmentRef: ref, start: segment.start, end: segment.end });
      }
    }
    return ranges;
  }

  function createTranscriptSync({ baselineSegments, getParagraphs }) {
    const readParagraphs = typeof getParagraphs === "function" ? getParagraphs : () => [];
    const readBaseline = Array.isArray(baselineSegments) ? baselineSegments : [];
    return {
      activeAt(time) {
        if (!Number.isFinite(time)) {
          return [];
        }
        return readParagraphs()
          .map((paragraph) => ({ paragraph, timedRanges: resolveTimedRanges(paragraph, readBaseline) }))
          .filter(({ timedRanges }) => timedRanges.some((range) => time >= range.start && time < range.end));
      },
      seekTarget(paragraph) {
        return resolveTimedRanges(paragraph, readBaseline)[0]?.start ?? null;
      },
      timedRanges(paragraph) {
        return resolveTimedRanges(paragraph, readBaseline);
      },
    };
  }

  const api = {
    PROJECT_SCHEMA_VERSION,
    SOURCE_SEGMENT_REF_KIND,
    buildBaselineParagraphs,
    collectSourceSegmentRefs,
    createSourceSegmentRef,
    createTranscriptSync,
    isSourceSegmentRef,
    mergeTiming,
    migrateProjectProvenance,
    normalizeSourceSegmentRefs,
    normalizeTiming,
    resolveTimedRanges,
    rescaleTiming,
    sanitizeTiming,
    splitTiming,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.TranscriptSync = api;
}(typeof window === "undefined" ? globalThis : window));
