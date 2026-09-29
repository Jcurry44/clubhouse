(function attachRatings(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BarrelRatings = factory();
  }
})(typeof self !== "undefined" ? self : this, function createRatingsModule() {
  // Explicit flag wins (the Log form and Night flights set it); fall back to the
  // "Blind" context text for tastings logged before the flag existed.
  function isBlindTasting(tasting) {
    if (tasting && typeof tasting.blind === "boolean") return tasting.blind;
    return /blind/i.test(String(tasting && tasting.context || ""));
  }

  function normalizeGuessText(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Did a blind guess name the bottle? Generous matching: the guess naming the
  // bottle (or one of its aliases), or vice versa, counts — "eagle rare" nails
  // "Eagle Rare 10 Year".
  function isGuessCorrect(guess, bottle) {
    const g = normalizeGuessText(guess);
    if (!g || g.length < 3 || !bottle) return false;
    const names = [bottle.name, ...(bottle.aliases || [])].map(normalizeGuessText).filter(Boolean);
    return names.some((name) => name.includes(g) || g.includes(name));
  }

  const STYLE_GUESS_WORDS = {
    "Wheated bourbon": ["wheated", "wheater", "wheat bomb"],
    "High-rye bourbon": ["high rye", "high-rye"],
    "Rye whiskey": ["rye"],
    "Traditional bourbon": []
  };

  // Full verdict with partial credit — because guessing the exact bottle out of
  // a 1,000-bottle shelf is heroic, but calling the right house or style is
  // still real skill. meta = { distillery, style } from the families engine.
  function guessVerdict(guess, bottle, meta) {
    if (isGuessCorrect(guess, bottle)) return { level: "nailed" };
    const g = normalizeGuessText(guess);
    if (!g || g.length < 3 || !bottle) return { level: "miss" };
    const m = meta || {};
    const distillery = normalizeGuessText(m.distillery);
    if (distillery && distillery !== "unknown producer" && (g.includes(distillery) || distillery.includes(g)) && g.length >= 4) {
      return { level: "close", why: "right house — " + m.distillery };
    }
    const styleWords = STYLE_GUESS_WORDS[m.style] || [];
    if (styleWords.some((word) => g.includes(word))) {
      return { level: "close", why: "right style — " + m.style.toLowerCase() };
    }
    return { level: "miss" };
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function average(values) {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  // Your rating record per bottle: sighted vs blind kept separate, plus the
  // delta between them (positive = you score it higher when you can SEE it —
  // the label tax; negative = it overperforms blind).
  function bottleRatings(state, resolveId) {
    const byBottle = {};
    for (const tasting of (state && state.tastings) || []) {
      let id = tasting && tasting.bottleId;
      const score = Number(tasting && tasting.score);
      if (!id || !Number.isFinite(score)) continue;
      // identityLinks resolve duplicate catalog spellings to one canonical bottle.
      if (resolveId) id = resolveId(id) || id;
      const row = byBottle[id] || (byBottle[id] = { sighted: [], blind: [] });
      (isBlindTasting(tasting) ? row.blind : row.sighted).push(score);
    }
    const out = {};
    for (const id of Object.keys(byBottle)) {
      const row = byBottle[id];
      const all = row.sighted.concat(row.blind);
      const sightedAvg = average(row.sighted);
      const blindAvg = average(row.blind);
      out[id] = {
        count: all.length,
        avg: round1(average(all)),
        sightedCount: row.sighted.length,
        sightedAvg: sightedAvg === null ? null : round1(sightedAvg),
        blindCount: row.blind.length,
        blindAvg: blindAvg === null ? null : round1(blindAvg),
        delta: sightedAvg !== null && blindAvg !== null ? round1(sightedAvg - blindAvg) : null
      };
    }
    return out;
  }

  // Bottles where your sighted and blind scores genuinely diverge.
  function blindGaps(ratings, minGap) {
    const threshold = Number.isFinite(minGap) ? minGap : 0.5;
    return Object.keys(ratings || {})
      .map((id) => ({ bottleId: id, ...ratings[id] }))
      .filter((row) => row.delta !== null && Math.abs(row.delta) >= threshold)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }

  // Style categories, evaluated against BarrelFamilies attributes (injected so
  // this module stays dependency-free and testable).
  const CATEGORIES = [
    { key: "all", label: "All" },
    { key: "bourbon", label: "Bourbon" },
    { key: "rye", label: "Rye" },
    { key: "bib", label: "Bottled in Bond" },
    { key: "cask", label: "Cask strength" },
    { key: "wheated", label: "Wheated" },
    { key: "single", label: "Single barrel" },
    { key: "finished", label: "Finished" }
  ];

  function matchesCategory(attrs, key) {
    const a = attrs || {};
    if (key === "all") return true;
    if (key === "bourbon") return a.whiskeyType === "Bourbon";
    if (key === "rye") return a.whiskeyType === "Rye whiskey" || a.isRye === true;
    if (key === "bib") return a.bottledInBond === true;
    if (key === "cask") return a.caskStrength === true;
    if (key === "wheated") return a.style === "Wheated bourbon" || a.isWheatWhiskey === true;
    if (key === "single") return a.singleBarrel === true;
    if (key === "finished") return a.finished === true;
    return false;
  }

  // Leaderboard for one category: your rated bottles of that style, best first.
  function categoryBoard(ratings, bottles, attrFn, key, limit) {
    const byId = new Map((bottles || []).map((bottle) => [bottle.id, bottle]));
    const rows = [];
    for (const id of Object.keys(ratings || {})) {
      const bottle = byId.get(id);
      if (!bottle) continue;
      if (!matchesCategory(attrFn ? attrFn(bottle) : {}, key)) continue;
      rows.push({ bottle, ...ratings[id] });
    }
    rows.sort((a, b) => (b.avg - a.avg) || (b.count - a.count) || String(a.bottle.name).localeCompare(String(b.bottle.name)));
    const summary = {
      count: rows.length,
      avg: rows.length ? round1(rows.reduce((sum, row) => sum + row.avg, 0) / rows.length) : null
    };
    return { rows: rows.slice(0, Number.isFinite(limit) ? limit : 12), summary };
  }

  // Score calibration: where your numbers actually live. Buckets plus the
  // thresholds that turn "a 9" into "your top N%".
  function scoreDistribution(tastings) {
    const scores = (tastings || [])
      .map((tasting) => Number(tasting && tasting.score))
      .filter((score) => Number.isFinite(score))
      .sort((a, b) => a - b);
    if (!scores.length) return null;
    const buckets = [
      { label: "≤6", min: -Infinity, max: 6, count: 0 },
      { label: "6–7", min: 6, max: 7, count: 0 },
      { label: "7–8", min: 7, max: 8, count: 0 },
      { label: "8–9", min: 8, max: 9, count: 0 },
      { label: "9+", min: 9, max: Infinity, count: 0 }
    ];
    for (const score of scores) {
      const bucket = buckets.find((b) => score > b.min && score <= b.max) || buckets[buckets.length - 1];
      bucket.count += 1;
    }
    const at = (p) => scores[Math.min(scores.length - 1, Math.floor(p * scores.length))];
    return {
      count: scores.length,
      median: round1(at(0.5)),
      p90: round1(at(0.9)),
      max: scores[scores.length - 1],
      buckets,
      // share of pours at or above a given score — "a 9.0 is your top X%"
      topShare: (score) => round1((scores.filter((s) => s >= score).length / scores.length) * 100)
    };
  }

  // Where your scores and your blind head-to-head record disagree: you RATE one
  // bottle higher, but you PICKED the other when they faced off in Showdown.
  function ratingConflicts(ratings, matchups, bottlesById) {
    const record = new Map();
    for (const matchup of matchups || []) {
      if (!matchup || !matchup.aId || !matchup.bId) continue;
      if (matchup.winnerId !== matchup.aId && matchup.winnerId !== matchup.bId) continue;
      const [x, y] = [matchup.aId, matchup.bId].sort();
      const key = x + "|" + y;
      const row = record.get(key) || { x, y, xWins: 0, yWins: 0 };
      if (matchup.winnerId === x) row.xWins += 1;
      else row.yWins += 1;
      record.set(key, row);
    }
    const conflicts = [];
    for (const row of record.values()) {
      const rx = (ratings || {})[row.x];
      const ry = (ratings || {})[row.y];
      if (!rx || !ry) continue;
      const gap = rx.avg - ry.avg;
      // conflict = meaningfully higher-rated bottle is LOSING the head-to-heads
      if (gap >= 0.4 && row.yWins > row.xWins) {
        conflicts.push({ ratedHigher: row.x, pickedMore: row.y, ratedGap: round1(gap), record: row.yWins + "–" + row.xWins });
      } else if (-gap >= 0.4 && row.xWins > row.yWins) {
        conflicts.push({ ratedHigher: row.y, pickedMore: row.x, ratedGap: round1(-gap), record: row.xWins + "–" + row.yWins });
      }
    }
    conflicts.sort((a, b) => b.ratedGap - a.ratedGap);
    return bottlesById
      ? conflicts.filter((c) => bottlesById.get(c.ratedHigher) && bottlesById.get(c.pickedMore))
      : conflicts;
  }

  // The kill log distilled: for each finished bottle, the LATEST verdict wins
  // (you can finish a bottle, rebuy it, and finish it again with a new answer).
  function rebuyBoard(killLog) {
    const latest = new Map();
    for (const entry of killLog || []) {
      if (entry && entry.bottleId) latest.set(entry.bottleId, entry);
    }
    const rows = [...latest.values()];
    return {
      rebuys: rows.filter((entry) => entry.rebuy === true),
      enoughs: rows.filter((entry) => entry.rebuy === false),
      unanswered: rows.filter((entry) => entry.rebuy !== true && entry.rebuy !== false),
      finishedCount: rows.length
    };
  }

  return {
    CATEGORIES,
    average,
    blindGaps,
    bottleRatings,
    categoryBoard,
    guessVerdict,
    isBlindTasting,
    isGuessCorrect,
    matchesCategory,
    ratingConflicts,
    rebuyBoard,
    scoreDistribution
  };
});
