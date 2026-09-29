(function attachNight(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BarrelNight = factory();
  }
})(typeof self !== "undefined" ? self : this, function createNightModule() {
  function average(values) {
    const clean = values.filter((value) => Number.isFinite(value));
    if (!clean.length) return null;
    return clean.reduce((sum, value) => sum + value, 0) / clean.length;
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function numOrNull(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function clampScore(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(10, n));
  }

  // Glass labels A, B, C ... so tasters score by glass, never by bottle name.
  function glassLetters(count) {
    const out = [];
    for (let i = 0; i < count; i += 1) out.push(String.fromCharCode(65 + (i % 26)));
    return out;
  }

  function uniqueNames(names) {
    const seen = new Set();
    const out = [];
    for (const raw of names || []) {
      const name = String(raw || "").trim().slice(0, 40);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }

  function defaultShuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function createTastingGame(options) {
    const opts = options || {};
    const names = uniqueNames(opts.teams || ["Team One", "Team Two"]);
    const teams = (names.length >= 2 ? names.slice(0, 2) : ["Team One", "Team Two"])
      .map((name, index) => ({ id: "team-" + (index + 1), name, points: 0 }));
    return {
      id: opts.id || "game",
      createdAt: opts.createdAt || "",
      status: "setup",
      teams,
      entries: [],
      rounds: [],
      currentRound: null
    };
  }

  function drawGameRound(game, guessingTeamId, random) {
    if (!game || !Array.isArray(game.entries)) return null;
    const played = new Set((game.rounds || []).map((round) => round.slot));
    const choices = game.entries.filter((entry) => !played.has(entry.slot));
    if (!choices.length) return null;
    const pick = choices[Math.floor((typeof random === "function" ? random() : Math.random()) * choices.length)] || choices[0];
    const team = (game.teams || []).find((item) => item.id === guessingTeamId) || (game.teams || [])[0];
    if (!team) return null;
    game.status = "playing";
    game.currentRound = {
      id: "round-" + Date.now(),
      slot: pick.slot,
      entryId: pick.id,
      guessingTeamId: team.id,
      attempts: [],
      points: 0,
      revealed: false
    };
    return game.currentRound;
  }

  function addGameGuess(game, text) {
    const round = game && game.currentRound;
    if (!round || round.revealed || (round.attempts || []).length >= 3) return null;
    const guess = String(text || "").trim().slice(0, 100);
    if (!guess) return null;
    round.attempts.push(guess);
    return round;
  }

  function resolveGameRound(game, correct) {
    const round = game && game.currentRound;
    if (!round || round.revealed) return null;
    const attempts = (round.attempts || []).length;
    if (correct && !attempts) return null;
    round.points = correct ? Math.max(1, 4 - attempts) : 0;
    round.correct = Boolean(correct);
    round.revealed = true;
    const team = (game.teams || []).find((item) => item.id === round.guessingTeamId);
    if (team) team.points = Number(team.points || 0) + round.points;
    return round;
  }

  function closeGameRound(game) {
    if (!game || !game.currentRound || !game.currentRound.revealed) return false;
    game.rounds = (game.rounds || []).concat(game.currentRound);
    game.currentRound = null;
    return true;
  }

  function gameEntry(game, round) {
    return (game && game.entries || []).find((entry) => entry.id === (round && round.entryId)) || null;
  }

  function remainingGameSlots(game) {
    const played = new Set(((game && game.rounds) || []).map((round) => round.slot));
    return ((game && game.entries) || []).filter((entry) => !played.has(entry.slot)).length;
  }

  // Turn a chosen set of bottles + tasters into a blind flight: each bottle is
  // assigned to a shuffled glass letter so the pour order hides identity.
  function createFlight(bottles, tasters, options) {
    const opts = options || {};
    const shuffle = typeof opts.shuffle === "function" ? opts.shuffle : defaultShuffle;
    const clean = (bottles || []).filter((bottle) => bottle && bottle.id);
    const shuffled = shuffle(clean);
    const letters = glassLetters(shuffled.length);
    return {
      id: opts.id || "flight",
      createdAt: opts.createdAt || "",
      status: "scoring",
      pours: shuffled.map((bottle, index) => ({
        glass: letters[index],
        bottleId: bottle.id,
        bottleName: bottle.name
      })),
      tasters: uniqueNames(tasters),
      scores: {}
    };
  }

  function setScore(flight, glass, taster, score) {
    if (!flight) return flight;
    if (!flight.scores || typeof flight.scores !== "object") flight.scores = {};
    if (!flight.scores[glass] || typeof flight.scores[glass] !== "object") flight.scores[glass] = {};
    const value = clampScore(score);
    if (value === null) delete flight.scores[glass][taster];
    else flight.scores[glass][taster] = value;
    return flight;
  }

  // The room's guess for a glass — the parlor game inside the flight.
  function setGuess(flight, glass, text) {
    if (!flight) return flight;
    if (!flight.guesses || typeof flight.guesses !== "object") flight.guesses = {};
    const clean = String(text == null ? "" : text).trim().slice(0, 80);
    if (!clean) delete flight.guesses[glass];
    else flight.guesses[glass] = clean;
    return flight;
  }

  function scoredCount(flight) {
    let count = 0;
    const scores = (flight && flight.scores) || {};
    for (const glass of Object.keys(scores)) count += Object.keys(scores[glass]).length;
    return count;
  }

  function expectedScores(flight) {
    const pours = (flight && flight.pours) || [];
    const tasters = (flight && flight.tasters) || [];
    return pours.length * Math.max(1, tasters.length);
  }

  function canReveal(flight) {
    return Boolean(flight) && (flight.pours || []).length >= 2 && scoredCount(flight) > 0;
  }

  // Score one glass across all tasters.
  function glassAverage(flight, glass) {
    const row = ((flight && flight.scores) || {})[glass] || {};
    return numOrNull(round1(average(Object.values(row)) || NaN));
  }

  // Reveal: map glasses back to bottles, rank by the room's average, and surface a
  // headline (value win, hype upset, etc). `lookup(bottleId)` supplies price/hype.
  function flightResults(flight, lookup) {
    const rows = ((flight && flight.pours) || []).map((pour) => {
      const row = ((flight.scores || {})[pour.glass]) || {};
      const scores = Object.keys(row)
        .map((taster) => ({ taster, score: row[taster] }))
        .filter((entry) => Number.isFinite(entry.score))
        .sort((a, b) => b.score - a.score);
      const avg = scores.length ? round1(average(scores.map((s) => s.score))) : null;
      const info = (lookup && lookup(pour.bottleId)) || {};
      return {
        glass: pour.glass,
        bottleId: pour.bottleId,
        bottleName: pour.bottleName,
        guess: ((flight && flight.guesses) || {})[pour.glass] || "",
        scores,
        average: avg,
        refPrice: numOrNull(info.refPrice),
        hype: numOrNull(info.hype)
      };
    });
    const ranked = rows.filter((r) => r.average !== null).sort((a, b) => b.average - a.average);
    const unscored = rows.filter((r) => r.average === null);
    return {
      ranked,
      unscored,
      headline: buildHeadline(ranked),
      tasters: (flight && flight.tasters) || []
    };
  }

  function buildHeadline(ranked) {
    if (ranked.length < 2) return ranked.length ? ranked[0].bottleName + " stood alone." : "";
    const winner = ranked[0];
    const last = ranked[ranked.length - 1];

    const priced = ranked.filter((r) => Number.isFinite(r.refPrice));
    if (priced.length >= 2) {
      const cheapest = priced.reduce((a, b) => (b.refPrice < a.refPrice ? b : a));
      const dearest = priced.reduce((a, b) => (b.refPrice > a.refPrice ? b : a));
      if (cheapest.bottleId === winner.bottleId && cheapest.refPrice < dearest.refPrice) {
        return "Value win — the cheapest pour in the flight took first place blind.";
      }
      if (dearest.bottleId === last.bottleId && dearest.refPrice > cheapest.refPrice) {
        return "Upset — the priciest pour finished last blind.";
      }
    }

    const hyped = ranked.filter((r) => Number.isFinite(r.hype));
    if (hyped.length >= 2) {
      const mostHyped = hyped.reduce((a, b) => (b.hype > a.hype ? b : a));
      if (mostHyped.bottleId === last.bottleId && mostHyped.hype >= 80) {
        return "Hype check — the most-hyped bottle landed at the bottom blind.";
      }
      if (mostHyped.bottleId === winner.bottleId && mostHyped.hype >= 80) {
        return "Hype confirmed — the most-hyped bottle actually won blind.";
      }
    }

    return winner.bottleName + " took the flight.";
  }

  // A group-chat-ready recap of the flight. Pure text — works with the native
  // share sheet or the clipboard.
  function buildRecapText(flight, lookup, dateLabel) {
    const results = flightResults(flight, lookup);
    const lines = [];
    lines.push("🥃 Blind Flight" + (dateLabel ? " · " + dateLabel : ""));
    if (results.tasters.length) lines.push("Tasters: " + results.tasters.join(", "));
    lines.push("");
    results.ranked.forEach((row, index) => {
      const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : (index + 1) + ".";
      let line = medal + " " + row.bottleName + " — " + row.average.toFixed(1) + " (Glass " + row.glass + ")";
      if (row.guess) line += " · guessed “" + row.guess + "”";
      lines.push(line);
    });
    if (results.headline) {
      lines.push("");
      lines.push(results.headline);
    }
    lines.push("");
    lines.push("— scored blind with Barrel Proof");
    return lines.join("\n");
  }

  return {
    average,
    buildRecapText,
    canReveal,
    clampScore,
    createFlight,
    createTastingGame,
    drawGameRound,
    addGameGuess,
    resolveGameRound,
    closeGameRound,
    gameEntry,
    remainingGameSlots,
    expectedScores,
    flightResults,
    glassAverage,
    glassLetters,
    scoredCount,
    setGuess,
    setScore,
    uniqueNames
  };
});
