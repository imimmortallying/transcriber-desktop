(function attachTimedTextPresentation(global) {
  "use strict";

  const HIGHLIGHT_NAME = "asr-timed-active";

  function sameSourceSegmentRef(left, right) {
    return left?.kind === right?.kind && left?.index === right?.index;
  }

  function resolveFragment(paragraph, timedRanges, offset) {
    if (!paragraph || !Number.isFinite(offset)) {
      return null;
    }
    const part = (paragraph.timing || []).find((candidate) => (
      offset >= candidate.from && offset < candidate.to
    ));
    if (!part) {
      return null;
    }
    const timedRange = (timedRanges || []).find((range) => (
      (part.sourceSegmentRefs || []).some((ref) => sameSourceSegmentRef(ref, range.sourceSegmentRef))
    ));
    return timedRange ? { from: part.from, to: part.to, timedRange } : null;
  }

  function resolveActiveFragments(activeStates, time) {
    if (!Number.isFinite(time)) {
      return [];
    }
    return (activeStates || []).flatMap(({ paragraph, timedRanges }) => (timedRanges || [])
      .filter((range) => time >= range.start && time < range.end)
      .flatMap((range) => (paragraph.timing || [])
        .filter((part) => (part.sourceSegmentRefs || []).some((ref) => sameSourceSegmentRef(ref, range.sourceSegmentRef)))
        .map((part) => ({ paragraph, from: part.from, to: part.to, timedRange: range }))));
  }

  function createTimedTextPresentation({ editor }) {

    function supportsCustomHighlights() {
      return Boolean(global.CSS?.highlights && typeof global.Highlight === "function");
    }

    function clearHighlights() {
      if (supportsCustomHighlights()) {
        global.CSS.highlights.delete(HIGHLIGHT_NAME);
      }
    }

    function textNodes(element) {
      const walker = element.ownerDocument.createTreeWalker(element, global.NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) {
        nodes.push(walker.currentNode);
      }
      return nodes;
    }

    function domPointAtOffset(element, offset) {
      let remaining = Math.max(0, offset);
      const nodes = textNodes(element);
      for (const node of nodes) {
        if (remaining <= node.nodeValue.length) {
          return { node, offset: remaining };
        }
        remaining -= node.nodeValue.length;
      }
      const last = nodes.at(-1);
      return last ? { node: last, offset: last.nodeValue.length } : null;
    }

    function rangeForFragment(fragment) {
      const textElement = editor.querySelector(`.document-text[data-paragraph-id="${fragment.paragraph.id}"]`);
      if (!textElement) {
        return null;
      }
      const start = domPointAtOffset(textElement, fragment.from);
      const end = domPointAtOffset(textElement, fragment.to);
      if (!start || !end) {
        return null;
      }
      const range = textElement.ownerDocument.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range;
    }

    function render(snapshot) {
      clearHighlights();
      if (!snapshot?.enabled) {
        return;
      }
      const ranges = resolveActiveFragments(snapshot.activeStates, snapshot.media?.currentTime)
        .map(rangeForFragment)
        .filter(Boolean);
      if (supportsCustomHighlights() && ranges.length) {
        global.CSS.highlights.set(HIGHLIGHT_NAME, new global.Highlight(...ranges));
      }
    }

    return {
      clear() {
        clearHighlights();
      },
      dispose() {
        this.clear();
      },
      render,
    };
  }

  const api = { HIGHLIGHT_NAME, createTimedTextPresentation, resolveActiveFragments, resolveFragment };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.TimedTextPresentation = api;
}(typeof window === "undefined" ? globalThis : window));
