(function attachMediaController(global) {
  function classifyPlaybackCapability(value) {
    if (value === "probably" || value === "maybe") {
      return value;
    }
    return "unsupported";
  }

  function createMediaController({ documentRef = document } = {}) {
    let mediaElement = null;
    let source = null;

    function ensureMediaElement(nextSource) {
      const tagName = nextSource.sourceKind === "video" ? "video" : "audio";
      if (mediaElement?.tagName.toLowerCase() === tagName) {
        return mediaElement;
      }
      mediaElement?.pause();
      mediaElement = documentRef.createElement(tagName);
      mediaElement.preload = "metadata";
      return mediaElement;
    }

    function snapshot() {
      return {
        currentTime: Number.isFinite(mediaElement?.currentTime) ? mediaElement.currentTime : 0,
        duration: Number.isFinite(mediaElement?.duration) ? mediaElement.duration : null,
        state: mediaElement?.ended ? "ended" : (mediaElement?.paused ? "paused" : "playing"),
        sourceKind: source?.sourceKind || "unknown",
      };
    }

    function probe(nextSource) {
      if (!nextSource || nextSource.status !== "available" || !nextSource.url) {
        return "unavailable";
      }
      const probeElement = documentRef.createElement(nextSource.sourceKind === "video" ? "video" : "audio");
      return classifyPlaybackCapability(probeElement.canPlayType(nextSource.mimeType || ""));
    }

    function load(nextSource) {
      if (!nextSource || nextSource.status !== "available" || !nextSource.url) {
        source = null;
        mediaElement?.pause();
        mediaElement?.removeAttribute("src");
        mediaElement?.load();
        return snapshot();
      }
      source = { ...nextSource };
      const element = ensureMediaElement(source);
      element.src = source.url;
      element.load();
      return snapshot();
    }

    return {
      getElement: () => mediaElement,
      getSnapshot: snapshot,
      load,
      pause: () => mediaElement?.pause(),
      play: () => mediaElement ? mediaElement.play() : Promise.reject(new Error("Media source is not loaded.")),
      probe,
      seek: (seconds) => {
        if (!mediaElement || !Number.isFinite(seconds)) {
          return snapshot();
        }
        mediaElement.currentTime = Math.max(0, seconds);
        return snapshot();
      },
    };
  }

  const api = { classifyPlaybackCapability, createMediaController };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.MediaController = api;
})(typeof window === "undefined" ? globalThis : window);
