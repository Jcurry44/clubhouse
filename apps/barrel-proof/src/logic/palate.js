(function attachPalate(global) {
  // Personal palate model + connoisseur-grade recommender.
  //
  // Two hard rules, enforced everywhere:
  //   1. Never recommend a bottle as buyable that isn't. Availability is read
  //      from curated rarity/hype where present, and from a maintained list of
  //      known allocated/unicorn expressions otherwise. Catalog bottles default
  //      to "on shelves" because they appear in state retail catalogs.
  //   2. Never quote a price you won't actually pay. Findable bottles use real
  //      shelf/MSRP; allocated/unicorn use real secondary data where we have it
  //      and say so honestly where we don't.
  //
  // The learned profile combines tastings, Showdown results, and shelf statuses
  // into preference scores that personalize recommendations over time.

  function norm(value) {
    return " " + String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  }

  // Connoisseur knowledge: expressions that are NOT a normal shelf buy.
  const UNICORN_TOKENS = [
    "pappy", "van winkle", "old rip", "george t stagg", "william larue", "thomas h handy",
    "eagle rare 17", "sazerac 18", "birthday bourbon", "boss hog", "michter s 20", "michter s 25",
    "michter s celebration", "parker s heritage", "four roses limited", "elijah craig 18",
    "elijah craig 23", "taylor tornado", "taylor warehouse", "taylor amaranth", "double eagle",
    "a h hirsch", "willett family estate", "very old st", "old forester 1910 birthday"
  ];
  const ALLOCATED_TOKENS = [
    "weller 12", "weller full proof", "weller cypb", "weller single barrel", "weller antique", "w l weller 12",
    "blanton", "elmer t lee", "rock hill farms", "stagg", "e h taylor", "colonel e h taylor",
    "eagle rare", "michter s 10", "michter s toasted", "michter s barrel strength", "russell s reserve 13",
    "russell s reserve 15", "russells reserve 13", "russells reserve 15", "kentucky owl", "old fitzgerald",
    "knob creek 18", "knob creek 15", "elijah craig barrel proof", "garrison brothers", "wild turkey master",
    "woodford master", "woodford batch proof", "old forester 117", "old forester 1924", "1792 full proof",
    "1792 single barrel", "1792 sweet wheat", "little book", "wild turkey mstr", "mstr keep",
    "cellar aged", "coy hill", "single barrel select", "old carter", "joseph magnus", "midwinter",
    "found north", "smoke wagon", "barrell gray label", "barrell vantage"
  ];

  const AVAIL = {
    shelf: { tier: "shelf", label: "On shelves", buyable: true, score: 92 },
    allocated: { tier: "allocated", label: "Allocated — hunt", buyable: false, score: 34 },
    unicorn: { tier: "unicorn", label: "Unicorn — secondary only", buyable: false, score: 8 }
  };

  // Release descriptors that signal allocation regardless of brand (year-dated
  // limited editions, anniversary bottlings, store-pick barrel-strength, etc.).
  const ALLOCATED_PATTERN = /\blimited edition\b|\blimited release\b|\banniv|\bmaster s keep\b|\bsingle barrel select\b|\bbatch \d{3,}\b|\bcask strength.*(store|private|select)\b/;

  function availability(bottle) {
    if (!bottle) return AVAIL.shelf;
    if (bottle._avail) return bottle._avail;
    const result = availabilityUncached(bottle);
    try {
      Object.defineProperty(bottle, "_avail", { value: result, enumerable: false, configurable: true, writable: true });
    } catch (error) {
      bottle._avail = result;
    }
    return result;
  }

  function availabilityUncached(bottle) {
    const hay = norm([bottle.name, Array.isArray(bottle.aliases) ? bottle.aliases.join(" ") : ""].join(" "));
    const rarity = bottle.rarity;
    const hype = Number(bottle.hypeIndex);
    if (rarity === "Unicorn" || (Number.isFinite(hype) && hype >= 96)) return AVAIL.unicorn;
    if (UNICORN_TOKENS.some((t) => hay.indexOf(norm(t).trim()) !== -1)) return AVAIL.unicorn;
    if (rarity === "Allocated" || rarity === "Limited" || (Number.isFinite(hype) && hype >= 85)) return AVAIL.allocated;
    if (ALLOCATED_TOKENS.some((t) => hay.indexOf(norm(t).trim()) !== -1)) return AVAIL.allocated;
    if (ALLOCATED_PATTERN.test(hay)) return AVAIL.allocated;
    return AVAIL.shelf;
  }

  // Realistic price: what you'll actually pay, with honest framing.
  function realisticPrice(bottle, rec) {
    const avail = availability(bottle);
    const ref = rec && rec.getReferencePriceInfo ? rec.getReferencePriceInfo(bottle) : { value: null, type: "none" };
    const msrp = Number(bottle.msrp);
    if (avail.tier === "shelf") {
      const value = Number.isFinite(ref.value) ? ref.value : (Number.isFinite(msrp) ? msrp : null);
      return { value, basis: "shelf", honest: true, caption: value ? "around shelf price" : "price varies by market" };
    }
    // allocated / unicorn
    if (ref.type === "secondary" && Number.isFinite(ref.value)) {
      return { value: ref.value, basis: "secondary", honest: true, caption: "real secondary-market price" };
    }
    if (Number.isFinite(msrp)) {
      return { value: msrp, basis: "msrp-fantasy", honest: false, caption: "MSRP — expect well above this or secondary-only" };
    }
    return { value: null, basis: "unknown", honest: false, caption: avail.tier === "unicorn" ? "secondary-only; price varies widely" : "rarely at retail; price varies" };
  }

  // ---- Learned palate profile ---------------------------------------------

  function bump(map, key, amount) {
    if (!key) return;
    map[key] = (map[key] || 0) + amount;
  }

  function buildProfile(state, bottlesById, deps) {
    const families = deps && deps.families;
    const styleScores = {};
    const typeScores = {};
    const flavorScores = {};
    const distilleryScores = {};
    const proofSamples = [];
    let signals = 0;

    const attrsOf = (bottle) => (families ? families.attributes(bottle) : {});
    const houseOf = (bottle) => (families ? families.classify(bottle).distillery : bottle.distillery || "");

    const applyBottle = (bottle, weight) => {
      if (!bottle) return;
      const a = attrsOf(bottle);
      bump(styleScores, a.style, weight);
      bump(typeScores, a.whiskeyType, weight);
      bump(distilleryScores, houseOf(bottle), weight);
      for (const tag of bottle.profile || []) bump(flavorScores, String(tag).toLowerCase(), weight * 0.6);
      if (weight > 0 && Number.isFinite(Number(bottle.proof))) proofSamples.push({ proof: Number(bottle.proof), weight });
      signals += Math.abs(weight);
    };

    // Tastings: score 1-10 -> signal centered at 6 (a "fine" pour).
    for (const t of state.tastings || []) {
      const bottle = bottlesById[t.bottleId];
      if (!bottle) continue;
      const w = Math.max(-1, Math.min(1, (Number(t.score) - 6) / 4));
      applyBottle(bottle, w * 1.2);
      for (const tag of t.tags || []) bump(flavorScores, String(tag).toLowerCase(), w * 0.8);
    }

    // Showdown matchups: winners gain, losers shed a little.
    for (const m of state.matchups || []) {
      const a = bottlesById[m.aId];
      const b = bottlesById[m.bId];
      if (!a || !b) continue;
      if (m.winnerId === "tie") {
        continue;
      }
      const winner = m.winnerId === m.aId ? a : b;
      const loser = m.winnerId === m.aId ? b : a;
      applyBottle(winner, 0.5);
      applyBottle(loser, -0.2);
    }

    // Shelf statuses: owned/wishlist positive, passed negative.
    for (const [bottleId, status] of Object.entries(state.statuses || {})) {
      const bottle = bottlesById[bottleId];
      if (!bottle) continue;
      if (status === "owned") applyBottle(bottle, 0.6);
      else if (status === "wishlist") applyBottle(bottle, 0.35);
      else if (status === "passed") applyBottle(bottle, -0.5);
    }

    const proofWeight = proofSamples.reduce((s, p) => s + p.weight, 0);
    const proofPreference = proofWeight > 0
      ? proofSamples.reduce((s, p) => s + p.proof * p.weight, 0) / proofWeight
      : null;

    const interactions = (state.tastings || []).length + (state.matchups || []).length +
      Object.keys(state.statuses || {}).length;

    return {
      styleScores,
      typeScores,
      flavorScores,
      distilleryScores,
      proofPreference,
      signals,
      interactions,
      ready: interactions >= 1
    };
  }

  // A baseline "is this a good, recognized, findable bottle" signal — used so
  // recommendations are sensible from the very first use and gracefully blend
  // with the learned score as it grows.
  function qualityPrior(bottle, deps) {
    const families = deps && deps.families;
    let q = 0;
    if (Number.isFinite(Number(bottle.reviewScore))) q += (Number(bottle.reviewScore) - 80) / 10;
    if (Number.isFinite(Number(bottle.hypeIndex))) q += Math.min(0.4, Number(bottle.hypeIndex) / 220);
    if (families && families.classify(bottle).matched) q += 0.25;
    const sc = bottle.sourceSummary && Number(bottle.sourceSummary.sourceCount);
    if (Number.isFinite(sc)) q += Math.min(0.5, sc * 0.09);
    return q;
  }

  function topEntries(map, n) {
    return Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  // ---- Scoring + recommendation -------------------------------------------

  function scoreFor(bottle, profile, deps) {
    const families = deps && deps.families;
    const a = families ? families.attributes(bottle) : {};
    const house = families ? families.classify(bottle).distillery : bottle.distillery || "";
    let score = 0;
    const reasons = [];

    const styleScore = profile.styleScores[a.style] || 0;
    if (styleScore) {
      score += clampSig(styleScore) * 1.4;
      if (styleScore > 0) reasons.push(simpleStyle(a.style));
    }
    const typeScore = profile.typeScores[a.whiskeyType] || 0;
    if (typeScore) score += clampSig(typeScore) * 0.8;

    const houseScore = profile.distilleryScores[house] || 0;
    if (houseScore > 0) {
      score += clampSig(houseScore) * 0.7;
      reasons.push(house);
    }

    let flavorHits = 0;
    for (const tag of bottle.profile || []) {
      const f = profile.flavorScores[String(tag).toLowerCase()] || 0;
      if (f > 0) {
        score += clampSig(f) * 0.5;
        flavorHits += 1;
      }
    }
    if (flavorHits) reasons.push(flavorHits + " flavor match" + (flavorHits === 1 ? "" : "es"));

    if (Number.isFinite(profile.proofPreference) && Number.isFinite(Number(bottle.proof))) {
      const delta = Math.abs(Number(bottle.proof) - profile.proofPreference);
      score += Math.max(-0.4, 0.4 - delta / 25);
    }

    return { score, reasons: reasons.slice(0, 3) };
  }

  function clampSig(v) {
    return Math.max(-1.5, Math.min(1.5, v));
  }

  function simpleStyle(s) {
    return String(s || "").replace(" bourbon", "").replace(" whiskey", "");
  }

  function recommend(bottles, profile, state, deps) {
    const rec = deps && deps.rec;
    const statuses = (state && state.statuses) || {};
    const candidates = [];
    for (const bottle of bottles) {
      const status = statuses[bottle.id];
      if (status === "owned" || status === "passed") continue;
      const scored = profile.ready ? scoreFor(bottle, profile, deps) : { score: 0, reasons: [] };
      const q = qualityPrior(bottle, deps);
      const total = scored.score + q * 0.6;
      candidates.push({
        bottle,
        score: total,
        learned: scored.score,
        reasons: scored.reasons,
        coldStart: !profile.ready,
        avail: availability(bottle)
      });
    }

    candidates.sort((a, b) => b.score - a.score);

    const families = deps && deps.families;
    const houseOf = (bottle) => (families ? families.classify(bottle).distilleryId : bottle.distillery || "?");
    const houseCount = {};

    const buyNow = [];
    const grails = [];
    const seenNames = new Set();
    for (const c of candidates) {
      const key = String(c.bottle.name).toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (seenNames.has(key)) continue;
      if (c.avail.buyable) {
        if (buyNow.length >= 12) continue;
        // Diversify: no more than 2 from the same distillery in the buy list.
        const house = houseOf(c.bottle);
        if ((houseCount[house] || 0) >= 2) continue;
        houseCount[house] = (houseCount[house] || 0) + 1;
        c.price = realisticPrice(c.bottle, rec);
        c.rationale = buildRationale(c, profile);
        buyNow.push(c);
        seenNames.add(key);
      } else if (profile.ready && c.learned > 0.6 && grails.length < 6) {
        // Only chase grails the palate genuinely earns — never for a cold profile.
        c.price = realisticPrice(c.bottle, rec);
        c.rationale = buildRationale(c, profile);
        grails.push(c);
        seenNames.add(key);
      }
    }

    return { buyNow, grails, profileReady: profile.ready };
  }

  function buildRationale(c, profile) {
    const why = c.coldStart
      ? "a well-regarded, easy-to-find pour to start with"
      : c.reasons.length ? "matches your " + c.reasons.join(", ") : "fits your taste";
    if (c.avail.tier === "shelf") {
      const p = c.price.value ? " around $" + Math.round(c.price.value) : "";
      return "Findable" + p + " — " + why + ".";
    }
    if (c.avail.tier === "allocated") {
      return "Your palate would love it, but it's allocated — " + c.price.caption + ". Chase it; don't count on it.";
    }
    return "A grail for your taste — " + c.price.caption + ". Aspirational, not a shelf buy.";
  }

  // Predict which of two bottles you'll prefer in a blind pour, from your
  // learned palate. Returns null when the profile is thin or it's too close.
  function predictPick(a, b, profile, deps) {
    if (!profile || !profile.ready || !a || !b) return null;
    const sa = scoreFor(a, profile, deps);
    const sb = scoreFor(b, profile, deps);
    const margin = sa.score - sb.score;
    if (Math.abs(margin) < 0.1) return null;
    const winner = margin > 0 ? "a" : "b";
    const reasons = (margin > 0 ? sa.reasons : sb.reasons) || [];
    return {
      winner,
      confidence: Math.abs(margin) > 0.55 ? "confident" : "leaning",
      reason: reasons.length ? "your " + reasons.slice(0, 2).join(" + ") : "your palate so far"
    };
  }

  global.BarrelPalate = {
    availability,
    realisticPrice,
    buildProfile,
    scoreFor,
    recommend,
    predictPick,
    topEntries,
    simpleStyle
  };
})(typeof window !== "undefined" ? window : globalThis);
