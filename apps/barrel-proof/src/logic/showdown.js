(function attachShowdown(global) {
  // Blind head-to-head engine. Turns recorded matchups into Elo ratings for
  // bottles and distilleries, head-to-head pair records, and "upset" detection
  // that surfaces the meaningful results (a value bottle beating a trophy)
  // while a trophy beating a daily pour reads as expected.
  const START_ELO = 1500;
  const K = 32;

  const RARITY_RANK = {
    Unicorn: 5,
    Allocated: 4,
    Limited: 3,
    "Label approval": 2,
    Findable: 1,
    "Source-backed": 1,
    "Multi-source": 1,
    New: 1
  };

  // 0..100 "how stacked is this bottle" — blends hype, rarity, and price.
  function tierScore(bottle) {
    if (!bottle) return 0;
    let score = 0;
    let weight = 0;
    const hype = Number(bottle.hypeIndex);
    if (Number.isFinite(hype)) {
      score += hype;
      weight += 1;
    }
    const rarity = RARITY_RANK[bottle.rarity] || 1;
    score += (rarity / 5) * 100 * 0.6;
    weight += 0.6;
    const price = Number(bottle.msrp) || Number(bottle.fairPrice) || Number(bottle.sourceRetailPrice);
    if (Number.isFinite(price) && price > 0) {
      const p = Math.min(100, Math.max(0, ((Math.log10(price) - 1) / 2) * 100));
      score += p * 0.8;
      weight += 0.8;
    }
    return weight ? Math.round(score / weight) : 0;
  }

  function tierLabel(score) {
    if (score >= 80) return "Trophy";
    if (score >= 60) return "Premium";
    if (score >= 40) return "Mid-shelf";
    if (score >= 20) return "Daily";
    return "Value";
  }

  function matchupOutlook(a, b) {
    const ta = tierScore(a);
    const tb = tierScore(b);
    const gap = ta - tb;
    const absGap = Math.abs(gap);
    let label = "Fair fight";
    if (absGap >= 45) label = "Heavy mismatch";
    else if (absGap >= 22) label = "Clear favorite";
    const favorite = gap === 0 ? null : gap > 0 ? "a" : "b";
    return { ta, tb, gap, absGap, label, favorite };
  }

  function resultFor(matchup) {
    if (!matchup || !matchup.aId || !matchup.bId || matchup.aId === matchup.bId) return null;
    if (matchup.winnerId === "tie") return { sa: 0.5, sb: 0.5 };
    if (matchup.winnerId === matchup.aId) return { sa: 1, sb: 0 };
    if (matchup.winnerId === matchup.bId) return { sa: 0, sb: 1 };
    return null;
  }

  function runElo(items) {
    const ratings = {};
    const record = {};
    const get = (k) => (k in ratings ? ratings[k] : START_ELO);
    const rec = (k) => record[k] || (record[k] = { w: 0, l: 0, t: 0, n: 0, elo: START_ELO, peak: 0, label: "" });
    for (const it of items) {
      const Ra = get(it.aKey);
      const Rb = get(it.bKey);
      const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
      ratings[it.aKey] = Ra + K * (it.sa - Ea);
      ratings[it.bKey] = Rb + K * (it.sb - (1 - Ea));
      const ra = rec(it.aKey);
      const rb = rec(it.bKey);
      ra.n += 1;
      rb.n += 1;
      if (it.sa === 1) {
        ra.w += 1;
        rb.l += 1;
      } else if (it.sa === 0) {
        ra.l += 1;
        rb.w += 1;
      } else {
        ra.t += 1;
        rb.t += 1;
      }
    }
    for (const k in record) record[k].elo = Math.round(get(k));
    return record;
  }

  function compute(matchups, bottlesById) {
    const valid = [];
    for (const m of matchups || []) {
      const r = resultFor(m);
      const a = bottlesById[m.aId];
      const b = bottlesById[m.bId];
      if (!r || !a || !b) continue;
      valid.push({ m, a, b, sa: r.sa, sb: r.sb });
    }

    const bottleRec = runElo(valid.map((v) => ({ aKey: v.m.aId, bKey: v.m.bId, sa: v.sa, sb: v.sb })));
    const bottleStandings = Object.entries(bottleRec)
      .map(([id, r]) => ({ id, name: bottlesById[id] ? bottlesById[id].name : id, bottle: bottlesById[id], ...r }))
      .sort((x, y) => y.elo - x.elo);

    const fam = global.BarrelFamilies;
    const distOf = (bottle) => (fam ? fam.classify(bottle).distillery : bottle.distillery || "Unknown");

    const distItems = [];
    const pairCounts = {};
    for (const v of valid) {
      const da = distOf(v.a);
      const db = distOf(v.b);
      if (!da || !db || da === db) continue;
      distItems.push({ aKey: da, bKey: db, sa: v.sa, sb: v.sb });
      const sorted = [da, db].sort();
      const key = sorted[0] + " || " + sorted[1];
      const p = pairCounts[key] || (pairCounts[key] = { x: sorted[0], y: sorted[1], xw: 0, yw: 0, t: 0, n: 0 });
      p.n += 1;
      const xIsA = da === sorted[0];
      if (v.sa === 0.5) p.t += 1;
      else if ((v.sa === 1) === xIsA) p.xw += 1;
      else p.yw += 1;
    }
    const distRec = runElo(distItems);
    const distStandings = Object.entries(distRec)
      .map(([name, r]) => ({ name, ...r }))
      .sort((x, y) => y.elo - x.elo);

    const pairs = Object.values(pairCounts).sort((a, b) => b.n - a.n);

    // Palate leans: head-to-head between mash-bill styles and whiskey types,
    // derived from the same blind results. Surfaces "you pick wheated over
    // high-rye 70% of the time" — preference signal that ignores brand prestige.
    const attrsOf = (bottle) => (fam ? fam.attributes(bottle) : {});
    const stylePairs = {};
    const typePairs = {};
    const tallyPair = (store, va, vb, sa) => {
      if (!va || !vb || va === vb) return;
      const sorted = [va, vb].sort();
      const key = sorted[0] + " || " + sorted[1];
      const p = store[key] || (store[key] = { x: sorted[0], y: sorted[1], xw: 0, yw: 0, t: 0, n: 0 });
      p.n += 1;
      const xIsA = va === sorted[0];
      if (sa === 0.5) p.t += 1;
      else if ((sa === 1) === xIsA) p.xw += 1;
      else p.yw += 1;
    };
    for (const v of valid) {
      const aa = attrsOf(v.a);
      const ab = attrsOf(v.b);
      tallyPair(stylePairs, aa.style, ab.style, v.sa);
      tallyPair(typePairs, aa.whiskeyType, ab.whiskeyType, v.sa);
    }
    const stylePrefs = Object.values(stylePairs).filter((p) => p.n >= 2).sort((a, b) => b.n - a.n);
    const typePrefs = Object.values(typePairs).filter((p) => p.n >= 2).sort((a, b) => b.n - a.n);

    const upsets = [];
    for (const v of valid) {
      if (v.sa === 0.5) continue;
      const winner = v.sa === 1 ? v.a : v.b;
      const loser = v.sa === 1 ? v.b : v.a;
      const tw = tierScore(winner);
      const tl = tierScore(loser);
      if (tl - tw >= 18) upsets.push({ winner, loser, gap: tl - tw });
    }
    upsets.sort((a, b) => b.gap - a.gap);

    return { total: valid.length, bottleStandings, distStandings, pairs, upsets, stylePrefs, typePrefs };
  }

  global.BarrelShowdown = { tierScore, tierLabel, matchupOutlook, compute, START_ELO };
})(typeof window !== "undefined" ? window : globalThis);
