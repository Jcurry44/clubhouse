(function attachStore(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.BarrelStore = factory(root);
  }
})(typeof window !== "undefined" ? window : globalThis, function createStore(global) {
  const STORAGE_KEY = "barrel-proof-state-v1";
  const CURRENT_VERSION = 12;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeState(state, defaults, options = {}) {
    const fallback = clone(defaults);
    const input = state && typeof state === "object" ? state : {};
    const migrated = migrateState(input);
    const normalized = {
      ...fallback,
      ...migrated,
      schemaVersion: CURRENT_VERSION,
      statuses: {
        ...fallback.statuses,
        ...(migrated.statuses || {})
      },
      tastings: Array.isArray(migrated.tastings) ? migrated.tastings : fallback.tastings,
      huntLog: Array.isArray(migrated.huntLog) ? migrated.huntLog : fallback.huntLog,
      matchups: Array.isArray(migrated.matchups) ? migrated.matchups : (fallback.matchups || []),
      collection: migrated.collection && typeof migrated.collection === "object" ? migrated.collection : (fallback.collection || {}),
      prices: migrated.prices && typeof migrated.prices === "object" ? migrated.prices : (fallback.prices || {}),
      club: migrated.club && typeof migrated.club === "object" ? migrated.club : (fallback.club || { friends: [] }),
      activeFlight: migrated.activeFlight && typeof migrated.activeFlight === "object" ? migrated.activeFlight : (fallback.activeFlight || null),
      flights: Array.isArray(migrated.flights) ? migrated.flights : (fallback.flights || []),
      barcodeLinks: migrated.barcodeLinks && typeof migrated.barcodeLinks === "object" ? migrated.barcodeLinks : (fallback.barcodeLinks || {}),
      killLog: Array.isArray(migrated.killLog) ? migrated.killLog : (fallback.killLog || []),
      identityLinks: migrated.identityLinks && typeof migrated.identityLinks === "object" ? migrated.identityLinks : (fallback.identityLinks || {}),
      clubProfiles: migrated.clubProfiles && typeof migrated.clubProfiles === "object" ? migrated.clubProfiles : (fallback.clubProfiles || {}),
      activeTastingGame: migrated.activeTastingGame && typeof migrated.activeTastingGame === "object" ? migrated.activeTastingGame : (fallback.activeTastingGame || null),
      tastingGames: Array.isArray(migrated.tastingGames) ? migrated.tastingGames : (fallback.tastingGames || [])
    };
    remapStateIds(normalized, options.idAliases);
    return validateState(normalized, fallback, options);
  }

  function migrateState(input) {
    const version = Number(input.schemaVersion) || 0;
    const next = { ...input };
    if (version < 1) {
      next.statuses = next.statuses && typeof next.statuses === "object" ? next.statuses : {};
      next.tastings = Array.isArray(next.tastings) ? next.tastings : [];
      next.huntLog = Array.isArray(next.huntLog) ? next.huntLog : [];
    }
    if (version < 2) {
      next.storePrice = Number.isFinite(Number(next.storePrice)) ? Number(next.storePrice) : "";
    }
    if (version < 3) {
      next.matchups = Array.isArray(next.matchups) ? next.matchups : [];
    }
    if (version < 4) {
      next.collection = next.collection && typeof next.collection === "object" ? next.collection : {};
    }
    if (version < 5) {
      next.prices = next.prices && typeof next.prices === "object" ? next.prices : {};
    }
    if (version < 6) {
      next.club = next.club && typeof next.club === "object"
        ? { friends: Array.isArray(next.club.friends) ? next.club.friends : [] }
        : { friends: [] };
    }
    if (version < 7) {
      next.activeFlight = next.activeFlight && typeof next.activeFlight === "object" ? next.activeFlight : null;
      next.flights = Array.isArray(next.flights) ? next.flights : [];
    }
    if (version < 8) {
      next.barcodeLinks = next.barcodeLinks && typeof next.barcodeLinks === "object" ? next.barcodeLinks : {};
    }
    if (version < 9) {
      next.killLog = Array.isArray(next.killLog) ? next.killLog : [];
    }
    if (version < 10) {
      next.identityLinks = next.identityLinks && typeof next.identityLinks === "object" ? next.identityLinks : {};
    }
    if (version < 11) {
      // This is deliberately only a local profile foundation. It records whose
      // cabinet this browser represents; it does not imply shared activity.
      next.clubProfiles = next.clubProfiles && typeof next.clubProfiles === "object" ? next.clubProfiles : {};
    }
    if (version < 12) {
      next.activeTastingGame = next.activeTastingGame && typeof next.activeTastingGame === "object" ? next.activeTastingGame : null;
      next.tastingGames = Array.isArray(next.tastingGames) ? next.tastingGames : [];
    }
    return next;
  }

  // Catalog rebuilds can merge bottle records, retiring ids that user data
  // points at. idAliases (old id -> surviving id) migrate everything the user
  // owns: statuses, collection counts, prices, tastings, kills, links.
  function remapId(aliases, id) {
    let current = id;
    for (let hop = 0; hop < 5 && aliases[current]; hop += 1) current = aliases[current];
    return current;
  }

  function remapStateIds(state, aliases) {
    if (!aliases || !Object.keys(aliases).length) return state;
    const map = (id) => (id ? remapId(aliases, id) : id);

    const statuses = {};
    for (const id of Object.keys(state.statuses || {})) {
      const next = map(id);
      // a value already living on the surviving id always wins over migrants
      if (id === next) statuses[next] = state.statuses[id];
      else if (statuses[next] === undefined) statuses[next] = state.statuses[id];
    }
    state.statuses = statuses;

    const collection = {};
    for (const id of Object.keys(state.collection || {})) {
      const next = map(id);
      const entry = state.collection[id];
      if (!collection[next]) {
        collection[next] = entry;
      } else {
        collection[next] = {
          count: (collection[next].count || 0) + (entry.count || 0),
          batches: [...new Set([...(collection[next].batches || []), ...(entry.batches || [])])],
          note: collection[next].note || entry.note || ""
        };
      }
    }
    state.collection = collection;

    const prices = {};
    for (const id of Object.keys(state.prices || {})) {
      const next = map(id);
      prices[next] = prices[next] ? [...prices[next], ...state.prices[id]] : state.prices[id];
    }
    state.prices = prices;

    for (const tasting of state.tastings || []) tasting.bottleId = map(tasting.bottleId);
    for (const kill of state.killLog || []) kill.bottleId = map(kill.bottleId);
    for (const matchup of state.matchups || []) {
      matchup.aId = map(matchup.aId);
      matchup.bId = map(matchup.bId);
      if (matchup.winnerId && matchup.winnerId !== "tie") matchup.winnerId = map(matchup.winnerId);
    }

    const identityLinks = {};
    for (const id of Object.keys(state.identityLinks || {})) {
      const from = map(id);
      const to = map(state.identityLinks[id]);
      if (from !== to) identityLinks[from] = to;
    }
    state.identityLinks = identityLinks;

    for (const code of Object.keys(state.barcodeLinks || {})) {
      state.barcodeLinks[code] = map(state.barcodeLinks[code]);
    }

    state.activeBottleId = map(state.activeBottleId);
    const remapFlight = (flight) => {
      if (!flight) return;
      for (const pour of flight.pours || []) pour.bottleId = map(pour.bottleId);
      if (Array.isArray(flight.bottleIds)) flight.bottleIds = flight.bottleIds.map(map);
    };
    remapFlight(state.activeFlight);
    for (const flight of state.flights || []) remapFlight(flight);

    return state;
  }

  function validateState(state, fallback, options = {}) {
    const bottleIds = new Set(options.bottleIds || []);
    if (bottleIds.size && !bottleIds.has(state.activeBottleId)) {
      state.activeBottleId = bottleIds.has(fallback.activeBottleId)
        ? fallback.activeBottleId
        : Array.from(bottleIds)[0] || fallback.activeBottleId;
    }
    // Only prune "ghost" statuses against the loaded catalog when that catalog is
    // trustworthy. If the catalog failed to load (seed/fallback mode), pruning would
    // permanently delete the user's owned/wishlist/passed tags for every imported
    // bottle on the next save. Data preservation wins over tidiness on a degraded boot.
    if (bottleIds.size && options.pruneStatuses !== false) {
      state.statuses = Object.fromEntries(
        Object.entries(state.statuses || {}).filter(([bottleId]) => bottleIds.has(bottleId))
      );
    }
    return state;
  }

  function load(defaults, options = {}) {
    try {
      const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeState(defaults, defaults, options);
      return normalizeState(JSON.parse(raw), defaults, options);
    } catch (error) {
      console.warn("Failed to load Barrel Proof state:", error);
      return normalizeState(defaults, defaults, options);
    }
  }

  function save(state) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.warn("Failed to save Barrel Proof state:", error);
      return false;
    }
  }

  function reset(defaults, options = {}) {
    global.localStorage.removeItem(STORAGE_KEY);
    return normalizeState(defaults, defaults, options);
  }

  return {
    CURRENT_VERSION,
    STORAGE_KEY,
    load,
    migrateState,
    normalizeState,
    remapStateIds,
    reset,
    save
  };
});
