(function (global) {
  "use strict";
  const engine = global.BarrelTableGame;
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const points = (n) => n + (n === 1 ? " point" : " points");
  const label = (e) => e.name + (e.release ? " · " + e.release : "");
  const button = (action, text, extra = "", style = "primary") => `<button type="button" class="tt-button tt-${style}" data-action="tt-${action}" ${extra}>${text}</button>`;
  const lockIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>`;
  const glassIcon = `<svg viewBox="0 0 70 80" aria-hidden="true"><path d="M12 12h46l-5 52a8 8 0 0 1-8 7H25a8 8 0 0 1-8-7Z"/><path d="M16 42h38M25 21l3 36"/></svg>`;
  function ui(ctx) { return ctx.ui.table || (ctx.ui.table = { query: "", glass: "A", guessQuery: "", selected: "", open: "", preview: null }); }
  function game(ctx) { return ctx.state.activeTastingGame; }
  function active(ctx) { return game(ctx) && game(ctx).format === engine.FORMAT; }
  function name(g, id) { return (g.teams.find((t) => t.id === id) || {}).name || "Team"; }
  function key(g) { return g.currentRound ? g.currentRound.id + ":" + g.currentRound.phase : ""; }
  function conceal(ctx) { const s = ui(ctx); s.open = ""; s.selected = ""; s.guessQuery = ""; s.glass = "A"; s.message = ""; }
  function bindPrivacy(ctx, helpers) {
    const hide = () => {
      if (active(ctx) && ctx.ui.tab === "night" && ui(ctx).open) { conceal(ctx); helpers.render(ctx); }
    };
    if (global.addEventListener) { global.addEventListener("blur", hide); global.addEventListener("pagehide", hide); global.addEventListener("pageshow", (e) => { if (e.persisted) hide(); }); }
    if (global.document) global.document.addEventListener("visibilitychange", () => { if (global.document.hidden) hide(); });
  }
  function snapshot(bottle) {
    const family = global.BarrelFamilies && global.BarrelFamilies.classify(bottle);
    const proof = Number(bottle.proof);
    return { bottleId: bottle.id, name: bottle.name, release: "", proof: Number.isFinite(proof) && proof > 0 ? proof : null,
      distillery: family && family.matched ? family.distillery : (bottle.distillery && !/unknown/i.test(bottle.distillery) ? bottle.distillery : ""),
      brand: family && family.matched ? family.brand : "", sourceUrl: "" };
  }
  function addEntry(g, value) {
    if (g.status !== "setup" || g.entries.length >= 100) return;
    g.entries.push(engine.cleanEntry({ ...value, id: "entry-" + Date.now() + "-" + g.entries.length }, g.entries.length + 1));
  }
  function shell(g, body, viewing = false) {
    const round = g.currentRound;
    const stage = g.status === "setup" ? "The lineup" : viewing || g.status === "complete" ? "Night recap" : round ? "Round " + round.number : "Between rounds";
    return `<div class="tt-shell"><header class="tt-top"><div class="tt-wordmark"><span class="tt-emblem">BP</span><span>Barrel Proof<small>TASTING TABLE</small></span></div>${button("exit", viewing ? "Close recap" : "Back to cabinet", "", "text")}</header><div class="tt-meta"><span>${esc(stage)}</span><span>${g.entries.length} bottles · 2 vs 2</span></div>${scoreboard(g)}<main class="tt-main">${body}</main><footer class="tt-footer"><span>3 / 2 / 1 points per bottle</span><span>Every bottle returns each round</span></footer></div>`;
  }
  function scoreboard(g) {
    return `<div class="tt-scoreboard" aria-label="Team scores">${engine.totals(g).map((t, i) => `<div class="tt-score tt-team-${i}"><span class="tt-team-dot"></span><span class="tt-team-name">${esc(t.name)}</span><strong>${t.points}<small>PTS</small></strong></div>`).join("")}</div>`;
  }
  function startCard() {
    return `<section class="tt-start"><p class="tt-eyebrow">Four friends. One table.</p><h2>Trust your palate.</h2><p>Two teams, two blind pours each. Three guesses to call your bottle.</p><div class="tt-start-actions">${button("new", "Set up tonight’s game <span aria-hidden=\"true\">↗</span>")}<span>Private handoffs · live scoring · round recaps</span></div></section>`;
  }
  function render(ctx) {
    const s = ui(ctx);
    const archived = s.archiveId && (ctx.state.tastingGames || []).find((g) => g.id === s.archiveId);
    const g = archived || game(ctx);
    if (!g) return "";
    if (archived) return shell(g, nightRecap(g, true), true);
    if (g.status === "setup") return shell(g, setup(ctx, g));
    const r = g.currentRound;
    if (!r) return shell(g, between(g));
    if (r.phase === "recap") return shell(g, roundRecap(g));
    if (r.phase === "ready-reveal") return shell(g, `<section class="tt-center"><div class="tt-orbit">${glassIcon}</div><p class="tt-eyebrow">All four glasses are locked</p><h1>The moment of proof.</h1><p>Bring everyone back to the screen.<br>The bottles, points, and close calls are ready.</p>${button("reveal", "Reveal the round")}</section>`);
    if (s.open !== key(g)) return shell(g, curtain(g));
    return shell(g, r.phase.startsWith("pour-") ? pourScreen(g) : guessScreen(ctx, g));
  }
  function setup(ctx, g) {
    const s = ui(ctx);
    const teams = g.teams.map((t, i) => `<label class="tt-field"><span>Team ${i + 1}</span><input id="tt-team-${i}" data-tt-team="${t.id}" value="${esc(t.name)}" maxlength="40"></label>`).join("");
    const rows = g.entries.map((e) => `<div class="tt-lineup-row"><span class="tt-slot">${String(e.slot).padStart(2, "0")}</span><details><summary><strong>${esc(e.name)}</strong><span>${esc(e.release || "Add batch or pick details")}${e.proof ? " · " + e.proof + " proof" : ""}</span></summary><div class="tt-entry-edit"><label class="tt-field"><span>Bottle name</span><input data-tt-entry="${e.id}" data-tt-field="name" value="${esc(e.name)}" maxlength="140"></label><label class="tt-field"><span>Exact batch / release / pick</span><input data-tt-entry="${e.id}" data-tt-field="release" value="${esc(e.release)}" maxlength="140" placeholder="e.g. C923, 2023, or store pick"></label><div class="tt-two-fields"><label class="tt-field"><span>Proof, if known</span><input type="number" min="1" max="200" step="0.1" data-tt-entry="${e.id}" data-tt-field="proof" value="${e.proof || ""}"></label><label class="tt-field"><span>House / distillery, if known</span><input data-tt-entry="${e.id}" data-tt-field="distillery" value="${esc(e.distillery)}" maxlength="140"></label></div></div></details>${button("remove", "×", `data-entry="${e.id}" aria-label="Remove bottle ${e.slot}"`, "icon")}</div>`).join("");
    return `<div class="tt-heading"><p class="tt-eyebrow">Make it your table</p><h1>Set the lineup.</h1><p>Number your bottles from left to right. Those numbers stay fixed all night.</p></div><div class="tt-setup-grid"><section class="tt-panel"><div class="tt-two-fields">${teams}</div>${orderControl(g)}<label class="tt-field tt-search"><span>Find a bottle</span><input id="tt-search" type="search" value="${esc(s.query)}" autocomplete="off" placeholder="Bottle, distillery, or batch…"></label><div id="tt-search-results">${catalogResults(ctx)}</div><div class="tt-tools"><details><summary>Add a bottle by name</summary><p class="tt-hint">Missing from the catalog? Add the exact label now; fill in the facts when known.</p><label class="tt-field"><span>Bottle name</span><input id="tt-manual" value="${esc(s.manual || "")}" maxlength="140" placeholder="Exact bottle name"></label><label class="tt-field"><span>Batch / release / pick</span><input id="tt-release" value="${esc(s.manualRelease || "")}" maxlength="140" placeholder="Optional release detail"></label>${button("manual", "Add to lineup", "", "secondary")}</details><details><summary>Paste or import a lineup</summary><p class="tt-hint">One bottle per line, or import a researched lineup file. Review before adding.</p><textarea id="tt-bulk" rows="4" placeholder="One bottle per line">${esc(s.bulk || "")}</textarea><div class="tt-inline-actions">${button("preview", "Review names", "", "secondary")}<label class="tt-button tt-secondary">Import file<input id="tt-import" type="file" accept=".json,application/json" class="tt-file"></label></div></details></div>${s.preview ? preview(s.preview) : ""}</section><section class="tt-panel tt-lineup-panel"><div class="tt-panel-title"><h2>Tonight’s bottles</h2><span class="tt-count">${g.entries.length}</span></div><div class="tt-lineup">${rows || `<div class="tt-empty">${glassIcon}<h3>The table is yours.</h3><p>Find your first bottle or paste the lineup.<br>You only need two to start.</p></div>`}</div><div class="tt-setup-bottom">${button("start", "Draw round one <span aria-hidden=\"true\">→</span>", g.entries.length < 2 ? "disabled" : "")}<p class="tt-hint">Two different bottles per team. Overlap between teams is allowed.</p></div></section></div>${s.message ? `<p class="tt-notice" role="status">${esc(s.message)}</p>` : ""}`;
  }
  function orderControl(g, nextRound = false) {
    const alternating = g.guessOrder === "alternate";
    return `<fieldset class="tt-order"><legend>${nextRound ? "Next round’s guessing order" : "Guessing order"}</legend><div class="tt-order-options">${[
      { id: "team", selected: !alternating, title: "Team at a time", detail: "Finish both glasses, then swap." },
      { id: "alternate", selected: alternating, title: "Alternate bottles", detail: "Finish one glass, then swap." }
    ].map((mode) => `<button type="button" class="${mode.selected ? "is-selected" : ""}" data-action="tt-order" data-order="${mode.id}" aria-pressed="${mode.selected}"><strong>${mode.title}</strong><span>${mode.detail}</span></button>`).join("")}</div><p>${alternating ? `${esc(g.teams[0].name)} A → ${esc(g.teams[1].name)} A → ${esc(g.teams[0].name)} B → ${esc(g.teams[1].name)} B` : `${esc(g.teams[0].name)} A + B → ${esc(g.teams[1].name)} A + B`}</p></fieldset>`;
  }
  function catalogResults(ctx) {
    const query = engine.norm(ui(ctx).query);
    if (query.length < 2) return `<p class="tt-hint">Search the catalog, or add any bottle by name below.</p>`;
    const results = ctx.bottles.filter((b) => engine.norm(b._searchText || b.name).includes(query)).slice(0, 6);
    return `<div class="tt-search-list">${results.map((b) => `<button type="button" data-action="tt-add" data-bottle="${esc(b.id)}"><span><strong>${esc(b.name)}</strong><small>${esc(b.distillery || b.producer || "")}${b.proof ? " · " + b.proof + " proof" : ""}</small></span><span aria-hidden="true">+</span></button>`).join("") || `<p class="tt-hint">No exact fit? Add the bottle by name below.</p>`}</div>`;
  }
  function preview(entries) {
    return `<section class="tt-preview"><p class="tt-eyebrow">Review ${entries.length} bottle${entries.length === 1 ? "" : "s"}</p><div class="tt-preview-list">${entries.map((e, i) => `<div><span>${i + 1}</span><strong>${esc(label(e))}</strong><small>${e.proof ? e.proof + " proof" : "Proof not supplied"}</small></div>`).join("")}</div><div class="tt-inline-actions">${button("accept-import", "Add reviewed bottles")}${button("cancel-import", "Cancel", "", "text")}</div></section>`;
  }
  function curtain(g) {
    const r = g.currentRound, idx = Number(r.phase.slice(-1));
    const pouring = r.phase.startsWith("pour-");
    const step = pouring ? null : engine.guessStep(r);
    const turn = r.turns[pouring ? idx : step.teamIndex];
    const who = name(g, pouring ? turn.pouringTeamId : turn.teamId);
    return `<section class="tt-center tt-curtain"><div class="tt-lock">${lockIcon}</div><p class="tt-eyebrow">Private handoff · ${pouring ? "pour " + (idx + 1) + " of 2" : "tasting " + (step.index + 1) + " of " + step.total}</p><h1>Pass to<br><em>${esc(who)}.</em></h1><p>${pouring ? `You’re pouring for <strong>${esc(name(g, turn.teamId))}</strong>.<br>Keep the next screen with your team.` : step.glasses.length === 1 ? `You’re guessing <strong>glass ${step.glasses[0]}</strong>.<br>Up to three guesses for this bottle.` : `Your glasses are labeled A and B.<br>Your team gets three guesses for each.`}</p>${button("open", pouring ? "We’re pouring · show our pair" : "We’re ready · start guessing", `data-phase="${r.phase}"`)}<span class="tt-sealed">${lockIcon} Bottle numbers and names are hidden</span></section>`;
  }
  function pourScreen(g) {
    const r = g.currentRound, turn = r.turns[Number(r.phase.slice(-1))];
    return `<section class="tt-pour-screen"><div class="tt-heading"><p class="tt-eyebrow">${esc(name(g, turn.pouringTeamId))} · eyes only</p><h1>Pour for ${esc(name(g, turn.teamId))}.</h1><p>Match each table bottle to the glass below. Keep labels out of sight.</p></div><div class="tt-pour-grid">${turn.pours.map((p) => `<article class="tt-pour-card"><div class="tt-glass-label">GLASS <b>${p.glass}</b></div><span class="tt-bottle-caption">TABLE BOTTLE</span><strong class="tt-bottle-number">${String(p.answer.slot).padStart(2, "0")}</strong><h2>${esc(p.answer.name)}</h2><p>${esc(p.answer.release || "")}</p></article>`).join("")}</div><div class="tt-handoff-bar">${button("poured", `${lockIcon} Poured · hide & pass phone`, `data-phase="${r.phase}"`)}${button("hide", "Hide now", "", "text")}<p>The next screen contains no bottle numbers or names.</p></div></section>`;
  }
  function guessChoices(g, query, pour, selected) {
    const q = engine.norm(query);
    return g.entries.filter((e) => !q || engine.norm(label(e)).includes(q)).map((e) => {
      const used = pour.guesses.some((guess) => guess.entry && guess.entry.id === e.id);
      return `<button type="button" class="tt-choice ${selected === e.id ? "is-selected" : ""}" data-action="tt-select" data-entry="${e.id}" ${used ? "disabled" : ""}><strong>${esc(e.name)}</strong><span>${esc(e.release || "")}${used ? " · Already guessed" : ""}</span>${selected === e.id ? `<b aria-hidden="true">✓</b>` : ""}</button>`;
    }).join("") || `<p class="tt-hint">No lineup match. Select the exact table bottle to score, or record an outside-lineup miss.</p>`;
  }
  function guessScreen(ctx, g) {
    const s = ui(ctx), r = g.currentRound, step = engine.guessStep(r), turn = r.turns[step.teamIndex];
    const available = turn.pours.filter((p) => step.glasses.includes(p.glass));
    const pour = available.find((p) => p.glass === s.glass) || available[0];
    const done = available.every((p) => p.resolved);
    const nextStep = engine.guessStep({ ...r, phase: "guess-" + (step.index + 1) });
    const nextTeam = nextStep ? name(g, r.turns[nextStep.teamIndex].teamId) : "";
    const tabs = turn.pours.map((p) => `<button type="button" class="tt-glass-tab ${p.glass === pour.glass ? "is-active" : ""}" data-action="tt-glass" data-glass="${p.glass}" aria-pressed="${p.glass === pour.glass}" ${step.glasses.includes(p.glass) ? "" : "disabled"}><span>Glass ${p.glass}</span><small>${p.resolved ? points(p.points) + " · locked" : !step.glasses.includes(p.glass) ? "Later this round" : p.guesses.length ? p.guesses.length + " guessed" : "Ready to taste"}</small></button>`).join("");
    const selected = g.entries.find((e) => e.id === s.selected);
    const attempts = pour.guesses.map((guess) => `<div class="tt-attempt ${guess.correct ? "is-correct" : ""}"><b>${guess.attempt}</b><div><strong>${esc(guess.entry ? label(guess.entry) : guess.text)}</strong><small>${guess.correct ? "Correct · " + points(pour.points) : "Not this bottle"}</small></div><span>${guess.correct ? "✓" : "×"}</span></div>`).join("");
    return `<section class="tt-guess-screen"><div class="tt-heading"><p class="tt-eyebrow">${esc(name(g, turn.teamId))} · ${step.glasses.length === 1 ? "Glass " + pour.glass + " · turn " + (step.index + 1) + " of " + step.total : "on the nose"}</p><h1>What’s in your glass?</h1><p>Pick the exact bottle and release. Close-call insights wait until the round reveal.</p></div><div class="tt-glass-tabs">${tabs}</div><div class="tt-guess-layout"><div class="tt-panel"><div class="tt-panel-title"><h2>Glass ${pour.glass}</h2><span class="tt-points-pill">${pour.resolved ? points(pour.points) : points(3 - pour.guesses.length) + " on this guess"}</span></div><div class="tt-attempt-list">${attempts || `<p class="tt-hint">Trust the nose. Take a sip. Make your call.</p>`}</div>${pour.resolved ? `<div class="tt-locked-glass"><span>${pour.points ? "✓" : "—"}</span><h3>${pour.points ? "You called it." : "That glass is locked."}</h3><p>${pour.points ? points(pour.points) + " earned." : "The bottle stays hidden until both teams finish."}</p>${!done ? button("glass", "On to glass " + (pour.glass === "A" ? "B" : "A"), `data-glass="${pour.glass === "A" ? "B" : "A"}"`, "secondary") : ""}</div>` : `<label class="tt-field"><span>Choose from tonight’s lineup</span><input id="tt-guess-search" type="search" autocomplete="off" placeholder="Find your guess…" value="${esc(s.guessQuery)}"></label><div id="tt-choices" class="tt-choices">${guessChoices(g, s.guessQuery, pour, s.selected)}</div><div class="tt-lock-guess">${selected ? `<p>Lock <strong>${esc(label(selected))}</strong> for glass ${pour.glass}?</p>` : `<p>Choose a bottle above to make your call.</p>`}${button("guess", "Lock guess " + (pour.guesses.length + 1), `data-round="${r.id}" data-team="${turn.teamId}" data-glass="${pour.glass}" data-attempt="${pour.guesses.length + 1}" ${selected ? "" : "disabled"}`)}</div><details class="tt-outside"><summary>Guessing something outside the lineup?</summary><p class="tt-hint">Outside-lineup guesses count as a miss. Choose a matching bottle above if it is on the table.</p><input id="tt-outside" placeholder="Record what you guessed" value="${esc(s.outside || "")}" maxlength="140">${button("outside", "Record as a miss", `data-round="${r.id}" data-team="${turn.teamId}" data-glass="${pour.glass}" data-attempt="${pour.guesses.length + 1}"`, "secondary")}</details>`}</div><aside class="tt-side-note">${glassIcon}<p class="tt-eyebrow">The house rules</p><p>3 points on the first call.<br>2 on the second.<br>1 on the third.</p><small>Pick the exact release when more than one batch is on the table.</small></aside></div>${done ? `<div class="tt-handoff-bar">${button("finish-turn", nextTeam ? `${lockIcon} ${step.glasses.length === 1 ? "Glass " + pour.glass : "Guesses"} locked · pass to ${esc(nextTeam)}` : "Finish tasting · gather the table")}</div>` : ""}${s.message ? `<p class="tt-notice" role="status">${esc(s.message)}</p>` : ""}<div class="tt-quiet-action">${button("hide", "Hide screen", "", "text")}</div></section>`;
  }
  function revealCard(pour, teamName) {
    const a = pour.answer;
    return `<article class="tt-reveal-card"><div class="tt-reveal-top"><span>${esc(teamName)} · Glass ${pour.glass}</span><strong>+${pour.points}</strong></div><p class="tt-eyebrow">Bottle ${a.slot}${a.proof ? " · " + a.proof + " proof" : ""}</p><h3>${esc(a.name)}</h3>${a.release ? `<p class="tt-release">${esc(a.release)}</p>` : ""}<div class="tt-reveal-guesses">${pour.guesses.map((guess) => `<div><span class="tt-attempt-number">${guess.attempt}</span><div><strong>${esc(guess.entry ? label(guess.entry) : guess.text)}</strong><div class="tt-insights">${guess.correct ? `<span class="is-correct">Exact bottle · ${points(pour.points)}</span>` : engine.insights(a, guess.entry).map((n) => `<span title="${esc(n.detail)}">${esc(n.label)}<small>${esc(n.detail)}</small></span>`).join("") || `<span class="tt-miss">${guess.entry ? "No verified close match" : "Outside-lineup guess"}</span>`}</div></div></div>`).join("")}</div></article>`;
  }
  function roundRecap(g) {
    const r = g.currentRound;
    const scores = r.turns.map((turn) => turn.pours.reduce((n, p) => n + p.points, 0));
    const headline = scores[0] === scores[1] ? "An even round." : name(g, r.turns[scores[0] > scores[1] ? 0 : 1].teamId) + " takes the round.";
    return `<div class="tt-heading"><p class="tt-eyebrow">Round ${r.number} · the reveal</p><h1>${esc(headline)}</h1><p>${esc(name(g, r.turns[0].teamId))} ${scores[0]} · ${esc(name(g, r.turns[1].teamId))} ${scores[1]}. Close calls are for the conversation, never extra points.</p></div><div class="tt-reveal-grid">${r.turns.flatMap((t) => t.pours.map((p) => revealCard(p, name(g, t.teamId)))).join("")}</div>${orderControl(g, true)}<div class="tt-handoff-bar tt-round-actions">${button("next", "Draw next round <span aria-hidden=\"true\">→</span>")}${button("finish", "Finish & save the night", "", "secondary")}${button("export", "Download game record", "", "text")}</div>`;
  }
  function between(g) {
    return `<section class="tt-center"><p class="tt-eyebrow">${g.rounds.length} rounds played</p><h1>Back to the full table.</h1><p>All ${g.entries.length} bottles are eligible again.</p>${orderControl(g, true)}${button("start", "Draw the next round")}${button("finish", "Finish & save the night", "", "secondary")}</section>`;
  }
  function nightRecap(g, archived) {
    const totals = engine.totals(g);
    const title = totals[0].points === totals[1].points ? "A night well matched." : (totals[0].points > totals[1].points ? totals[0].name : totals[1].name) + " wins the night.";
    return `<div class="tt-heading"><p class="tt-eyebrow">${g.rounds.length} ${g.rounds.length === 1 ? "round" : "rounds"} · the final pour</p><h1>${esc(title)}</h1><p>The score is settled. Here’s what your guesses revealed.</p></div><div class="tt-summary-grid">${engine.summary(g).map((s) => `<section class="tt-panel"><h2>${esc(s.name)}</h2><div class="tt-stat-row"><div><b>${s.correct}<small> / ${s.pours}</small></b><span>Bottles called</span></div><div><b>${s.firstTry}</b><span>First-try calls</span></div></div><p class="tt-hint">${s.familyComparable ? `${s.sameHouse} of ${s.familyComparable} wrong guesses with known houses still matched the actual bottle’s house.` : "More verified bottle details will unlock family comparisons."}</p>${s.confusion ? `<div class="tt-confusion"><span>Most repeated mix-up · ${s.confusion.count} ${s.confusion.count === 1 ? "guess" : "guesses"}</span><strong>${esc(label(s.confusion.answer))}</strong><small>Guessed as ${esc(label(s.confusion.guess))}</small></div>` : ""}</section>`).join("")}</div><div class="tt-inline-actions">${button("export", "Download game record", archived ? `data-archive="${esc(g.id)}"` : "", "secondary")}${button("lineup-export", "Save lineup for next time", archived ? `data-archive="${esc(g.id)}"` : "", "secondary")}${button("exit", "Back to cabinet", "", "text")}</div><div class="tt-history-rounds">${g.rounds.map((r) => `<details><summary>Round ${r.number}<span>${r.turns.map((t) => t.pours.reduce((n, p) => n + p.points, 0)).join(" — ")}</span></summary><div class="tt-reveal-grid">${r.turns.flatMap((t) => t.pours.map((p) => revealCard(p, name(g, t.teamId)))).join("")}</div></details>`).join("")}</div>`;
  }
  function history(ctx) {
    const games = (ctx.state.tastingGames || []).filter((g) => g.format === engine.FORMAT);
    if (!games.length) return "";
    return `<section class="tt-past"><h3>Past tasting tables</h3>${games.slice(0, 6).map((g) => `<button type="button" data-action="tt-archive" data-archive="${esc(g.id)}"><strong>${engine.totals(g).map((t) => esc(t.name) + " " + t.points).join(" · ")}</strong><span>${g.rounds.length} ${g.rounds.length === 1 ? "round" : "rounds"} · ${esc(new Date(g.createdAt).toLocaleDateString())} →</span></button>`).join("")}</section>`;
  }
  function download(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = global.document.createElement("a");
    a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function onClick(ctx, target, helpers) {
    const action = target.dataset.action || "";
    if (!action.startsWith("tt-")) return false;
    const a = action.slice(3), s = ui(ctx), g = game(ctx), r = g && g.currentRound;
    s.message = "";
    if (a === "new") { ctx.state.activeTastingGame = engine.create(); ctx.ui.tab = "night"; ctx.ui.table = null; }
    else if (a === "archive") { s.archiveId = target.dataset.archive; ctx.ui.tab = "night"; conceal(ctx); }
    else if (a === "exit") { conceal(ctx); s.archiveId = ""; ctx.ui.tab = "cabinet"; }
    else if (a === "export" || a === "lineup-export") {
      const source = target.dataset.archive ? (ctx.state.tastingGames || []).find((v) => v.id === target.dataset.archive) : g;
      if (source) download(a === "export" ? source : { kind: "barrel-proof-lineup", version: 1, entries: source.entries }, "barrel-proof-" + (a === "export" ? "game-" : "lineup-") + new Date().toISOString().slice(0, 10) + ".json");
      return true;
    }
    else if (!g || g.format !== engine.FORMAT) return true;
    else if (a === "order" && (g.status === "setup" || !r || r.phase === "recap")) {
      g.guessOrder = target.dataset.order === "alternate" ? "alternate" : "team";
    }
    else if (a === "add" && g.status === "setup") {
      const bottle = ctx.bottles.find((b) => b.id === target.dataset.bottle);
      if (bottle) addEntry(g, snapshot(bottle)); s.query = "";
    }
    else if (a === "manual" && g.status === "setup") { if (String(s.manual || "").trim()) { addEntry(g, { name: s.manual, release: s.manualRelease || "" }); s.manual = ""; s.manualRelease = ""; } else s.message = "Give this bottle a name first."; }
    else if (a === "remove" && g.status === "setup") { g.entries = g.entries.filter((e) => e.id !== target.dataset.entry).map((e, i) => ({ ...e, slot: i + 1 })); }
    else if (a === "preview" && g.status === "setup") {
      const lines = String(s.bulk || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!lines.length || lines.length > 100) s.message = "Paste between 1 and 100 bottle names, one per line.";
      else s.preview = lines.map((line, i) => {
        const matches = ctx.bottles.filter((b) => engine.norm(b.name) === engine.norm(line));
        return engine.cleanEntry(matches.length === 1 ? snapshot(matches[0]) : { name: line }, i + 1);
      });
    }
    else if (a === "accept-import" && g.status === "setup" && s.preview) {
      if (g.entries.length + s.preview.length > 100) s.message = "A table can hold up to 100 bottles.";
      else { s.preview.forEach((e) => addEntry(g, e)); s.preview = null; s.bulk = ""; }
    }
    else if (a === "cancel-import") s.preview = null;
    else if (a === "start") { conceal(ctx); if (!engine.startRound(g)) s.message = g.entries.length < 2 ? "Add at least two bottles before drawing." : "Two bottles have the same name and release. Add a distinct batch or pick label, or remove the duplicate."; }
    else if (a === "open" && r && target.dataset.phase === r.phase) s.open = key(g);
    else if (a === "hide") conceal(ctx);
    else if (a === "poured" && r && s.open === key(g)) { engine.confirmPour(g, target.dataset.phase); conceal(ctx); }
    else if (a === "glass" && engine.guessStep(r) && engine.guessStep(r).glasses.includes(target.dataset.glass)) { s.glass = target.dataset.glass; s.selected = ""; s.guessQuery = ""; }
    else if (a === "select") { s.selected = target.dataset.entry; }
    else if ((a === "guess" || a === "outside") && r && s.open === key(g)) {
      const accepted = engine.submitGuess(g, { teamId: target.dataset.team, glass: target.dataset.glass, roundId: target.dataset.round,
        expectedAttempt: Number(target.dataset.attempt), entryId: a === "guess" ? s.selected : "", freeText: a === "outside" ? s.outside : "" });
      if (accepted) { s.selected = ""; s.guessQuery = ""; s.outside = ""; } else s.message = "Choose a new bottle, or enter the outside-lineup guess.";
    }
    else if (a === "finish-turn") { if (engine.finishTurn(g)) conceal(ctx); }
    else if (a === "reveal") engine.reveal(g);
    else if (a === "next") { if (engine.closeRound(g)) engine.startRound(g); conceal(ctx); }
    else if (a === "finish" && (!r || r.phase === "recap")) {
      if (r) engine.closeRound(g);
      g.status = "complete"; g.savedAt = new Date().toISOString();
      ctx.state.tastingGames = [JSON.parse(JSON.stringify(g))].concat(ctx.state.tastingGames || []).slice(0, 20);
      s.archiveId = g.id; ctx.state.activeTastingGame = null; conceal(ctx);
    }
    helpers.persist(ctx); helpers.render(ctx);
    if (!["select", "glass", "order", "remove", "add", "manual", "preview", "accept-import", "cancel-import", "guess", "outside"].includes(a) && global.scrollTo) global.scrollTo({ top: 0, behavior: "instant" });
    return true;
  }
  function onInput(ctx, target, helpers) {
    const s = ui(ctx), g = game(ctx);
    if (!active(ctx)) return false;
    if (target.id === "tt-search") {
      s.query = target.value;
      const node = ctx.mount.querySelector("#tt-search-results"); if (node) node.innerHTML = catalogResults(ctx);
      return true;
    }
    if (target.id === "tt-guess-search") {
      s.guessQuery = target.value;
      const r = g.currentRound;
      const step = engine.guessStep(r);
      if (step) {
        const turn = r.turns[step.teamIndex], allowed = turn.pours.filter((p) => step.glasses.includes(p.glass));
        const p = allowed.find((p) => p.glass === s.glass) || allowed[0];
        const node = ctx.mount.querySelector("#tt-choices"); if (node) node.innerHTML = guessChoices(g, s.guessQuery, p, s.selected);
      }
      return true;
    }
    const fields = { "tt-manual": "manual", "tt-release": "manualRelease", "tt-bulk": "bulk", "tt-outside": "outside" };
    if (fields[target.id]) { s[fields[target.id]] = target.value; return true; }
    if (g.status === "setup" && target.dataset.ttTeam) {
      const team = g.teams.find((t) => t.id === target.dataset.ttTeam);
      if (team) team.name = String(target.value).trim().slice(0, 40) || "Team " + (g.teams.indexOf(team) + 1);
      const scores = ctx.mount.querySelectorAll(".tt-team-name"); scores.forEach((node, i) => { node.textContent = g.teams[i].name; });
      helpers.persist(ctx); return true;
    }
    if (g.status === "setup" && target.dataset.ttEntry) {
      const entry = g.entries.find((e) => e.id === target.dataset.ttEntry), field = target.dataset.ttField;
      if (entry && ["name", "release", "proof", "distillery"].includes(field)) {
        const value = field === "proof" ? (target.value.trim() === "" ? null : Number(target.value)) : target.value;
        if (field === "release" && String(value).trim() !== entry.release) entry.proof = null;
        if (field === "name" && String(value).trim() !== entry.name) { entry.proof = null; entry.distillery = ""; entry.brand = ""; entry.bottleId = ""; entry.sourceUrl = ""; }
        Object.assign(entry, engine.cleanEntry({ ...entry, [field]: value }, entry.slot));
        const details = target.closest && target.closest("details");
        if (details) {
          details.querySelector("summary strong").textContent = entry.name;
          details.querySelector("summary span").textContent = (entry.release || "Add batch or pick details") + (entry.proof ? " · " + entry.proof + " proof" : "");
          if (field === "name" || field === "release") details.querySelector('[data-tt-field="proof"]').value = entry.proof || "";
          if (field === "name") details.querySelector('[data-tt-field="distillery"]').value = "";
        }
        helpers.persist(ctx);
      }
      return true;
    }
    return false;
  }
  async function onChange(ctx, target, helpers) {
    if (target.id !== "tt-import" || !active(ctx) || game(ctx).status !== "setup") return false;
    const file = target.files && target.files[0];
    if (!file) return true;
    try {
      if (file.size > 1000000) throw new Error("Choose a lineup file smaller than 1 MB.");
      ui(ctx).preview = engine.importLineup(JSON.parse(await file.text())); ui(ctx).message = "";
    } catch (error) { ui(ctx).message = error.message === "Choose a lineup file smaller than 1 MB." ? error.message : "Could not read this lineup. Use a JSON file with named bottle entries."; }
    helpers.render(ctx); return true;
  }
  global.BarrelTableUI = { active, render, startCard, history, onClick, onInput, onChange, bindPrivacy, conceal };
})(typeof window !== "undefined" ? window : globalThis);
