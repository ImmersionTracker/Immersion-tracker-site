(() => {
  function getPlayerElement() {
    return document.getElementById("movie_player");
  }

  function parsePlayerResponse() {
    const player = getPlayerElement();
    try {
      const apiResponse = player?.getPlayerResponse?.();
      if (apiResponse && typeof apiResponse === "object") return apiResponse;
    } catch {
      // Fall through to page globals.
    }

    if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;

    const raw = window.ytplayer?.config?.args?.player_response;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return raw || null;
  }

  function textFromRuns(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value.simpleText === "string") return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map((run) => run?.text || "").join("");
    return "";
  }

  function collectLanguageHints(root) {
    const hints = [];
    const seen = new WeakSet();

    function walk(value, path, depth) {
      if (!value || depth > 10 || typeof value !== "object") return;
      if (seen.has(value)) return;
      seen.add(value);

      for (const [key, child] of Object.entries(value)) {
        const nextPath = path ? `${path}.${key}` : key;
        const keyLooksRelevant = /defaultAudioLanguage|audioLanguage|audioTrack|languageCode|lang/i.test(key);

        if (keyLooksRelevant && (typeof child === "string" || typeof child === "number")) {
          hints.push({ path: nextPath, value: String(child) });
        }

        if (child && typeof child === "object") walk(child, nextPath, depth + 1);
      }
    }

    walk(root, "", 0);
    return hints.slice(0, 150);
  }

  function collectCaptions(response) {
    const renderer = response?.captions?.playerCaptionsTracklistRenderer;
    const tracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
    const captions = tracks.map((track) => ({
      languageCode: track?.languageCode || "",
      kind: track?.kind || "",
      name: textFromRuns(track?.name),
      vssId: track?.vssId || "",
      isTranslatable: Boolean(track?.isTranslatable)
    }));

    const player = getPlayerElement();
    try {
      const apiTracks = player?.getOption?.("captions", "tracklist");
      if (Array.isArray(apiTracks)) {
        for (const track of apiTracks) {
          captions.push({
            languageCode: track?.languageCode || track?.language || "",
            kind: track?.kind || "",
            name: textFromRuns(track?.displayName || track?.name),
            vssId: track?.vssId || "",
            isTranslatable: Boolean(track?.isTranslatable)
          });
        }
      }
    } catch {
      // Internal player APIs change frequently; response captions are enough when available.
    }

    const unique = new Map();
    for (const track of captions) {
      const key = `${track.languageCode}|${track.kind}|${track.vssId}|${track.name}`;
      unique.set(key, track);
    }
    return [...unique.values()].slice(0, 50);
  }

  function collectAudioTracks(response) {
    const tracks = [];
    const seen = new WeakSet();

    function walk(value, depth) {
      if (!value || depth > 9 || typeof value !== "object") return;
      if (seen.has(value)) return;
      seen.add(value);

      if (
        value.audioTrack &&
        typeof value.audioTrack === "object"
      ) {
        const audio = value.audioTrack;
        tracks.push({
          id: audio.id || audio.audioTrackId || "",
          languageCode: audio.languageCode || audio.audioLanguage || "",
          displayName: textFromRuns(audio.displayName || audio.name),
          audioIsDefault: Boolean(audio.audioIsDefault || audio.isDefault)
        });
      }

      for (const child of Object.values(value)) {
        if (child && typeof child === "object") walk(child, depth + 1);
      }
    }

    walk(response, 0);
    const unique = new Map();
    for (const track of tracks) {
      const key = `${track.id}|${track.languageCode}|${track.displayName}`;
      unique.set(key, track);
    }
    return [...unique.values()].slice(0, 30);
  }

  function selectedCaption() {
    const player = getPlayerElement();
    try {
      const track = player?.getOption?.("captions", "track");
      if (!track || typeof track !== "object") return null;
      return {
        languageCode: track.languageCode || track.language || "",
        kind: track.kind || "",
        name: textFromRuns(track.displayName || track.name),
        vssId: track.vssId || ""
      };
    } catch {
      return null;
    }
  }

  function sendProbe() {
    const response = parsePlayerResponse();
    window.postMessage(
      {
        source: "language-immersion-tracker",
        type: "youtube-probe",
        data: {
          hints: collectLanguageHints(response),
          captions: collectCaptions(response),
          audioTracks: collectAudioTracks(response),
          selectedCaption: selectedCaption(),
          videoId: response?.videoDetails?.videoId || null,
          title: response?.videoDetails?.title || null,
          channelId: response?.videoDetails?.channelId || null,
          author: response?.videoDetails?.author || null,
          capturedAt: Date.now()
        }
      },
      location.origin
    );
  }

  sendProbe();
  setInterval(sendProbe, 2000);
})();
