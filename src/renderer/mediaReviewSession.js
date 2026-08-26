(function attachMediaReviewSession(global) {
  "use strict";

  function createSeekResolver({ resolve } = {}) {
    const strategy = typeof resolve === "function"
      ? resolve
      : ({ paragraph, timedRange, transcriptSync }) => {
        if (Number.isFinite(timedRange?.start)) {
          return { kind: "timed-fragment", target: timedRange.start };
        }
        const target = transcriptSync.seekTarget(paragraph);
        return Number.isFinite(target) ? { kind: "first-referenced-segment", target } : null;
      };
    return {
      resolve(context) {
        const intent = strategy(context);
        return intent && Number.isFinite(intent.target) ? { ...intent } : null;
      },
    };
  }

  function createHighlightPolicy() {
    return {
      activeIndications(activeStates, time) {
        return activeStates.flatMap(({ paragraph, timedRanges }) => (timedRanges || [])
          .filter((range) => time >= range.start && time < range.end)
          .map((range) => ({ paragraphId: paragraph.id, start: range.start, end: range.end })));
      },
      activeParagraphIds(activeStates, time) {
        return new Set(this.activeIndications(activeStates, time).map(({ paragraphId }) => paragraphId));
      },
    };
  }

  function createMediaReviewSession({ mediaController, transcriptSync, seekResolver = createSeekResolver(), highlightPolicy = createHighlightPolicy() }) {
    if (!mediaController || !transcriptSync) {
      throw new Error("Media Review требует MediaController и TranscriptSync.");
    }

    let enabled = false;
    let source = null;
    let videoVisible = true;
    let activeStates = [];
    let media = mediaController.getSnapshot();
    let playbackCapability = "unavailable";
    const listeners = new Set();

    function refreshDerivedState() {
      activeStates = enabled ? transcriptSync.activeAt(media.currentTime) : [];
    }

    function probeSource() {
      return source?.status === "available" && source.url
        ? mediaController.probe(source)
        : "unavailable";
    }

    function snapshot() {
      return {
        enabled,
        source: source ? { ...source } : null,
        media: { ...media },
        playbackCapability,
        activeStates: activeStates.map(({ paragraph, timedRanges }) => ({
          paragraph,
          timedRanges: timedRanges.map((range) => ({ ...range, sourceSegmentRef: { ...range.sourceSegmentRef } })),
        })),
        activeIndications: highlightPolicy.activeIndications(activeStates, media.currentTime),
        activeParagraphIds: highlightPolicy.activeParagraphIds(activeStates, media.currentTime),
        videoVisible,
      };
    }

    function notify() {
      const value = snapshot();
      for (const listener of listeners) {
        listener(value);
      }
    }

    const unsubscribeMedia = mediaController.subscribe((nextMedia) => {
      media = nextMedia;
      refreshDerivedState();
      notify();
    });

    function setSource(nextSource) {
      source = nextSource ? { ...nextSource } : null;
      playbackCapability = probeSource();
      if (enabled) {
        if (playbackCapability !== "unsupported" && playbackCapability !== "unavailable") {
          mediaController.load(source);
        } else {
          enabled = false;
          mediaController.load(null);
        }
      }
      refreshDerivedState();
      notify();
      return snapshot();
    }

    function enable() {
      if (source?.status !== "available" || !source.url) {
        return false;
      }
      playbackCapability = probeSource();
      if (playbackCapability === "unsupported" || playbackCapability === "unavailable") {
        notify();
        return false;
      }
      enabled = true;
      videoVisible = source.sourceKind === "video";
      mediaController.load(source);
      refreshDerivedState();
      notify();
      return true;
    }

    function disable() {
      enabled = false;
      activeStates = [];
      mediaController.pause();
      mediaController.load(null);
      notify();
    }

    function requestSeek(paragraph, context = {}) {
      if (!enabled) {
        return null;
      }
      const intent = seekResolver.resolve({ paragraph, transcriptSync, ...context });
      if (!intent) {
        return null;
      }
      mediaController.seek(intent.target);
      return intent;
    }

    return {
      canSeek: (paragraph, context = {}) => Boolean(enabled && seekResolver.resolve({ paragraph, transcriptSync, ...context })),
      disable,
      dispose() {
        disable();
        unsubscribeMedia();
        listeners.clear();
      },
      enable,
      getElement: () => mediaController.getElement(),
      getSnapshot: snapshot,
      pause: () => enabled && mediaController.pause(),
      play: () => enabled ? mediaController.play() : Promise.reject(new Error("Media Review выключен.")),
      requestSeek,
      seek: (seconds) => enabled && mediaController.seek(seconds),
      setSource,
      setVideoVisible(visible) {
        videoVisible = Boolean(visible);
        notify();
      },
      subscribe(listener) {
        listeners.add(listener);
        listener(snapshot());
        return () => listeners.delete(listener);
      },
      togglePlayback: () => enabled
        ? mediaController.togglePlayback()
        : Promise.reject(new Error("Media Review выключен.")),
    };
  }

  const api = { createHighlightPolicy, createMediaReviewSession, createSeekResolver };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.MediaReviewSession = api;
}(typeof window === "undefined" ? globalThis : window));
