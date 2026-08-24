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
    const listeners = new Set();

    function emit() {
      const value = snapshot();
      for (const listener of listeners) {
        listener(value);
      }
    }

    function observeMediaElement(element) {
      ["durationchange", "ended", "error", "loadedmetadata", "pause", "play", "seeked", "seeking", "timeupdate"].forEach((eventName) => {
        element.addEventListener(eventName, emit);
      });
    }

    function ensureMediaElement(nextSource) {
      const tagName = nextSource.sourceKind === "video" ? "video" : "audio";
      if (mediaElement?.tagName.toLowerCase() === tagName) {
        return mediaElement;
      }
      mediaElement?.pause();
      mediaElement = documentRef.createElement(tagName);
      mediaElement.preload = "metadata";
      observeMediaElement(mediaElement);
      return mediaElement;
    }

    function snapshot() {
      return {
        currentTime: Number.isFinite(mediaElement?.currentTime) ? mediaElement.currentTime : 0,
        duration: Number.isFinite(mediaElement?.duration) ? mediaElement.duration : null,
        hasError: Boolean(mediaElement?.error),
        state: !mediaElement ? "idle" : (mediaElement.ended ? "ended" : (mediaElement.paused ? "paused" : "playing")),
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
        emit();
        return snapshot();
      }
      source = { ...nextSource };
      const element = ensureMediaElement(source);
      element.src = source.url;
      element.load();
      emit();
      return snapshot();
    }

    return {
      getElement: () => mediaElement,
      getSnapshot: snapshot,
      load,
      pause: () => {
        mediaElement?.pause();
        emit();
      },
      play: () => mediaElement
        ? mediaElement.play().then(() => {
          emit();
        })
        : Promise.reject(new Error("Media source is not loaded.")),
      probe,
      seek: (seconds) => {
        if (!mediaElement || !Number.isFinite(seconds)) {
          return snapshot();
        }
        const duration = Number.isFinite(mediaElement.duration) && mediaElement.duration >= 0
          ? mediaElement.duration
          : null;
        mediaElement.currentTime = duration === null
          ? Math.max(0, seconds)
          : Math.min(duration, Math.max(0, seconds));
        emit();
        return snapshot();
      },
      subscribe(listener) {
        listeners.add(listener);
        listener(snapshot());
        return () => listeners.delete(listener);
      },
    };
  }

  const api = { classifyPlaybackCapability, createMediaController };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.MediaController = api;
})(typeof window === "undefined" ? globalThis : window);
