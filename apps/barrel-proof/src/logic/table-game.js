(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BarrelTableGame = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const FORMAT = "paired-table-v1";
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const text = (value, size = 140) => String(value || "").trim().slice(0, size);
  function cleanEntry(input, slot) {
    const e = input || {};
    const proof = e.proof === "" || e.proof == null ? null : Number(e.proof);
    return {
      id: text(e.id, 100) || "slot-" + slot, slot,
      bottleId: text(e.bottleId, 140), name: text(e.name) || "Bottle " + slot,
      release: text(e.release), proof: Number.isFinite(proof) && proof > 0 && proof <= 200 ? proof : null,
      distillery: text(e.distillery), brand: text(e.brand), sourceUrl: /^https?:\/\//i.test(e.sourceUrl || "") ? text(e.sourceUrl, 1000) : ""
    };
  }
  function create(options = {}) {
    return { format: FORMAT, id: options.id || "table-" + Date.now(), createdAt: new Date().toISOString(),
      status: "setup", teams: [0, 1].map((i) => ({ id: "team-" + i, name: text((options.teams || [])[i], 40) || "Team " + (i + 1) })),
      guessOrder: options.guessOrder === "alternate" ? "alternate" : "team",
      entries: [], rounds: [], currentRound: null };
  }
  function drawPair(entries, random = Math.random) {
    if (entries.length < 2) throw new Error("Add at least two bottles to play.");
    const index = (length) => Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
    const first = index(entries.length);
    let second = index(entries.length - 1);
    if (second >= first) second += 1;
    return [entries[first], entries[second]].map((entry, i) => ({
      glass: i ? "B" : "A", answer: copy(entry), guesses: [], resolved: false, points: 0
    }));
  }
  function startRound(game, random) {
    if (!game || game.format !== FORMAT || game.currentRound || game.status === "complete") return false;
    if (game.entries.length < 2 || new Set(game.entries.map((e) => e.id)).size !== game.entries.length) return false;
    if (new Set(game.entries.map((e) => norm(e.name + " " + e.release))).size !== game.entries.length) return false;
    game.currentRound = {
      id: game.id + "-round-" + (game.rounds.length + 1), number: game.rounds.length + 1,
      phase: "pour-0", createdAt: new Date().toISOString(),
      guessOrder: game.guessOrder === "alternate" ? "alternate" : "team",
      turns: game.teams.map((team, index) => ({ teamId: team.id, pouringTeamId: game.teams[1 - index].id, pours: drawPair(game.entries, random) }))
    };
    game.status = "playing";
    return true;
  }
  function confirmPour(game, expectedPhase) {
    const round = game && game.currentRound;
    if (!round || round.phase !== expectedPhase || !/^pour-[01]$/.test(expectedPhase)) return false;
    round.phase = expectedPhase === "pour-0" ? "pour-1" : "guess-0";
    return true;
  }
  function submitGuess(game, options) {
    const round = game && game.currentRound;
    const { teamId, glass, entryId, freeText, expectedAttempt, roundId } = options || {};
    const step = guessStep(round);
    if (!step || (roundId && round.id !== roundId)) return false;
    const turn = round.turns[step.teamIndex];
    if (turn.teamId !== teamId || !step.glasses.includes(glass)) return false;
    const pour = turn.pours.find((p) => p.glass === glass);
    if (!pour || pour.resolved || pour.guesses.length >= 3 || expectedAttempt !== pour.guesses.length + 1) return false;
    const selected = game.entries.find((e) => e.id === entryId);
    if (!selected && !text(freeText)) return false;
    if (selected && pour.guesses.some((g) => g.entry && g.entry.id === selected.id)) return false;
    const correct = Boolean(selected && selected.id === pour.answer.id);
    pour.guesses.push({ attempt: expectedAttempt, entry: selected ? copy(selected) : null, text: selected ? selected.name : text(freeText), correct });
    pour.resolved = correct || pour.guesses.length === 3;
    pour.points = correct ? 4 - pour.guesses.length : 0;
    return true;
  }
  function finishTurn(game) {
    const round = game && game.currentRound;
    const step = guessStep(round);
    if (!step) return false;
    const turn = round.turns[step.teamIndex];
    if (!turn.pours.filter((p) => step.glasses.includes(p.glass)).every((p) => p.resolved)) return false;
    round.phase = step.index + 1 < step.total ? "guess-" + (step.index + 1) : "ready-reveal";
    return true;
  }
  function guessStep(round) {
    if (!round || !/^guess-[0-3]$/.test(round.phase)) return null;
    const plan = round.guessOrder === "alternate"
      ? [{ teamIndex: 0, glasses: ["A"] }, { teamIndex: 1, glasses: ["A"] }, { teamIndex: 0, glasses: ["B"] }, { teamIndex: 1, glasses: ["B"] }]
      : [{ teamIndex: 0, glasses: ["A", "B"] }, { teamIndex: 1, glasses: ["A", "B"] }];
    const index = Number(round.phase.slice(-1));
    return plan[index] ? { ...plan[index], index, total: plan.length } : null;
  }
  function reveal(game) {
    const round = game && game.currentRound;
    if (!round || round.phase !== "ready-reveal" || !round.turns.every((t) => t.pours.every((p) => p.resolved))) return false;
    round.phase = "recap";
    return true;
  }
  function closeRound(game) {
    if (!game || !game.currentRound || game.currentRound.phase !== "recap") return false;
    game.rounds.push(copy(game.currentRound));
    game.currentRound = null;
    return true;
  }
  function completedRounds(game) {
    return (game.rounds || []).concat(game.currentRound && game.currentRound.phase === "recap" ? [game.currentRound] : []);
  }
  function totals(game) {
    return game.teams.map((team) => ({ ...team, points: completedRounds(game).reduce((sum, round) =>
      sum + round.turns.filter((t) => t.teamId === team.id).reduce((n, turn) => n + turn.pours.reduce((p, pour) => p + pour.points, 0), 0), 0) }));
  }
  function proofRange(proof) {
    if (!Number.isFinite(proof) || proof <= 0) return "";
    return proof < 100 ? "Under 100 proof" : proof < 115 ? "100–114.9 proof" : proof < 140 ? "115–139.9 proof" : "140+ proof";
  }
  function insights(answer, guess) {
    if (!answer || !guess) return [];
    const notes = [];
    if (answer.brand && guess.brand && norm(answer.brand) === norm(guess.brand)) notes.push({ kind: "brand", label: "Same brand family", detail: answer.brand });
    if (answer.distillery && guess.distillery && norm(answer.distillery) === norm(guess.distillery)) notes.push({ kind: "house", label: "Same house", detail: answer.distillery });
    if (Number.isFinite(answer.proof) && Number.isFinite(guess.proof)) {
      const delta = Math.round(Math.abs(answer.proof - guess.proof) * 10) / 10;
      if (delta <= 5) notes.push({ kind: "proof", label: delta === 0 ? "Same proof" : delta + " proof apart", detail: guess.proof + " guessed · " + answer.proof + " actual" });
      else if (proofRange(answer.proof) === proofRange(guess.proof)) notes.push({ kind: "proof", label: "Same proof range", detail: proofRange(answer.proof) });
    }
    return notes;
  }
  function summary(game) {
    const rounds = completedRounds(game);
    return game.teams.map((team) => {
      const pours = rounds.flatMap((r) => r.turns.filter((t) => t.teamId === team.id).flatMap((t) => t.pours));
      const misses = pours.flatMap((p) => p.guesses.filter((g) => !g.correct).map((g) => ({ answer: p.answer, guess: g.entry })));
      const known = misses.filter((m) => m.answer.distillery && m.guess && m.guess.distillery);
      const confusion = new Map();
      for (const m of misses.filter((m) => m.guess)) {
        const key = m.answer.id + ":" + m.guess.id;
        const row = confusion.get(key) || { answer: m.answer, guess: m.guess, count: 0 };
        row.count++; confusion.set(key, row);
      }
      return { teamId: team.id, name: team.name, pours: pours.length, correct: pours.filter((p) => p.points > 0).length,
        firstTry: pours.filter((p) => p.points === 3).length, familyComparable: known.length,
        sameHouse: known.filter((m) => norm(m.answer.distillery) === norm(m.guess.distillery)).length,
        confusion: [...confusion.values()].sort((a, b) => b.count - a.count)[0] || null };
    });
  }
  function importLineup(value) {
    const rows = Array.isArray(value) ? value : value && (value.entries || value.lineup);
    if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new Error("Choose a lineup with 1–100 bottles.");
    if (rows.some((row) => !row || typeof row !== "object" || !text(row.name))) throw new Error("Every bottle needs a name.");
    // The current lineup owns its IDs. Imports are reviewed before fresh slot IDs are assigned.
    return rows.map((e, i) => cleanEntry({ ...e, id: "import-" + (i + 1) }, i + 1));
  }
  return { FORMAT, create, cleanEntry, drawPair, startRound, confirmPour, submitGuess, finishTurn, guessStep, reveal, closeRound,
    completedRounds, totals, proofRange, insights, summary, importLineup, norm };
});
