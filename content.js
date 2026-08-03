(() => {
  const STREAMING_SITE_CONFIGS = [
    {
      id: "netflix", name: "Netflix", hosts: [/^(?:www\.)?netflix\.com$/],
      routes: [/^\/watch\/[^/?#]+/], brand: /\s*[-|]\s*Netflix\s*$/i,
      titleSelectors: ['[data-uia="video-title"]', ".video-title", ".ellipsize-text h4"],
      seriesSelectors: ['[data-uia="video-title"] h4', ".video-title h4", ".ellipsize-text h4"]
    },
    {
      id: "disneyplus", name: "Disney+", hosts: [/^(?:www\.)?disneyplus\.com$/],
      routes: [/^\/(?:[a-z]{2}-[a-z]{2}\/)?(?:play|video)\//i], brand: /\s*[-|]\s*Disney\+\s*$/i,
      titleSelectors: ['[data-testid*="title"]', '[class*="title"] h1', "h1"],
      seriesSelectors: ['[data-testid="player-title"]', '[data-testid*="series-title"]']
    },
    {
      id: "primevideo", name: "Prime Video",
      hosts: [/^(?:www\.)?primevideo\.com$/, /^(?:www\.)?amazon\.(?:com|co\.uk|ca|de|co\.jp|fr|it|es)$/],
      routes: [/\/(?:detail|gp\/video\/detail)\//i], brand: /\s*[-|:]\s*(?:Prime Video|Amazon\.com)\s*$/i,
      titleSelectors: ['[data-automation-id="title"]', '[class*="atvwebplayersdk-title"]', "h1"],
      seriesSelectors: ['[class*="atvwebplayersdk-series-title"]', '[data-automation-id*="series-title"]']
    },
    {
      id: "hulu", name: "Hulu", hosts: [/^(?:www\.)?hulu\.com$/],
      routes: [/^\/watch\//i], brand: /\s*[-|]\s*Hulu\s*$/i,
      titleSelectors: ['[data-testid="player-title"]', '[class*="PlayerMetadata"]', "h1"],
      seriesSelectors: ['[data-testid*="series-title"]', '[class*="PlayerMetadata__series"]']
    },
    {
      id: "max", name: "Max", hosts: [/^play\.max\.com$/],
      routes: [/\/(?:video\/watch|watch)\//i], brand: /\s*[-|]\s*Max\s*$/i,
      titleSelectors: ['[data-testid*="content-title"]', '[data-testid*="player-title"]', "h1"],
      seriesSelectors: ['[data-testid*="series-title"]']
    },
    {
      id: "appletv", name: "Apple TV+", hosts: [/^tv\.apple\.com$/],
      routes: [/\/(?:episode|movie)\//i], brand: /\s*[-|]\s*Apple TV(?:\+)?\s*$/i,
      titleSelectors: ['[data-testid*="title"]', '[class*="title"] h1', "h1"],
      seriesSelectors: ['[data-testid*="show-title"]', '[class*="show-title"]']
    },
    {
      id: "paramountplus", name: "Paramount+", hosts: [/^(?:www\.)?paramountplus\.com$/],
      routes: [/\/(?:shows|movies)\/video\//i, /\/live-tv\//i], brand: /\s*[-|]\s*Paramount\+\s*$/i,
      titleSelectors: ['[data-testid*="title"]', '[class*="video-title"]', "h1"],
      seriesSelectors: ['[data-testid*="show-title"]', '[class*="show-title"]']
    },
    {
      id: "peacock", name: "Peacock", hosts: [/^(?:www\.)?peacocktv\.com$/],
      routes: [/\/watch\//i], brand: /\s*[-|]\s*Peacock(?: TV)?\s*$/i,
      titleSelectors: ['[data-testid*="title"]', '[class*="metadata"] h1', "h1"],
      seriesSelectors: ['[data-testid*="series-title"]']
    },
    {
      id: "crunchyroll", name: "Crunchyroll", hosts: [/^(?:www\.)?crunchyroll\.com$/],
      routes: [/\/watch\//i], brand: /\s*[-|]\s*Crunchyroll\s*$/i,
      titleSelectors: ['[data-testid*="title"]', '[class*="show-title"]', "h1"],
      seriesSelectors: ['[data-testid*="series-title"]', '[class*="series-title"]', 'a[href*="/series/"]']
    },
    {
      id: "hidive", name: "HIDIVE", hosts: [/^(?:www\.)?hidive\.com$/],
      routes: [/\/(?:video|stream)\//i], brand: /\s*[-|]\s*HIDIVE\s*$/i,
      titleSelectors: ['[class*="video-title"]', '[class*="player-title"]', "h1"],
      seriesSelectors: ['[class*="series-title"]', '[class*="show-title"]']
    },
    {
      id: "tubi", name: "Tubi", hosts: [/^(?:www\.)?tubitv\.com$/],
      routes: [/\/(?:movies|tv-shows)\//i], brand: /\s*[-|]\s*Tubi(?: TV)?\s*$/i,
      titleSelectors: ['[data-testid*="title"]', '[class*="video-title"]', "h1"],
      seriesSelectors: ['[data-testid*="series-title"]', '[class*="series-title"]']
    }
  ];

  const streamingSite = STREAMING_SITE_CONFIGS.find((candidate) =>
    candidate.hosts.some((pattern) => pattern.test(location.hostname))
  ) || null;
  const site = streamingSite?.id || "youtube";
  const isStreamingSite = Boolean(streamingSite);
  let targetLanguage = { code: "ja", name: "Japanese" };
  let detectedLanguage = null;
  // Languages offered in Automatic mode's "which language is this?" prompt,
  // most-immersed first. Filled from the background on demand.
  let languageChoices = [];
  let automaticResolutionSequence = 0;

  let currentVideo = null;
  let currentInfo = null;
  let sessionId = null;
  let languageState = "checking";
  let detectionReason = "";
  let pageProbe = { hints: [], captions: [], audioTracks: [] };
  let lastStreamingAudioSignature = "";

  // Structured series metadata can provide an optional, anonymous family key.
  // It never blocks playback and is never used to classify content for the user.
  let ogJsonLdDirty = true;
  let ogJsonLdSnapshot = { candidates: [] };
  let ogJsonLdDebounceTimer = null;

  let lastSampleWall = 0;
  let lastMediaTime = 0;
  let pendingActive = 0;
  let pendingPassive = 0;
  let unconfirmedActive = 0;
  let unconfirmedPassive = 0;
  let sessionActive = 0;
  let sessionPassive = 0;
  let lastFlushAt = performance.now();
  let flushPromise = null;
  let statusPausedByUser = false;
  let reconnectInProgress = false;
  let browserTabMuted = false;
  let browserContextActive = true;
  let sourceSuggestion = false;
  let overlayCompact = false;
  let overlayManuallyShown = false;
  let overlayDragState = null;
  let suppressOverlayClick = false;
  let autoMinimizeTimer = null;
  let overlayPreferences = {
    autoMinimizeEnabled: true,
    autoMinimizeSeconds: 5,
    theme: "dark",
    fullyManualEnabled: false,
    targetLanguageDeferred: false
  };

  const overlay = createOverlay();
  initializeOverlayDragging();

  function randomId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function injectYouTubeProbe() {
    if (site !== "youtube" || document.documentElement.dataset.jitProbeInjected) return;
    document.documentElement.dataset.jitProbeInjected = "true";
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page-probe.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "language-immersion-tracker") return;
    if (event.data?.type !== "youtube-probe") return;
    pageProbe = event.data.data || { hints: [], captions: [], audioTracks: [] };

    // Player metadata often arrives after playback starts. Re-evaluate
    // candidates, and immediately dismiss a prompt if another primary language
    // becomes clear.
    retryDetection(["checking", "awaiting", "awaiting-language", "not-candidate", "primary-other"]);
  });

  function getYouTubeVideoId() {
    const url = new URL(location.href);
    if (location.pathname === "/watch") {
      return url.searchParams.get("v")?.trim() || "";
    }

    const routeMatch = location.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/);
    return routeMatch?.[1] || "";
  }

  function getYouTubeInfo() {
    const urlVideoId = getYouTubeVideoId();
    if (!urlVideoId) return null;

    const probeMatchesVideo = !pageProbe.videoId || pageProbe.videoId === urlVideoId;
    const title =
      document.querySelector("h1 ytd-watch-metadata yt-formatted-string")?.textContent?.trim() ||
      document.querySelector("h1.title yt-formatted-string")?.textContent?.trim() ||
      (probeMatchesVideo ? pageProbe.title : "") ||
      document.title.replace(/\s*-\s*YouTube\s*$/, "") ||
      "YouTube video";
    const channel =
      document.querySelector("#owner #channel-name a")?.textContent?.trim() ||
      document.querySelector("ytd-video-owner-renderer #channel-name a")?.textContent?.trim() ||
      (probeMatchesVideo ? pageProbe.author : "") ||
      "";
    const channelId = probeMatchesVideo ? (pageProbe.channelId || "") : "";

    return {
      site: "youtube",
      contentKey: `youtube:${urlVideoId}`,
      sourceKey: channelId
        ? `youtube-channel:${channelId}`
        : channel
          ? `youtube-channel-name:${channel.toLowerCase()}`
          : "",
      title,
      sourceLabel: channel || "this channel"
    };
  }

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isLikelyPlaybackMetadataElement(element) {
    if (!element) return false;
    let current = element;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const identity = [
        typeof current.className === "string" ? current.className : "",
        current.id,
        current.getAttribute?.("data-testid"),
        current.getAttribute?.("data-uia"),
        current.getAttribute?.("aria-label")
      ].filter(Boolean).join(" ");
      if (/recommend|carousel|suggest|related|more[-_\s]?like|content[-_\s]?rail/i.test(identity)) return false;
      if (current.hidden || current.getAttribute?.("aria-hidden") === "true") return false;
    }
    return true;
  }

  function firstText(selectors) {
    for (const selector of selectors || []) {
      let elements = [];
      try {
        elements = [...document.querySelectorAll(selector)].slice(0, 8);
      } catch {
        continue;
      }
      const element = elements.find(isLikelyPlaybackMetadataElement);
      const text = compactText(element?.innerText || element?.textContent || element?.getAttribute?.("aria-label"));
      if (text) return text;
    }
    return "";
  }

  function cleanStreamingTitle(value, config) {
    let title = compactText(value);
    title = title.replace(config.brand, "").trim();
    title = title.replace(/^watch\s+/i, "").replace(/^stream\s+/i, "").trim();
    return title.replace(/^[-|:\s]+|[-|:\s]+$/g, "").trim();
  }

  function stableKeyPart(value) {
    return compactText(value).toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160) || "unknown";
  }

  // Structured metadata is used only to find a stable related-content family.
  // Content categories are never exposed as a question or required to proceed.

  const SERIES_SCHEMA_TYPES = new Set([
    "video.tv_show", "video.episode",
    "tvseries", "tvseason", "tvepisode", "creativeworkseries"
  ]);

  function isSeriesSchemaType(raw) {
    const value = String(raw || "").trim().toLowerCase();
    return SERIES_SCHEMA_TYPES.has(value);
  }

  function normalizedComparableTitle(value) {
    return compactText(value).toLocaleLowerCase().normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function structuredSeriesCandidateFromNode(node, root = false) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return null;
    const rawTypes = [].concat(node["@type"] || []);
    const rawType = rawTypes.find(isSeriesSchemaType);
    if (!rawType) return null;
    const seriesValue = node.partOfSeries || node.isPartOf;
    const seriesTitle = typeof seriesValue === "string"
      ? compactText(seriesValue)
      : compactText(seriesValue?.name || seriesValue?.headline);
    const urls = [
      node.url,
      node["@id"],
      typeof node.mainEntityOfPage === "string" ? node.mainEntityOfPage : node.mainEntityOfPage?.["@id"]
    ].map((value) => String(value || "").trim()).filter(Boolean);
    return {
      rawType,
      name: compactText(node.name || node.headline),
      seriesTitle,
      urls,
      root
    };
  }

  function collectStructuredSeriesCandidates(parsed) {
    const candidates = [];
    const visited = new Set();
    let inspected = 0;
    function visit(value, depth = 0, root = false) {
      if (!value || depth > 5 || inspected >= 100) return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item, depth + 1, root);
        return;
      }
      if (typeof value !== "object" || visited.has(value)) return;
      visited.add(value);
      inspected += 1;
      const candidate = structuredSeriesCandidateFromNode(value, root);
      if (candidate) candidates.push(candidate);
      for (const [key, child] of Object.entries(value)) {
        if (key === "@context") continue;
        if (child && typeof child === "object") visit(child, depth + 1, false);
      }
    }
    visit(parsed, 0, true);
    return candidates;
  }

  // Cache structured series candidates, then match them to the current
  // playback title. This prevents an unrelated carousel's JSON-LD from
  // grouping the video that is actually playing.
  function recomputeStructuredSeriesMetadata() {
    ogJsonLdDirty = false;
    ogJsonLdSnapshot = { candidates: [] };

    try {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 12);
      for (const script of scripts) {
        let parsed;
        try {
          parsed = JSON.parse(script.textContent || "");
        } catch {
          continue;
        }
        ogJsonLdSnapshot.candidates.push(...collectStructuredSeriesCandidates(parsed));
      }
    } catch {
      // Malformed structured data: no evidence, remain unresolved.
    }
  }

  function scheduleStructuredSeriesRescan() {
    ogJsonLdDirty = true;
    if (ogJsonLdDebounceTimer) return;
    ogJsonLdDebounceTimer = setTimeout(() => {
      ogJsonLdDebounceTimer = null;
      recomputeStructuredSeriesMetadata();
    }, 400);
  }

  // SPA sites (Netflix, Prime Video, etc.) swap <head> metadata and use
  // history.pushState instead of full navigations, so a one-time read on
  // load would go stale. Watch for both.
  function mutationContainsStructuredData(mutation) {
    if (mutation.type === "attributes") {
      return mutation.target?.matches?.('script[type="application/ld+json"]');
    }
    if (mutation.type === "characterData") {
      return mutation.target?.parentElement?.matches?.('script[type="application/ld+json"]');
    }
    if (mutation.target?.matches?.('script[type="application/ld+json"]')) return true;
    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
      node?.matches?.('script[type="application/ld+json"]') ||
      node?.querySelector?.('script[type="application/ld+json"]')
    );
  }

  function watchStructuredSeriesMetadata() {
    if (!isStreamingSite || !document.head) return;
    try {
      new MutationObserver((mutations) => {
        if (mutations.some(mutationContainsStructuredData)) scheduleStructuredSeriesRescan();
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        attributeFilter: ["content", "property", "type"]
      });
    } catch {
      // History navigation still marks the metadata cache dirty.
    }

    for (const methodName of ["pushState", "replaceState"]) {
      const original = history[methodName];
      if (typeof original !== "function") continue;
      if (original.__immersionTrackerPatched) continue;
      const patched = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        scheduleStructuredSeriesRescan();
        return result;
      };
      patched.__immersionTrackerPatched = true;
      history[methodName] = patched;
    }
    window.addEventListener("popstate", scheduleStructuredSeriesRescan);
  }

  function metadataUrlMatchesCurrentPage(value) {
    try {
      const candidate = new URL(value, location.href);
      return candidate.origin === location.origin &&
        candidate.pathname.replace(/\/+$/, "") === location.pathname.replace(/\/+$/, "");
    } catch {
      return false;
    }
  }

  function candidateMatchScore(candidate, title, seriesTitle) {
    const currentNames = [title, seriesTitle].map(normalizedComparableTitle).filter(Boolean);
    const candidateNames = [candidate.name, candidate.seriesTitle]
      .map(normalizedComparableTitle).filter(Boolean);
    let score = candidate.urls.some(metadataUrlMatchesCurrentPage) ? 120 : 0;
    for (const candidateName of candidateNames) {
      for (const currentName of currentNames) {
        if (candidateName === currentName) score = Math.max(score, 110);
        else if (
          candidateName.length >= 6 && currentName.length >= 6 &&
          (candidateName.includes(currentName) || currentName.includes(candidateName))
        ) score = Math.max(score, 70);
      }
    }
    if (!candidateNames.length && candidate.root) score = Math.max(score, 55);
    return score;
  }

  function structuredSeriesTitle({ title = "", selectedSeries = "" } = {}) {
    if (ogJsonLdDirty) recomputeStructuredSeriesMetadata();
    const ranked = ogJsonLdSnapshot.candidates
      .filter((candidate) => compactText(candidate.seriesTitle))
      .map((candidate) => ({ candidate, score: candidateMatchScore(candidate, title, selectedSeries) }))
      // A current-page URL or a strong title match is required. Generic/root
      // JSON-LD and unrelated recommendation rails are deliberately ignored.
      .filter(({ score }) => score >= 70)
      .sort((a, b) => b.score - a.score);
    if (!ranked.length) return "";
    return compactText(ranked[0].candidate.seriesTitle);
  }

  function getStreamingInfo() {
    if (!streamingSite) return null;
    const knownPlaybackRoute = streamingSite.routes.some((pattern) => pattern.test(location.pathname));
    if (!knownPlaybackRoute) {
      const audiblePlayingVideo = [...document.querySelectorAll("video")].some((video) => {
        const rect = video.getBoundingClientRect();
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        return isVideoPlaying(video) && !video.muted && video.volume > 0 &&
          area >= Math.max(80000, window.innerWidth * window.innerHeight * 0.2);
      });
      if (!audiblePlayingVideo) return null;
    }

    const selectedTitle = firstText(streamingSite.titleSelectors);
    const pageTitle = cleanStreamingTitle(document.title, streamingSite);
    const title = selectedTitle || pageTitle || `${streamingSite.name} video`;
    const selectedSeries = firstText(streamingSite.seriesSelectors);
    const structuredFamily = structuredSeriesTitle({ title, selectedSeries });
    const selectorFamily = normalizedComparableTitle(selectedSeries) &&
      normalizedComparableTitle(selectedSeries) !== normalizedComparableTitle(title)
      ? selectedSeries
      : "";
    const familyTitle = structuredFamily || selectorFamily;
    const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
    const identityQueryNames = new Set([
      "id", "v", "video", "videoid", "contentid", "episodeid",
      "assetid", "asin", "entityid", "mediaid"
    ]);
    const identityQuery = [...new URL(location.href).searchParams.entries()]
      .filter(([name, value]) => identityQueryNames.has(name.toLocaleLowerCase()) && value)
      .map(([name, value]) => `${name.toLocaleLowerCase()}=${String(value).slice(0, 200)}`)
      .sort()
      .join("&");
    const exactPlaybackIdentity = normalizedPath + (identityQuery ? `?${identityQuery}` : "");

    return {
      site,
      // Playback paths are the most stable exact identity on supported
      // services and do not fluctuate when the player's title overlay hides.
      // The background hashes this key before persistent storage.
      contentKey: `${site}:content:${exactPlaybackIdentity}`,
      // A family exists only when the page exposes an explicit series name.
      // No h1/document-title fallback is allowed because it can join unrelated
      // movies or episodes under a false identity.
      sourceKey: familyTitle ? `${site}:family:${stableKeyPart(familyTitle)}` : "",
      title,
      sourceLabel: familyTitle || "related content",
      scopeLabel: "video",
      decisionScope: "content",
      familyEvidence: structuredFamily ? "structured" : selectorFamily ? "selector" : ""
    };
  }

  function getContentInfo() {
    return site === "youtube" ? getYouTubeInfo() : getStreamingInfo();
  }

  function findMainVideo(info = currentInfo) {
    if (!info) return null;

    const videos = [...document.querySelectorAll("video")];
    if (!videos.length) return null;
    return videos
      .map((video) => {
        const rect = video.getBoundingClientRect();
        return { video, area: Math.max(0, rect.width) * Math.max(0, rect.height) };
      })
      .sort((a, b) => b.area - a.area)[0]?.video || null;
  }

  function isVideoPlaying(video) {
    return Boolean(
      video &&
      !video.paused &&
      !video.ended &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    );
  }

  const LANGUAGE_ALIASES = {
    auto: ["automatic"],
    ja: ["japanese", "\u65e5\u672c\u8a9e"],
    en: ["english"], sv: ["swedish", "svenska"], es: ["spanish", "espanol"],
    fr: ["french", "francais"], de: ["german", "deutsch"], it: ["italian", "italiano"],
    pt: ["portuguese", "portugues"], ko: ["korean", "\ud55c\uad6d\uc5b4"],
    zh: ["chinese", "mandarin", "\u4e2d\u6587"], ru: ["russian"], uk: ["ukrainian"],
    ar: ["arabic"], hi: ["hindi"], tr: ["turkish", "turkce"], pl: ["polish", "polski"],
    nl: ["dutch", "nederlands"], da: ["danish", "dansk"], no: ["norwegian", "norsk"],
    fi: ["finnish", "suomi"], vi: ["vietnamese"], th: ["thai"],
    id: ["indonesian", "bahasa indonesia"], ms: ["malay", "bahasa melayu"],
    tl: ["filipino", "tagalog"], el: ["greek"], he: ["hebrew"],
    fa: ["persian", "farsi"], bn: ["bengali", "bangla"], ur: ["urdu"],
    cs: ["czech"], ro: ["romanian"], hu: ["hungarian", "magyar"], bg: ["bulgarian"],
    hr: ["croatian"], sr: ["serbian"], sk: ["slovak"], sl: ["slovenian"],
    et: ["estonian"], lv: ["latvian"], lt: ["lithuanian"], is: ["icelandic"],
    sw: ["swahili", "kiswahili"], ca: ["catalan"], eu: ["basque", "euskara"],
    gl: ["galician"], cy: ["welsh"], ga: ["irish", "gaeilge"],
    ka: ["georgian", "\u10e5\u10d0\u10e0\u10d7\u10e3\u10da\u10d8"],
    hy: ["armenian", "\u0570\u0561\u0575\u0565\u0580\u0565\u0576"],
    am: ["amharic", "\u12a0\u121b\u122d\u129b"],
    km: ["khmer", "cambodian", "\u1781\u17d2\u1798\u17c2\u179a"],
    lo: ["lao", "laotian"],
    my: ["burmese", "myanmar"],
    ta: ["tamil", "\u0ba4\u0bae\u0bbf\u0bb4\u0bcd"],
    te: ["telugu", "\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41"],
    kn: ["kannada", "\u0c95\u0ca8\u0ccd\u0ca8\u0ca1"],
    ml: ["malayalam", "\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02"]
  };

  const ISO3_CODES = {
    ja: "jpn", en: "eng", sv: "swe", es: "spa", fr: "fra", de: "deu",
    it: "ita", pt: "por", ko: "kor", zh: "zho", ru: "rus", uk: "ukr",
    ar: "ara", hi: "hin", tr: "tur", pl: "pol", nl: "nld", da: "dan",
    no: "nor", fi: "fin", vi: "vie", th: "tha", id: "ind", ms: "msa",
    tl: "tgl", el: "ell", he: "heb", fa: "fas", bn: "ben", ur: "urd",
    cs: "ces", ro: "ron", hu: "hun", bg: "bul", hr: "hrv", sr: "srp"
  };

  const SCRIPT_PATTERNS = {
    ja: /[\u3040-\u30ff]/, ko: /[\uac00-\ud7af]/, zh: /[\u3400-\u9fff]/,
    el: /[\u0370-\u03ff]/, he: /[\u0590-\u05ff]/, hi: /[\u0900-\u097f]/,
    bn: /[\u0980-\u09ff]/, th: /[\u0e00-\u0e7f]/, ka: /[\u10a0-\u10ff]/,
    hy: /[\u0530-\u058f]/, am: /[\u1200-\u137f]/, km: /[\u1780-\u17ff]/,
    lo: /[\u0e80-\u0eff]/, my: /[\u1000-\u109f]/, ta: /[\u0b80-\u0bff]/,
    te: /[\u0c00-\u0c7f]/, kn: /[\u0c80-\u0cff]/, ml: /[\u0d00-\u0d7f]/
  };

  const LANGUAGE_NAMES = {
    ja: "Japanese", en: "English", sv: "Swedish", es: "Spanish", fr: "French",
    de: "German", it: "Italian", pt: "Portuguese", ko: "Korean", zh: "Chinese",
    ru: "Russian", uk: "Ukrainian", ar: "Arabic", hi: "Hindi", tr: "Turkish",
    pl: "Polish", nl: "Dutch", da: "Danish", no: "Norwegian", fi: "Finnish",
    vi: "Vietnamese", th: "Thai", id: "Indonesian", ms: "Malay",
    tl: "Filipino / Tagalog", el: "Greek", he: "Hebrew", fa: "Persian / Farsi",
    bn: "Bengali", ur: "Urdu", cs: "Czech", ro: "Romanian", hu: "Hungarian",
    bg: "Bulgarian", hr: "Croatian", sr: "Serbian", sk: "Slovak", sl: "Slovenian",
    et: "Estonian", lv: "Latvian", lt: "Lithuanian", is: "Icelandic",
    sw: "Swahili", ca: "Catalan", eu: "Basque", gl: "Galician", cy: "Welsh", ga: "Irish",
    ka: "Georgian", hy: "Armenian", am: "Amharic", km: "Khmer", lo: "Lao",
    my: "Burmese", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam"
  };

  function normalizeLanguageCode(value) {
    return String(value || "").trim().toLowerCase().replace(/_/g, "-");
  }

  function isAutomaticLanguageMode() {
    return normalizeLanguageCode(targetLanguage.code) === "auto";
  }

  function languageFromCode(value) {
    const code = normalizeLanguageCode(value).split("-")[0];
    return LANGUAGE_NAMES[code] ? { code, name: LANGUAGE_NAMES[code] } : null;
  }

  function activeLanguage() {
    return isAutomaticLanguageMode() && detectedLanguage ? detectedLanguage : targetLanguage;
  }

  function baseTargetCode() {
    return normalizeLanguageCode(activeLanguage().code).split("-")[0];
  }

  function isTargetLanguageCode(value) {
    const code = normalizeLanguageCode(value);
    if (!code) return false;
    const targetCode = normalizeLanguageCode(activeLanguage().code);
    const base = baseTargetCode();
    return code === targetCode || code.startsWith(targetCode + "-") ||
      code === base || code.startsWith(base + "-") || code === ISO3_CODES[base];
  }

  function isLanguageCode(value) {
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalizeLanguageCode(value));
  }

  function normalizeLabelText(value) {
    return String(value || "").toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }

  function languageFromLabel(value) {
    const text = normalizeLabelText(value);
    if (!text) return null;
    for (const [code, aliases] of Object.entries(LANGUAGE_ALIASES)) {
      if (code === "auto") continue;
      const names = [LANGUAGE_NAMES[code], ...aliases].map(normalizeLabelText).filter(Boolean);
      if (names.some((name) => text.includes(name))) return { code, name: LANGUAGE_NAMES[code] };
      if (new RegExp("(^|[\\s(\\[/_-])" + code + "($|[\\s)\\]/_-])", "i").test(text)) {
        return { code, name: LANGUAGE_NAMES[code] };
      }
    }
    return null;
  }

  function languageLabelMatches(value) {
    const text = normalizeLabelText(value);
    if (!text) return false;
    const language = activeLanguage();
    const aliases = [language.name, ...(LANGUAGE_ALIASES[baseTargetCode()] || [])]
      .map(normalizeLabelText).filter(Boolean);
    if (aliases.some((alias) => text.includes(alias))) return true;
    const code = baseTargetCode();
    return new RegExp("(^|[\\s(\\[/_-])" + code + "($|[\\s)\\]/_-])", "i").test(text);
  }

  function selectedAudioLabels() {
    const selected = [...document.querySelectorAll(
      '[aria-checked="true"], [aria-selected="true"], [data-uia*="audio-item-selected"], ' +
      '[data-testid*="audio"][data-selected="true"], [data-testid*="audio"][data-state="selected"], ' +
      '[data-uia*="audio-item"][data-selected="true"], [data-uia*="audio-item"].selected, ' +
      '[data-uia*="audio-item"][class*="selected" i], [data-uia*="audio-item"] input:checked'
    )];
    const labels = [];
    for (const element of selected) {
      const item = element.closest?.(
        '[data-uia*="audio-item"], [data-testid*="audio"], [role="menuitemradio"]'
      ) || element;
      const label = item.textContent?.trim() || item.getAttribute("aria-label") ||
        element.textContent?.trim() || element.getAttribute("aria-label") || "";
      if (!label) continue;
      const dataUia = item.getAttribute("data-uia") ||
        item.closest?.("[data-uia]")?.getAttribute("data-uia") || "";
      const dataTestId = item.getAttribute("data-testid") ||
        item.closest?.("[data-testid]")?.getAttribute("data-testid") || "";
      const className = typeof item.className === "string" ? item.className : "";
      const descriptor = `${dataUia} ${dataTestId} ${className} ${item.getAttribute("aria-label") || ""}`;
      if (/subtitle|caption|closed.?caption|text.?track/i.test(descriptor)) continue;
      const isAudio = /audio|sound|dub|voice/i.test(descriptor) ||
        Boolean(item.closest?.(
          '[data-uia*="audio"], [data-testid*="audio"], [class*="audio" i], ' +
          '[aria-label*="Audio"], [aria-label*="audio"]'
        ));
      if (isAudio) labels.push(label);
    }

    const audioTracks = currentVideo?.audioTracks;
    if (audioTracks) {
      for (let index = 0; index < audioTracks.length; index += 1) {
        const track = audioTracks[index];
        if (!track?.enabled) continue;
        const label = compactText(`${track.label || ""} ${track.language || ""}`);
        if (label) labels.push(label);
      }
    }
    return [...new Set(labels)];
  }

  function findSelectedTargetAudioLabel() {
    return selectedAudioLabels().find(languageLabelMatches) || "";
  }

  function looksLikeKnownLanguageLabel(value) {
    const text = normalizeLabelText(value);
    if (!text) return false;
    if (languageLabelMatches(text)) return true;
    if (Object.values(LANGUAGE_ALIASES).flat().some((alias) => text.includes(normalizeLabelText(alias)))) return true;
    return /(?:^|[\s([/_-])[a-z]{2,3}(?:-[a-z]{2,8})?(?:$|[\s)\]/_-])/i.test(text);
  }

  function findSelectedOtherAudioLabel() {
    return selectedAudioLabels().find(
      (label) => !languageLabelMatches(label) && looksLikeKnownLanguageLabel(label)
    ) || "";
  }

  function isAutomaticCaptionTrack(track) {
    const name = String(track?.name || "");
    const kind = String(track?.kind || "").toLowerCase();
    const vssId = String(track?.vssId || "").toLowerCase();
    return kind === "asr" || vssId.includes(".asr") ||
      /auto-generated|automatically generated|automatic captions/i.test(name);
  }

  function findTargetCaptionHint() {
    const probeCaption = (pageProbe.captions || []).some(
      (track) => isTargetLanguageCode(track.languageCode) || languageLabelMatches(track.name)
    );
    if (probeCaption) return true;
    return [...document.querySelectorAll('[aria-checked="true"], [aria-selected="true"]')]
      .some((element) => {
        const dataUia = element.getAttribute("data-uia") ||
          element.closest("[data-uia]")?.getAttribute("data-uia") || "";
        if (!/subtitle|caption/i.test(dataUia)) return false;
        const label = element.textContent?.trim() || element.getAttribute("aria-label") || "";
        return languageLabelMatches(label);
      });
  }

  function findTargetAutoGeneratedCaption() {
    return (pageProbe.captions || []).find((track) =>
      isAutomaticCaptionTrack(track) &&
      (isTargetLanguageCode(track.languageCode) || languageLabelMatches(track.name))
    );
  }

  function findTargetAudioTrackFromProbe() {
    return (pageProbe.audioTracks || []).find((track) => {
      const label = (track.displayName || "") + " " + (track.languageCode || "");
      return (isTargetLanguageCode(track.languageCode) || languageLabelMatches(label)) &&
        (track.audioIsDefault || (pageProbe.audioTracks || []).length === 1);
    });
  }

  // "Another language" is not actionable — name it. Every code here comes from
  // player metadata that page-probe.js already reads (defaultAudioLanguage,
  // audioTrack.languageCode, the caption tracklist). Nothing listens to audio.
  function namedOtherLanguage(code, fallbackLabel) {
    const named = languageFromCode(code);
    if (named) return named.name;
    const label = String(fallbackLabel || "")
      .replace(/\s*[([]\s*(?:auto[- ]?generated|automatic|CC|closed captions?)\s*[)\]]\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (label) return label;
    const normalized = normalizeLanguageCode(code);
    return normalized ? normalized.toUpperCase() : "";
  }

  function findPrimaryOtherLanguageEvidence() {
    const selectedAudio = findSelectedOtherAudioLabel();
    if (selectedAudio) {
      return "The selected audio track is " + selectedAudio + ", not " + targetLanguage.name + ".";
    }
    if (isStreamingSite) return "";
    const audioTracks = pageProbe.audioTracks || [];
    const primaryTrack = audioTracks.find((track) =>
      (track.audioIsDefault || audioTracks.length === 1) &&
      isLanguageCode(track.languageCode) && !isTargetLanguageCode(track.languageCode)
    );
    if (primaryTrack) {
      return "YouTube reports " + (primaryTrack.displayName || primaryTrack.languageCode) +
        " as the primary audio language.";
    }
    const audioHint = (pageProbe.hints || []).find((hint) => {
      const path = String(hint.path || "").toLowerCase();
      return (path.includes("audio") || path.includes("defaultaudiolanguage")) &&
        isLanguageCode(hint.value) && !isTargetLanguageCode(hint.value);
    });
    if (audioHint) {
      const hintName = namedOtherLanguage(audioHint.value);
      return hintName
        ? "YouTube reports " + hintName + " as the primary audio language, not " + targetLanguage.name + "."
        : "YouTube reports another language as the primary audio language.";
    }
    const otherAutomaticCaption = (pageProbe.captions || []).find((track) =>
      isAutomaticCaptionTrack(track) && isLanguageCode(track.languageCode) &&
      !isTargetLanguageCode(track.languageCode)
    );
    if (!otherAutomaticCaption) return "";
    const captionName = namedOtherLanguage(otherAutomaticCaption.languageCode, otherAutomaticCaption.name);
    return captionName
      ? "YouTube's automatic captions identify the spoken language as " + captionName + ", not " + targetLanguage.name + "."
      : "YouTube's automatic captions identify another spoken language.";
  }

  function targetScriptPattern() {
    return SCRIPT_PATTERNS[baseTargetCode()] || null;
  }

  function looksPredominantlyTargetScript(value) {
    const pattern = targetScriptPattern();
    if (!pattern) return false;
    const text = String(value || "").trim();
    const matches = text.match(new RegExp(pattern.source, "gu")) || [];
    const latin = text.match(/[A-Za-z\u00c0-\u024f]/g) || [];
    return matches.length >= 2 && matches.length >= latin.length * 0.5;
  }

  function languageFromScript(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    let best = null;
    for (const [code, pattern] of Object.entries(SCRIPT_PATTERNS)) {
      const matches = text.match(new RegExp(pattern.source, "gu")) || [];
      if (matches.length < 2) continue;
      if (!best || matches.length > best.matches) best = { code, matches };
    }
    return best ? { code: best.code, name: LANGUAGE_NAMES[best.code] } : null;
  }

  function findTargetCommentSignal() {
    if (site !== "youtube" || !targetScriptPattern()) return false;
    const comments = [...document.querySelectorAll(
      "ytd-comment-thread-renderer #content-text, ytd-comment-view-model #content-text, ytd-comment-renderer #content-text"
    )].map((element) => element.textContent?.trim() || "").filter(Boolean).slice(0, 12);
    return comments.length >= 3 && comments.every(looksPredominantlyTargetScript);
  }

  // Automatic mode has no target to compare against, so instead of asking "is
  // this Japanese?" it asks "what is this?". Same evidence, same order of
  // trust: selected audio, then the player's declared audio language, then
  // auto-captions (which YouTube generates from the spoken audio), then the
  // title's script. Player metadata only - nothing here listens to audio.
  function identifyPageLanguage(info) {
    for (const label of selectedAudioLabels()) {
      const language = languageFromLabel(label);
      if (language) return { ...language, evidence: "the selected audio track" };
    }

    const audioTracks = pageProbe.audioTracks || [];
    const primaryTrack = audioTracks.find(
      (track) => (track.audioIsDefault || audioTracks.length === 1) && isLanguageCode(track.languageCode)
    );
    if (primaryTrack) {
      const language = languageFromCode(primaryTrack.languageCode) ||
        languageFromLabel(primaryTrack.displayName);
      if (language) return { ...language, evidence: "the player's audio track" };
    }

    const audioHint = (pageProbe.hints || []).find((hint) => {
      const path = String(hint.path || "").toLowerCase();
      return (path.includes("audio") || path.includes("defaultaudiolanguage")) && isLanguageCode(hint.value);
    });
    if (audioHint) {
      const language = languageFromCode(audioHint.value);
      if (language) return { ...language, evidence: "the page's declared audio language" };
    }

    const automaticCaption = (pageProbe.captions || []).find(
      (track) => isAutomaticCaptionTrack(track) && isLanguageCode(track.languageCode)
    );
    if (automaticCaption) {
      const language = languageFromCode(automaticCaption.languageCode) ||
        languageFromLabel(automaticCaption.name);
      if (language) return { ...language, evidence: "the automatic captions" };
    }

    const fromTitle = languageFromScript(info?.title);
    if (fromTitle?.name) return { ...fromTitle, evidence: "the title's script" };

    return null;
  }

  function detectTargetLanguage(info) {
    const languageName = targetLanguage.name;
    const selectedAudio = findSelectedTargetAudioLabel();
    if (selectedAudio) return {
      confidence: "high",
      reason: "Selected audio appears to be " + selectedAudio + "."
    };

    if (site === "youtube") {
      const expectedVideoId = String(info.contentKey || "").replace(/^youtube:/, "");
      if (pageProbe.videoId !== expectedVideoId) return {
        confidence: "no-evidence",
        reason: "Waiting for YouTube to expose the current video's language information."
      };

      const probeAudioTrack = findTargetAudioTrackFromProbe();
      if (probeAudioTrack) return {
        confidence: "high",
        reason: "YouTube reports the audio track as " +
          (probeAudioTrack.displayName || languageName) + "."
      };

      const strongHint = (pageProbe.hints || []).find((hint) => {
        const path = String(hint.path || "").toLowerCase();
        return isTargetLanguageCode(hint.value) &&
          (path.includes("audio") || path.includes("defaultaudiolanguage"));
      });
      if (strongHint) return {
        confidence: "high",
        reason: "YouTube reports " + languageName + " as the audio language."
      };

      if (findTargetAutoGeneratedCaption()) return {
        confidence: "high",
        reason: "YouTube generated " + languageName + " captions from the spoken audio."
      };
    }

    const primaryOtherLanguage = findPrimaryOtherLanguageEvidence();
    if (primaryOtherLanguage) return { confidence: "not-target", reason: primaryOtherLanguage };

    if (isStreamingSite) {
      const netflixHelp = site === "netflix"
        ? "Open Netflix's Audio & Subtitles menu once so the selected audio option is present on the page. "
        : "";
      return {
        confidence: "uncertain",
        reason: `${streamingSite.name} did not expose a reliable selected audio language. ` +
          `${netflixHelp}Your choice will be remembered for this ${info.scopeLabel || "title"}.`
      };
    }

    const script = targetScriptPattern();
    const titleMatches = Boolean(script?.test(info.title || ""));
    const sourceMatches = Boolean(script?.test(info.sourceLabel || ""));
    const targetCaptions = findTargetCaptionHint();
    const targetComments = findTargetCommentSignal();
    if (titleMatches || sourceMatches || targetCaptions || targetComments) {
      const evidence = [
        titleMatches ? "title" : "", sourceMatches ? "channel or source" : "",
        targetCaptions ? "captions" : "", targetComments ? "comments" : ""
      ].filter(Boolean).join(", ");
      return {
        confidence: "uncertain",
        reason: languageName + " was found in the " + evidence +
          ", but the primary audio language could not be confirmed."
      };
    }
    return {
      confidence: "no-evidence",
      reason: "No " + languageName + " audio, title, caption, source, or comment signal was found."
    };
  }

  function applyDetectionResult(detection) {
    if (overlayPreferences.fullyManualEnabled) {
      commitUnconfirmedBuffer();
      detectionReason = `Fully manual counting is on. Every audible supported video counts as ${targetLanguage.name}.`;
      languageState = "confirmed";
      showExpandedOverlay();
      resetSampling(currentVideo);
      return;
    }

    detectionReason = detection.reason;
    cancelAutoMinimize();

    if (detection.confidence === "high") {
      commitUnconfirmedBuffer();
      languageState = "confirmed";
      showExpandedOverlay();
    } else if (detection.confidence === "uncertain") {
      languageState = "awaiting";
      overlayCompact = false;
      renderOverlay();
    } else {
      discardUnconfirmedBuffer();
      languageState = detection.confidence === "not-target" ? "primary-other" : "not-candidate";
      if (!overlayManuallyShown) overlay.host.style.display = "none";
      renderOverlay();
    }
    resetSampling(currentVideo);
  }

  // Player metadata arrives late and in pieces, so an unanswered question is
  // re-asked whenever the probe reports something new.
  function retryDetection(states) {
    if (!currentInfo || !isVideoPlaying(currentVideo)) return;
    if (!states.includes(languageState)) return;
    if (isAutomaticLanguageMode()) {
      // This runs every second. Re-running the whole resolver while the user is
      // looking at the language picker would re-fetch the ranking and rebuild
      // the card's HTML underneath them, resetting the dropdown each tick. Only
      // the cheap synchronous identification is safe to retry here.
      if (languageState === "awaiting-language") {
        const identified = identifyPageLanguage(currentInfo);
        if (identified) confirmAutomaticLanguage(identified, identified.evidence);
        return;
      }
      resolveAutomaticLanguage(currentInfo);
      return;
    }
    if (overlayPreferences.fullyManualEnabled) return;
    applyDetectionResult(detectTargetLanguage(currentInfo));
  }

  function confirmAutomaticLanguage(language, evidence) {
    // Invalidate any resolver still waiting on a message.
    automaticResolutionSequence += 1;
    detectedLanguage = { code: language.code, name: language.name };
    commitUnconfirmedBuffer();
    languageState = "confirmed";
    detectionReason = `Detected as ${language.name} from ${evidence}.`;
    cancelAutoMinimize();
    showExpandedOverlay();
    resetSampling(currentVideo);
  }

  // Automatic mode books time under the language it identifies, never under a
  // literal "auto" bucket. A remembered answer wins over fresh detection,
  // because the user has already corrected us for this video or channel.
  async function resolveAutomaticLanguage(info) {
    // Each run claims a sequence number. Anything the user does while a message
    // is in flight starts a newer run, and the straggler must not write its
    // stale conclusion over the answer the user just gave.
    const run = ++automaticResolutionSequence;
    const stale = () =>
      run !== automaticResolutionSequence ||
      !currentInfo ||
      currentInfo.contentKey !== info.contentKey;

    // "Don't count this video" outranks a remembered language: it is the more
    // recent instruction whenever both exist for the same video.
    const declined = await sendMessage({
      type: "getDecision",
      contentKey: info.contentKey,
      sourceKey: info.sourceKey,
      languageCode: "auto"
    });
    if (stale()) return;
    if (declined?.decision === "not-target") {
      discardUnconfirmedBuffer();
      languageState = "rejected";
      detectionReason = "You chose not to count this video.";
      if (!overlayManuallyShown) overlay.host.style.display = "none";
      renderOverlay();
      return;
    }

    const remembered = await sendMessage({
      type: "getAutomaticLanguageChoice",
      contentKey: info.contentKey,
      sourceKey: info.sourceKey
    });
    if (stale()) return;

    if (remembered?.code) {
      confirmAutomaticLanguage(
        { code: remembered.code, name: remembered.name },
        remembered.scope === "source"
          ? `your answer for ${info.sourceLabel || "this source"}`
          : "your answer for this video"
      );
      return;
    }

    const identified = identifyPageLanguage(info);
    if (identified) {
      confirmAutomaticLanguage(identified, identified.evidence);
      return;
    }

    const ranking = (await sendMessage({ type: "getLanguageRanking" }))?.languages || [];
    if (stale()) return;
    languageChoices = ranking;
    languageState = "awaiting-language";
    detectionReason = isStreamingSite
      ? `${streamingSite?.name || "This site"} did not expose a spoken audio language.`
      : "This page does not declare a spoken audio language.";
    cancelAutoMinimize();
    overlayCompact = false;
    renderOverlay();
    resetSampling(currentVideo);
  }

  async function resolveLanguage(info) {
    if (!isVideoPlaying(currentVideo)) return;

    languageState = "checking";
    statusPausedByUser = false;
    sourceSuggestion = false;
    detectedLanguage = null;
    renderOverlay();

    if (overlayPreferences.targetLanguageDeferred || targetLanguage.code === "und") {
      discardUnconfirmedBuffer();
      languageState = "rejected";
      detectionReason = "Choose a target language in the extension before tracking.";
      overlay.host.style.display = "none";
      renderOverlay();
      return;
    }

    // Automatic mode identifies the language instead of testing against one, so
    // it skips the target-based decision flow below. It also outranks fully
    // manual counting: "count everything" still needs a language to count under,
    // and "Automatic" is a mode, not a language.
    if (isAutomaticLanguageMode()) {
      await resolveAutomaticLanguage(info);
      return;
    }

    if (overlayPreferences.fullyManualEnabled) {
      commitUnconfirmedBuffer();
      languageState = "confirmed";
      detectionReason = `Fully manual counting is on. Every audible supported video counts as ${targetLanguage.name}.`;
      showExpandedOverlay();
      resetSampling(currentVideo);
      return;
    }

    const automaticDetection = detectTargetLanguage(info);
    if (
      isStreamingSite &&
      ["high", "not-target"].includes(automaticDetection.confidence)
    ) {
      applyDetectionResult(automaticDetection);
      return;
    }

    const response = await sendMessage({
      type: "getDecision",
      contentKey: info.contentKey,
      sourceKey: info.sourceKey,
      languageCode: targetLanguage.code
    });

    if (!currentInfo || currentInfo.contentKey !== info.contentKey) return;

    if (response?.decision === "target") {
      commitUnconfirmedBuffer();
      languageState = "confirmed";
      const familyDecision = response?.scope === "source";
      detectionReason = familyDecision
        ? `Remembered as ${targetLanguage.name} for related content from ${info.sourceLabel || "this source"}.`
        : `Remembered as ${targetLanguage.name} for this video.`;
      showExpandedOverlay();
      renderOverlay();
      return;
    }

    if (response?.decision === "not-target") {
      discardUnconfirmedBuffer();
      languageState = "rejected";
      detectionReason = "Remembered as not " + targetLanguage.name + ".";
      overlay.host.style.display = "none";
      renderOverlay();
      return;
    }

    applyDetectionResult(automaticDetection);
  }

  async function monitorStreamingAudioLanguage() {
    if (
      (overlayPreferences.fullyManualEnabled && !isAutomaticLanguageMode()) ||
      !isStreamingSite ||
      !currentInfo ||
      !isVideoPlaying(currentVideo)
    ) return;
    const labels = selectedAudioLabels().map(compactText).filter(Boolean).sort();
    if (!labels.length) return;
    const signature = labels.join("|").toLocaleLowerCase();
    if (signature === lastStreamingAudioSignature) return;
    lastStreamingAudioSignature = signature;

    // Switching the audio track in Automatic mode switches the language time is
    // booked under. Flush first so the time already counted stays with the
    // language it was actually spoken in.
    if (isAutomaticLanguageMode()) {
      // Only follow the audio track while we are actually counting. Without
      // this, changing tracks on a video the user declined would silently
      // resume recording it, and would answer the language prompt for them.
      if (!["confirmed", "checking"].includes(languageState)) return;
      const identified = identifyPageLanguage(currentInfo);
      if (!identified || identified.code === detectedLanguage?.code) return;
      await flushTicks();
      confirmAutomaticLanguage(identified, identified.evidence);
      return;
    }

    const detection = detectTargetLanguage(currentInfo);
    if (!["high", "not-target"].includes(detection.confidence)) return;
    if (
      (detection.confidence === "high" && languageState === "confirmed") ||
      (detection.confidence === "not-target" && languageState === "primary-other")
    ) return;

    await flushTicks();
    applyDetectionResult(detection);
  }

  function isYouTubeAdPlaying() {
    return site === "youtube" && Boolean(document.querySelector(".html5-video-player.ad-showing"));
  }

  function hasAudibleSound(video) {
    return !browserTabMuted && !video.muted && video.volume > 0;
  }

  function isActiveImmersion() {
    // The background service worker checks the actual selected video tab and
    // whether its Chrome window is focused. The extension popup itself does
    // not make the session passive.
    return browserContextActive;
  }

  function resetSampling(video) {
    lastSampleWall = performance.now();
    lastMediaTime = Number(video?.currentTime) || 0;
  }

  function discardUnconfirmedBuffer() {
    unconfirmedActive = 0;
    unconfirmedPassive = 0;
  }

  function commitUnconfirmedBuffer() {
    if (!unconfirmedActive && !unconfirmedPassive) return;
    pendingActive += unconfirmedActive;
    pendingPassive += unconfirmedPassive;
    sessionActive += unconfirmedActive;
    sessionPassive += unconfirmedPassive;
    discardUnconfirmedBuffer();
  }

  function playbackStateAllowsSampling(video) {
    return Boolean(
      video &&
      !video.paused &&
      !video.ended &&
      !video.seeking &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      hasAudibleSound(video) &&
      !isYouTubeAdPlaying() &&
      !statusPausedByUser
    );
  }

  function playbackStateAllowsCounting(video) {
    return playbackStateAllowsSampling(video) && languageState === "confirmed";
  }

  function playbackStateAllowsBuffering(video) {
    // "awaiting-language" is Automatic mode's prompt; hold its time the same way.
    return playbackStateAllowsSampling(video) &&
      ["checking", "awaiting", "awaiting-language"].includes(languageState);
  }

  function samplePlayback() {
    const video = currentVideo;
    if (!video) return;

    const now = performance.now();
    const mediaTime = Number(video.currentTime) || 0;

    if (!lastSampleWall) {
      resetSampling(video);
      return;
    }

    const wallDelta = Math.max(0, (now - lastSampleWall) / 1000);
    const mediaDelta = mediaTime - lastMediaTime;
    lastSampleWall = now;
    lastMediaTime = mediaTime;

    const shouldCount = playbackStateAllowsCounting(video);
    const shouldBuffer = playbackStateAllowsBuffering(video);
    if (!shouldCount && !shouldBuffer) return;
    if (wallDelta <= 0 || wallDelta > 180 || mediaDelta <= 0) return;

    const playbackRate = Number(video.playbackRate) || 1;
    const expectedMediaDelta = wallDelta * playbackRate;
    const allowedDifference = Math.max(1.5, expectedMediaDelta * 0.35);

    // A large mismatch is normally a seek/skip. Rewinding itself is not counted,
    // but playback after the rewind is counted again.
    if (Math.abs(mediaDelta - expectedMediaDelta) > allowedDifference) return;

    if (shouldBuffer) {
      if (isActiveImmersion()) unconfirmedActive += wallDelta;
      else unconfirmedPassive += wallDelta;
    } else if (isActiveImmersion()) {
      pendingActive += wallDelta;
      sessionActive += wallDelta;
    } else {
      pendingPassive += wallDelta;
      sessionPassive += wallDelta;
    }

    if (now - lastFlushAt >= 4000 || pendingActive + pendingPassive >= 5) {
      flushTicks();
    }
    renderOverlay();
  }

  function flushTicks() {
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      while (sessionId && (pendingActive || pendingPassive)) {
        // The service worker deliberately caps a single automatic tick at
        // three minutes. Drain a longer in-memory confirmation buffer in safe
        // chunks so none of the held playback time is silently truncated.
        const activeSeconds = Math.min(pendingActive, 180);
        const passiveSeconds = Math.min(pendingPassive, 180);
        pendingActive = Math.max(0, pendingActive - activeSeconds);
        pendingPassive = Math.max(0, pendingPassive - passiveSeconds);
        lastFlushAt = performance.now();
        const tickSessionId = sessionId;
        const tickInfo = currentInfo;
        // In Automatic mode this is the identified language, not "auto" - the
        // background refuses to file time under a mode name.
        const tickLanguageCode = activeLanguage().code;

        const response = await sendMessage({
          type: "addTick",
          sessionId: tickSessionId,
          site,
          contentKey: tickInfo?.contentKey || "",
          title: tickInfo?.title || "Untitled video",
          languageCode: tickLanguageCode,
          activeSeconds,
          passiveSeconds,
          timestamp: Date.now()
        });

        if (response?.ignored) {
          sessionActive = Math.max(0, sessionActive - activeSeconds);
          sessionPassive = Math.max(0, sessionPassive - passiveSeconds);
          renderOverlay();
        }
      }
    })().finally(() => {
      flushPromise = null;
      // Playback may have added another tick between the loop condition and
      // releasing the lock.
      if (sessionId && (pendingActive || pendingPassive)) flushTicks();
    });
    return flushPromise;
  }

  async function confirmTargetLanguage(scope = "") {
    if (!currentInfo) return;
    // Automatic mode has no single target to confirm - re-run identification,
    // which falls through to the language picker if it still finds nothing.
    if (isAutomaticLanguageMode()) {
      // Clear any remembered "don't count this" so re-resolving is not
      // immediately overruled by the answer the user just changed their mind on.
      await sendMessage({
        type: "saveDecision",
        scope: scope === "source" && currentInfo.sourceKey ? "source" : "content",
        decision: "target",
        languageCode: "auto",
        contentKey: currentInfo.contentKey,
        sourceKey: currentInfo.sourceKey
      });
      await resolveAutomaticLanguage(currentInfo);
      return;
    }
    if (overlayPreferences.fullyManualEnabled) {
      commitUnconfirmedBuffer();
      languageState = "confirmed";
      detectionReason = `Fully manual counting is on. Every audible supported video counts as ${targetLanguage.name}.`;
      showExpandedOverlay();
      resetSampling(currentVideo);
      return;
    }
    const requestedScope = scope || currentInfo.decisionScope || "content";
    const effectiveScope = requestedScope === "source" && currentInfo.sourceKey ? "source" : "content";
    commitUnconfirmedBuffer();
    languageState = "confirmed";
    detectionReason = effectiveScope === "source"
      ? `Future related content from ${currentInfo.sourceLabel || "this source"} will count as ${targetLanguage.name}.`
      : "You confirmed this video as " + targetLanguage.name + ".";
    const response = await sendMessage({
      type: "saveDecision",
      scope: effectiveScope,
      decision: "target",
      languageCode: targetLanguage.code,
      contentKey: currentInfo.contentKey,
      sourceKey: currentInfo.sourceKey
    });
    sourceSuggestion = effectiveScope === "content" && Boolean(currentInfo.sourceKey) &&
      Boolean(response?.suggestSource);
    showExpandedOverlay();
    resetSampling(currentVideo);
    renderOverlay();
  }

  // Automatic mode's answer to "which language is this?". Remembered so the same
  // video, or the whole channel, stops asking.
  async function confirmAutomaticLanguageChoice(choice, scope = "content") {
    if (!currentInfo) return;
    const effectiveScope = scope === "source" && currentInfo.sourceKey ? "source" : "content";
    await sendMessage({
      type: "saveAutomaticLanguageChoice",
      scope: effectiveScope,
      code: choice.code,
      name: choice.name,
      contentKey: currentInfo.contentKey,
      sourceKey: currentInfo.sourceKey
    });
    confirmAutomaticLanguage(
      choice,
      effectiveScope === "source"
        ? `your answer for ${currentInfo.sourceLabel || "this source"}`
        : "your answer for this video"
    );
    renderOverlay();
  }

  async function rejectTargetLanguage({ rollback = true, scope = "" } = {}) {
    if (!currentInfo) return;
    // Automatic mode always allows declining a video: it is the only way to say
    // "this is not immersion", since there is no target language to fail.
    if (overlayPreferences.fullyManualEnabled && !isAutomaticLanguageMode()) {
      detectionReason = "Fully manual counting is on. Turn it off in Tracker Settings to exclude this video.";
      renderOverlay();
      return;
    }
    const requestedScope = scope || currentInfo.decisionScope || "content";
    const effectiveScope = requestedScope === "source" && currentInfo.sourceKey ? "source" : "content";
    // Invalidate any Automatic-mode resolver still waiting on a message, so it
    // cannot re-confirm the video the user is declining right now.
    automaticResolutionSequence += 1;
    discardUnconfirmedBuffer();
    await flushTicks();
    languageState = "rejected";
    statusPausedByUser = false;

    if (rollback && sessionId) {
      await sendMessage({ type: "rollbackSession", sessionId });
      sessionActive = 0;
      sessionPassive = 0;
    }

    await sendMessage({
      type: "saveDecision",
      scope: effectiveScope,
      decision: "not-target",
      languageCode: targetLanguage.code,
      contentKey: currentInfo.contentKey,
      sourceKey: currentInfo.sourceKey
    });
    sourceSuggestion = false;
    detectionReason = isAutomaticLanguageMode()
      ? (rollback
        ? "This video will not be counted. This session's time was removed."
        : "This video will not be counted. The unconfirmed playback time was discarded.")
      : (rollback
        ? `Marked as not ${activeLanguage().name}. This session's time was removed.`
        : `Marked as not ${activeLanguage().name}. The unconfirmed playback time was discarded.`);
    overlay.host.style.display = "none";
    renderOverlay();
  }

  async function reconnectTracker() {
    if (reconnectInProgress) return;
    reconnectInProgress = true;
    detectionReason = "Saving the current session and reconnecting the tracker...";
    renderOverlay();
    await Promise.race([
      flushTicks(),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]);
    location.reload();
  }

  function togglePause() {
    statusPausedByUser = !statusPausedByUser;
    resetSampling(currentVideo);
    renderOverlay();
  }

  function bindVideo(video) {
    if (currentVideo === video) return;
    if (currentVideo) {
      currentVideo.removeEventListener("timeupdate", samplePlayback);
      currentVideo.removeEventListener("playing", onPlaybackBoundary);
      currentVideo.removeEventListener("pause", onPlaybackBoundary);
      currentVideo.removeEventListener("seeking", onPlaybackBoundary);
      currentVideo.removeEventListener("seeked", onPlaybackBoundary);
      currentVideo.removeEventListener("waiting", onPlaybackBoundary);
      currentVideo.removeEventListener("ratechange", onPlaybackBoundary);
    }

    currentVideo = video;
    if (!video) return;
    video.addEventListener("timeupdate", samplePlayback, { passive: true });
    video.addEventListener("playing", onPlaybackBoundary, { passive: true });
    video.addEventListener("pause", onPlaybackBoundary, { passive: true });
    video.addEventListener("seeking", onPlaybackBoundary, { passive: true });
    video.addEventListener("seeked", onPlaybackBoundary, { passive: true });
    video.addEventListener("waiting", onPlaybackBoundary, { passive: true });
    video.addEventListener("ratechange", onPlaybackBoundary, { passive: true });
    resetSampling(video);
  }

  function onPlaybackBoundary() {
    resetSampling(currentVideo);
    renderOverlay();
  }

  async function refreshContext() {
    injectYouTubeProbe();

    const info = getContentInfo();
    const video = findMainVideo(info);
    const contentChanged = currentInfo?.contentKey !== info?.contentKey;

    if (contentChanged) {
      samplePlayback();
      await flushTicks();
      discardUnconfirmedBuffer();
      currentInfo = info;
      bindVideo(video);
      sessionId = info ? randomId() : null;
      sessionActive = 0;
      sessionPassive = 0;
      pendingActive = 0;
      pendingPassive = 0;
      discardUnconfirmedBuffer();
      languageState = info ? "idle" : "unavailable";
      detectionReason = "";
      lastStreamingAudioSignature = "";
      sourceSuggestion = false;
      statusPausedByUser = false;
      overlayCompact = false;
      overlayManuallyShown = false;
      cancelAutoMinimize();
      overlay.host.style.display = "none";
      resetSampling(currentVideo);
      renderOverlay();
    } else {
      // Structured metadata may arrive after playback starts. Enrich the
      // optional family identity without treating it as a new session.
      currentInfo = info;
      bindVideo(video);
    }

    // A supported URL alone is not enough. Language detection and its prompt
    // begin only after the page has a real media element that is playing.
    if (currentInfo && languageState === "idle" && isVideoPlaying(currentVideo)) {
      await resolveLanguage(currentInfo);
    } else {
      retryDetection(["not-candidate", "awaiting", "awaiting-language"]);
    }

    await monitorStreamingAudioLanguage();
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function createOverlay() {
    const host = document.createElement("div");
    host.id = "jit-overlay-host";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .card {
          width: 310px;
          box-sizing: border-box;
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.96);
          color: #f8fafc;
          box-shadow: 0 18px 45px rgba(0, 0, 0, 0.35);
          padding: 14px;
          font: 13px/1.4 Inter, ui-sans-serif, system-ui, sans-serif;
          backdrop-filter: blur(12px);
        }
        .card.compact {
          width: auto;
          padding: 0;
          border: 0;
          background: transparent;
          box-shadow: none;
          backdrop-filter: none;
        }
        .row { display: flex; align-items: center; gap: 9px; }
        .between { justify-content: space-between; }
        .dot { width: 9px; height: 9px; border-radius: 999px; flex: 0 0 auto; }
        .active { background: #22c55e; box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.12); }
        .passive { background: #f59e0b; box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.12); }
        .waiting { background: #f59e0b; box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.12); }
        .stopped { background: #94a3b8; }
        .title { font-weight: 750; letter-spacing: -0.01em; }
        .muted { color: #94a3b8; }
        .reason { margin-top: 8px; color: #cbd5e1; font-size: 12px; }
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
        .stat { background: rgba(30, 41, 59, 0.85); padding: 8px 9px; border-radius: 9px; }
        .stat-label { color: #94a3b8; font-size: 11px; }
        .stat-value { margin-top: 2px; font-weight: 700; }
        .language-picker { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; color: #94a3b8; font-size: 11px; }
        .language-picker select {
          width: 100%;
          border: 1px solid #475569;
          border-radius: 9px;
          padding: 7px 9px;
          background: #1e293b;
          color: #f8fafc;
          font: inherit;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
        }
        .buttons { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
        .recovery-buttons { display: flex; gap: 5px; width: 100%; }
        .recovery-buttons button { padding-left: 8px; padding-right: 8px; }
        .recovery-buttons .danger { flex: 1; min-width: 0; }
        button {
          border: 0;
          border-radius: 9px;
          padding: 7px 10px;
          background: #334155;
          color: #f8fafc;
          font: inherit;
          font-weight: 650;
          cursor: pointer;
        }
        button:hover { background: #475569; }
        button:disabled { opacity: 0.65; cursor: wait; }
        button.primary { background: #2563eb; }
        button.primary:hover { background: #1d4ed8; }
        button.danger { background: rgba(220, 38, 38, 0.2); color: #fecaca; }
        button.danger:hover { background: rgba(220, 38, 38, 0.32); }
        button.link { background: transparent; padding: 3px 5px; color: #94a3b8; }
        .compact-button {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 9px 12px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.96);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
          min-width: 118px;
          justify-content: center;
        }
        .drag-handle { cursor: move; user-select: none; touch-action: none; }
        .compact-button strong { font-variant-numeric: tabular-nums; font-size: 14px; }
        .compact-button span:last-child { color: #cbd5e1; font-size: 10px; text-transform: uppercase; }
        .fab-grip { cursor: move; user-select: none; touch-action: none; }
        :host([data-theme="light"]) .card {
          border-color: rgba(100, 116, 139, 0.34);
          background: rgba(255, 255, 255, 0.97);
          color: #172033;
          box-shadow: 0 18px 45px rgba(30, 41, 59, 0.22);
        }
        :host([data-theme="light"]) .card.compact { background: transparent; }
        :host([data-theme="light"]) .reason { color: #46566c; }
        :host([data-theme="light"]) .muted,
        :host([data-theme="light"]) .stat-label { color: #65758b; }
        :host([data-theme="light"]) .stat { background: #edf2f7; }
        :host([data-theme="light"]) .language-picker { color: #65758b; }
        :host([data-theme="light"]) .language-picker select { border-color: #cbd5e1; background: #fff; color: #172033; }
        :host([data-theme="light"]) button { background: #e2e8f0; color: #172033; }
        :host([data-theme="light"]) button:hover { background: #cfd9e6; }
        :host([data-theme="light"]) button.primary { background: #2563eb; color: #fff; }
        :host([data-theme="light"]) button.primary:hover { background: #1d4ed8; }
        :host([data-theme="light"]) button.danger { background: #feecef; color: #b4233d; }
        :host([data-theme="light"]) button.link { background: transparent; color: #5d6d82; }
        :host([data-theme="light"]) .compact-button {
          background: rgba(255, 255, 255, 0.97);
          color: #172033;
          box-shadow: 0 10px 30px rgba(30, 41, 59, 0.2);
        }
        :host([data-theme="light"]) .compact-button span:last-child { color: #56667a; }
      </style>
      <div class="card" id="card"></div>
    `;
    document.documentElement.appendChild(host);
    host.style.display = "none";
    return { host, shadow, card: shadow.getElementById("card") };
  }

  function setOverlayPosition(left, top, { save = false } = {}) {
    const rect = overlay.host.getBoundingClientRect();
    const width = rect.width || overlay.card.offsetWidth || 120;
    const height = rect.height || overlay.card.offsetHeight || 44;
    const safeLeft = Math.min(Math.max(0, Number(left) || 0), Math.max(0, window.innerWidth - width));
    const safeTop = Math.min(Math.max(0, Number(top) || 0), Math.max(0, window.innerHeight - height));
    overlay.host.style.left = safeLeft + "px";
    overlay.host.style.top = safeTop + "px";
    overlay.host.style.right = "auto";
    if (save) sendMessage({
      type: "setOverlayPosition",
      position: {
        custom: true,
        left: safeLeft,
        top: safeTop,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }
    });
  }

  function resetOverlayPosition() {
    overlay.host.style.left = "auto";
    overlay.host.style.top = "16px";
    overlay.host.style.right = "18px";
  }

  function clampCurrentOverlayPosition() {
    if (!overlay.host.style.left) return;
    const rect = overlay.host.getBoundingClientRect();
    setOverlayPosition(rect.left, rect.top);
  }

  function initializeOverlayDragging() {
    overlay.shadow.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const handle = target?.closest(".drag-handle");
      if (!handle) return;
      const action = target.closest("[data-action]");
      if (action && !handle.classList.contains("compact-button")) return;

      const rect = overlay.host.getBoundingClientRect();
      overlayDragState = {
        pointerId: event.pointerId,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false
      };
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional; movement inside the overlay still works.
      }
    });

    overlay.shadow.addEventListener("pointermove", (event) => {
      if (!overlayDragState || event.pointerId !== overlayDragState.pointerId) return;
      const dx = event.clientX - overlayDragState.startX;
      const dy = event.clientY - overlayDragState.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) overlayDragState.moved = true;
      if (!overlayDragState.moved) return;
      event.preventDefault();
      setOverlayPosition(overlayDragState.left + dx, overlayDragState.top + dy);
    });

    const finishDrag = (event) => {
      if (!overlayDragState || event.pointerId !== overlayDragState.pointerId) return;
      const moved = overlayDragState.moved;
      const rect = overlay.host.getBoundingClientRect();
      overlayDragState = null;
      if (moved) {
        suppressOverlayClick = true;
        setOverlayPosition(rect.left, rect.top, { save: true });
        setTimeout(() => {
          suppressOverlayClick = false;
        }, 0);
        renderOverlay();
      }
    };
    overlay.shadow.addEventListener("pointerup", finishDrag);
    overlay.shadow.addEventListener("pointercancel", finishDrag);
    window.addEventListener("resize", clampCurrentOverlayPosition);
  }

  function cancelAutoMinimize() {
    if (autoMinimizeTimer) {
      clearTimeout(autoMinimizeTimer);
      autoMinimizeTimer = null;
    }
  }

  function scheduleAutoMinimize() {
    cancelAutoMinimize();
    if (
      !overlayPreferences.autoMinimizeEnabled ||
      // An overlay the user opened deliberately (Show status, or the hotkey)
      // stays open until they close it. Auto-minimize exists to keep the
      // overlay out of the way when it appeared on its own; applying it here
      // collapsed the card to the compact pill five seconds after Show status,
      // which reads as the button having done nothing at all.
      overlayManuallyShown ||
      overlayCompact ||
      languageState !== "confirmed" ||
      overlay.host.style.display === "none"
    ) return;

    const delay = Math.max(1, Number(overlayPreferences.autoMinimizeSeconds) || 5) * 1000;
    autoMinimizeTimer = setTimeout(minimizeOverlay, delay);
  }

  function minimizeOverlay() {
    if (!currentInfo) return;
    cancelAutoMinimize();
    // Minimizing ends the "user opened this deliberately" state, so a later
    // overlay that appears on its own can auto-minimize normally again.
    overlayManuallyShown = false;
    overlayCompact = true;
    overlay.host.style.display = "block";
    renderOverlay();
    requestAnimationFrame(clampCurrentOverlayPosition);
  }

  function showExpandedOverlay() {
    if (!currentInfo) return;
    overlayCompact = false;
    overlay.host.style.display = "block";
    renderOverlay();
    scheduleAutoMinimize();
    requestAnimationFrame(clampCurrentOverlayPosition);
  }

  function toggleOverlayCompact() {
    if (!currentInfo) return false;
    if (overlay.host.style.display === "none" || overlayCompact) showExpandedOverlay();
    else minimizeOverlay();
    return true;
  }

  function applyOverlayPreferences(preferences) {
    const previousFullyManual = overlayPreferences.fullyManualEnabled;
    overlayPreferences = {
      autoMinimizeEnabled: preferences?.autoMinimizeEnabled !== false,
      autoMinimizeSeconds: Math.min(300, Math.max(1, Number(preferences?.autoMinimizeSeconds) || 5)),
      theme: preferences?.theme === "light" ? "light" : "dark",
      fullyManualEnabled: preferences?.fullyManualEnabled === true,
      targetLanguageDeferred: preferences?.targetLanguageDeferred === true
    };
    overlay.host.dataset.theme = overlayPreferences.theme;
    const nextTarget = {
      code: normalizeLanguageCode(preferences?.targetLanguage?.code || "ja") || "ja",
      name: String(preferences?.targetLanguage?.name || "Japanese").trim() || "Japanese"
    };
    const targetChanged = nextTarget.code !== targetLanguage.code ||
      nextTarget.name !== targetLanguage.name;
    const fullyManualChanged = previousFullyManual !== overlayPreferences.fullyManualEnabled;
    if ((targetChanged || fullyManualChanged) && currentInfo) {
      samplePlayback();
      flushTicks();
    }
    targetLanguage = nextTarget;

    if (preferences?.overlayPosition?.custom === true) {
      requestAnimationFrame(() => setOverlayPosition(
        preferences.overlayPosition.left,
        preferences.overlayPosition.top
      ));
    } else {
      resetOverlayPosition();
    }
    if ((targetChanged || fullyManualChanged) && currentInfo) {
      discardUnconfirmedBuffer();
      if (targetChanged) {
        sessionId = randomId();
        sessionActive = 0;
        sessionPassive = 0;
        pendingActive = 0;
        pendingPassive = 0;
      }
      languageState = "idle";
      detectionReason = "";
      lastStreamingAudioSignature = "";
      sourceSuggestion = false;
      overlay.host.style.display = "none";
      resetSampling(currentVideo);
      setTimeout(refreshContext, 0);
    }
    if (!overlayCompact && overlay.host.style.display !== "none") scheduleAutoMinimize();
  }

  async function loadOverlayPreferences() {
    const response = await sendMessage({ type: "getPreferences" });
    if (response?.preferences) applyOverlayPreferences(response.preferences);
  }

  function recordingMode() {
    if (!currentVideo || languageState !== "confirmed" || statusPausedByUser) return "stopped";
    if (!playbackStateAllowsCounting(currentVideo)) return "stopped";
    return isActiveImmersion() ? "active" : "passive";
  }

  function renderOverlay() {
    if (!overlay?.card || overlayDragState) return;

    if (!currentInfo) {
      overlay.host.style.display = "none";
      return;
    }

    overlay.card.classList.toggle("compact", overlayCompact);

    if (overlayCompact) {
      const mode = recordingMode();
      overlay.card.innerHTML =
        '<button class="compact-button fab-grip drag-handle" data-action="expand-full" ' +
          'title="Drag to move or click to open full status" aria-label="Open full immersion status">' +
          '<span class="dot ' + mode + '"></span>' +
          '<strong>' + escapeHtml(formatDuration(sessionActive + sessionPassive)) + '</strong>' +
          '<span>session</span>' +
        '</button>';

      overlay.card.querySelector('[data-action="expand-full"]')?.addEventListener("click", () => {
        if (!suppressOverlayClick) showExpandedOverlay();
      });
      sendStatus();
      return;
    }

    if (languageState === "awaiting-language") {
      cancelAutoMinimize();
      overlayCompact = false;
      if (!isVideoPlaying(currentVideo) && !overlayManuallyShown) {
        overlay.host.style.display = "none";
        return;
      }
      overlay.host.style.display = "block";
      const used = languageChoices.filter((entry) => entry.used);
      const rest = languageChoices.filter((entry) => !entry.used);
      const optionsFor = (entries) => entries
        .map((entry) => `<option value="${escapeHtml(entry.code)}">${escapeHtml(entry.name)}</option>`)
        .join("");
      overlay.card.innerHTML = `
        <div class="row drag-handle">
          <span class="dot waiting"></span>
          <div class="title">No language could be detected</div>
        </div>
        <div class="reason">${escapeHtml(detectionReason)} Do you want to count this? Playback time is held temporarily until you answer.</div>
        <label class="language-picker">
          <span>Count this as</span>
          <select data-action="language-choice" aria-label="Language for this video">
            ${used.length ? `<optgroup label="Your languages">${optionsFor(used)}</optgroup>` : ""}
            ${rest.length ? `<optgroup label="All languages">${optionsFor(rest)}</optgroup>` : ""}
          </select>
        </label>
        <div class="buttons">
          <button class="primary" data-action="count-language">Count this video</button>
          ${currentInfo.sourceKey ? `<button data-action="count-language-always">Always for ${escapeHtml(currentInfo.sourceLabel || "this source")}</button>` : ""}
          <button class="danger" data-action="no">Don't count this video</button>
        </div>
      `;
    } else if (languageState === "awaiting") {
      cancelAutoMinimize();
      overlayCompact = false;
      if (!isVideoPlaying(currentVideo) && !overlayManuallyShown) {
        overlay.host.style.display = "none";
        return;
      }
      overlay.host.style.display = "block";
      const confirmationGuidance = isStreamingSite
        ? `Confirm only when the selected spoken audio is ${targetLanguage.name}. Subtitles do not count.`
        : `Count it when roughly 90% or more of the spoken content is ${targetLanguage.name}.`;
      overlay.card.innerHTML = `
        <div class="row drag-handle">
          <span class="dot waiting"></span>
          <div class="title">${isStreamingSite ? "Is the selected audio " : "Is this mostly "}${escapeHtml(targetLanguage.name)}?</div>
        </div>
        <div class="reason">${escapeHtml(detectionReason)} ${escapeHtml(confirmationGuidance)} Playback time is held temporarily until you answer.</div>
        <div class="buttons">
          <button class="primary" data-action="yes">Yes, count this video</button>
          ${!isStreamingSite && currentInfo.sourceKey ? `<button data-action="always">Always count channel</button>` : ""}
          <button class="danger" data-action="no">No, don't count this video</button>
        </div>
      `;
    } else if (languageState === "confirmed") {
      const mode = recordingMode();
      const audible = currentVideo ? hasAudibleSound(currentVideo) : false;
      const playing = currentVideo && !currentVideo.paused && !currentVideo.ended;
      // In Automatic mode this is the identified language, not "Automatic (Pro)".
      const languageName = activeLanguage().name;
      const label = statusPausedByUser
        ? "Tracking paused"
        : mode === "active"
          ? "Recording active " + languageName
          : mode === "passive"
            ? "Recording passive " + languageName
            : !playing
              ? languageName + " confirmed - video paused"
              : !audible
                ? languageName + " confirmed - sound is off"
                : languageName + " confirmed - waiting for playback";

      overlay.card.innerHTML = `
        <div class="row between drag-handle">
          <div class="row">
            <span class="dot ${mode}"></span>
            <div class="title">${escapeHtml(label)}</div>
          </div>
          <button class="link" data-action="minimize" aria-label="Minimize">&minus;</button>
        </div>
        <div class="reason">${escapeHtml(detectionReason)}</div>
        ${sourceSuggestion ? `<div class="reason"><strong>You confirmed multiple related videos from ${escapeHtml(currentInfo.sourceLabel)}.</strong> Remember them as ${escapeHtml(languageName)} so future related videos can count automatically?</div>` : ""}
        <div class="stats">
          <div class="stat"><div class="stat-label">Active this session</div><div class="stat-value">${formatDuration(sessionActive)}</div></div>
          <div class="stat"><div class="stat-label">Passive this session</div><div class="stat-value">${formatDuration(sessionPassive)}</div></div>
        </div>
        <div class="buttons">
          ${sourceSuggestion ? `<button class="primary" data-action="always-now">${site === "youtube" ? "Always count this channel" : "Remember related videos"}</button><button data-action="dismiss-source">Not yet</button>` : ""}
          <button data-action="pause">${statusPausedByUser ? "Resume tracking" : "Pause tracking"}</button>
          <button data-action="minimize">Minimize</button>
          <button data-action="hide">Hide</button>
          <div class="recovery-buttons">
            <button data-action="reconnect" ${reconnectInProgress ? "disabled" : ""} aria-label="Reload this page and reconnect the tracker">${reconnectInProgress ? "Reconnecting..." : "Reconnect"}</button>
            ${overlayPreferences.fullyManualEnabled ? "" : `<button class="danger" data-action="wrong">Not ${escapeHtml(languageName)} - remove time</button>`}
          </div>
        </div>
      `;
    } else if (["rejected", "not-candidate", "primary-other"].includes(languageState)) {
      const stoppedLabel = languageState === "rejected"
        ? "Not tracking this video"
        : "Automatic detection did not mark this as " + activeLanguage().name;
      overlay.card.innerHTML = `
        <div class="row drag-handle">
          <span class="dot stopped"></span>
          <div class="title">${escapeHtml(stoppedLabel)}</div>
        </div>
        <div class="reason">${escapeHtml(detectionReason)}</div>
        <div class="buttons"><button data-action="change">Actually, count it</button><button class="link" data-action="hide">Hide</button></div>
      `;
    } else if (languageState === "checking") {
      if (!overlayManuallyShown) {
        overlay.host.style.display = "none";
        return;
      }
      overlay.host.style.display = "block";
      overlay.card.innerHTML = `
        <div class="row drag-handle"><span class="dot waiting"></span><div class="title">Checking selected audio...</div></div>
        <div class="reason">Keep the streaming site's audio menu open briefly if it is available.</div>
        <div class="buttons"><button class="link" data-action="hide">Hide</button></div>
      `;
    } else {
      if (!overlayManuallyShown) {
        overlay.host.style.display = "none";
        return;
      }
      overlay.host.style.display = "block";
      overlay.card.innerHTML = `
        <div class="row drag-handle"><span class="dot stopped"></span><div class="title">Waiting for playback</div></div>
        <div class="reason">Start the video to check its spoken audio language.</div>
        <div class="buttons"><button class="link" data-action="hide">Hide</button></div>
      `;
    }

    overlay.card.querySelector('[data-action="yes"]')?.addEventListener("click", () => confirmTargetLanguage());
    overlay.card.querySelector('[data-action="always"]')?.addEventListener("click", () => confirmTargetLanguage("source"));
    overlay.card.querySelector('[data-action="always-now"]')?.addEventListener("click", () => confirmTargetLanguage("source"));
    overlay.card.querySelector('[data-action="dismiss-source"]')?.addEventListener("click", async () => {
      sourceSuggestion = false;
      await sendMessage({
        type: "dismissSourceSuggestion",
        sourceKey: currentInfo?.sourceKey || "",
        languageCode: targetLanguage.code
      });
      renderOverlay();
    });
    const chooseLanguage = (scope) => {
      const select = overlay.card.querySelector('[data-action="language-choice"]');
      const code = select?.value || "";
      const choice = languageChoices.find((entry) => entry.code === code);
      if (choice) confirmAutomaticLanguageChoice(choice, scope);
    };
    overlay.card.querySelector('[data-action="count-language"]')?.addEventListener("click", () => chooseLanguage("content"));
    overlay.card.querySelector('[data-action="count-language-always"]')?.addEventListener("click", () => chooseLanguage("source"));
    overlay.card.querySelector('[data-action="no"]')?.addEventListener("click", () => rejectTargetLanguage({ rollback: false }));
    overlay.card.querySelector('[data-action="wrong"]')?.addEventListener("click", () => rejectTargetLanguage({ rollback: true }));
    overlay.card.querySelector('[data-action="reconnect"]')?.addEventListener("click", reconnectTracker);
    overlay.card.querySelector('[data-action="pause"]')?.addEventListener("click", togglePause);
    overlay.card.querySelectorAll('[data-action="minimize"]').forEach((button) => {
      button.addEventListener("click", minimizeOverlay);
    });
    overlay.card.querySelector('[data-action="change"]')?.addEventListener("click", () => confirmTargetLanguage());
    overlay.card.querySelector('[data-action="hide"]')?.addEventListener("click", () => {
      overlayManuallyShown = false;
      cancelAutoMinimize();
      overlay.host.style.display = "none";
    });

    sendStatus();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sendStatus() {
    const mode = recordingMode();
    const state =
      ["awaiting", "awaiting-language"].includes(languageState)
        ? "awaiting"
        : mode === "active"
          ? "recording-active"
          : mode === "passive"
            ? "recording-passive"
            : "stopped";

    sendMessage({
      type: "status",
      status: {
        state,
        languageState,
        targetLanguage: { ...targetLanguage },
        // What time is actually being booked under, which in Automatic mode is
        // the identified language rather than the mode itself.
        languageCode: activeLanguage().code,
        languageName: activeLanguage().name,
        detectedLanguage: detectedLanguage ? { ...detectedLanguage } : null,
        site,
        title: currentInfo?.title || "",
        contentKey: currentInfo?.contentKey || "",
        sessionId,
        sessionActive,
        sessionPassive,
        detectionReason,
        audible: currentVideo ? hasAudibleSound(currentVideo) : false,
        playing: Boolean(currentVideo && !currentVideo.paused && !currentVideo.ended),
        countingEligible: currentVideo ? playbackStateAllowsCounting(currentVideo) : false,
        trackingPaused: statusPausedByUser,
        pageVisible: document.visibilityState === "visible",
        pageFocused: document.hasFocus()
      }
    }).then((response) => {
      let changed = false;
      if (typeof response?.tabMuted === "boolean" && response.tabMuted !== browserTabMuted) {
        browserTabMuted = response.tabMuted;
        changed = true;
      }
      if (typeof response?.activeImmersion === "boolean" && response.activeImmersion !== browserContextActive) {
        samplePlayback();
        flushTicks();
        browserContextActive = response.activeImmersion;
        changed = true;
      }
      if (changed) resetSampling(currentVideo);
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "confirmCurrentLanguage" || message.type === "confirmCurrentJapanese") {
      confirmTargetLanguage().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "rejectCurrentLanguage" || message.type === "rejectCurrentJapanese") {
      rejectTargetLanguage({ rollback: true }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "showTrackerOverlay") {
      if (!currentInfo) {
        sendResponse({ ok: false, reason: "no-video" });
        return false;
      }
      overlayManuallyShown = true;
      showExpandedOverlay();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "toggleTrackerPause") {
      if (!currentInfo || languageState !== "confirmed") {
        sendResponse({ ok: false, reason: "no-confirmed-video" });
        return false;
      }
      togglePause();
      sendResponse({ ok: true, paused: statusPausedByUser });
      return false;
    }
    if (message.type === "toggleOverlayCompact") {
      sendResponse({ ok: toggleOverlayCompact() });
      return false;
    }
    if (message.type === "overlayPreferencesChanged") {
      applyOverlayPreferences(message.preferences);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "browserContextChanged") {
      const nextActive = Boolean(message.activeImmersion);
      if (nextActive !== browserContextActive) {
        samplePlayback();
        flushTicks();
        browserContextActive = nextActive;
        resetSampling(currentVideo);
        renderOverlay();
      }
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  document.addEventListener("fullscreenchange", () => {
    const fullscreenParent = document.fullscreenElement;
    if (fullscreenParent && !(fullscreenParent instanceof HTMLVideoElement)) {
      fullscreenParent.appendChild(overlay.host);
    } else if (!fullscreenParent) {
      document.documentElement.appendChild(overlay.host);
    }
    renderOverlay();
    sendStatus();
  });
  document.addEventListener("visibilitychange", () => {
    resetSampling(currentVideo);
    renderOverlay();
    sendStatus();
  });
  window.addEventListener("focus", sendStatus);
  window.addEventListener("blur", sendStatus);
  window.addEventListener("pagehide", () => flushTicks());

  injectYouTubeProbe();
  loadOverlayPreferences();
  watchStructuredSeriesMetadata();
  refreshContext();
  setInterval(() => {
    refreshContext();
    samplePlayback();
    if (performance.now() - lastFlushAt >= 5000) flushTicks();
    sendStatus();
  }, 1000);
})();
