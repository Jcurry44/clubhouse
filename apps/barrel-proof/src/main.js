(function bootBarrelProof() {
  const INDEX_JSON_URL = "./src/data/imported-catalog-index.json";
  const INDEX_JS_FALLBACK_URL = "./src/data/imported-catalog-index.js";

  async function start() {
    const app = document.getElementById("app");
    renderBootShell(app);

    try {
      const data = window.BarrelData;
      const friends = window.BarrelFriends.friends;
      const cocktails = window.BarrelCocktailData ? window.BarrelCocktailData.cocktails : [];
      const reviewData = window.BarrelReviewData || { reviewsByBottleId: {} };
      const curatedData = window.BarrelCuratedData || { bottlesById: {}, bottleAliases: {} };
      const store = window.BarrelStore;
      const ui = window.BarrelUI;

      const imported = await loadImportedCatalog();
      const mergeOutcome = mergeBottles(data.bottles, imported.bottles || []);
      const bottles = mergeOutcome.bottles;
      attachCuratedMetadata(bottles, curatedData);
      attachReviewMetadata(bottles, reviewData);
      attachBottleImages(bottles);

      // Catalog rebuilds retire ids when records merge; boot-time seed merging
      // absorbs more. Combine both alias maps so user data saved against an old
      // id migrates to the surviving bottle instead of orphaning.
      const idAliases = { ...(imported.bottleAliases || {}), ...mergeOutcome.aliases };

      // When the catalog failed to load we fall back to seed bottles only. In that
      // degraded state we must NOT prune the user's statuses against the tiny seed
      // list, or every owned/wishlist/passed tag for imported bottles is lost on save.
      const catalogHealthy = imported.loadMode !== "seed" && (imported.bottles || []).length > 0;
      const state = store.load(data.initialState, {
        bottleIds: bottles.map((bottle) => bottle.id),
        pruneStatuses: catalogHealthy,
        idAliases
      });
      // Persist the alias migration right away so the saved copy carries the
      // surviving ids even if the user never makes another change this session.
      if (Object.keys(idAliases).length) store.save(state);

      ui.createApp({
        mount: app,
        bottles,
        catalogMeta: {
          importedBottleCount: imported.bottleCount || imported.bottles.length || 0,
          fullBottleCount: imported.fullBottleCount || imported.bottleCount || imported.bottles.length || 0,
          sourceCount: imported.sourceCount || 0,
          generatedAt: imported.generatedAt || "",
          loadMode: imported.loadMode || "seed"
        },
        cocktails,
        reviewData,
        friends,
        palate: data.palate,
        state,
        save: store.save,
        reset: () => store.reset(data.initialState, { bottleIds: bottles.map((bottle) => bottle.id), idAliases })
      });

      registerServiceWorker();
    } catch (error) {
      console.error("Barrel Proof failed to start:", error);
      renderBootError(app, error);
    }
  }

  function renderBootShell(app) {
    app.innerHTML = `
      <section class="boot-panel">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div>
          <p class="eyebrow">Private bourbon intelligence</p>
          <h1>Barrel Proof</h1>
          <p>Loading the source-backed bottle index...</p>
        </div>
      </section>
    `;
  }

  async function loadImportedCatalog() {
    if (window.BarrelImportedCatalogIndex) {
      return { ...window.BarrelImportedCatalogIndex, loadMode: "script" };
    }
    if (window.BarrelImportedCatalog) {
      return { ...window.BarrelImportedCatalog, loadMode: "legacy-script" };
    }

    try {
      const response = await fetchWithTimeout(INDEX_JSON_URL, { cache: "default" }, 20000);
      if (!response.ok) throw new Error("Catalog index request failed: " + response.status);
      return { ...(await response.json()), loadMode: "json" };
    } catch (error) {
      try {
        await loadScript(INDEX_JS_FALLBACK_URL);
        if (window.BarrelImportedCatalogIndex) {
          return { ...window.BarrelImportedCatalogIndex, loadMode: "script-fallback" };
        }
      } catch (fallbackError) {
        console.warn("Failed to load imported catalog index:", error, fallbackError);
      }
    }

    return {
      schemaVersion: 1,
      sourceCount: 0,
      bottleCount: 0,
      bottles: [],
      loadMode: "seed"
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Unable to load " + src));
      document.head.appendChild(script);
    });
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    if (typeof AbortController === "undefined") return fetch(url, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  function renderBootError(app, error) {
    const message = error && error.message ? error.message : String(error || "Unknown error");
    app.innerHTML = `
      <section class="boot-panel boot-error">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div>
          <p class="eyebrow">Private bourbon intelligence</p>
          <h1>Barrel Proof</h1>
          <p>Startup was interrupted. Your saved collection, tastings, and prices on this device are untouched.</p>
          <p class="boot-error-detail">${escapeBootText(message)}</p>
          <div class="boot-actions">
            <button type="button" id="bootRetry" class="primary-button">Retry</button>
            <button type="button" id="bootHardReset" class="ghost-button">Clear app cache &amp; reload</button>
          </div>
        </div>
      </section>
    `;
    const retry = document.getElementById("bootRetry");
    if (retry) retry.addEventListener("click", () => window.location.reload());
    const hardReset = document.getElementById("bootHardReset");
    if (hardReset) hardReset.addEventListener("click", clearCachesAndReload);
  }

  // Self-heal a poisoned service-worker/cache without DevTools. This clears ONLY
  // the offline asset caches and the service worker — it never touches localStorage,
  // so the user's saved data survives.
  async function clearCachesAndReload() {
    try {
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        // CLUBHOUSE: only Barrel Proof's own caches; the Clubhouse service worker is never unregistered here
        await Promise.all(keys.filter((key) => key.startsWith("barrel-proof")).map((key) => caches.delete(key)));
      }
    } catch (error) {
      console.warn("Cache reset failed:", error);
    }
    window.location.reload();
  }

  function escapeBootText(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function mergeBottles(baseBottles, importedBottles) {
    const catalog = window.BarrelCatalog;
    const byKey = new Map();
    const result = [];
    const aliases = {};

    for (const bottle of baseBottles) {
      const clone = cloneBottle(bottle);
      addBottle(result, byKey, clone, catalog, aliases);
    }

    for (const bottle of importedBottles) {
      addBottle(result, byKey, cloneBottle(bottle), catalog, aliases);
    }

    return { bottles: result, aliases };
  }

  function attachReviewMetadata(bottles, reviewData) {
    const reviewLogic = window.BarrelReviews;
    if (!reviewLogic || !reviewLogic.getBottleReviewEntries) return;

    for (const bottle of bottles) {
      const entries = reviewLogic.getBottleReviewEntries(bottle, reviewData);
      if (!entries.length) continue;
      bottle.reviewSummary = {
        sourceCount: entries.length,
        editorialCount: entries.filter((entry) => entry.sourceType === "editorial").length,
        communityCount: entries.filter((entry) => entry.sourceType === "community").length,
        hasNumericScore: false
      };
      bottle.reviewSources = entries.map((entry) => ({
        sourceName: entry.sourceName,
        sourceType: entry.sourceType,
        url: entry.url,
        retrievedAt: entry.retrievedAt || ""
      }));
    }
  }

  function attachBottleImages(bottles) {
    const images = window.BarrelBottleImages;
    if (!images || !images.byCode) return;
    const byCode = images.byCode;
    for (const bottle of bottles) {
      if (bottle.imageUrl) continue;
      const codes = [bottle.upc, ...(bottle.barcodes || [])].filter(Boolean);
      for (const code of codes) {
        const url = byCode[String(code)];
        if (url) {
          bottle.imageUrl = url;
          break;
        }
      }
    }
  }

  function attachCuratedMetadata(bottles, curatedData) {
    const records = curatedData.bottlesById || {};
    const aliases = curatedData.bottleAliases || {};
    for (const bottle of bottles) {
      const mappedId = aliases[bottle.id];
      const canonicalId = mappedId || bottle.id;
      const record = records[canonicalId];
      if (!record) continue;
      applyCuratedRecord(bottle, canonicalId, record, Boolean(mappedId));
    }
  }

  function applyCuratedRecord(bottle, canonicalId, record, forceDisplayName) {
    if (record.displayName && (forceDisplayName || shouldUseCuratedName(bottle.name, record.displayName))) {
      bottle.name = record.displayName;
    }

    for (const field of ["distillery", "producer", "category", "age", "mashBill", "size", "bottleKind"]) {
      if (shouldFillText(bottle[field]) && record[field]) bottle[field] = record[field];
    }

    for (const field of ["proof", "msrp", "fairPrice", "hypeIndex", "ageYears", "releaseYear"]) {
      if (!Number.isFinite(bottle[field]) && Number.isFinite(record[field])) bottle[field] = record[field];
    }

    if (record.rarity && (!bottle.rarity || bottle.rarity === "Source-backed" || bottle.rarity === "New")) {
      bottle.rarity = record.rarity;
    }
    if (record.story && (!bottle.story || /^Source-backed catalog record/i.test(bottle.story))) {
      bottle.story = record.story;
    }
    if (record.shelfNote && !bottle.shelfNote) bottle.shelfNote = record.shelfNote;
    if (record.priceBands && !bottle.priceBands) bottle.priceBands = cloneBottle(record.priceBands);
    if (record.secondaryMarket && !bottle.secondaryMarket) bottle.secondaryMarket = cloneBottle(record.secondaryMarket);

    bottle.aliases = mergeTextArray(bottle.aliases, record.aliases);
    bottle.profile = mergeTextArray(bottle.profile, record.profile);
    bottle.bestFor = mergeTextArray(bottle.bestFor, record.bestFor);
    bottle.reviewIds = mergeTextArray(bottle.reviewIds, record.reviewIds);
    bottle.curatedSources = mergeArray(bottle.curatedSources, record.sources);
    bottle.curated = {
      canonicalId,
      confidence: record.confidence || "curated",
      releaseSpecific: Boolean(record.releaseSpecific),
      releaseLabel: record.releaseLabel || "",
      sourceNote: record.sourceNote || ""
    };
  }

  function addBottle(result, byKey, bottle, catalog, aliases) {
    const keys = makeBottleKeys(bottle, catalog);
    const existing = keys
      .map((key) => byKey.get(key))
      .find((candidate) => candidate && (!catalog || !catalog.canMergeCatalogRecords || catalog.canMergeCatalogRecords(candidate, bottle)));

    if (existing) {
      mergeBottleInto(existing, bottle, catalog);
      if (aliases && bottle.id && bottle.id !== existing.id) aliases[bottle.id] = existing.id;
      for (const key of keys) byKey.set(key, existing);
      return;
    }

    result.push(bottle);
    for (const key of keys) byKey.set(key, bottle);
  }

  function mergeBottleInto(existing, incoming, catalog) {
    existing.aliases = mergeTextArray(existing.aliases, incoming.aliases);
    existing.profile = mergeTextArray(existing.profile, incoming.profile);
    existing.bestFor = mergeTextArray(existing.bestFor, incoming.bestFor);
    existing.sourceRefs = mergeSourceRefs(existing.sourceRefs, incoming.sourceRefs);
    existing.prices = catalog && catalog.mergePrices
      ? catalog.mergePrices(existing.prices, incoming.prices)
      : mergeArray(existing.prices, incoming.prices);
    existing.labelApprovals = mergeArray(existing.labelApprovals, incoming.labelApprovals);
    existing.barcodes = mergeTextArray(existing.barcodes, incoming.barcodes);
    existing.sourceRetailPrice = firstFinite(existing.sourceRetailPrice, incoming.sourceRetailPrice);
    existing.sourcePriceLabel = existing.sourcePriceLabel || incoming.sourcePriceLabel;
    existing.rarity = chooseRarity(existing.rarity, incoming.rarity);
    existing.producer = existing.producer || incoming.producer;
    existing.supplier = existing.supplier || incoming.supplier;
    existing.distillery = existing.distillery || incoming.distillery || incoming.producer || incoming.supplier;
    existing.size = existing.size || incoming.size;
    existing.proof = existing.proof || incoming.proof;
    existing.age = chooseAge(existing.age, incoming.age);
    existing.ageYears = Number.isFinite(existing.ageYears) ? existing.ageYears : incoming.ageYears;
    existing.upc = existing.upc || incoming.upc;
    if (!existing.story && incoming.story) existing.story = incoming.story;
    if (!existing.sourceSummary && incoming.sourceSummary) existing.sourceSummary = incoming.sourceSummary;
  }

  function makeBottleKeys(bottle, catalog) {
    if (catalog && catalog.makeCanonicalIdentityKey) {
      return catalog.unique([
        bottle.id,
        catalog.makeCanonicalIdentityKey({ ...bottle, size: bottle.size || "750ml" }),
        [catalog.slugify(bottle.name), bottle.proof ? Math.round(Number(bottle.proof)) : "", bottle.size || "750ml"].filter(Boolean).join("|")
      ]);
    }
    return [bottle.id || String(bottle.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")];
  }

  function cloneBottle(bottle) {
    return JSON.parse(JSON.stringify(bottle));
  }

  function firstFinite(left, right) {
    if (Number.isFinite(left)) return left;
    return Number.isFinite(right) ? right : left || null;
  }

  function chooseRarity(left, right) {
    if (!left || left === "Source-backed") return right || left;
    if (right === "Multi-source") return right;
    return left;
  }

  function chooseAge(left, right) {
    if (!right) return left;
    if (!left || left === "Unknown" || left === "NAS" || left === "0 months") return right;
    return left;
  }

  function shouldFillText(value) {
    return !value || value === "Unknown" || value === "Unknown producer" || value === "NAS" || value === "Undisclosed";
  }

  function shouldUseCuratedName(currentName, curatedName) {
    if (!currentName) return true;
    const current = String(currentName).toLowerCase();
    const curated = String(curatedName).toLowerCase();
    if (current === curated) return false;
    if (current.includes("(pappy)") || current.includes("fam res") || current.includes("rsrv")) return true;
    if (current.includes("ch ") || current.includes("yo") || current.includes("yr")) return true;
    if (current.length > curated.length + 12) return true;
    return false;
  }

  function mergeSourceRefs(left, right) {
    const seen = new Set();
    const merged = [];
    for (const source of [...(left || []), ...(right || [])]) {
      const key = [source.sourceId, source.sourceRecordId].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(source);
    }
    return merged;
  }

  function mergeTextArray(left, right) {
    const catalog = window.BarrelCatalog;
    return catalog && catalog.unique ? catalog.unique([...(left || []), ...(right || [])]) : mergeArray(left, right);
  }

  function mergeArray(left, right) {
    const seen = new Set();
    const merged = [];
    for (const item of [...(left || []), ...(right || [])]) {
      const key = item && typeof item === "object" ? JSON.stringify(item) : String(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged;
  }

  function registerServiceWorker() {
    return; // CLUBHOUSE: the Clubhouse service worker owns this scope
    if (!("serviceWorker" in navigator)) return;
    if (!/^(https?:|http:)$/.test(window.location.protocol)) return;
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Barrel Proof service worker registration failed:", error);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
