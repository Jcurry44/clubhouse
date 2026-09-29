(function attachUI(global) {
  const rec = global.BarrelRecommendation;
  const catalog = global.BarrelCatalog;
  const research = global.BarrelResearch;
  const reviewLogic = global.BarrelReviews;
  const clubLogic = global.BarrelClub;
  const nightLogic = global.BarrelNight;
  const barcodeLogic = global.BarrelBarcode;
  const ratingsLogic = global.BarrelRatings;
  const cocktailLogic = global.BarrelCocktails;
  const MIN_SEARCH_CHARS = 2;
  // The flavor wheel, grouped the way tasters think. Custom write-ins join the
  // same tag set and render under "Yours".
  const TAG_GROUPS = [
    ["Sweet", ["caramel", "vanilla", "honey", "maple", "brown sugar", "butterscotch"]],
    ["Fruit", ["cherry", "dark fruit", "stone fruit", "citrus", "apple", "berry"]],
    ["Spice", ["baking spice", "cinnamon", "black pepper", "clove", "mint", "rye spice"]],
    ["Oak & earth", ["oak", "char", "leather", "tobacco", "cocoa", "coffee", "nutty", "earthy"]],
    ["Grain & floral", ["corn", "wheat", "floral", "grassy", "herbal"]],
    ["Feel", ["heat", "creamy", "oily", "thin", "dry", "long finish"]]
  ];
  const ALL_WHEEL_TAGS = new Set(TAG_GROUPS.flatMap(([, tags]) => tags));
  const MAX_EMPTY_RESULTS = 8;
  const MAX_SEARCH_RESULTS = 60;
  const MAX_QA_ISSUES = 80;
  const MAX_TOP_SHELF_ITEMS = 12;
  const MAX_SECONDARY_MARKET_ITEMS = 12;
  const QA_SEVERITY_SCORE = {
    high: 300,
    medium: 200,
    low: 100
  };
  const QA_CATEGORY_SCORE = {
    Identity: 50,
    Proof: 40,
    Pricing: 30,
    Coverage: 20,
    Specs: 10
  };

  function createApp(options) {
    const bottles = (options.bottles || []).map((bottle) => ({
      ...bottle,
      _searchText: buildBottleSearchText(bottle)
    }));
    const ctx = {
      mount: options.mount,
      bottles,
      catalogMeta: options.catalogMeta || {},
      cocktails: options.cocktails || [],
      reviewData: options.reviewData || { reviewsByBottleId: {} },
      staticFriends: options.friends || [],
      friends: options.friends || [],
      palate: options.palate,
      state: options.state,
      save: options.save,
      reset: options.reset,
      ui: {
        tab: ((options.state.activeTastingGame && options.state.activeTastingGame.format === "paired-table-v1") || (global.location && global.location.hash === "#night")) ? "night" : "cabinet",
        query: "",
        shelfFilter: "all",
        storeFilters: { type: "", release: "" },
        storeHidePicks: true,
        activeFamily: "",
        familySort: "count",
        familyType: "",
        shelfMode: "view",
        wizStep: "houses",
        wizHouses: [],
        wizIdx: 0,
        wizQuery: "",
        wizFilter: "all",
        wizHidePicks: true,
        wizExpanded: "",
        pourOffset: 0,
        showdownView: "arena",
        showdownQuery: "",
        showdownA: "",
        showdownB: "",
        activeCocktailId: options.cocktails && options.cocktails[0] ? options.cocktails[0].id : "",
        tastingTags: new Set(),
        tastingQuery: "",
        tastingBottleId: "",
        tastingsView: "log",
        ratingsCategory: "all",
        identityQuery: "",
        tastingDraft: { score: "8.5", context: "Neat pour", note: "", guess: "", blind: false, batch: "", nose: "", palateNote: "", finish: "" },
        nightQuery: "",
        lastScanCode: "",
        scorecardOpen: false,
        scorecardContext: "store",
        researchCopied: false,
        reviewCopied: false
      }
    };

    refreshFriends(ctx);
    ensureActiveBottle(ctx);
    bindEvents(ctx);
    render(ctx);
    warmCaches(ctx);
  }

  // ctx.friends = seeded friends (none today) + the friend cards the user has
  // imported into their club. Recompute whenever the club changes so the Club tab
  // and every friend-aware Buy/Consider/Pass call stay in sync.
  function refreshFriends(ctx) {
    const clubFriends = ctx.state && ctx.state.club && Array.isArray(ctx.state.club.friends)
      ? ctx.state.club.friends
      : [];
    ctx.friends = (ctx.staticFriends || []).concat(clubFriends);
    return ctx.friends;
  }

  // After first paint, warm the per-bottle classify/attribute/availability caches
  // in the background so the first Distilleries / For You compute feels instant.
  function warmCaches(ctx) {
    const fam = global.BarrelFamilies;
    const pal = global.BarrelPalate;
    const run = () => {
      for (const bottle of ctx.bottles) {
        if (fam) {
          fam.classify(bottle);
          fam.attributes(bottle);
        }
        if (pal) pal.availability(bottle);
      }
    };
    if (global.requestIdleCallback) global.requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 250);
  }

  function bindEvents(ctx) {
    if (global.BarrelTableUI) {
      global.BarrelTableUI.bindPrivacy(ctx, { render });
      ctx.mount.addEventListener("change", (event) => global.BarrelTableUI.onChange(ctx, event.target, { persist, render }));
    }
    ctx.mount.addEventListener("click", async (event) => {
      // Tap the dimmed backdrop (but not the card itself) closes the scorecard.
      if (ctx.ui.scorecardOpen && event.target.closest) {
        if (event.target.closest(".scorecard-backdrop") && !event.target.closest(".scorecard-card")) {
          ctx.ui.scorecardOpen = false;
          render(ctx);
          return;
        }
      }

      const target = event.target.closest("[data-action], [data-tab], [data-bottle-id], [data-cocktail-id], [data-status], [data-filter], [data-tag], [data-price], [data-family], [data-goto], [data-corner], [data-result], [data-sdview], [data-filtergroup], [data-famsort], [data-famtype], [data-wiz], [data-open-card]");
      if (!target) return;
      if (global.BarrelTableUI && global.BarrelTableUI.onClick(ctx, target, { persist, render })) return;

      if (target.dataset.openCard) {
        ctx.state.activeBottleId = target.dataset.openCard;
        ctx.ui.scorecardContext = target.dataset.cardContext || "store";
        ctx.ui.scorecardOpen = true;
        ctx.ui.researchCopied = false;
        ctx.ui.reviewCopied = false;
        persist(ctx);
        render(ctx);
        const card = ctx.mount.querySelector && ctx.mount.querySelector(".scorecard-card");
        if (card && card.scrollTop !== undefined) card.scrollTop = 0;
        return;
      }

      if (target.dataset.action === "close-card") {
        ctx.ui.scorecardOpen = false;
        render(ctx);
        return;
      }

      if (target.dataset.wiz) {
        handleWizard(ctx, target);
        return;
      }

      if (target.dataset.famsort) {
        ctx.ui.familySort = target.dataset.famsort;
        render(ctx);
        return;
      }

      if (target.hasAttribute("data-famtype")) {
        ctx.ui.familyType = target.dataset.famtype;
        render(ctx);
        return;
      }

      if (target.dataset.filtergroup) {
        const group = target.dataset.filtergroup;
        const value = target.dataset.filtervalue;
        if (!ctx.ui.storeFilters) ctx.ui.storeFilters = { type: "", release: "" };
        ctx.ui.storeFilters[group] = ctx.ui.storeFilters[group] === value ? "" : value;
        render(ctx);
        return;
      }

      if (target.dataset.action === "clear-filters") {
        ctx.ui.storeFilters = { type: "", release: "" };
        render(ctx);
        return;
      }

      if (target.dataset.action === "toggle-store-picks") {
        ctx.ui.storeHidePicks = !(ctx.ui.storeHidePicks !== false);
        render(ctx);
        return;
      }

      if (target.dataset.action === "scan-open") {
        openScanner(ctx);
        return;
      }

      if (target.dataset.action === "tastings-view") {
        ctx.ui.tastingsView = target.dataset.view || "log";
        render(ctx);
        return;
      }

      if (target.dataset.action === "tasting-blind") {
        ctx.ui.tastingDraft.blind = target.dataset.blind === "1";
        render(ctx);
        return;
      }

      if (target.dataset.action === "tasting-batch") {
        const label = target.dataset.batch;
        ctx.ui.tastingDraft.batch = ctx.ui.tastingDraft.batch === label ? "" : label;
        render(ctx);
        return;
      }

      if (target.dataset.action === "add-custom-tag") {
        const input = ctx.mount.querySelector ? ctx.mount.querySelector("#customTag") : null;
        const tag = input ? String(input.value).toLowerCase().trim().slice(0, 24) : "";
        if (tag) {
          ctx.ui.tastingTags.add(tag);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "identity-link") {
        const bottle = getActiveBottle(ctx);
        let canon = target.dataset.canon;
        if (bottle && canon && canon !== bottle.id) {
          const links = ctx.state.identityLinks || (ctx.state.identityLinks = {});
          // flatten chains: if the target is itself linked, point at its canonical
          canon = links[canon] || canon;
          links[bottle.id] = canon;
          ctx.ui.identityQuery = "";
          persist(ctx);
          render(ctx);
          showToast(ctx, "Linked — pours on either spelling now count as one bottle.");
        }
        return;
      }

      if (target.dataset.action === "identity-unlink") {
        const bottle = getActiveBottle(ctx);
        if (bottle && ctx.state.identityLinks) {
          delete ctx.state.identityLinks[bottle.id];
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "night-share") {
        const idx = target.dataset.flightI;
        const flight = idx !== undefined && idx !== "" ? (ctx.state.flights || [])[Number(idx)] : ctx.state.activeFlight;
        if (!flight || !nightLogic || !nightLogic.buildRecapText) return;
        const dateLabel = (flight.savedAt || flight.createdAt || new Date().toISOString()).slice(0, 10);
        const text = nightLogic.buildRecapText(flight, makeNightLookup(ctx), dateLabel);
        if (global.navigator && global.navigator.share) {
          global.navigator.share({ text }).catch(() => copyText(text).then(() => showToast(ctx, "Recap copied — paste it in the group chat.")));
        } else {
          copyText(text).then(() => showToast(ctx, "Recap copied — paste it in the group chat."));
        }
        return;
      }

      if (target.dataset.action === "quick-open") {
        ctx.ui.tab = "shelf";
        ctx.ui.shelfMode = "quick";
        ctx.ui.quickQuery = "";
        ctx.ui.quickAdded = 0;
        render(ctx);
        return;
      }

      if (target.dataset.action === "quick-done") {
        ctx.ui.shelfMode = "view";
        render(ctx);
        return;
      }

      if (target.dataset.action === "quick-own") {
        const C = global.BarrelCollection;
        const bottleId = target.dataset.bottle;
        if (C && bottleId) {
          C.setCount(ctx.state, bottleId, C.ownedCount(ctx.state, bottleId) + 1);
          ctx.ui.quickAdded = (ctx.ui.quickAdded || 0) + 1;
          ctx._forYou = null;
          persist(ctx);
          // Update only the results + counter so the search box keeps focus.
          const region = ctx.mount.querySelector(".quickadd-results");
          if (region) region.innerHTML = renderQuickResults(ctx);
          const counter = ctx.mount.querySelector("#quickCount");
          if (counter) counter.textContent = ctx.ui.quickAdded;
        }
        return;
      }

      if (target.dataset.action === "own-count") {
        const C = global.BarrelCollection;
        const bottleId = target.dataset.bottle;
        if (C && bottleId) {
          // "Add to shelf" can set owned status without a collection entry, so
          // the stepper displays max(1, count) — step from what's displayed.
          const current = Math.max(1, C.ownedCount(ctx.state, bottleId));
          C.setCount(ctx.state, bottleId, Math.max(1, current + Number(target.dataset.delta)));
          ctx._forYou = null;
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "finish-bottle") {
        const C = global.BarrelCollection;
        const bottleId = target.dataset.bottle;
        if (!bottleId) return;
        const count = C ? C.ownedCount(ctx.state, bottleId) : 1;
        if (C && count > 1) {
          C.setCount(ctx.state, bottleId, count - 1);
          persist(ctx);
          render(ctx);
          showToast(ctx, "One down — backup promoted. " + (count - 1) + " left on the shelf.");
          return;
        }
        if (C) C.setCount(ctx.state, bottleId, 0);
        ctx.state.statuses[bottleId] = "finished";
        if (!Array.isArray(ctx.state.killLog)) ctx.state.killLog = [];
        ctx.state.killLog.push({ bottleId, date: new Date().toISOString().slice(0, 10), rebuy: null });
        ctx._forYou = null;
        persist(ctx);
        render(ctx);
        showToast(ctx, "Bottle finished. Your pours and rating stay in the books.");
        return;
      }

      if (target.dataset.action === "rebuy") {
        const bottleId = target.dataset.bottle;
        const verdict = target.dataset.val === "1";
        const entry = [...(ctx.state.killLog || [])].reverse().find((item) => item.bottleId === bottleId);
        if (entry) {
          entry.rebuy = verdict;
          ctx._forYou = null;
          persist(ctx);
          render(ctx);
          showToast(ctx, verdict ? "Noted — a rebuy. That's the highest praise there is." : "Noted — one was enough.");
        }
        return;
      }

      if (target.dataset.action === "ratings-cat") {
        ctx.ui.ratingsCategory = target.dataset.cat || "all";
        render(ctx);
        return;
      }

      if (target.dataset.action === "scan-dismiss") {
        ctx.ui.lastScanCode = "";
        render(ctx);
        return;
      }

      if (target.dataset.action === "link-scan") {
        const code = ctx.ui.lastScanCode;
        const bottleId = target.dataset.bottle;
        if (code && bottleId) {
          if (!ctx.state.barcodeLinks || typeof ctx.state.barcodeLinks !== "object") ctx.state.barcodeLinks = {};
          ctx.state.barcodeLinks[code] = bottleId;
          ctx.ui.lastScanCode = "";
          ctx._barcodeIndex = null;
          persist(ctx);
          render(ctx);
          showToast(ctx, "Barcode linked — next scan opens this bottle instantly.");
        }
        return;
      }

      if (target.dataset.tab) {
        ctx.ui.tab = target.dataset.tab;
        ctx.ui.scorecardOpen = false;
        render(ctx);
        return;
      }

      if (target.dataset.family !== undefined) {
        ctx.ui.activeFamily = target.dataset.family;
        render(ctx);
        return;
      }

      if (target.dataset.goto) {
        // A bottle link from anywhere (For You, Pour Tonight, etc.) opens its scorecard.
        ctx.state.activeBottleId = target.dataset.goto;
        ctx.ui.scorecardContext = "store";
        ctx.ui.scorecardOpen = true;
        ctx.ui.researchCopied = false;
        ctx.ui.reviewCopied = false;
        persist(ctx);
        render(ctx);
        return;
      }

      if (target.dataset.action === "goto-family") {
        ctx.ui.activeFamily = target.dataset.famid || "";
        ctx.ui.tab = "families";
        ctx.ui.scorecardOpen = false;
        render(ctx);
        return;
      }

      if (target.dataset.sdview) {
        ctx.ui.showdownView = target.dataset.sdview;
        render(ctx);
        return;
      }

      if (target.dataset.corner && target.dataset.pick) {
        ctx.ui[target.dataset.corner === "a" ? "showdownA" : "showdownB"] = target.dataset.pick;
        ctx.ui.showdownQuery = "";
        render(ctx);
        return;
      }

      if (target.dataset.result) {
        recordMatchup(ctx, target.dataset.result);
        return;
      }

      if (target.dataset.action === "sd-random") {
        const pool = showdownPool(ctx);
        if (pool.length >= 2) {
          ctx.ui.showdownA = pool[0].id;
          ctx.ui.showdownB = pool[1].id;
        }
        render(ctx);
        return;
      }

      if (target.dataset.action === "sd-clear-a") {
        ctx.ui.showdownA = "";
        render(ctx);
        return;
      }

      if (target.dataset.action === "sd-clear-b") {
        ctx.ui.showdownB = "";
        render(ctx);
        return;
      }

      if (target.dataset.action === "sd-swap") {
        const tmp = ctx.ui.showdownA;
        ctx.ui.showdownA = ctx.ui.showdownB;
        ctx.ui.showdownB = tmp;
        render(ctx);
        return;
      }

      if (target.dataset.action === "sd-undo") {
        if (Array.isArray(ctx.state.matchups) && ctx.state.matchups.length) {
          ctx.state.matchups.shift();
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.bottleId) {
        ctx.state.activeBottleId = target.dataset.bottleId;
        ctx.ui.researchCopied = false;
        ctx.ui.reviewCopied = false;
        persist(ctx);
        render(ctx);
        return;
      }

      if (target.dataset.cocktailId) {
        ctx.ui.activeCocktailId = target.dataset.cocktailId;
        render(ctx);
        revealCocktailSpec(ctx);
        return;
      }

      if (target.dataset.price) {
        ctx.state.storePrice = Number(target.dataset.price);
        ctx.ui.researchCopied = false;
        ctx.ui.reviewCopied = false;
        persist(ctx);
        render(ctx);
        return;
      }

      if (target.dataset.status) {
        const bottle = getActiveBottle(ctx);
        ctx.state.statuses[bottle.id] = target.dataset.status;
        persist(ctx);
        render(ctx);
        return;
      }

      if (target.dataset.filter) {
        ctx.ui.shelfFilter = target.dataset.filter;
        render(ctx);
        return;
      }

      if (target.dataset.tag) {
        toggleTag(ctx.ui.tastingTags, target.dataset.tag);
        render(ctx);
        return;
      }

      if (target.dataset.action === "log-active") {
        ctx.ui.tab = "tastings";
        ctx.ui.scorecardOpen = false;
        render(ctx);
        return;
      }

      if (target.dataset.action === "pour-reshuffle") {
        ctx.ui.pourOffset = (ctx.ui.pourOffset || 0) + 3;
        render(ctx);
        return;
      }

      if (target.dataset.action === "start-build") {
        ctx.ui.tab = "shelf";
        ctx.ui.shelfMode = "wizard";
        ctx.ui.wizStep = "houses";
        render(ctx);
        return;
      }

      if (target.dataset.action === "log-price") {
        const P = global.BarrelPrices;
        if (P && P.add(ctx.state, ctx.state.activeBottleId, ctx.state.storePrice)) {
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "remove-price") {
        const P = global.BarrelPrices;
        if (P) {
          P.removeAt(ctx.state, ctx.state.activeBottleId, Number(target.dataset.idx));
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "copy-research") {
        const activeBottle = getActiveBottle(ctx);
        await copyText(buildResearchPrompt(ctx, activeBottle));
        ctx.ui.researchCopied = true;
        render(ctx);
        return;
      }

      if (target.dataset.action === "copy-review-research") {
        const activeBottle = getActiveBottle(ctx);
        await copyText(buildReviewResearchPrompt(activeBottle));
        ctx.ui.reviewCopied = true;
        render(ctx);
        return;
      }

      if (target.dataset.action === "view-cocktail") {
        const activeBottle = getActiveBottle(ctx);
        const match = getBestCocktailMatch(ctx, activeBottle);
        if (match) ctx.ui.activeCocktailId = match.cocktail.id;
        ctx.ui.tab = "cocktails";
        ctx.ui.scorecardOpen = false;
        render(ctx);
        revealCocktailSpec(ctx);
        return;
      }

      if (target.dataset.action === "export") {
        exportState(ctx.state);
        showToast(ctx, "Backup downloaded.");
        return;
      }

      if (target.dataset.action === "import") {
        importState(ctx);
        return;
      }

      if (target.dataset.action === "club-share") {
        exportClubCard(ctx);
        showToast(ctx, "Your club card downloaded — send it to your group.");
        return;
      }

      if (target.dataset.action === "club-add") {
        importClubCard(ctx);
        return;
      }

      if (target.dataset.action === "club-remove") {
        const name = target.dataset.friend;
        if (clubLogic && ctx.state.club && Array.isArray(ctx.state.club.friends)) {
          ctx.state.club.friends = clubLogic.removeFriend(ctx.state.club.friends, name);
          refreshFriends(ctx);
          ctx._forYou = null;
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "game-new") {
        ctx.state.activeTastingGame = nightLogic && nightLogic.createTastingGame
          ? nightLogic.createTastingGame({ id: "game-" + Date.now(), createdAt: new Date().toISOString(), teams: ["Team One", "Team Two"] })
          : null;
        ctx.ui.gameQuery = "";
        persist(ctx);
        render(ctx);
        return;
      }

      if (target.dataset.action === "game-add-bottle" && target.dataset.bottle) {
        const game = ctx.state.activeTastingGame;
        const bottle = getBottleIndex(ctx).get(target.dataset.bottle);
        if (game && bottle && game.status === "setup") {
          const ownedBatches = ((ctx.state.collection || {})[bottle.id] || {}).batches || [];
          // The same line may appear twice as different physical releases (for
          // example ECBP C923 and B524), so each tap intentionally adds a slot.
          game.entries.push({ id: "entry-" + Date.now(), slot: game.entries.length + 1, bottleId: bottle.id, name: bottle.name, release: ownedBatches.length === 1 ? ownedBatches[0] : "" });
          ctx.ui.gameQuery = "";
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "game-add-manual") {
        const game = ctx.state.activeTastingGame;
        const nameInput = ctx.mount.querySelector && ctx.mount.querySelector("#gameManualName");
        const releaseInput = ctx.mount.querySelector && ctx.mount.querySelector("#gameManualRelease");
        const name = nameInput ? String(nameInput.value || "").trim().slice(0, 100) : "";
        const release = releaseInput ? String(releaseInput.value || "").trim().slice(0, 80) : "";
        if (game && game.status === "setup" && name) {
          game.entries.push({ id: "entry-" + Date.now(), slot: game.entries.length + 1, bottleId: "", name, release });
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "game-remove-entry") {
        const game = ctx.state.activeTastingGame;
        if (game && game.status === "setup") {
          game.entries = game.entries.filter((entry) => entry.id !== target.dataset.entry).map((entry, index) => ({ ...entry, slot: index + 1 }));
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "game-draw") {
        const game = ctx.state.activeTastingGame;
        if (game && nightLogic && nightLogic.drawGameRound) {
          const teamId = target.dataset.team || ((game.teams || [])[0] || {}).id;
          const round = nightLogic.drawGameRound(game, teamId);
          if (!round) showToast(ctx, "Every lineup slot has been played.");
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "game-guess") {
        const game = ctx.state.activeTastingGame;
        const input = ctx.mount.querySelector && ctx.mount.querySelector("#gameGuess");
        if (game && nightLogic && nightLogic.addGameGuess && nightLogic.addGameGuess(game, input ? input.value : "")) {
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "game-resolve") {
        const game = ctx.state.activeTastingGame;
        if (game && nightLogic && nightLogic.resolveGameRound) {
          nightLogic.resolveGameRound(game, target.dataset.correct === "1");
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "game-next") {
        const game = ctx.state.activeTastingGame;
        if (game && nightLogic && nightLogic.closeGameRound) {
          nightLogic.closeGameRound(game);
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "game-save") {
        saveTastingGame(ctx);
        return;
      }

      if (target.dataset.action === "game-discard") {
        const game = ctx.state.activeTastingGame;
        if (game && (game.rounds || []).length && !global.confirm("Discard this Tasting Night game and its score?")) return;
        ctx.state.activeTastingGame = null;
        persist(ctx);
        render(ctx);
        return;
      }

      if (target.dataset.action === "night-new") {
        ctx.state.activeFlight = {
          status: "setup",
          bottleIds: [],
          tasters: ctx.palate && ctx.palate.name ? [String(ctx.palate.name)] : []
        };
        ctx.ui.nightQuery = "";
        persist(ctx);
        render(ctx);
        return;
      }

      if (target.dataset.action === "night-add" && target.dataset.bottle) {
        const flight = ctx.state.activeFlight;
        if (flight && flight.status === "setup") {
          flight.bottleIds = flight.bottleIds || [];
          if (!flight.bottleIds.includes(target.dataset.bottle) && flight.bottleIds.length < 8) {
            flight.bottleIds.push(target.dataset.bottle);
          }
          ctx.ui.nightQuery = "";
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "night-remove-bottle" && target.dataset.bottle) {
        const flight = ctx.state.activeFlight;
        if (flight && Array.isArray(flight.bottleIds)) {
          flight.bottleIds = flight.bottleIds.filter((id) => id !== target.dataset.bottle);
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "night-add-taster") {
        const flight = ctx.state.activeFlight;
        const input = ctx.mount.querySelector ? ctx.mount.querySelector("#nightTaster") : null;
        const name = input ? input.value : "";
        if (flight && nightLogic && name && name.trim()) {
          flight.tasters = nightLogic.uniqueNames((flight.tasters || []).concat(name));
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "night-remove-taster" && target.dataset.taster) {
        const flight = ctx.state.activeFlight;
        if (flight && Array.isArray(flight.tasters)) {
          flight.tasters = flight.tasters.filter((name) => name !== target.dataset.taster);
          persist(ctx);
          render(ctx);
        }
        return;
      }

      if (target.dataset.action === "night-start") {
        const flight = ctx.state.activeFlight;
        if (flight && nightLogic) {
          const byId = getBottleIndex(ctx);
          const bottles = (flight.bottleIds || []).map((id) => byId.get(id)).filter(Boolean);
          if (bottles.length >= 2 && (flight.tasters || []).length >= 1) {
            ctx.state.activeFlight = nightLogic.createFlight(bottles, flight.tasters, {
              id: "flight-" + Date.now(),
              createdAt: new Date().toISOString()
            });
            persist(ctx);
            render(ctx);
          }
        }
        return;
      }

      if (target.dataset.action === "night-reveal") {
        const flight = ctx.state.activeFlight;
        if (!flight || !nightLogic) return;
        if (!nightLogic.canReveal(flight)) {
          showToast(ctx, "Score at least one glass to reveal.");
          return;
        }
        flight.status = "revealed";
        persist(ctx);
        render(ctx);
        return;
      }

      if (target.dataset.action === "night-save") {
        saveFlight(ctx);
        return;
      }

      if (target.dataset.action === "night-discard") {
        const flight = ctx.state.activeFlight;
        const hasScores = flight && nightLogic && nightLogic.scoredCount(flight) > 0;
        if (hasScores && !global.confirm("Discard this flight and its scores?")) return;
        ctx.state.activeFlight = null;
        persist(ctx);
        render(ctx);
        return;
      }

      if (target.dataset.action === "reset") {
        if (!global.confirm("This erases your collection, tastings, prices, and Showdown history on this device. Back it up first if you want to keep it. Continue?")) {
          return;
        }
        ctx.state = ctx.reset();
        ctx._forYou = null;
        refreshFriends(ctx);
        persist(ctx);
        render(ctx);
      }
    });

    if (global.document && global.document.addEventListener) {
      global.document.addEventListener("keydown", (event) => {
        // Enter in the flavor write-in adds the tag instead of submitting the form.
        if (event.key === "Enter" && event.target && event.target.id === "customTag") {
          event.preventDefault();
          const tag = String(event.target.value).toLowerCase().trim().slice(0, 24);
          if (tag) {
            ctx.ui.tastingTags.add(tag);
            render(ctx);
          }
          return;
        }
        if (event.key !== "Escape") return;
        if (ctx._scanner) { closeScanner(ctx); render(ctx); return; }
        if (ctx.ui.scorecardOpen) {
          ctx.ui.scorecardOpen = false;
          render(ctx);
        }
      });
    }

    ctx.mount.addEventListener("input", (event) => {
      const target = event.target;
      if (global.BarrelTableUI && global.BarrelTableUI.onInput(ctx, target, { persist, render })) return;
      if (target.id === "storeSearch") {
        ctx.ui.query = target.value;
        // Update ONLY the results list, never the input — re-rendering the input
        // mid-keystroke is what dropped characters. The input keeps focus + cursor.
        scheduleStoreResults(ctx);
      }
      if (target.id === "storePrice") {
        ctx.state.storePrice = Number(target.value);
        ctx.ui.researchCopied = false;
        ctx.ui.reviewCopied = false;
        persist(ctx);
        scheduleRender(ctx, 80);
      }
      if (target.id === "showdownSearch") {
        ctx.ui.showdownQuery = target.value;
        scheduleRender(ctx, 80);
      }
      if (target.id === "wizSearch") {
        ctx.ui.wizQuery = target.value;
        scheduleRender(ctx, 80);
      }
      if (target.id === "tastingSearch") {
        ctx.ui.tastingQuery = target.value;
        scheduleRender(ctx, 80);
      }
      if (target.id === "nightSearch") {
        ctx.ui.nightQuery = target.value;
        scheduleRender(ctx, 80);
      }
      if (target.id === "gameSearch") {
        ctx.ui.gameQuery = target.value;
        scheduleRender(ctx, 80);
      }
      if (target.dataset && target.dataset.gameEntryRelease) {
        const game = ctx.state.activeTastingGame;
        const entry = game && (game.entries || []).find((item) => item.id === target.dataset.gameEntryRelease);
        if (entry) {
          entry.release = String(target.value || "").trim().slice(0, 80);
          persist(ctx);
        }
      }
      if (target.dataset && target.dataset.gameTeamName) {
        const game = ctx.state.activeTastingGame;
        const team = game && (game.teams || []).find((item) => item.id === target.dataset.gameTeamName);
        if (team) {
          team.name = String(target.value || "").trim().slice(0, 40) || team.name;
          persist(ctx);
        }
      }
      // Keep the tasting form's draft alive across re-renders (tag taps, the
      // blind toggle) so typed notes are never wiped.
      if (target.name && target.closest && target.closest("[data-tasting-form]")) {
        const draft = ctx.ui.tastingDraft;
        if (target.name === "date") draft.date = target.value;
        if (target.name === "score") draft.score = target.value;
        if (target.name === "context") draft.context = target.value;
        if (target.name === "note") draft.note = target.value;
        if (target.name === "guess") draft.guess = target.value;
        if (target.name === "barrel") draft.batch = target.value;
        if (target.name === "nose") draft.nose = target.value;
        if (target.name === "palateNote") draft.palateNote = target.value;
        if (target.name === "finish") draft.finish = target.value;
        if (target.name === "bottleId") {
          // bottle changed → batch chips belong to the new bottle
          draft.batch = "";
          ctx.ui.tastingBottleId = target.value;
          render(ctx);
        }
      }
      if (target.id === "identitySearch") {
        ctx.ui.identityQuery = target.value;
        scheduleRender(ctx, 120);
      }
      if (target.id === "quickAdd") {
        ctx.ui.quickQuery = target.value;
        scheduleQuickResults(ctx);
      }

      if (target.dataset && target.dataset.nightGlass) {
        // Save each blind score immediately, but do NOT re-render — that would steal
        // focus while the table is being passed around and scored.
        const flight = ctx.state.activeFlight;
        if (flight && nightLogic) {
          nightLogic.setScore(flight, target.dataset.nightGlass, target.dataset.nightTaster, target.value);
          persist(ctx);
        }
      }
      if (target.dataset && target.dataset.nightGuess) {
        const flight = ctx.state.activeFlight;
        if (flight && nightLogic && nightLogic.setGuess) {
          nightLogic.setGuess(flight, target.dataset.nightGuess, target.value);
          persist(ctx);
        }
      }
    });

    ctx.mount.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-tasting-form]");
      if (!form) return;
      event.preventDefault();
      const data = new FormData(form);
      const blind = Boolean(ctx.ui.tastingDraft && ctx.ui.tastingDraft.blind);
      const guess = blind ? String(data.get("guess") || "").trim().slice(0, 80) : "";
      const tasting = {
        id: "taste-" + Date.now(),
        bottleId: String(data.get("bottleId")),
        date: String(data.get("date")),
        score: Number(data.get("score")),
        context: String(data.get("context") || "Neat pour"),
        blind,
        tags: Array.from(ctx.ui.tastingTags),
        note: String(data.get("note") || "").trim()
      };
      if (guess) tasting.guess = guess;
      const batch = String((ctx.ui.tastingDraft && ctx.ui.tastingDraft.batch) || data.get("barrel") || "").trim().slice(0, 60);
      if (batch) tasting.batch = batch;
      for (const [field, key] of [["nose", "nose"], ["palateNote", "palate"], ["finish", "finish"]]) {
        const value = String(data.get(field) || "").trim().slice(0, 160);
        if (value) tasting[key] = value;
      }
      ctx.state.tastings.unshift(tasting);
      ctx.state.statuses[tasting.bottleId] = ctx.state.statuses[tasting.bottleId] || "tasted";
      ctx.ui.tastingTags = new Set();
      ctx.ui.tastingQuery = "";
      ctx.ui.tastingBottleId = "";
      ctx.ui.tastingDraft = { score: "8.5", context: "Neat pour", note: "", guess: "", blind: false, batch: "", nose: "", palateNote: "", finish: "" };
      persist(ctx);
      render(ctx);
      if (guess) {
        const bottle = getBottleIndex(ctx).get(tasting.bottleId);
        const verdict = getGuessVerdict(ctx, tasting, bottle);
        if (verdict && verdict.level === "nailed") {
          showToast(ctx, "Nailed it — you called " + (bottle ? bottle.name : "it") + " blind. 🎯");
        } else if (verdict && verdict.level === "close") {
          showToast(ctx, "Close — " + verdict.why + ". It was " + (bottle ? bottle.name : "...") + ".");
        } else {
          showToast(ctx, "Logged blind. The reveal: " + (bottle ? bottle.name : "saved."));
        }
      }
    });
  }

  function scheduleRender(ctx, delay) {
    if (ctx.ui.renderTimer) global.clearTimeout(ctx.ui.renderTimer);
    ctx.ui.renderTimer = global.setTimeout(() => {
      ctx.ui.renderTimer = null;
      render(ctx);
    }, delay);
  }

  // Search-as-you-type: refresh only the results list, never the input element.
  function scheduleStoreResults(ctx) {
    if (ctx.ui.storeResultsTimer) global.clearTimeout(ctx.ui.storeResultsTimer);
    ctx.ui.storeResultsTimer = global.setTimeout(() => {
      ctx.ui.storeResultsTimer = null;
      const list = ctx.mount && ctx.mount.querySelector ? ctx.mount.querySelector(".bottle-list") : null;
      if (list) list.innerHTML = renderStoreResults(ctx);
      else render(ctx);
    }, 110);
  }

  function renderStoreResults(ctx) {
    const filtered = getFilteredBottleInfo(ctx);
    return `
      ${renderSearchSummary(filtered)}
      ${renderStorePicksToggle(ctx, filtered)}
      ${filtered.items.map((bottle) => renderMiniBottle(ctx, bottle)).join("")}
    `;
  }

  // ---------- Barcode scanning ----------
  // The overlay lives on document.body, outside the render cycle, because a
  // re-render would destroy the <video> element and kill the camera stream.

  function getBarcodeIndex(ctx) {
    if (!ctx._barcodeIndex && barcodeLogic) {
      ctx._barcodeIndex = barcodeLogic.buildIndex(ctx.bottles, ctx.state.barcodeLinks || {});
    }
    return ctx._barcodeIndex;
  }

  function openScanner(ctx) {
    if (ctx._scanner) return;
    const doc = global.document;
    const overlay = doc.createElement("div");
    overlay.className = "scan-overlay";
    overlay.innerHTML = `
      <div class="scan-sheet" role="dialog" aria-modal="true" aria-label="Scan a barcode">
        <button class="scorecard-close" type="button" data-scan="close" aria-label="Close scanner">&times;</button>
        <p class="eyebrow">Scan a bottle</p>
        <div class="scan-video-wrap">
          <video class="scan-video" muted playsinline></video>
          <div class="scan-reticle" aria-hidden="true"></div>
        </div>
        <div class="scan-controls">
          <button class="ghost-button scan-ctl" type="button" data-scan="torch" hidden>Light</button>
          <button class="ghost-button scan-ctl" type="button" data-scan="zoom" hidden>Zoom 2&times;</button>
        </div>
        <p class="scan-status">Starting camera&hellip;</p>
        <div class="scan-manual">
          <label class="field"><span>Or type the barcode</span><input class="scan-manual-input" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. 088004021344"></label>
          <button class="ghost-button" type="button" data-scan="manual">Find</button>
        </div>
      </div>
    `;
    doc.body.appendChild(overlay);

    const scanner = {
      overlay,
      video: overlay.querySelector(".scan-video"),
      status: overlay.querySelector(".scan-status"),
      stream: null,
      timer: null,
      reader: null,
      lastCode: "",
      lastAt: 0
    };
    ctx._scanner = scanner;

    overlay.addEventListener("click", (event) => {
      const btn = event.target.closest ? event.target.closest("[data-scan]") : null;
      if (btn && btn.dataset.scan === "close") { closeScanner(ctx); render(ctx); return; }
      if (btn && btn.dataset.scan === "manual") {
        const input = overlay.querySelector(".scan-manual-input");
        handleScanCode(ctx, input ? input.value : "");
        return;
      }
      if (btn && btn.dataset.scan === "torch") { toggleTorch(scanner, btn); return; }
      if (btn && btn.dataset.scan === "zoom") { toggleZoom(scanner, btn); return; }
      if (event.target === overlay) { closeScanner(ctx); render(ctx); }
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.classList && event.target.classList.contains("scan-manual-input")) {
        handleScanCode(ctx, event.target.value);
      }
    });

    startCamera(ctx, scanner);
  }

  function setScanStatus(ctx, text) {
    if (ctx._scanner && ctx._scanner.status) ctx._scanner.status.textContent = text;
  }

  async function startCamera(ctx, scanner) {
    const onCode = (raw) => {
      const now = Date.now();
      if (raw === scanner.lastCode && now - scanner.lastAt < 3000) return;
      scanner.lastCode = raw;
      scanner.lastAt = now;
      flashReticle(scanner);
      if (global.navigator && global.navigator.vibrate) { try { global.navigator.vibrate(60); } catch (error) {} }
      handleScanCode(ctx, raw);
    };

    try {
      // One getUserMedia for both engines, asking for the sharpest feed the
      // device will give — resolution is the #1 factor in 1D barcode decoding.
      scanner.stream = await global.navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: "continuous" }]
        },
        audio: false
      });
      scanner.track = scanner.stream.getVideoTracks ? scanner.stream.getVideoTracks()[0] : null;
      scanner.video.srcObject = scanner.stream;
      await scanner.video.play();
      revealCameraControls(scanner);

      if (typeof global.BarcodeDetector === "function") {
        let detector;
        try {
          detector = new global.BarcodeDetector({ formats: ["upc_a", "upc_e", "ean_13", "ean_8", "code_128", "qr_code"] });
        } catch (error) {
          detector = new global.BarcodeDetector();
        }
        setScanStatus(ctx, "Point at the barcode.");
        // Detect on a center crop at native pixels: less frame to scan, more
        // pixels per bar. Busy flag instead of fixed cadence so slow frames
        // never stack.
        const canvas = global.document.createElement("canvas");
        const cctx = canvas.getContext("2d", { willReadFrequently: true });
        let busy = false;
        scanner.timer = global.setInterval(async () => {
          if (busy || !scanner.video.videoWidth) return;
          busy = true;
          try {
            const vw = scanner.video.videoWidth, vh = scanner.video.videoHeight;
            const cw = Math.round(vw * 0.8), chh = Math.round(vh * 0.55);
            canvas.width = cw; canvas.height = chh;
            cctx.drawImage(scanner.video, (vw - cw) / 2, (vh - chh) / 2, cw, chh, 0, 0, cw, chh);
            let found = await detector.detect(canvas);
            if (!(found && found.length)) found = await detector.detect(scanner.video);
            if (found && found.length && found[0].rawValue) onCode(found[0].rawValue);
          } catch (error) { /* per-frame detect errors are normal while focusing */ }
          busy = false;
        }, 150);
        return;
      }

      // iOS Safari path: vendored ZXing with decode hints — fewer formats to
      // try plus TRY_HARDER = faster, more reliable 1D reads.
      setScanStatus(ctx, "Loading scanner…");
      await loadScannerLibrary();
      if (!global.ZXing || !ctx._scanner) return;
      const Z = global.ZXing;
      let hints = null;
      try {
        hints = new Map([
          [Z.DecodeHintType.POSSIBLE_FORMATS, [
            Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
            Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8,
            Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.QR_CODE
          ]],
          [Z.DecodeHintType.TRY_HARDER, true]
        ]);
      } catch (error) { hints = null; }
      scanner.reader = new Z.BrowserMultiFormatReader(hints);
      const onResult = (result) => { if (result && result.getText) onCode(result.getText()); };
      // Decode from OUR stream so the torch/zoom track controls stay live.
      if (scanner.reader.decodeFromStream) {
        await scanner.reader.decodeFromStream(scanner.stream, scanner.video, onResult);
      } else if (scanner.reader.decodeFromVideoElement) {
        await scanner.reader.decodeFromVideoElement(scanner.video, onResult);
      } else {
        await scanner.reader.decodeFromVideoDevice(undefined, scanner.video, onResult);
      }
      setScanStatus(ctx, "Point at the barcode.");
    } catch (error) {
      setScanStatus(ctx, "Camera unavailable — type the code below instead.");
    }
  }

  // Show torch / zoom buttons only when the camera actually supports them
  // (mostly Android; iOS exposes neither — the buttons stay hidden there).
  function revealCameraControls(scanner) {
    if (!scanner.track || !scanner.track.getCapabilities) return;
    let caps = null;
    try { caps = scanner.track.getCapabilities(); } catch (error) { return; }
    if (!caps) return;
    const torchBtn = scanner.overlay.querySelector('[data-scan="torch"]');
    const zoomBtn = scanner.overlay.querySelector('[data-scan="zoom"]');
    if (caps.torch && torchBtn) torchBtn.hidden = false;
    if (caps.zoom && Number(caps.zoom.max) >= 2 && zoomBtn) zoomBtn.hidden = false;
  }

  function toggleTorch(scanner, btn) {
    if (!scanner.track || !scanner.track.applyConstraints) return;
    scanner.torchOn = !scanner.torchOn;
    scanner.track.applyConstraints({ advanced: [{ torch: scanner.torchOn }] }).catch(() => {});
    btn.classList.toggle("active", scanner.torchOn);
  }

  function toggleZoom(scanner, btn) {
    if (!scanner.track || !scanner.track.applyConstraints) return;
    scanner.zoomed = !scanner.zoomed;
    scanner.track.applyConstraints({ advanced: [{ zoom: scanner.zoomed ? 2 : 1 }] }).catch(() => {});
    btn.classList.toggle("active", scanner.zoomed);
    btn.textContent = scanner.zoomed ? "Zoom 1×" : "Zoom 2×";
  }

  function flashReticle(scanner) {
    const reticle = scanner.overlay && scanner.overlay.querySelector(".scan-reticle");
    if (!reticle) return;
    reticle.classList.remove("scan-hit");
    void reticle.offsetWidth;
    reticle.classList.add("scan-hit");
  }

  let scannerLibraryPromise = null;
  function loadScannerLibrary() {
    if (global.ZXing) return Promise.resolve();
    if (!scannerLibraryPromise) {
      scannerLibraryPromise = new Promise((resolve, reject) => {
        const script = global.document.createElement("script");
        script.src = "./vendor/zxing-library.min.js";
        script.async = true;
        script.onload = resolve;
        script.onerror = () => { scannerLibraryPromise = null; reject(new Error("scanner library failed to load")); };
        global.document.head.appendChild(script);
      });
    }
    return scannerLibraryPromise;
  }

  function closeScanner(ctx) {
    const scanner = ctx._scanner;
    if (!scanner) return;
    ctx._scanner = null;
    if (scanner.timer) global.clearInterval(scanner.timer);
    if (scanner.reader && scanner.reader.reset) { try { scanner.reader.reset(); } catch (error) {} }
    if (scanner.stream) { for (const track of scanner.stream.getTracks()) track.stop(); }
    if (scanner.overlay && scanner.overlay.parentNode) scanner.overlay.parentNode.removeChild(scanner.overlay);
  }

  function handleScanCode(ctx, raw) {
    if (!barcodeLogic || !barcodeLogic.isLikelyBarcode(raw)) {
      setScanStatus(ctx, "That doesn't look like a barcode — try again.");
      return;
    }
    const id = barcodeLogic.lookup(getBarcodeIndex(ctx), raw);
    if (id) {
      const bottle = getBottleIndex(ctx).get(id);
      closeScanner(ctx);
      ctx.state.activeBottleId = id;
      ctx.ui.scorecardContext = "store";
      ctx.ui.scorecardOpen = true;
      ctx.ui.lastScanCode = "";
      persist(ctx);
      render(ctx);
      showToast(ctx, "Scanned: " + (bottle ? bottle.name : "match found"));
      return;
    }
    const digits = String(raw).replace(/\D/g, "");
    ctx.ui.lastScanCode = digits;
    setScanStatus(ctx, "No match for " + digits + ". Close the scanner, find the bottle by name, and tap “Link scanned code” on its scorecard — next time it's instant.");
  }

  // On phones the cocktail spec stacks below the card list, so a tap updated
  // something off-screen. Scroll the spec into view — but only when it's actually
  // below the fold, so the desktop side-by-side layout is left alone.
  function revealCocktailSpec(ctx) {
    const spec = ctx.mount && ctx.mount.querySelector ? ctx.mount.querySelector(".cocktail-spec") : null;
    if (!spec || !spec.getBoundingClientRect || !spec.scrollIntoView) return;
    const vh = global.innerHeight ||
      (global.document && global.document.documentElement && global.document.documentElement.clientHeight) || 0;
    if (spec.getBoundingClientRect().top > vh * 0.4) {
      spec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function persist(ctx) {
    const ok = ctx.save(ctx.state);
    // ctx.save returns false when localStorage is full or blocked (e.g. private
    // browsing). Surface that so the user never silently loses a tasting or price.
    ctx.ui.saveFailed = ok === false;
    return ok;
  }

  function attachObservedPrices(ctx) {
    const P = global.BarrelPrices;
    if (!P || !ctx.state.prices) return;
    const byId = getBottlesById(ctx);
    for (const bottleId in ctx.state.prices) {
      const bottle = byId[bottleId];
      if (!bottle) continue;
      const s = P.stats(ctx.state, bottleId);
      if (s) {
        bottle.observedPrice = s.median;
        bottle.observedCount = s.count;
      } else {
        delete bottle.observedPrice;
        delete bottle.observedCount;
      }
    }
  }

  function render(ctx) {
    attachObservedPrices(ctx);
    const focusState = captureFocusState(ctx.mount);
    if (ctx.ui.tab === "night" && global.BarrelTableUI &&
        (global.BarrelTableUI.active(ctx) || (ctx.ui.table && ctx.ui.table.archiveId))) {
      ctx.mount.innerHTML = renderSaveBanner(ctx) + global.BarrelTableUI.render(ctx);
      restoreFocusState(ctx.mount, focusState);
      return;
    }
    const activeBottle = getActiveBottle(ctx);
    const result = rec.scoreBottleDecision({
      bottle: activeBottle,
      shelfPrice: ctx.state.storePrice,
      palate: ctx.palate,
      friends: ctx.friends,
      status: ctx.state.statuses[activeBottle.id]
    });

    ctx.mount.innerHTML = `
      ${renderHeader(ctx)}
      ${renderSaveBanner(ctx)}
      <nav class="tabbar" role="tablist" aria-label="Primary">
        ${tabButton(ctx, "cabinet", "Cabinet")}
        ${tabButton(ctx, "store", "Find bottle")}
        ${tabButton(ctx, "shelf", "Shelf")}
        ${tabButton(ctx, "tastings", "Tastings")}
        ${tabButton(ctx, "foryou", "For You")}
        ${tabButton(ctx, "families", "Distilleries")}
        ${tabButton(ctx, "showdown", "Showdown")}
        ${tabButton(ctx, "cocktails", "Cocktails")}
        ${tabButton(ctx, "night", "Night")}
        ${tabButton(ctx, "club", "Club")}
        ${tabButton(ctx, "qa", "Data")}
      </nav>
      <main>
        ${ctx.ui.tab === "cabinet" ? renderCabinet(ctx) : ""}
        ${ctx.ui.tab === "foryou" ? renderForYou(ctx) : ""}
        ${ctx.ui.tab === "store" ? renderStore(ctx, activeBottle, result) : ""}
        ${ctx.ui.tab === "families" ? renderFamilies(ctx) : ""}
        ${ctx.ui.tab === "showdown" ? renderShowdown(ctx) : ""}
        ${ctx.ui.tab === "shelf" ? renderShelf(ctx) : ""}
        ${ctx.ui.tab === "cocktails" ? renderCocktails(ctx, activeBottle) : ""}
        ${ctx.ui.tab === "tastings" ? renderTastings(ctx) : ""}
        ${ctx.ui.tab === "night" ? renderNight(ctx) : ""}
        ${ctx.ui.tab === "club" ? renderClub(ctx) : ""}
        ${ctx.ui.tab === "qa" ? renderCatalogQuality(ctx) : ""}
      </main>
      ${renderScorecard(ctx)}
    `;
    restoreFocusState(ctx.mount, focusState);
  }

  function captureFocusState(mount) {
    const active = global.document && global.document.activeElement;
    if (!active || !mount || !mount.contains || !mount.contains(active)) return null;
    if (!/^(INPUT|TEXTAREA|SELECT)$/i.test(active.tagName || "")) return null;

    return {
      id: active.id || "",
      name: active.getAttribute ? active.getAttribute("name") || "" : "",
      tagName: active.tagName,
      selectionStart: Number.isFinite(active.selectionStart) ? active.selectionStart : null,
      selectionEnd: Number.isFinite(active.selectionEnd) ? active.selectionEnd : null
    };
  }

  function restoreFocusState(mount, focusState) {
    if (!focusState || !mount || !mount.querySelector) return;
    const selector = focusState.id
      ? "#" + cssEscape(focusState.id)
      : focusState.name
        ? String(focusState.tagName || "").toLowerCase() + "[name=\"" + escapeSelectorAttr(focusState.name) + "\"]"
        : "";
    if (!selector) return;

    const next = mount.querySelector(selector);
    if (!next || !next.focus) return;
    next.focus({ preventScroll: true });
    if (next.setSelectionRange && focusState.selectionStart !== null && focusState.selectionEnd !== null) {
      try {
        next.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
      } catch (error) {
        // Some input types, such as number/date, do not support text selections.
      }
    }
  }

  function cssEscape(value) {
    const css = global.CSS;
    if (css && css.escape) return css.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => "\\" + char);
  }

  function escapeSelectorAttr(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function renderSaveBanner(ctx) {
    if (!ctx.ui.saveFailed) return "";
    return `
      <div class="save-banner" role="alert">
        <div>
          <strong>Your last change didn't save on this device.</strong>
          <span>Storage may be full or blocked (private browsing). Export a backup now so nothing is lost.</span>
        </div>
        <button class="primary-button" type="button" data-action="export">Export backup</button>
      </div>
    `;
  }

  function renderHeader(ctx) {
    const owned = countStatus(ctx, "owned");
    const wishlist = countStatus(ctx, "wishlist");
    const avgScore = average(ctx.state.tastings.map((tasting) => tasting.score));
    return `
      <header class="app-header">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <div>
            <p class="eyebrow">Private bourbon intelligence</p>
            <h1>Barrel Proof</h1>
          </div>
        </div>
        <div class="header-stats" aria-label="Collection snapshot">
          <div><span>${owned}</span><small>Owned</small></div>
          <div><span>${wishlist}</span><small>Wishlist</small></div>
          <div><span>${avgScore ? avgScore.toFixed(1) : "--"}</span><small>Avg pour</small></div>
        </div>
        <div class="header-actions">
          <button class="icon-button" type="button" data-action="export" title="Back up to a file" aria-label="Back up your data to a file">
            ${icon("download")}
          </button>
          <button class="icon-button" type="button" data-action="import" title="Restore from a backup file" aria-label="Restore your data from a backup file">
            ${icon("upload")}
          </button>
          <button class="icon-button" type="button" data-action="reset" title="Reset everything" aria-label="Reset everything">
            ${icon("rotate")}
          </button>
        </div>
      </header>
    `;
  }

  function renderObservedPrices(ctx, bottle) {
    const P = global.BarrelPrices;
    if (!P) return "";
    const obs = P.list(ctx.state, bottle.id);
    const s = P.stats(ctx.state, bottle.id);
    const storePrice = Number(ctx.state.storePrice);
    const canLog = Number.isFinite(storePrice) && storePrice > 0;
    return `
      <div class="price-log">
        <div class="price-log-head">
          <div>
            <p class="eyebrow">Observed prices</p>
            ${s
              ? `<strong>median $${Math.round(s.median)} &middot; $${Math.round(s.min)}&ndash;$${Math.round(s.max)}</strong><small>${s.count} sighting${s.count === 1 ? "" : "s"} &middot; drives your buy/pass</small>`
              : `<strong>No sightings yet</strong><small>Log what you see on the shelf to make pricing real and local</small>`}
          </div>
          <button class="primary-button price-log-btn" type="button" data-action="log-price"${canLog ? "" : " disabled"}>${canLog ? "Log $" + Math.round(storePrice) : "Enter a price"}</button>
        </div>
        ${obs.length ? `<div class="price-log-list">${obs.slice(0, 6).map((o, i) => `<span class="price-pill">$${Math.round(o.price)}${o.store ? " &middot; " + escapeHtml(o.store) : ""}<button class="price-x" type="button" data-action="remove-price" data-idx="${i}" aria-label="Remove sighting">&times;</button></span>`).join("")}</div>` : ""}
      </div>
    `;
  }

  // Quick-tap reference prices so an in-store buyer can test the call against the
  // tag in front of them without fumbling the number keypad one-handed.
  function renderPriceChips(ctx, bottle) {
    const chips = [];
    const seen = new Set();
    const add = (label, value) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const rounded = Math.round(value);
      if (seen.has(rounded)) return;
      seen.add(rounded);
      chips.push({ label, value: rounded });
    };
    add("MSRP", bottle.msrp);
    add("Fair", bottle.fairPrice);
    add("Source", rec.getSourceRetailPrice(bottle));
    add("You've seen", bottle.observedPrice);
    if (!chips.length) return "";
    const current = Number(ctx.state.storePrice);
    return `
      <div class="price-chips" aria-label="Tap a reference price">
        ${chips.map((chip) => `<button class="price-chip${current === chip.value ? " active" : ""}" type="button" data-price="${chip.value}">${escapeHtml(chip.label)} ${rec.money(chip.value)}</button>`).join("")}
      </div>
    `;
  }

  // The reusable bottle scorecard — one focused overlay opened by tapping a bottle
  // anywhere (Store results, Shelf). Essentials up top; the deep research lives in
  // a "Full details" expander so the answer is glanceable, no endless scroll.
  function renderScorecard(ctx) {
    if (!ctx.ui.scorecardOpen) return "";
    const bottle = getActiveBottle(ctx);
    if (!bottle) return "";
    const isShelf = ctx.ui.scorecardContext === "shelf";
    const entered = Number(ctx.state.storePrice);
    const priceEntered = Number.isFinite(entered) && entered > 0;
    const basis = priceEntered ? entered : (bottle.observedPrice || bottle.shelfAverage || rec.getReferencePrice(bottle));
    const haveBasis = Number.isFinite(basis) && basis > 0;
    const result = rec.scoreBottleDecision({
      bottle,
      shelfPrice: basis,
      palate: ctx.palate,
      friends: ctx.friends,
      status: ctx.state.statuses[bottle.id]
    });
    const showVerdict = priceEntered || (isShelf && haveBasis);
    const verdictClass = showVerdict ? "decision-" + result.decision.toLowerCase() : "decision-awaiting";
    const basisNote = (!priceEntered && isShelf && haveBasis)
      ? "Estimated at " + rec.money(basis) + " (typical). Enter a price to check a specific shelf."
      : "";
    const canonId = resolveIdentity(ctx, bottle.id);
    const pours = (ctx.state.tastings || []).filter((tasting) => resolveIdentity(ctx, tasting.bottleId) === canonId);
    const poursAvg = pours.length ? average(pours.map((pour) => Number(pour.score))) : null;
    const batchAverages = {};
    for (const pour of pours) {
      if (!pour.batch || !Number.isFinite(Number(pour.score))) continue;
      (batchAverages[pour.batch] = batchAverages[pour.batch] || []).push(Number(pour.score));
    }
    const batchRows = Object.entries(batchAverages)
      .map(([label, scores]) => ({ label, avg: average(scores), count: scores.length }))
      .sort((a, b) => b.avg - a.avg);

    return `
      <div class="scorecard-backdrop">
        <section class="scorecard-card ${verdictClass}" role="dialog" aria-modal="true" aria-label="${escapeAttr(bottle.name)} scorecard">
          <button class="scorecard-close" type="button" data-action="close-card" aria-label="Close scorecard">&times;</button>
          <div class="decision-topline">
            <div>
              <p class="eyebrow">${isShelf ? "Your bottle" : "Decision"}</p>
              <strong>${showVerdict ? escapeHtml(result.decision) : "Enter price"}</strong>
            </div>
            <div class="confidence-ring" style="--score:${showVerdict ? result.confidence : 0}">
              <span>${showVerdict ? result.confidence : "&ndash;"}</span>
            </div>
          </div>
          ${renderBottleHero(ctx, bottle)}
          <div class="scorecard-price">
            <label class="field price-field">
              <span>Shelf price you see</span>
              <input id="storePrice" type="number" min="0" step="1" value="${priceEntered ? entered : ""}" inputmode="decimal" placeholder="${haveBasis ? "~" + Math.round(basis) : "price"}">
            </label>
            ${renderPriceChips(ctx, bottle)}
          </div>
          <p class="decision-summary">${showVerdict ? escapeHtml(result.summary) : "Enter the shelf price to get your Buy / Consider / Pass call."}${basisNote ? ` <span class="muted-note">${escapeHtml(basisNote)}</span>` : ""}</p>
          <div class="decision-metrics">
            ${metric("MSRP", rec.money(bottle.msrp))}
            ${metric("Reference", getReferencePriceMetric(bottle))}
            ${metric("Palate fit", Math.round((result.palateMatch || 0) * 100) + "%")}
            ${metric("Friends", result.friendAverage ? result.friendAverage.toFixed(1) : "--")}
          </div>
          ${renderScorecardReviews(ctx, bottle)}
          ${ctx.ui.lastScanCode ? `<button class="ghost-button scan-link-btn" type="button" data-action="link-scan" data-bottle="${escapeAttr(bottle.id)}">Link scanned code ${escapeHtml(ctx.ui.lastScanCode)} to this bottle</button>` : ""}
          ${showVerdict && result.reasons.length ? `<div class="reason-block"><h3>Reasons</h3>${result.reasons.map((reason) => `<p>${escapeHtml(reason)}</p>`).join("")}</div>` : ""}
          ${showVerdict && result.cautions.length ? `<div class="reason-block caution"><h3>Cautions</h3>${result.cautions.map((caution) => `<p>${escapeHtml(caution)}</p>`).join("")}</div>` : ""}
          ${pours.length ? `<section class="scorecard-pours"><h3>Your pours</h3><p>${pours.length} logged${poursAvg ? " · avg " + poursAvg.toFixed(1) : ""}</p>${pours.slice(0, 3).map((pour) => `<div class="pour-row"><span>${escapeHtml(pour.date || "")}${pour.batch ? ' <span class="batch-tag">' + escapeHtml(pour.batch) + "</span>" : ""}${ratingsLogic && ratingsLogic.isBlindTasting(pour) ? ' <span class="blind-chip">Blind</span>' : ""}</span><b>${Number(pour.score).toFixed(1)}</b></div>`).join("")}${batchRows.length ? `<div class="batch-breakdown">${batchRows.map((row) => `<span class="batch-tag">${escapeHtml(row.label)} · ${row.avg.toFixed(1)}${row.count > 1 ? " (" + row.count + ")" : ""}</span>`).join("")}</div>` : ""}</section>` : ""}
          ${renderScorecardShelfRow(ctx, bottle)}
          <div class="status-actions">
            ${statusButton(ctx, "owned", "Add to shelf")}
            ${statusButton(ctx, "wishlist", "Wishlist")}
            ${statusButton(ctx, "passed", "Pass log")}
            <button class="ghost-button" type="button" data-action="log-active">Log tasting</button>
          </div>
          <details class="scorecard-more">
            <summary>Full details</summary>
            ${showVerdict ? renderDecisionTrustStack(ctx, bottle, result) : ""}
            ${renderObservedPrices(ctx, bottle)}
            ${renderMarketReality(ctx, bottle)}
            ${renderPriceWindow(bottle, result)}
            ${renderBottleIntelligence(ctx, bottle, result)}
            ${renderReviewIntelligence(ctx, bottle)}
            ${renderBottleDossier(ctx, bottle, result)}
            ${renderCocktailLane(ctx, bottle)}
            ${renderIdentityPanel(ctx, bottle)}
            ${renderBottleScout(ctx, bottle)}
          </details>
        </section>
      </div>
    `;
  }

  // Bottle lifecycle on the scorecard: backups (count) while owned, then
  // "Finished it", then the one question worth asking at that moment — rebuy?
  function renderScorecardShelfRow(ctx, bottle) {
    const C = global.BarrelCollection;
    const status = ctx.state.statuses[bottle.id];
    if (status === "owned" && C) {
      const count = Math.max(1, C.ownedCount(ctx.state, bottle.id));
      return `
        <div class="shelf-row">
          <span class="shelf-row-label">On your shelf${count > 1 ? " · " + (count - 1) + " backup" + (count === 2 ? "" : "s") : ""}</span>
          <span class="wiz-stepper"><button class="step-btn" type="button" data-action="own-count" data-bottle="${escapeAttr(bottle.id)}" data-delta="-1">&minus;</button><b>${count}</b><button class="step-btn" type="button" data-action="own-count" data-bottle="${escapeAttr(bottle.id)}" data-delta="1">+</button></span>
          <button class="ghost-button finish-btn" type="button" data-action="finish-bottle" data-bottle="${escapeAttr(bottle.id)}">Finished it</button>
        </div>
      `;
    }
    if (status === "finished") {
      const kill = [...(ctx.state.killLog || [])].reverse().find((entry) => entry.bottleId === bottle.id);
      const rebuy = kill ? kill.rebuy : null;
      return `
        <div class="shelf-row finished">
          <span class="shelf-row-label">Finished${kill && kill.date ? " · " + escapeHtml(kill.date) : ""}</span>
          ${rebuy === null || rebuy === undefined ? `
            <span class="rebuy-ask">Buy it again?</span>
            <button class="ghost-button" type="button" data-action="rebuy" data-bottle="${escapeAttr(bottle.id)}" data-val="1">Would rebuy</button>
            <button class="ghost-button" type="button" data-action="rebuy" data-bottle="${escapeAttr(bottle.id)}" data-val="0">One was enough</button>
          ` : `
            <span class="rebuy-pill ${rebuy ? "yes" : "no"}">${rebuy ? "Would rebuy ✓" : "One was enough"}</span>
          `}
        </div>
      `;
    }
    return "";
  }

  // The catalog has many spellings of some bottles. Let the user declare "this
  // IS that" so their pours and ratings aggregate under one canonical record.
  function renderIdentityPanel(ctx, bottle) {
    const links = ctx.state.identityLinks || {};
    const byId = getBottleIndex(ctx);
    const linkedTo = links[bottle.id] ? byId.get(links[bottle.id]) : null;
    const incoming = Object.keys(links).filter((id) => links[id] === bottle.id).length;
    if (linkedTo) {
      return `
        <section class="identity-panel">
          <h3>Same bottle</h3>
          <p>Counts as <strong>${escapeHtml(linkedTo.name)}</strong> in your ratings. <button class="link-inline" type="button" data-action="identity-unlink">Unlink</button></p>
        </section>
      `;
    }
    const query = (ctx.ui.identityQuery || "").trim().toLowerCase();
    let results = [];
    if (query.length >= MIN_SEARCH_CHARS) {
      for (const candidate of ctx.bottles) {
        if (results.length >= 6) break;
        if (candidate.id === bottle.id) continue;
        if (candidate._searchText.includes(query)) results.push(candidate);
      }
    }
    return `
      <section class="identity-panel">
        <h3>Same bottle, different spelling?</h3>
        <p class="source-note">If this is a duplicate of another catalog record, link it — pours on either spelling count as one bottle.${incoming ? " " + incoming + " record" + (incoming === 1 ? "" : "s") + " already point here." : ""}</p>
        <label class="field"><input id="identitySearch" type="search" value="${escapeAttr(ctx.ui.identityQuery || "")}" placeholder="Search the bottle this really is" autocomplete="off"></label>
        ${query.length >= MIN_SEARCH_CHARS ? `<div class="night-results">${results.length ? results.map((candidate) => `<button class="night-result" type="button" data-action="identity-link" data-canon="${escapeAttr(candidate.id)}"><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(getBottleMaker(candidate))}</small></button>`).join("") : `<p class="source-line">No matches.</p>`}</div>` : ""}
      </section>
    `;
  }

  function getGuessVerdict(ctx, tasting, bottle) {
    if (!ratingsLogic || !tasting.guess) return null;
    const fam = global.BarrelFamilies;
    const meta = {
      distillery: fam && fam.classify ? fam.classify(bottle || {}).distillery : "",
      style: bottleAttrs(bottle || {}).style || ""
    };
    return ratingsLogic.guessVerdict(tasting.guess, bottle, meta);
  }

  // Always-present review strip on the scorecard: curated, cited sources when we
  // have them; honest deep-links to r/bourbon / Breaking Bourbon / Whiskybase
  // when we don't. A buyer in an aisle should never hit a dead end.
  function renderScorecardReviews(ctx, bottle) {
    if (!reviewLogic) return "";
    const entries = reviewLogic.getBottleReviewEntries
      ? reviewLogic.getBottleReviewEntries(bottle, ctx.reviewData)
      : [];
    if (entries.length) {
      const top = entries.find((entry) => entry.verdict) || entries[0];
      return `
        <div class="scorecard-reviews">
          <span class="scorecard-reviews-label">Reviews</span>
          <span class="scorecard-reviews-main">${entries.length} cited source${entries.length === 1 ? "" : "s"}${top && top.verdict ? ` · <a href="${escapeAttr(top.url)}" target="_blank" rel="noopener">${escapeHtml(top.sourceName)}: “${escapeHtml(top.verdict)}”</a>` : ""}</span>
        </div>
      `;
    }
    const links = reviewLogic.buildReviewSearchLinks ? reviewLogic.buildReviewSearchLinks(bottle) : [];
    if (!links.length) return "";
    return `
      <div class="scorecard-reviews">
        <span class="scorecard-reviews-label">Reviews</span>
        <span class="scorecard-reviews-main">${links.map((link) => `<a class="review-link" href="${escapeAttr(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.sourceName)} &rarr;</a>`).join("")}</span>
      </div>
    `;
  }

  function renderStore(ctx) {
    const importedCount = ctx.catalogMeta.importedBottleCount || Math.max(0, ctx.bottles.length - 10);
    const fullCount = ctx.catalogMeta.fullBottleCount || importedCount;
    const rawCatalogNote = fullCount > importedCount
      ? ` Raw source pool: ${fullCount.toLocaleString("en-US")} records kept behind the confidence gate.`
      : "";
    return `
      <section class="section-stack store-stack">
        <section class="search-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Store Mode</p>
              <h2>Buy window</h2>
            </div>
            <button class="scan-button" type="button" data-action="scan-open" title="Scan a bottle's barcode">Scan</button>
          </div>
          <p class="source-note">Search ${importedCount.toLocaleString("en-US")} confident source-backed records — or tap Scan and point your camera at the barcode. Tap a bottle for its scorecard: your Buy / Consider / Pass call at the price you see.${rawCatalogNote}</p>
          ${ctx.ui.lastScanCode ? `<p class="scan-pending">Unmatched barcode <b>${escapeHtml(ctx.ui.lastScanCode)}</b> — open the right bottle's scorecard and tap “Link scanned code”, or <button class="link-inline" type="button" data-action="scan-dismiss">dismiss</button>.</p>` : ""}
          <label class="field">
            <span>Bottle</span>
            <input id="storeSearch" type="search" value="${escapeHtml(ctx.ui.query)}" placeholder="Search by bottle, distillery, profile">
          </label>
          ${renderStoreFilters(ctx)}
        </section>

        <section class="bottle-list" aria-label="Bottle results">
          ${renderStoreResults(ctx)}
        </section>
      </section>
    `;
  }

  function renderDecisionTrustStack(ctx, bottle, result) {
    const trust = buildDecisionTrust(ctx, bottle, result);
    return `
      <div class="trust-stack" aria-label="Decision trust">
        ${trust.map((item) => `
          <div class="trust-chip trust-${escapeAttr(item.tone)}">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
            <small>${escapeHtml(item.detail)}</small>
          </div>
        `).join("")}
      </div>
    `;
  }

  function buildDecisionTrust(ctx, bottle, result) {
    const confidence = getDatabaseConfidence(bottle);
    const review = buildReviewIntelligence(ctx, bottle);
    const priceWindow = getPriceWindow(bottle, result);
    const release = getReleaseTrust(bottle, review);
    return [
      {
        label: "Database",
        value: confidence.level,
        detail: confidence.score + " confidence",
        tone: confidence.level === "Strong" ? "strong" : confidence.level === "Partial" ? "partial" : "thin"
      },
      {
        label: "Reviews",
        value: review.hasReviews ? review.sourceCount + " cited" : "Scout",
        detail: review.hasReviews ? `${review.editorialCount} editorial / ${review.communityCount} community` : "No cited packet yet",
        tone: review.hasReviews ? "strong" : "thin"
      },
      {
        label: "Price",
        value: priceWindow.confidenceLabel,
        detail: priceWindow.hasReference ? priceWindow.reference.label : "Needs anchor",
        tone: priceWindow.confidence === "high" ? "strong" : priceWindow.confidence === "medium" ? "partial" : "thin"
      },
      release
    ];
  }

  function renderMarketReality(ctx, bottle) {
    const reality = buildMarketReality(ctx, bottle);
    if (!reality.shouldShow) return "";
    const link = reality.hasSecondary && reality.secondary.url
      ? `<a href="${escapeAttr(reality.secondary.url)}" target="_blank" rel="noopener">View source</a>`
      : `<a href="${escapeAttr(buildDramValueSearchUrl(bottle, buildDramValueQuery(bottle)))}" target="_blank" rel="noopener">Search DramValue</a>`;
    return `
      <section class="market-reality-card market-${escapeAttr(reality.hasSecondary ? "matched" : "missing")}">
        <div class="intel-heading">
          <div>
            <p class="eyebrow">Market Reality</p>
            <h3>${escapeHtml(reality.hasSecondary ? "Secondary-aware" : "Needs secondary check")}</h3>
          </div>
          ${link}
        </div>
        <p>${escapeHtml(reality.summary)}</p>
        <div class="market-reality-grid">
          ${reality.signals.map((signal) => metric(signal.label, signal.value)).join("")}
          ${metric("Shelf vs secondary", formatPercent(reality.ratios.shelfToSecondary))}
          ${metric("Shelf vs MSRP", formatRatio(reality.ratios.shelfToMsrp))}
        </div>
        ${reality.caveats.length ? `
          <div class="intel-tags">
            ${reality.caveats.slice(0, 3).map((caveat) => `<span>${escapeHtml(caveat)}</span>`).join("")}
          </div>
        ` : ""}
      </section>
    `;
  }

  function buildMarketReality(ctx, bottle) {
    if (rec.getMarketReality) {
      return rec.getMarketReality(bottle, ctx.state && ctx.state.storePrice);
    }
    const secondary = rec.getSecondaryMarketInfo ? rec.getSecondaryMarketInfo(bottle) : { value: null };
    const sourceRetail = rec.getSourceRetailPrice ? rec.getSourceRetailPrice(bottle) : bottle.sourceRetailPrice;
    const msrp = Number.isFinite(bottle.msrp) ? bottle.msrp : null;
    const shelfPrice = Number(ctx.state && ctx.state.storePrice);
    const hasShelfPrice = Number.isFinite(shelfPrice) && shelfPrice > 0;
    const hasSecondary = Number.isFinite(secondary.value);
    const ratios = {
      shelfToSecondary: hasShelfPrice && hasSecondary ? shelfPrice / secondary.value : null,
      shelfToMsrp: hasShelfPrice && Number.isFinite(msrp) ? shelfPrice / msrp : null
    };
    const signals = [
      Number.isFinite(msrp) ? { label: "MSRP", value: money(msrp) } : null,
      Number.isFinite(sourceRetail) ? { label: "Official retail", value: money(sourceRetail) } : null,
      hasSecondary ? { label: secondary.label || "Secondary avg", value: money(secondary.value) } : null
    ].filter(Boolean);
    return {
      shouldShow: hasSecondary || Number.isFinite(msrp) || Number.isFinite(sourceRetail),
      hasSecondary,
      secondary,
      ratios,
      signals,
      caveats: hasSecondary ? [] : ["No secondary-market result is attached yet."],
      summary: hasSecondary ? "Secondary market data is attached to this bottle." : "No secondary-market result is attached yet."
    };
  }

  function renderPriceWindow(bottle, result) {
    const priceWindow = getPriceWindow(bottle, result);
    if (!priceWindow.hasReference) {
      return `
        <section class="price-window-card price-window-thin">
          <div>
            <p class="eyebrow">Buy Window</p>
            <h3>No reliable price window yet</h3>
            <p>${escapeHtml(priceWindow.summary)}</p>
          </div>
        </section>
      `;
    }

    return `
      <section class="price-window-card price-window-${escapeAttr(priceWindow.confidence)}">
        <div>
          <p class="eyebrow">Buy Window</p>
          <h3>${escapeHtml(priceWindow.confidenceLabel)}</h3>
          <p>${escapeHtml(priceWindow.summary)}</p>
          ${priceWindow.caveats.length ? `<small>${escapeHtml(priceWindow.caveats[0])}</small>` : ""}
        </div>
        <div class="price-window-grid">
          ${metric("Buy under", money(priceWindow.buyBelow))}
          ${metric("Consider to", money(priceWindow.considerBelow))}
          ${metric("Pass above", money(priceWindow.passAbove))}
        </div>
      </section>
    `;
  }

  function renderBottleIntelligence(ctx, bottle, result) {
    const intel = buildBottleIntelligence(ctx, bottle, result);
    return `
      <section class="bottle-intelligence intel-${escapeAttr(intel.confidence.level.toLowerCase())}">
        <div class="intel-heading">
          <div>
            <p class="eyebrow">Bottle Intelligence</p>
            <h3>${escapeHtml(intel.confidence.level)} database confidence</h3>
          </div>
          <strong>${intel.confidence.score}</strong>
        </div>

        <div class="intel-facts" aria-label="Known bottle facts">
          ${intel.facts.map((fact) => `
            <div class="${fact.value === "Unknown" ? "is-missing" : ""}">
              <span>${escapeHtml(fact.label)}</span>
              <strong>${escapeHtml(fact.value)}</strong>
            </div>
          `).join("")}
        </div>

        <div class="intel-price">
          <div>
            <h3>Price Context</h3>
            <p>${escapeHtml(intel.price.message)}</p>
          </div>
          <div class="intel-stat-row">
            ${metric("Source range", intel.price.sourceRange)}
            ${metric("Reference", intel.price.reference)}
            ${metric("Shelf delta", intel.price.delta)}
          </div>
        </div>

        <div class="intel-two-up">
          <div>
            <h3>Source Coverage</h3>
            <p>${escapeHtml(intel.source.summary)}</p>
            <div class="intel-tags">
              ${intel.source.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
            </div>
          </div>
          <div>
            <h3>Data Gaps</h3>
            <div class="intel-tags">
              ${intel.missing.map((gap) => `<span>${escapeHtml(gap)}</span>`).join("")}
            </div>
          </div>
        </div>

        ${intel.sources.length ? `
          <div class="intel-source-list">
            <h3>Source Refs</h3>
            ${intel.sources.map((source) => `
              <p><span>${escapeHtml(source.label)}</span>${escapeHtml(source.recordId)}</p>
            `).join("")}
          </div>
        ` : ""}

        ${renderBottleScout(ctx, bottle)}
      </section>
    `;
  }

  function buildBottleIntelligence(ctx, bottle, result) {
    const confidence = getDatabaseConfidence(bottle);
    const summary = bottle.sourceSummary || {};
    const sourceRefs = getBottleSourceRefs(bottle);
    const priceInfo = rec.getReferencePriceInfo
      ? rec.getReferencePriceInfo(bottle)
      : { value: rec.getReferencePrice(bottle), label: "Reference" };
    const shelfPrice = Number(ctx.state && ctx.state.storePrice);
    const sourceCount = summary.sourceCount || sourceRefs.length;
    const priceCount = summary.priceObservationCount || countPriceObservations(bottle);
    const regions = Array.isArray(summary.regions) ? summary.regions.filter(Boolean) : [];
    const proofValue = bottle.proofDisplay || (Number.isFinite(bottle.proof) ? bottle.proof + " proof" : "");

    const sourceSummary = sourceCount
      ? `${sourceCount} official record${sourceCount === 1 ? "" : "s"}${priceCount ? ` with ${priceCount} price observation${priceCount === 1 ? "" : "s"}` : ""}.`
      : "No official source record attached yet.";
    const sourceTags = [
      sourceCount ? `${sourceCount} source${sourceCount === 1 ? "" : "s"}` : "No source refs",
      priceCount ? `${priceCount} price${priceCount === 1 ? "" : "s"}` : "No source price",
      regions.length ? regions.slice(0, 4).join(", ") : "No region coverage"
    ];

    const referenceText = Number.isFinite(priceInfo.value)
      ? `${money(priceInfo.value)} ${priceInfo.label ? `(${priceInfo.label})` : ""}`.trim()
      : "n/a";
    const deltaText = Number.isFinite(shelfPrice) && shelfPrice > 0 && Number.isFinite(priceInfo.value)
      ? formatDelta(shelfPrice - priceInfo.value)
      : "Enter price";

    return {
      confidence,
      facts: [
        intelligenceFact("Maker", getBottleMaker(bottle)),
        intelligenceFact("Category", bottle.category),
        intelligenceFact("Proof", proofValue),
        intelligenceFact("Age", bottle.age && bottle.age !== "NAS" ? bottle.age : ""),
        intelligenceFact("Size", bottle.size),
        intelligenceFact("Mash bill", bottle.mashBill && bottle.mashBill !== "Unknown" ? bottle.mashBill : "")
      ],
      price: {
        message: result && result.price && result.price.message
          ? result.price.message
          : "Price context depends on the entered shelf price and the best available reference.",
        sourceRange: getSourcePriceRange(summary),
        reference: referenceText,
        delta: deltaText
      },
      source: {
        summary: sourceSummary,
        tags: sourceTags
      },
      sources: sourceRefs.slice(0, 5).map((source) => ({
        label: source.sourceId ? source.sourceId.replace(/_/g, " ") : "source",
        recordId: source.sourceRecordId ? ` / ${source.sourceRecordId}` : ""
      })),
      missing: normalizeMissingFacts(confidence.missing)
    };
  }

  function renderReviewIntelligence(ctx, bottle) {
    const intel = buildReviewIntelligence(ctx, bottle);
    return `
      <section class="review-intelligence">
        <div class="intel-heading">
          <div>
            <p class="eyebrow">Review Intelligence</p>
            <h3>${intel.hasReviews ? "Cited review consensus" : "No cited reviews yet"}</h3>
          </div>
          <strong>${intel.sourceCount}</strong>
        </div>
        <p>${escapeHtml(intel.consensus)}</p>
        <div class="intel-stat-row">
          ${metric("Editorial", intel.editorialCount)}
          ${metric("Community", intel.communityCount)}
          ${metric("Sources", intel.sourceCount)}
        </div>
        ${intel.hasReviews ? `
          ${Array.isArray(intel.verdicts) && intel.verdicts.length ? `
            <div class="review-verdicts">
              ${intel.verdicts.map((verdict) => `
                <a href="${escapeAttr(verdict.url)}" target="_blank" rel="noopener">
                  <span>${escapeHtml(verdict.sourceName)} / ${escapeHtml(verdict.sourceType)}</span>
                  <strong>${escapeHtml(verdict.verdict)}</strong>
                </a>
              `).join("")}
            </div>
          ` : ""}
          <div class="review-takeaways">
            ${intel.takeaways.map((takeaway) => `
              <article>
                <p>${escapeHtml(takeaway.text)}</p>
                <a href="${escapeAttr(takeaway.url)}" target="_blank" rel="noopener">${escapeHtml(takeaway.sourceName)}</a>
              </article>
            `).join("")}
          </div>
          <div class="intel-tags">
            ${intel.sources.slice(0, 5).map((source) => `<span>${escapeHtml(source.sourceName)} / ${escapeHtml(source.sourceType)}</span>`).join("")}
          </div>
        ` : `
          <div class="review-links">
            ${(reviewLogic && reviewLogic.buildReviewSearchLinks ? reviewLogic.buildReviewSearchLinks(bottle) : []).map((link) => `<a class="review-link" href="${escapeAttr(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.sourceName)} &rarr;</a>`).join("")}
          </div>
          <button class="ghost-button" type="button" data-action="copy-review-research">${ctx.ui.reviewCopied ? "Copied" : "Copy review scout"}</button>
        `}
      </section>
    `;
  }

  function renderBottleDossier(ctx, bottle, result) {
    const dossier = buildBottleDossier(ctx, bottle, result);
    return `
      <section class="bottle-dossier dossier-${escapeAttr(dossier.trustTone)}">
        <div class="intel-heading">
          <div>
            <p class="eyebrow">Bottle Dossier</p>
            <h3>${escapeHtml(dossier.headline)}</h3>
          </div>
          <strong>${escapeHtml(dossier.grade)}</strong>
        </div>
        <p>${escapeHtml(dossier.summary)}</p>
        <div class="dossier-grid">
          ${dossier.facts.map((fact) => metric(fact.label, fact.value)).join("")}
        </div>
        <div class="dossier-lanes">
          ${dossier.lanes.map((lane) => `
            <article>
              <span>${escapeHtml(lane.label)}</span>
              <strong>${escapeHtml(lane.value)}</strong>
              <small>${escapeHtml(lane.detail)}</small>
            </article>
          `).join("")}
        </div>
        ${dossier.actions.length ? `
          <div class="intel-tags">
            ${dossier.actions.map((action) => `<span>${escapeHtml(action)}</span>`).join("")}
          </div>
        ` : ""}
      </section>
    `;
  }

  function buildBottleDossier(ctx, bottle, result) {
    const confidence = getDatabaseConfidence(bottle);
    const review = buildReviewIntelligence(ctx, bottle);
    const priceWindow = getPriceWindow(bottle, result);
    const sourceRefs = getBottleSourceRefs(bottle);
    const curated = bottle.curated || {};
    const release = getReleaseTrust(bottle, review);
    const actions = [];

    if (!curated.canonicalId && isTopShelfCandidate(bottle)) actions.push("Needs curated overlay");
    if (!review.hasReviews) actions.push("Needs cited review packet");
    if (!priceWindow.hasReference || priceWindow.confidence === "low") actions.push("Verify price anchor");
    if (release.tone === "thin") actions.push("Match exact release");
    if (confidence.level !== "Strong") actions.push("Fill database gaps");

    const grade = confidence.level === "Strong" && review.hasReviews && priceWindow.confidence !== "none"
      ? "Ready"
      : actions.length >= 3
        ? "Audit"
        : "Watch";

    return {
      grade,
      trustTone: grade === "Ready" ? "strong" : grade === "Watch" ? "partial" : "thin",
      headline: curated.releaseSpecific && curated.releaseLabel ? curated.releaseLabel : bottle.name,
      summary: buildDossierSummary(bottle, confidence, review, priceWindow, release),
      facts: [
        { label: "Maker", value: getBottleMaker(bottle) },
        { label: "Category", value: bottle.category || "Unknown" },
        { label: "Proof", value: bottle.proofDisplay || (Number.isFinite(bottle.proof) ? bottle.proof + " proof" : "Unknown") },
        { label: "Age", value: bottle.age || "Unknown" },
        { label: "MSRP", value: money(bottle.msrp) },
        { label: "Sources", value: String((bottle.sourceSummary && bottle.sourceSummary.sourceCount) || sourceRefs.length || 0) }
      ],
      lanes: [
        {
          label: "Identity",
          value: curated.canonicalId ? "Curated" : confidence.level,
          detail: curated.sourceNote || confidence.summary
        },
        {
          label: "Reviews",
          value: review.hasReviews ? review.sourceCount + " cited" : "Missing",
          detail: review.hasReviews ? review.consensus : "No source-backed review consensus attached."
        },
        {
          label: "Market",
          value: priceWindow.hasReference ? priceWindow.confidenceLabel : "No anchor",
          detail: priceWindow.hasReference ? priceWindow.summary : priceWindow.summary
        },
        {
          label: "Release",
          value: release.value,
          detail: release.detail
        }
      ],
      actions
    };
  }

  function buildDossierSummary(bottle, confidence, review, priceWindow, release) {
    const parts = [
      `${bottle.name} is ${confidence.level.toLowerCase()} in the local database.`,
      review.hasReviews ? `${review.sourceCount} cited review source${review.sourceCount === 1 ? "" : "s"} attached.` : "No cited review packet attached.",
      priceWindow.hasReference ? `Price anchor is ${priceWindow.reference.label}.` : "No price anchor yet.",
      `Release match: ${release.value.toLowerCase()}.`
    ];
    return parts.join(" ");
  }

  function buildReviewIntelligence(ctx, bottle) {
    if (!reviewLogic || !reviewLogic.buildReviewIntelligence) {
      return {
        hasReviews: false,
        sourceCount: 0,
        editorialCount: 0,
        communityCount: 0,
        consensus: "No cited review sources are attached to this bottle yet.",
        takeaways: [],
        verdicts: [],
        sources: [],
        suggestedSources: ["Breaking Bourbon", "r/bourbon", "producer tasting notes"]
      };
    }
    return reviewLogic.buildReviewIntelligence({
      bottle,
      reviewData: ctx.reviewData
    });
  }

  function intelligenceFact(label, value) {
    const clean = String(value || "").trim();
    return { label, value: clean || "Unknown" };
  }

  function normalizeMissingFacts(missing) {
    const gaps = (missing || []).filter((gap) => gap && !/^Look for newer/i.test(gap));
    return gaps.length ? gaps.slice(0, 6) : ["No major gaps"];
  }

  function getBottleSourceRefs(bottle) {
    return bottle.sourceRefs || bottle.sourcePreview || [];
  }

  function getPriceWindow(bottle, result) {
    if (result && result.price && result.price.priceWindow) return result.price.priceWindow;
    if (rec.getPriceWindow) return rec.getPriceWindow(bottle);
    const reference = rec.getReferencePriceInfo
      ? rec.getReferencePriceInfo(bottle)
      : { value: rec.getReferencePrice(bottle), label: "Reference", confidence: "none" };
    return {
      hasReference: Number.isFinite(reference.value),
      reference,
      confidence: reference.confidence || "none",
      confidenceLabel: reference.confidence ? reference.confidence + " confidence" : "No price anchor",
      summary: "Price window depends on the best available reference.",
      caveats: [],
      buyBelow: null,
      considerBelow: null,
      passAbove: null
    };
  }

  function getReleaseTrust(bottle, review) {
    const curated = bottle.curated || {};
    const reviewIds = Array.isArray(bottle.reviewIds) ? bottle.reviewIds.join(" ") : "";
    const text = [bottle.id, bottle.name, bottle.releaseYear, bottle.batchCode, bottle.proofDisplay, reviewIds]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (curated.releaseSpecific) {
      return {
        label: "Release",
        value: "Matched",
        detail: curated.releaseLabel || "Curated release facts",
        tone: "strong"
      };
    }

    if (/\b(20\d{2}|batch|pact|chapter|spring|fall|release|limited edition|008|009|25b)\b/.test(text)) {
      return {
        label: "Release",
        value: "Specific",
        detail: "Release-level review/data",
        tone: "partial"
      };
    }

    if (/batch dependent|proof range|proof n\/a|unknown/i.test(String(bottle.age || "") + " " + String(bottle.proofDisplay || ""))) {
      return {
        label: "Release",
        value: "Family",
        detail: "Match exact label when possible",
        tone: "thin"
      };
    }

    return {
      label: "Release",
      value: "Core",
      detail: "Stable bottle identity",
      tone: review.hasReviews ? "strong" : "partial"
    };
  }

  function countPriceObservations(bottle) {
    return (bottle.prices || []).filter((price) => Number.isFinite(price.retailPrice)).length;
  }

  function money(value) {
    if (rec.money) return rec.money(value);
    if (!Number.isFinite(value)) return "n/a";
    return "$" + Math.round(value).toLocaleString("en-US");
  }

  function formatDelta(value) {
    if (!Number.isFinite(value)) return "n/a";
    if (Math.abs(value) < 1) return "At reference";
    const prefix = value > 0 ? "+" : "-";
    return prefix + money(Math.abs(value));
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return "n/a";
    return Math.round(value * 100) + "%";
  }

  function formatRatio(value) {
    if (!Number.isFinite(value)) return "n/a";
    return value >= 10 ? Math.round(value) + "x" : value.toFixed(value >= 2 ? 1 : 2) + "x";
  }

  function renderBottleScout(ctx, bottle) {
    const prompt = buildResearchPrompt(ctx, bottle);
    const confidence = getDatabaseConfidence(bottle);
    const scoutOpen = confidence.shouldScout ? " open" : "";
    return `
      <section class="scout-panel scout-${confidence.level.toLowerCase()}">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Database confidence</p>
            <h3>${escapeHtml(confidence.level)} / ${confidence.score}</h3>
          </div>
        </div>
        <p>${escapeHtml(confidence.summary)}</p>
        <div class="confidence-checklist">
          ${confidence.missing.slice(0, 4).map((gap) => `<span>${escapeHtml(gap)}</span>`).join("") || "<span>No major gaps</span>"}
        </div>
        <details class="scout-preview"${scoutOpen}>
          <summary>${confidence.shouldScout ? "Bottle Scout Lite" : "Optional research prompt"}</summary>
          <p>No API cost. Copy this prompt, open ChatGPT, and paste it when the app needs facts our database does not have yet.</p>
          <div class="scout-actions">
            <button class="primary-button" type="button" data-action="copy-research">${ctx.ui.researchCopied ? "Copied" : "Copy prompt"}</button>
            <a class="ghost-link" href="https://chatgpt.com/" target="_blank" rel="noopener">Open ChatGPT</a>
          </div>
          <textarea readonly rows="9">${escapeHtml(prompt)}</textarea>
        </details>
      </section>
    `;
  }

  function renderCocktailLane(ctx, bottle) {
    const match = getBestCocktailMatch(ctx, bottle);
    if (!match) return "";
    return `
      <section class="cocktail-lane">
        <div>
          <p class="eyebrow">Cocktail lane</p>
          <h3>${escapeHtml(match.cocktail.name)}</h3>
          <p>${escapeHtml(match.reason)}</p>
        </div>
        <button class="ghost-button" type="button" data-action="view-cocktail">View spec</button>
      </section>
    `;
  }

  function renderSourceIntel(bottle) {
    const summary = bottle.sourceSummary || {};
    const sourceCount = summary.sourceCount || (bottle.sourceRefs || bottle.sourcePreview || []).length;
    if (!sourceCount) return "";
    const priceRange = getSourcePriceRange(summary);
    const regions = (summary.regions || []).slice(0, 5).join(", ");
    const preview = (bottle.sourceRefs || bottle.sourcePreview || [])
      .slice(0, 4)
      .map((source) => source.sourceId.replace(/_/g, " "))
      .join(" / ");
    return `
      <section class="source-intel">
        <div>
          <p class="eyebrow">Source Intel</p>
          <h3>${sourceCount} official record${sourceCount === 1 ? "" : "s"}</h3>
          <p>${escapeHtml(preview || "Source-backed identity record")}</p>
        </div>
        <div class="source-intel-stats">
          ${metric("Prices", summary.priceObservationCount || 0)}
          ${metric("Range", priceRange)}
          ${metric("Regions", regions || "n/a")}
        </div>
      </section>
    `;
  }

  function getSourcePriceRange(summary) {
    if (!summary || !Number.isFinite(summary.minRetailPrice)) return "n/a";
    if (summary.minRetailPrice === summary.maxRetailPrice) return rec.money(summary.minRetailPrice);
    return rec.money(summary.minRetailPrice) + "-" + rec.money(summary.maxRetailPrice);
  }

  function renderConnoisseurStrip(ctx, bottle) {
    const fam = global.BarrelFamilies;
    const sd = global.BarrelShowdown;
    if (!fam) return "";
    const a = bottleAttrs(bottle);
    const cls = fam.classify(bottle);
    const badges = [];
    if (a.whiskeyType && a.whiskeyType !== "Other whiskey") badges.push(a.whiskeyType);
    if (a.style && a.style !== "Traditional bourbon") badges.push(a.style.replace(" bourbon", ""));
    if (a.singleBarrel) badges.push("Single barrel");
    if (a.smallBatch) badges.push("Small batch");
    if (a.bottledInBond) badges.push("Bottled in bond");
    if (a.caskStrength) badges.push("Cask strength");
    if (a.finished) badges.push("Finished");
    const tier = sd ? sd.tierScore(bottle) : null;
    const tierText = sd && Number.isFinite(tier) ? `${sd.tierLabel(tier)} · ${tier}` : "";
    return `
      <div class="conn-strip">
        ${cls.matched ? `<button class="conn-house" type="button" data-action="goto-family" data-famid="${escapeAttr(cls.distilleryId)}">${escapeHtml(cls.distillery)} &rarr;</button>` : ""}
        ${badges.map((b) => `<span class="conn-badge">${escapeHtml(b)}</span>`).join("")}
        ${a.proofTier ? `<span class="conn-badge ghost">${escapeHtml(a.proofTier.split(" (")[0])}</span>` : ""}
        ${tierText ? `<span class="conn-tier">${escapeHtml(tierText)}</span>` : ""}
      </div>
    `;
  }

  function renderBottleHero(ctx, bottle) {
    return `
      <div class="bottle-hero">
        ${bottleVisual(bottle)}
        <div class="bottle-copy">
          <span class="status-pill">${statusLabel(ctx.state.statuses[bottle.id])}</span>
          <h2>${escapeHtml(bottle.name)}</h2>
          <p>${escapeHtml(getBottleMaker(bottle))} / ${escapeHtml(bottle.category)}</p>
          ${renderSourceLine(bottle)}
          <div class="hero-tags">
            ${(bottle.profile || []).slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
          </div>
        </div>
      </div>
      ${renderConnoisseurStrip(ctx, bottle)}
    `;
  }

  function renderMiniBottle(ctx, bottle) {
    const active = bottle.id === ctx.state.activeBottleId ? " active" : "";
    const status = ctx.state.statuses[bottle.id] || "none";
    const friendAvg = rec.getFriendAverage(bottle.id, ctx.friends);
    const proofText = bottle.proofDisplay || (bottle.proof ? bottle.proof + " proof" : "proof n/a");
    return `
      <button class="mini-bottle${active}" type="button" data-open-card="${escapeAttr(bottle.id)}" data-card-context="store">
        ${bottleVisual(bottle)}
        <span class="mini-main">
          <strong>${escapeHtml(bottle.name)}</strong>
          <small>${escapeHtml(getBottleMaker(bottle))} / ${escapeHtml(proofText)}</small>
          <span class="mini-tags">
            <span>${escapeHtml(confidenceLabel(bottle) || bottle.rarity)}</span>
            <span>${statusLabel(status)}</span>
            ${bottle._variantCount > 1 ? `<span class="variant-chip">${bottle._variantCount} listings</span>` : `<span>${friendAvg ? friendAvg.toFixed(1) + " club" : "no club score"}</span>`}
          </span>
        </span>
      </button>
    `;
  }

  function confidenceLabel(bottle) {
    if (bottle.catalogConfidence === "verified") return "Verified";
    if (bottle.catalogConfidence === "cross-checked") return "Cross-checked";
    if (bottle.catalogConfidence === "priced-source") return "Priced source";
    return "";
  }

  function renderCocktails(ctx, activeBottle) {
    const ranked = getCocktailRankings(ctx, activeBottle);
    const activeCocktail = getActiveCocktail(ctx, ranked);
    return `
      <section class="cocktail-layout">
        <div class="cocktail-list">
          <section class="search-panel">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">High-end bar specs</p>
                <h2>Classic bourbon cocktails</h2>
              </div>
            </div>
            <p class="source-note">Specs are curated house standards for premium service. Bottle fit is matched against the active bottle in Store Mode.</p>
          </section>
          <div class="cocktail-card-grid">
            ${ranked.map((item) => renderCocktailCard(ctx, item)).join("")}
          </div>
        </div>
        ${renderCocktailSpec(activeCocktail, activeBottle)}
      </section>
    `;
  }

  function renderCocktailCard(ctx, item) {
    const active = item.cocktail.id === ctx.ui.activeCocktailId ? " active" : "";
    return `
      <button class="cocktail-card${active}" type="button" data-cocktail-id="${escapeAttr(item.cocktail.id)}">
        <span>
          <strong>${escapeHtml(item.cocktail.name)}</strong>
          <small>${escapeHtml(item.cocktail.family)} / ${escapeHtml(item.cocktail.proofLane)}</small>
        </span>
        <b>${item.score}</b>
      </button>
    `;
  }

  function renderCocktailSpec(item, activeBottle) {
    if (!item) return emptyState("No cocktail specs loaded yet.");
    const cocktail = item.cocktail;
    const ingredients = cocktailLogic ? cocktailLogic.formatIngredients(cocktail) : (cocktail.ingredients || []).map((ingredient) => ingredient.join(" "));
    return `
      <aside class="cocktail-spec">
        <div class="spec-topline">
          <div>
            <p class="eyebrow">${escapeHtml(cocktail.family)}</p>
            <h2>${escapeHtml(cocktail.name)}</h2>
          </div>
          <div class="spec-score">
            <span>${item.score}</span>
            <small>fit</small>
          </div>
        </div>
        <p class="decision-summary">${escapeHtml(item.reason)}</p>
        <div class="spec-meta">
          ${metric("Glass", cocktail.glassware)}
          ${metric("Ice", cocktail.ice)}
          ${metric("Proof lane", cocktail.proofLane)}
          ${metric("Active bottle", activeBottle.name)}
        </div>
        <section class="spec-section">
          <h3>Spec</h3>
          ${ingredients.map((ingredient) => `<p>${escapeHtml(ingredient)}</p>`).join("")}
        </section>
        <section class="spec-section">
          <h3>Technique</h3>
          ${(cocktail.technique || []).map((step) => `<p>${escapeHtml(step)}</p>`).join("")}
        </section>
        <section class="spec-section">
          <h3>Garnish</h3>
          <p>${escapeHtml(cocktail.garnish)}</p>
        </section>
        <section class="spec-section">
          <h3>Bar note</h3>
          <p>${escapeHtml(cocktail.barNotes)}</p>
        </section>
      </aside>
    `;
  }

  const STYLE_COLORS = {
    "Traditional bourbon": "#cba35a",
    "Wheated bourbon": "#e7c06a",
    "High-rye bourbon": "#6f9e72",
    "Rye whiskey": "#a9743f",
    "Wheat whiskey": "#d8c08a",
    _: "#5a7e9b"
  };

  function shortStyle(name) {
    return {
      "Traditional bourbon": "Bourbon",
      "Wheated bourbon": "Wheated",
      "High-rye bourbon": "High-rye",
      "Rye whiskey": "Rye",
      "Wheat whiskey": "Wheat"
    }[name] || name;
  }

  function fmtProof(value) {
    return Number.isFinite(value) ? (Math.round(value * 10) / 10) + " pf" : "--";
  }

  function styleBars(styleMix, total) {
    const entries = Object.entries(styleMix || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length || !total) return "";
    const segs = entries
      .map(([name, n]) => `<span class="style-seg" style="width:${((100 * n) / total).toFixed(1)}%;background:${STYLE_COLORS[name] || STYLE_COLORS._}" title="${escapeAttr(name + ": " + n)}"></span>`)
      .join("");
    const legend = entries
      .slice(0, 4)
      .map(([name, n]) => `<span class="style-legend"><i style="background:${STYLE_COLORS[name] || STYLE_COLORS._}"></i>${escapeHtml(shortStyle(name))} ${n}</span>`)
      .join("");
    return `<div class="style-bar">${segs}</div><div class="style-legend-row">${legend}</div>`;
  }

  function familyIndex(ctx) {
    if (!ctx._familyIndex && global.BarrelFamilies) {
      ctx._familyIndex = global.BarrelFamilies.buildIndex(ctx.bottles);
    }
    return ctx._familyIndex || [];
  }

  function renderFamilies(ctx) {
    if (!global.BarrelFamilies) {
      return emptyState("Distillery intelligence is unavailable.");
    }
    const index = familyIndex(ctx);
    if (ctx.ui.activeFamily) {
      const group = index.find((g) => g.id === ctx.ui.activeFamily);
      if (group) return renderFamilyDetail(ctx, group);
    }
    return renderFamilyList(ctx, index);
  }

  function renderFamilyList(ctx, index) {
    const allMatched = index.filter((g) => g.matched);
    const allFallback = index.filter((g) => !g.matched);
    const mappedCount = allMatched.reduce((sum, g) => sum + g.count, 0);
    const typeFilter = ctx.ui.familyType || "";
    const sortKey = ctx.ui.familySort || "count";
    const sortFns = {
      count: (a, b) => b.count - a.count,
      proof: (a, b) => (b.avgProof || 0) - (a.avgProof || 0),
      hype: (a, b) => (b.avgHype || 0) - (a.avgHype || 0)
    };
    const sortFn = sortFns[sortKey] || sortFns.count;
    const byType = (g) => !typeFilter || g.topType === typeFilter;
    const matched = allMatched.filter(byType).slice().sort(sortFn);
    const fallback = allFallback.filter(byType);
    const fallbackShown = fallback.filter((g) => g.count >= 3).slice().sort(sortFn).slice(0, 24);
    const fallbackRest = fallback.length - fallbackShown.length;
    const sortOptions = [["count", "Bottles"], ["proof", "Avg proof"], ["hype", "Hype"]];
    const typeOptions = [["", "All"], ["Bourbon", "Bourbon"], ["Rye whiskey", "Rye"], ["Tennessee whiskey", "Tennessee"], ["Scotch", "Scotch"], ["Irish whiskey", "Irish"]];

    return `
      <section class="section-stack">
        <div class="search-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Distillery intelligence</p>
              <h2>Houses &amp; families</h2>
            </div>
          </div>
          <p class="source-note">Every bottle is mapped to its distillery and parent company, then profiled by mash-bill style, proof, and release type. Drill into a house to see its full lineup and analytics.</p>
          <div class="insight-grid">
            ${insight("Distillery houses", allMatched.length, "with a known producer")}
            ${insight("Bottles mapped", mappedCount.toLocaleString(), Math.round((100 * mappedCount) / Math.max(1, ctx.bottles.length)) + "% of catalog")}
            ${insight("Largest house", allMatched[0] ? allMatched[0].name : "--", allMatched[0] ? allMatched[0].count + " bottles" : "")}
            ${insight("Other labels", allFallback.length.toLocaleString(), "smaller / sourced brands")}
          </div>
          <div class="store-filters family-controls">
            <div class="filter-group">
              <span class="filter-label">Sort</span>
              ${sortOptions.map(([v, l]) => `<button class="filter-button${sortKey === v ? " active" : ""}" type="button" data-famsort="${v}">${escapeHtml(l)}</button>`).join("")}
            </div>
            <div class="filter-group">
              <span class="filter-label">Type</span>
              ${typeOptions.map(([v, l]) => `<button class="filter-button${typeFilter === v ? " active" : ""}" type="button" data-famtype="${escapeAttr(v)}">${escapeHtml(l)}</button>`).join("")}
            </div>
          </div>
        </div>
        <div class="family-grid">
          ${matched.length ? matched.map((g) => renderFamilyCard(g)).join("") : emptyState("No distilleries match this filter.")}
        </div>
        ${fallbackShown.length ? `
          <div class="search-panel">
            <div class="panel-heading"><h3>Other labels &amp; sourced brands</h3></div>
            <div class="family-grid compact">
              ${fallbackShown.map((g) => renderFamilyCard(g)).join("")}
            </div>
            ${fallbackRest > 0 ? `<p class="source-line">+ ${fallbackRest.toLocaleString()} more smaller labels in the catalog.</p>` : ""}
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderFamilyCard(group) {
    const cs = group.counts;
    return `
      <button class="family-card" type="button" data-family="${escapeAttr(group.id)}">
        <div class="family-card-top">
          <div class="family-card-name">
            <strong>${escapeHtml(group.name)}</strong>
            <small>${escapeHtml([group.parent, group.region].filter(Boolean).join(" · "))}</small>
          </div>
          <span class="family-count">${group.count}</span>
        </div>
        <div class="family-mini">
          <div><span>Avg proof</span><strong>${escapeHtml(fmtProof(group.avgProof))}</strong></div>
          <div><span>Bonded</span><strong>${cs.bib}</strong></div>
          <div><span>Cask str.</span><strong>${cs.cask}</strong></div>
        </div>
        ${styleBars(group.styleMix, group.count)}
      </button>
    `;
  }

  function familyAttr(label, value, total) {
    const pct = total ? Math.round((100 * value) / total) : 0;
    return `<div class="family-attr"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${pct}% of house</small></div>`;
  }

  function renderFamilyDetail(ctx, group) {
    const cs = group.counts;
    const proofRange = Number.isFinite(group.minProof) ? `${group.minProof}–${group.maxProof} pf` : "--";
    const msrp = Number.isFinite(group.medianMsrp) ? rec.money(group.medianMsrp) : "n/a";
    const msrpNote = Number.isFinite(group.minMsrp) ? `${rec.money(group.minMsrp)}–${rec.money(group.maxMsrp)}` : "no MSRP data";
    const brands = group.brands.slice(0, 24);

    return `
      <section class="section-stack family-detail">
        <button class="ghost-button family-back" type="button" data-family="">&larr; All distilleries</button>
        <div class="search-panel">
          <div class="family-detail-head">
            <div>
              <p class="eyebrow">${escapeHtml([group.parent, group.region].filter(Boolean).join(" · "))}</p>
              <h2>${escapeHtml(group.name)}</h2>
            </div>
            <span class="family-count lg">${group.count}</span>
          </div>
          <div class="insight-grid">
            ${insight("Bottles", group.count, "in catalog")}
            ${insight("Avg proof", fmtProof(group.avgProof), proofRange)}
            ${insight("Median MSRP", msrp, msrpNote)}
            ${insight("Avg hype", Number.isFinite(group.avgHype) ? Math.round(group.avgHype) : "--", "0–100 scarcity")}
          </div>
          <div class="family-attr-grid">
            ${familyAttr("Bottled in bond", cs.bib, group.count)}
            ${familyAttr("Single barrel", cs.single, group.count)}
            ${familyAttr("Small batch", cs.small, group.count)}
            ${familyAttr("Cask strength", cs.cask, group.count)}
            ${familyAttr("Sourced", cs.sourced, group.count)}
            ${familyAttr("Finished", cs.finished, group.count)}
          </div>
          <div class="family-section">
            <h3>Mash-bill style</h3>
            ${styleBars(group.styleMix, group.count)}
          </div>
          <div class="family-section">
            <h3>Brands &amp; expressions (${group.brands.length})</h3>
            <div class="brand-chips">
              ${brands.map((b) => `<span class="brand-chip">${escapeHtml(b.name)} <i>${b.count}</i></span>`).join("")}
            </div>
          </div>
        </div>
        <div class="search-panel">
          <div class="panel-heading"><h3>Notable bottles</h3></div>
          <div class="bottle-list">
            ${group.notable.map((item) => renderFamilyBottle(item)).join("")}
          </div>
        </div>
      </section>
    `;
  }

  function renderFamilyBottle(item) {
    const bottle = item.bottle;
    const attrs = item.attrs;
    const facts = [fmtProof(Number(bottle.proof)), shortStyle(attrs.style)]
      .filter((part) => part && part !== "--")
      .join(" · ");
    const flags = [];
    if (attrs.singleBarrel) flags.push("Single barrel");
    if (attrs.bottledInBond) flags.push("Bonded");
    if (attrs.caskStrength) flags.push("Cask strength");
    if (attrs.finished) flags.push("Finished");
    const tags = flags.slice(0, 3).map((f) => `<span>${escapeHtml(f)}</span>`).join("");
    return `
      <button class="mini-bottle" type="button" data-goto="${escapeAttr(bottle.id)}">
        ${bottleVisual(bottle)}
        <span class="mini-main">
          <strong>${escapeHtml(bottle.name)}</strong>
          <small>${escapeHtml(facts)}${bottle.rarity ? " · " + escapeHtml(bottle.rarity) : ""}</small>
          ${tags ? `<span class="mini-tags">${tags}</span>` : ""}
        </span>
      </button>
    `;
  }

  function shortName(name) {
    const s = String(name || "");
    return s.length > 24 ? s.slice(0, 23) + "…" : s;
  }

  function getBottlesById(ctx) {
    if (!ctx._bottlesById) {
      ctx._bottlesById = {};
      for (const b of ctx.bottles) ctx._bottlesById[b.id] = b;
    }
    return ctx._bottlesById;
  }

  function showdownPool(ctx) {
    // Prefer the bottles the user intentionally tracks; otherwise pull a varied
    // pool of recognizable bottles. Never lean on "tasted" (Showdown sets that
    // itself, which would lock random onto the same pair).
    const picked = new Set([ctx.ui.showdownA, ctx.ui.showdownB]);
    let candidates = ctx.bottles.filter((b) => ["owned", "wishlist"].includes(ctx.state.statuses[b.id]));
    if (candidates.length < 4) {
      const hyped = ctx.bottles.filter((b) => Number.isFinite(Number(b.hypeIndex)));
      candidates = hyped.length >= 8 ? hyped : ctx.bottles;
    }
    let pool = candidates.filter((b) => !picked.has(b.id));
    if (pool.length < 2) pool = candidates.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    const a = pool[0];
    const b = pool.find((x, i) => i > 0 && x.name !== a.name) || pool[1];
    return [a, b].filter(Boolean);
  }

  function recordMatchup(ctx, result) {
    const aId = ctx.ui.showdownA;
    const bId = ctx.ui.showdownB;
    if (!aId || !bId || aId === bId) return;
    if (!Array.isArray(ctx.state.matchups)) ctx.state.matchups = [];
    const winnerId = result === "tie" ? "tie" : result === "a" ? aId : bId;
    ctx.state.matchups.unshift({ id: "m-" + Date.now(), aId, bId, winnerId, ts: Date.now() });
    ctx.state.statuses[aId] = ctx.state.statuses[aId] || "tasted";
    ctx.state.statuses[bId] = ctx.state.statuses[bId] || "tasted";
    persist(ctx);
    render(ctx);
  }

  function renderShowdown(ctx) {
    if (!global.BarrelShowdown) return emptyState("Showdown engine unavailable.");
    const total = Array.isArray(ctx.state.matchups) ? ctx.state.matchups.length : 0;
    return `
      <section class="section-stack">
        <div class="search-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Blind tasting lab</p>
              <h2>Showdown</h2>
            </div>
            <div class="sd-toggle">
              <button class="ghost-button${ctx.ui.showdownView === "arena" ? " active" : ""}" data-sdview="arena" type="button">Arena</button>
              <button class="ghost-button${ctx.ui.showdownView === "rankings" ? " active" : ""}" data-sdview="rankings" type="button">Rankings${total ? " (" + total + ")" : ""}</button>
            </div>
          </div>
          <p class="source-note">Pour two bottles blind, pick a winner, and let the lab keep score. Ratings use Elo — beating a heavyweight earns more than beating a daily sipper — so your real preferences surface, not just who happened to be in the glass.</p>
        </div>
        ${ctx.ui.showdownView === "rankings" ? renderShowdownRankings(ctx) : renderShowdownArena(ctx)}
      </section>
    `;
  }

  function renderShowdownArena(ctx) {
    const byId = getBottlesById(ctx);
    const a = byId[ctx.ui.showdownA];
    const b = byId[ctx.ui.showdownB];
    const sd = global.BarrelShowdown;
    const ready = a && b && a.id !== b.id;
    const outlook = ready ? sd.matchupOutlook(a, b) : null;
    const prediction = ready && global.BarrelPalate
      ? global.BarrelPalate.predictPick(a, b, forYouData(ctx).profile, { families: global.BarrelFamilies })
      : null;
    const predName = prediction ? (prediction.winner === "a" ? a.name : b.name) : "";
    return `
      <div class="search-panel">
        <div class="sd-arena">
          ${renderCorner(ctx, "a", a)}
          <div class="sd-center">
            <span class="sd-vs">VS</span>
            ${ready ? renderOutlook(outlook, a, b) : `<p class="source-line">Fill both corners to start.</p>`}
            <div class="sd-center-actions">
              <button class="ghost-button" data-action="sd-random" type="button">Random matchup</button>
              ${a && b ? `<button class="ghost-button" data-action="sd-swap" type="button">Swap</button>` : ""}
            </div>
          </div>
          ${renderCorner(ctx, "b", b)}
        </div>
        ${prediction ? `<div class="sd-prediction"><strong>Our call:</strong> we're ${escapeHtml(prediction.confidence)} toward <b>${escapeHtml(shortName(predName))}</b> for you — ${escapeHtml(prediction.reason)}. Pour blind and see if you agree.</div>` : ""}
        ${ready ? `
          <div class="sd-result-row">
            <button class="primary-button" data-result="a" type="button">${escapeHtml(shortName(a.name))} wins</button>
            <button class="ghost-button" data-result="tie" type="button">Tie</button>
            <button class="primary-button" data-result="b" type="button">${escapeHtml(shortName(b.name))} wins</button>
          </div>
        ` : ""}
        ${renderShowdownPicker(ctx)}
      </div>
      ${renderRecentMatchups(ctx, byId)}
    `;
  }

  function renderCorner(ctx, corner, bottle) {
    const cls = corner === "a" ? "sd-corner-a" : "sd-corner-b";
    if (!bottle) {
      return `<div class="sd-corner ${cls} empty"><span class="sd-corner-tag">${corner.toUpperCase()}</span><p>Empty corner</p><small>Search below to fill</small></div>`;
    }
    const sd = global.BarrelShowdown;
    const tier = sd.tierScore(bottle);
    return `
      <div class="sd-corner ${cls}">
        <span class="sd-corner-tag">${corner.toUpperCase()}</span>
        ${bottleVisual(bottle)}
        <strong>${escapeHtml(bottle.name)}</strong>
        <small>${escapeHtml([bottle.distillery, fmtProof(Number(bottle.proof))].filter(Boolean).join(" · "))}</small>
        <span class="sd-tier">${sd.tierLabel(tier)} · tier ${tier}</span>
        <button class="ghost-link sd-clear" data-action="sd-clear-${corner}" type="button">Clear</button>
      </div>
    `;
  }

  function renderOutlook(o, a, b) {
    const favName = o.favorite === "a" ? a.name : o.favorite === "b" ? b.name : "";
    const cls = o.absGap >= 45 ? "mismatch" : o.absGap >= 22 ? "favorite" : "fair";
    const text = o.absGap < 22
      ? "Comparable tier — a meaningful test."
      : `${escapeHtml(shortName(favName))} is favored${o.absGap >= 45 ? " heavily; a win here says little" : ""}. An upset would be notable.`;
    return `<div class="sd-outlook ${cls}"><strong>${escapeHtml(o.label)}</strong><span>${text}</span></div>`;
  }

  function renderShowdownPicker(ctx) {
    const q = (ctx.ui.showdownQuery || "").trim().toLowerCase();
    let results = [];
    if (q.length >= 2) {
      results = ctx.bottles.filter((bo) => (bo._searchText || bo.name.toLowerCase()).includes(q)).slice(0, 8);
    }
    return `
      <div class="sd-picker">
        <div class="field">
          <span>Add a bottle</span>
          <input id="showdownSearch" type="search" placeholder="Search by bottle, distillery, profile" value="${escapeAttr(ctx.ui.showdownQuery || "")}" autocomplete="off">
        </div>
        ${q.length >= 2 ? `<div class="sd-results">${results.length ? results.map((bo) => renderPickRow(bo)).join("") : `<p class="source-line">No matches.</p>`}</div>` : ""}
      </div>
    `;
  }

  function renderPickRow(bottle) {
    return `
      <div class="sd-pick-row">
        ${bottleVisual(bottle)}
        <span class="mini-main"><strong>${escapeHtml(bottle.name)}</strong><small>${escapeHtml([bottle.distillery, fmtProof(Number(bottle.proof))].filter(Boolean).join(" · "))}</small></span>
        <span class="sd-pick-actions">
          <button class="ghost-button" data-corner="a" data-pick="${escapeAttr(bottle.id)}" type="button">&rarr; A</button>
          <button class="ghost-button" data-corner="b" data-pick="${escapeAttr(bottle.id)}" type="button">&rarr; B</button>
        </span>
      </div>
    `;
  }

  function renderRecentMatchups(ctx, byId) {
    const ms = (ctx.state.matchups || []).slice(0, 6);
    if (!ms.length) return "";
    return `
      <div class="search-panel">
        <div class="panel-heading"><h3>Recent matchups</h3><button class="ghost-link" data-action="sd-undo" type="button">Undo last</button></div>
        <div class="sd-log">
          ${ms.map((m) => {
            const a = byId[m.aId];
            const b = byId[m.bId];
            if (!a || !b) return "";
            const aw = m.winnerId === m.aId;
            const bw = m.winnerId === m.bId;
            const tie = m.winnerId === "tie";
            return `<div class="sd-log-row"><span class="${aw ? "win" : tie ? "tie" : "loss"}">${escapeHtml(shortName(a.name))}</span><i>${tie ? "tie" : "def."}</i><span class="${bw ? "win" : tie ? "tie" : "loss"}">${escapeHtml(shortName(b.name))}</span></div>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderShowdownRankings(ctx) {
    const sd = global.BarrelShowdown;
    const byId = getBottlesById(ctx);
    const data = sd.compute(ctx.state.matchups || [], byId);
    if (!data.total) {
      return `<div class="search-panel">${emptyState("No matchups yet. Open the Arena, pour two bottles blind, and your Elo ladders build themselves.")}</div>`;
    }
    return `
      <div class="search-panel">
        <div class="insight-grid">
          ${insight("Matchups", data.total, "blind pours logged")}
          ${insight("Bottles rated", data.bottleStandings.length, "in your ladder")}
          ${insight("Distilleries", data.distStandings.length, "head-to-head")}
          ${insight("Upsets", data.upsets.length, "value beat trophy")}
        </div>
      </div>
      ${data.distStandings.length ? `
        <div class="search-panel">
          <div class="panel-heading"><h3>Distillery ladder &middot; Elo</h3></div>
          <div class="sd-ladder">${data.distStandings.slice(0, 12).map((d, i) => renderLadderRow(i + 1, d.name, d)).join("")}</div>
        </div>` : ""}
      ${data.bottleStandings.length ? `
        <div class="search-panel">
          <div class="panel-heading"><h3>Bottle ladder &middot; Elo</h3></div>
          <div class="sd-ladder">${data.bottleStandings.slice(0, 12).map((d, i) => renderLadderRow(i + 1, d.name, d, d.bottle)).join("")}</div>
        </div>` : ""}
      ${renderPalateLeans(data)}
      ${renderPairs(data.pairs)}
      ${renderUpsets(data.upsets)}
    `;
  }

  function simpleStyle(s) {
    return String(s || "").replace(" bourbon", "").replace(" whiskey", "");
  }

  function renderPalateLeans(data) {
    const items = [...(data.typePrefs || []), ...(data.stylePrefs || [])].slice(0, 6);
    if (!items.length) return "";
    return `<div class="search-panel"><div class="panel-heading"><h3>Your palate leans</h3></div><p class="source-note">Preference pulled from blind results, independent of brand prestige.</p><div class="sd-pairs">${items.map((p) => {
      const lead = p.xw >= p.yw ? p.x : p.y;
      const other = p.xw >= p.yw ? p.y : p.x;
      const xPct = Math.round((100 * (p.xw + p.t * 0.5)) / p.n);
      const leadPct = p.xw >= p.yw ? xPct : 100 - xPct;
      return `<div class="sd-pair"><div class="sd-pair-names"><span>${escapeHtml(p.x)}</span><b>${p.xw}&ndash;${p.yw}${p.t ? " (" + p.t + "t)" : ""}</b><span>${escapeHtml(p.y)}</span></div><div class="sd-pair-bar"><span style="width:${xPct}%"></span></div><small>You lean ${escapeHtml(simpleStyle(lead))} over ${escapeHtml(simpleStyle(other))} &mdash; ${leadPct}% (${p.n} blind picks)</small></div>`;
    }).join("")}</div></div>`;
  }

  function renderLadderRow(rank, name, r, bottle) {
    return `<div class="sd-ladder-row"><span class="sd-rank">${rank}</span>${bottle ? bottleVisual(bottle) : ""}<span class="sd-ladder-name"><strong>${escapeHtml(shortName(name))}</strong><small>${r.w}-${r.l}${r.t ? "-" + r.t : ""} &middot; ${r.n} pours</small></span><span class="sd-elo">${r.elo}</span></div>`;
  }

  function renderPairs(pairs) {
    const meaningful = pairs.filter((p) => p.n >= 2).slice(0, 8);
    if (!meaningful.length) return "";
    return `<div class="search-panel"><div class="panel-heading"><h3>Head-to-head records</h3></div><div class="sd-pairs">${meaningful.map((p) => {
      const xPct = p.n ? Math.round((100 * (p.xw + p.t * 0.5)) / p.n) : 0;
      const lead = p.xw >= p.yw ? p.x : p.y;
      const leadPct = p.xw >= p.yw ? xPct : 100 - xPct;
      return `<div class="sd-pair"><div class="sd-pair-names"><span>${escapeHtml(p.x)}</span><b>${p.xw}&ndash;${p.yw}${p.t ? " (" + p.t + "t)" : ""}</b><span>${escapeHtml(p.y)}</span></div><div class="sd-pair-bar"><span style="width:${xPct}%"></span></div><small>You pick ${escapeHtml(lead)} ${leadPct}% of the time (${p.n} matchups)</small></div>`;
    }).join("")}</div></div>`;
  }

  function renderUpsets(upsets) {
    if (!upsets.length) return "";
    return `<div class="search-panel"><div class="panel-heading"><h3>Notable upsets</h3></div><p class="source-note">Lower-tier bottles that beat a pricier or more hyped pour — the blind results most worth trusting.</p><div class="sd-upsets">${upsets.slice(0, 8).map((u) => `<div class="sd-upset"><strong>${escapeHtml(shortName(u.winner.name))}</strong><span>beat</span><em>${escapeHtml(shortName(u.loser.name))}</em><i>+${u.gap} tier gap</i></div>`).join("")}</div></div>`;
  }

  function forYouData(ctx) {
    const statuses = ctx.state.statuses || {};
    const sig = (ctx.state.tastings || []).length + "|" + (ctx.state.matchups || []).length + "|" +
      Object.entries(statuses).sort().map((e) => e[0] + e[1]).join(",");
    if (ctx._forYou && ctx._forYou.sig === sig) return ctx._forYou;
    const P = global.BarrelPalate;
    const deps = { families: global.BarrelFamilies, rec };
    const byId = getBottlesById(ctx);
    const profile = P.buildProfile(ctx.state, byId, deps);
    const recs = P.recommend(ctx.bottles, profile, ctx.state, deps);
    ctx._forYou = { sig, profile, recs };
    return ctx._forYou;
  }

  function isNewUser(ctx) {
    const s = ctx.state;
    return !Object.keys(s.collection || {}).length &&
      !(s.tastings || []).length &&
      !(s.matchups || []).length &&
      !Object.keys(s.statuses || {}).length;
  }

  function renderGetStarted(ctx) {
    if (!isNewUser(ctx)) return "";
    return `
      <div class="search-panel get-started">
        <p class="eyebrow">Welcome</p>
        <h3>Make it yours in two minutes</h3>
        <p class="source-note">Barrel Proof gets sharper the more it knows your shelf and your taste. Start with any of these — no typing required.</p>
        <div class="gs-steps">
          <button class="gs-step" type="button" data-action="start-build">
            <strong>1 · Build your shelf</strong>
            <small>Tap the distilleries you collect, then tap the bottles you own.</small>
          </button>
          <button class="gs-step" type="button" data-tab="showdown">
            <strong>2 · Run a blind Showdown</strong>
            <small>Pour two bottles, pick a winner — it learns what you actually like.</small>
          </button>
          <button class="gs-step" type="button" data-tab="families">
            <strong>3 · Explore the distilleries</strong>
            <small>Drill into 78 houses with proof, value, and release analytics.</small>
          </button>
        </div>
      </div>
    `;
  }

  function renderCabinet(ctx) {
    const C = global.BarrelCollection;
    const owned = ctx.bottles.filter((bottle) => ctx.state.statuses[bottle.id] === "owned" || (C && C.ownedCount(ctx.state, bottle.id) > 0));
    const tasted = new Set((ctx.state.tastings || []).map((tasting) => tasting.bottleId));
    const promptBottle = owned.find((bottle) => !tasted.has(bottle.id)) || owned[0] || null;
    const recent = (ctx.state.tastings || []).slice(0, 3);
    const releaseLanes = [
      ["Elijah Craig Barrel Proof", /elijah craig.*barrel proof/i],
      ["Larceny Barrel Proof", /larceny.*barrel proof/i],
      ["Booker's", /booker/i],
      ["Stagg", /^stagg$|stagg/i],
      ["Four Roses", /four roses.*(limited|small batch|single barrel)/i]
    ].map(([label, pattern]) => {
      const bottle = ctx.bottles.find((item) => pattern.test(item.name));
      return bottle ? { label, bottle } : null;
    }).filter(Boolean);
    const clubMembers = (ctx.state.club && Array.isArray(ctx.state.club.friends)) ? ctx.state.club.friends : [];
    const profile = (ctx.state.clubProfiles && ctx.state.clubProfiles.joe) || { name: ctx.palate.name || "Joe", role: "This device" };

    return `
      <section class="cabinet-home section-stack">
        <section class="cabinet-hero">
          <div>
            <p class="eyebrow">The shared whiskey cabinet</p>
            <h2>What are we opening tonight?</h2>
            <p>${owned.length ? owned.length + " bottle" + (owned.length === 1 ? "" : "s") + " on the shelf, ready for a real pour." : "Start with the bottles already in the room — the rest of the catalog can wait."}</p>
          </div>
          <div class="cabinet-hero-actions">
            <button class="primary-button" type="button" data-action="quick-open">Found a bottle</button>
            <button class="ghost-button" type="button" data-tab="store">Search the catalog</button>
          </div>
        </section>

        <section class="cabinet-grid">
          <article class="cabinet-panel cabinet-pours">
            <div class="panel-heading"><div><p class="eyebrow">Your recent pours</p><h3>${recent.length ? "Keep the thread going" : "No pours logged yet"}</h3></div><button class="text-button" type="button" data-tab="tastings">All tastings</button></div>
            ${recent.length ? `<div class="cabinet-pour-list">${recent.map((tasting) => renderCabinetPour(ctx, tasting)).join("")}</div>` : `<p class="source-note">A quick score, batch, and one sentence is enough to make the next pour smarter.</p>`}
          </article>
          <article class="cabinet-panel cabinet-prompt">
            <p class="eyebrow">Tasting prompt</p>
            <h3>${promptBottle ? escapeHtml(promptBottle.name) : "Name the first bottle"}</h3>
            <p>${promptBottle ? (tasted.has(promptBottle.id) ? "Come back to this bottle: what changed since the last pour?" : "You own it, but it has not made the notebook yet. What do you get on the finish?") : "Log a bottle you have, then the cabinet will keep the next good prompt in view."}</p>
            <button class="ghost-button" type="button" data-tab="tastings">${promptBottle ? "Log this pour" : "Open tastings"}</button>
          </article>
        </section>

        <section class="cabinet-panel release-lane">
          <div class="panel-heading"><div><p class="eyebrow">Release watch</p><h3>The marquee bottles, batch first</h3></div><button class="text-button" type="button" data-tab="store">Browse catalog</button></div>
          <div class="release-rail">${releaseLanes.map(({ label, bottle }) => renderReleaseCard(label, bottle)).join("")}</div>
        </section>
        <section class="cabinet-panel crew-foundation">
          <div><p class="eyebrow">Private crew</p><h3>${escapeHtml(profile.name)}’s Collection</h3><p>${owned.length} bottle${owned.length === 1 ? "" : "s"} on this device. Brother, close friend, and cousin profiles will appear here only once they are connected.</p></div>
          <button class="text-button" type="button" data-tab="club">Open the club</button>
          ${clubMembers.length ? `<small>${clubMembers.length} imported crew card${clubMembers.length === 1 ? "" : "s"} inform your bottle calls.</small>` : "<small>Bring requests need shared accounts and a synced tasting-night list.</small>"}
        </section>
      </section>
    `;
  }

  function renderCabinetPour(ctx, tasting) {
    const bottle = getBottleIndex(ctx).get(tasting.bottleId);
    return `<button class="cabinet-pour" type="button" data-open-card="${escapeAttr(tasting.bottleId)}" data-card-context="cabinet"><span>${escapeHtml(bottle ? bottle.name : "Unknown bottle")}</span><small>${escapeHtml(tasting.date || "Recent")} · ${Number(tasting.score).toFixed(1)}${tasting.batch ? " · " + escapeHtml(tasting.batch) : ""}</small></button>`;
  }

  function renderReleaseCard(label, bottle) {
    const batch = bottle.curated && bottle.curated.releaseLabel ? bottle.curated.releaseLabel : (bottle.age && bottle.age !== "NAS" ? bottle.age : "Release details");
    return `<button class="release-card" type="button" data-open-card="${escapeAttr(bottle.id)}" data-card-context="cabinet"><p>${escapeHtml(label)}</p><strong>${escapeHtml(bottle.name)}</strong><span>${escapeHtml(batch)} · ${Number(bottle.proof || 0).toFixed(1).replace(/\.0$/, "")} proof</span><small>${escapeHtml(bottle.shelfNote || "Open release details")}</small></button>`;
  }

  function renderForYou(ctx) {
    if (!global.BarrelPalate) return emptyState("Recommender unavailable.");
    const data = forYouData(ctx);
    return `
      <section class="section-stack">
        <div class="search-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Personal recommender</p>
              <h2>For you</h2>
            </div>
          </div>
          <p class="source-note">Connoisseur-grade picks tuned to your taste. The <strong>Buy this</strong> lane is bottles you can actually find at a fair price &mdash; never allocated unicorns dressed up as shelf buys. The more you log in Tastings and Showdown, the sharper it gets.</p>
          ${renderPalateSummary(ctx, data.profile)}
        </div>
        ${renderGetStarted(ctx)}
        ${renderPourTonight(ctx, data.profile)}
        ${renderRecLane(ctx, "Buy this", "Findable picks for your palate, at prices you'll actually pay.", data.recs.buyNow, "buy")}
        ${data.recs.grails.length ? renderRecLane(ctx, "Grails to chase", "Your taste would love these, but they're allocated. Chase them honestly — they're not shelf buys.", data.recs.grails, "grail") : ""}
        ${!data.recs.buyNow.length && !data.recs.grails.length ? emptyState("Rate a few bottles in Tastings or run a Showdown round, and your recommendations appear here.") : ""}
      </section>
    `;
  }

  function palateChip(label, value) {
    return `<div class="palate-chip"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "—")}</strong></div>`;
  }

  function renderPalateSummary(ctx, profile) {
    const P = global.BarrelPalate;
    if (!profile.ready) {
      return `<p class="source-line">Your palate profile is still empty. Rate a few bottles in <strong>Tastings</strong> or play a <strong>Showdown</strong> round, and this tunes to you. For now these are well-regarded, easy-to-find pours.</p>`;
    }
    const styles = P.topEntries(profile.styleScores, 3).map((e) => P.simpleStyle(e[0]));
    const houses = P.topEntries(profile.distilleryScores, 3).map((e) => e[0]);
    const flavors = P.topEntries(profile.flavorScores, 4).map((e) => e[0]);
    const proof = Number.isFinite(profile.proofPreference) ? Math.round(profile.proofPreference) + " pf" : "—";
    return `
      <div class="palate-summary">
        ${palateChip("Leans", styles.join(", "))}
        ${palateChip("Houses", houses.join(", "))}
        ${palateChip("Flavors", flavors.join(", "))}
        ${palateChip("Sweet spot", proof)}
      </div>
    `;
  }

  function renderRecLane(ctx, title, subtitle, items, kind) {
    if (!items.length) return "";
    return `
      <div class="search-panel">
        <div class="panel-heading">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p class="source-line">${escapeHtml(subtitle)}</p>
          </div>
        </div>
        <div class="rec-list">
          ${items.map((c) => renderRecCard(ctx, c, kind)).join("")}
        </div>
      </div>
    `;
  }

  function renderRecCard(ctx, c, kind) {
    const b = c.bottle;
    const priceText = c.price && Number.isFinite(c.price.value) ? "$" + Math.round(c.price.value) : "";
    return `
      <button class="rec-card rec-${kind}" type="button" data-goto="${escapeAttr(b.id)}">
        ${bottleVisual(b)}
        <span class="rec-main">
          <strong>${escapeHtml(b.name)}</strong>
          <small>${escapeHtml([getBottleMaker(b), fmtProof(Number(b.proof))].filter(Boolean).join(" · "))}</small>
          <span class="rec-why">${escapeHtml(c.rationale)}</span>
        </span>
        <span class="rec-meta">
          <span class="avail-badge avail-${c.avail.tier}">${escapeHtml(c.avail.label)}</span>
          ${priceText ? `<span class="rec-price">${priceText}</span>` : ""}
        </span>
      </button>
    `;
  }

  function reasonForPour(bottle, profile, recent) {
    const P = global.BarrelPalate;
    const fam = global.BarrelFamilies;
    if (recent) return "a recent favorite worth revisiting";
    if (profile && profile.ready && fam) {
      const style = fam.attributes(bottle).style;
      const top = P.topEntries(profile.styleScores, 1)[0];
      if (top && top[0] === style && style !== "Traditional bourbon") return "matches your " + P.simpleStyle(style) + " lean";
      const house = fam.classify(bottle).distillery;
      if ((profile.distilleryScores[house] || 0) > 0) return "from " + house + ", a house you reach for";
    }
    const flavors = (bottle.profile || []).slice(0, 2).join(", ");
    return flavors ? "for " + flavors + " tonight" : "an easy pour from your shelf";
  }

  function renderPourTonight(ctx, profile) {
    const C = global.BarrelCollection;
    const P = global.BarrelPalate;
    const fam = global.BarrelFamilies;
    if (!C || !P) return "";
    const ids = Object.keys(ctx.state.collection || {});
    if (!ids.length) return "";
    const byId = getBottlesById(ctx);
    const owned = ids.map((id) => byId[id]).filter(Boolean);
    if (!owned.length) return "";
    const recent = new Set((ctx.state.tastings || []).slice(0, 2).map((t) => t.bottleId));
    const scored = owned
      .map((b) => {
        const s = profile.ready ? P.scoreFor(b, profile, { families: fam }).score : (Number(b.hypeIndex) || 5) / 20;
        return { b, score: s, recent: recent.has(b.id) };
      })
      .sort((x, y) => (x.recent === y.recent ? y.score - x.score : x.recent ? 1 : -1));
    const len = scored.length;
    const offset = len ? (ctx.ui.pourOffset || 0) % len : 0;
    const picks = [];
    for (let i = 0; i < Math.min(3, len); i++) picks.push(scored[(offset + i) % len]);
    return `
      <div class="search-panel pour-panel">
        <div class="panel-heading">
          <div><p class="eyebrow">From your shelf</p><h3>Pour tonight</h3></div>
          ${len > 3 ? `<button class="ghost-button" type="button" data-action="pour-reshuffle">Reshuffle</button>` : ""}
        </div>
        <div class="rec-list">
          ${picks.map((p) => {
            const b = p.b;
            const count = C.ownedCount(ctx.state, b.id);
            return `
              <button class="rec-card rec-pour" type="button" data-goto="${escapeAttr(b.id)}">
                ${bottleVisual(b)}
                <span class="rec-main">
                  <strong>${escapeHtml(b.name)}</strong>
                  <small>${escapeHtml([getBottleMaker(b), fmtProof(Number(b.proof))].filter(Boolean).join(" · "))}${count > 1 ? " · ×" + count : ""}</small>
                  <span class="rec-why">${escapeHtml(reasonForPour(b, profile, p.recent))}</span>
                </span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function handleWizard(ctx, target) {
    const C = global.BarrelCollection;
    const action = target.dataset.wiz;
    const bottleId = target.dataset.bottle;
    if (action === "open") {
      ctx.ui.shelfMode = "wizard";
      ctx.ui.wizStep = ctx.ui.wizHouses.length ? "walk" : "houses";
    } else if (action === "close" || action === "finish") {
      ctx.ui.shelfMode = "view";
    } else if (action === "house") {
      const id = target.dataset.house;
      const i = ctx.ui.wizHouses.indexOf(id);
      if (i >= 0) ctx.ui.wizHouses.splice(i, 1);
      else ctx.ui.wizHouses.push(id);
    } else if (action === "start") {
      ctx.ui.wizStep = "walk";
      ctx.ui.wizIdx = 0;
      ctx.ui.wizQuery = "";
      ctx.ui.wizExpanded = "";
      ctx.ui.wizFilter = "all";
    } else if (action === "prev") {
      ctx.ui.wizIdx = Math.max(0, ctx.ui.wizIdx - 1);
      ctx.ui.wizQuery = "";
      ctx.ui.wizExpanded = "";
      ctx.ui.wizFilter = "all";
    } else if (action === "next") {
      if (ctx.ui.wizIdx < ctx.ui.wizHouses.length - 1) {
        ctx.ui.wizIdx += 1;
        ctx.ui.wizQuery = "";
        ctx.ui.wizExpanded = "";
        ctx.ui.wizFilter = "all";
      } else {
        ctx.ui.wizStep = "review";
      }
    } else if (action === "filter") {
      ctx.ui.wizFilter = target.dataset.filter;
    } else if (action === "toggle-picks") {
      ctx.ui.wizHidePicks = !(ctx.ui.wizHidePicks !== false);
    } else if (action === "own") {
      C.toggle(ctx.state, bottleId);
      persist(ctx);
    } else if (action === "count") {
      C.setCount(ctx.state, bottleId, C.ownedCount(ctx.state, bottleId) + Number(target.dataset.delta));
      persist(ctx);
    } else if (action === "expand") {
      ctx.ui.wizExpanded = ctx.ui.wizExpanded === bottleId ? "" : bottleId;
    } else if (action === "batch") {
      C.toggleBatch(ctx.state, bottleId, target.dataset.batch);
      persist(ctx);
    } else if (action === "back-walk") {
      ctx.ui.wizStep = "walk";
    }
    render(ctx);
  }

  function wizHouseList(ctx) {
    return familyIndex(ctx).filter((g) => g.matched).map((g) => ({ id: g.id, name: g.name, count: g.count }));
  }

  function wizTypeRank(t) {
    return t === "batched" ? 0 : t === "pick" ? 1 : 2;
  }

  function wizHouseBottles(ctx, houseId) {
    if (!ctx._wizLines) ctx._wizLines = {};
    if (ctx._wizLines[houseId]) return ctx._wizLines[houseId];
    const fam = global.BarrelFamilies;
    const C = global.BarrelCollection;
    const bottles = ctx.bottles.filter((b) => fam.classify(b).distilleryId === houseId);
    const lines = C.collapse(bottles);
    lines.sort((a, b) => (wizTypeRank(a.type) - wizTypeRank(b.type)) || String(a.rep.name).localeCompare(String(b.rep.name)));
    ctx._wizLines[houseId] = lines;
    return lines;
  }

  function renderWizard(ctx) {
    const step = ctx.ui.wizStep;
    const title = step === "houses" ? "Pick your houses" : step === "walk" ? "Tap what you own" : "Review";
    const steps = [["houses", "Houses"], ["walk", "Bottles"], ["review", "Review"]];
    const idx = { houses: 0, walk: 1, review: 2 }[step] || 0;
    return `
      <section class="section-stack wizard">
        <div class="search-panel">
          <div class="wiz-head">
            <div><p class="eyebrow">Build your shelf</p><h2>${title}</h2></div>
            <button class="ghost-button" type="button" data-wiz="close">Close</button>
          </div>
          <div class="wiz-steps">${steps.map(([k, l], i) => `<span class="wiz-step${step === k ? " active" : ""}${idx > i ? " done" : ""}">${i + 1}. ${l}</span>`).join("")}</div>
        </div>
        ${step === "houses" ? renderWizHouses(ctx) : step === "walk" ? renderWizWalk(ctx) : renderWizReview(ctx)}
      </section>
    `;
  }

  function renderWizHouses(ctx) {
    const houses = wizHouseList(ctx);
    const sel = new Set(ctx.ui.wizHouses);
    return `
      <div class="search-panel">
        <p class="source-note">Tap every distillery you collect. We'll walk you through each one so you can tap the bottles you own &mdash; no typing.</p>
        <div class="wiz-bubbles">
          ${houses.map((h) => `<button class="wiz-bubble${sel.has(h.id) ? " on" : ""}" type="button" data-wiz="house" data-house="${escapeAttr(h.id)}" aria-pressed="${sel.has(h.id)}">${escapeHtml(h.name)}<i>${h.count}</i></button>`).join("")}
        </div>
        <div class="wiz-actions">
          <span class="source-line">${sel.size} selected</span>
          <button class="primary-button" type="button" data-wiz="start"${sel.size ? "" : " disabled"}>Continue &rarr;</button>
        </div>
      </div>
    `;
  }

  function wizMatchFilter(g, filter) {
    if (filter === "all") return true;
    const a = global.BarrelFamilies.attributes(g.rep);
    if (filter === "barrel") return a.caskStrength;
    if (filter === "single") return a.singleBarrel || g.type === "pick";
    if (filter === "bonded") return a.bottledInBond;
    if (filter === "allocated") return global.BarrelPalate && !global.BarrelPalate.availability(g.rep).buyable;
    if (filter === "standard") return g.type === "standard";
    return true;
  }

  function renderWizWalk(ctx) {
    const houses = ctx.ui.wizHouses;
    const idx = Math.max(0, Math.min(ctx.ui.wizIdx, houses.length - 1));
    const houseId = houses[idx];
    const all = wizHouseBottles(ctx, houseId);
    const houseName = (wizHouseList(ctx).find((h) => h.id === houseId) || {}).name || "House";
    const q = (ctx.ui.wizQuery || "").trim().toLowerCase();
    const filter = ctx.ui.wizFilter;
    const hidePicks = ctx.ui.wizHidePicks !== false;
    const pickCount = all.filter((g) => g.type === "pick").length;
    const lines = all.filter((g) =>
      wizMatchFilter(g, filter) &&
      (!hidePicks || g.type !== "pick") &&
      (!q || g.rep.name.toLowerCase().includes(q) || g.members.some((m) => m.name.toLowerCase().includes(q)))
    );
    const shown = lines.slice(0, 60);
    const filters = [["all", "All"], ["barrel", "Barrel proof"], ["single", "Single barrel"], ["bonded", "Bonded"], ["allocated", "Allocated"], ["standard", "Standard"]];
    return `
      <div class="search-panel">
        <div class="wiz-walk-head">
          <div><h3>${escapeHtml(houseName)}</h3><small>House ${idx + 1} of ${houses.length}</small></div>
          <div class="wiz-nav">
            <button class="ghost-button" type="button" data-wiz="prev"${idx > 0 ? "" : " disabled"}>&larr;</button>
            <button class="ghost-button" type="button" data-wiz="next">${idx < houses.length - 1 ? "Next house &rarr;" : "Review &rarr;"}</button>
          </div>
        </div>
        <label class="field"><input id="wizSearch" type="search" value="${escapeAttr(ctx.ui.wizQuery || "")}" placeholder="Search ${escapeAttr(houseName)}" autocomplete="off"></label>
        <div class="filter-row">
          ${filters.map(([v, l]) => `<button class="filter-button${filter === v ? " active" : ""}" type="button" data-wiz="filter" data-filter="${v}">${l}</button>`).join("")}
        </div>
        ${pickCount ? `<div class="wiz-picks-row"><button class="wiz-picks-toggle${hidePicks ? "" : " on"}" type="button" data-wiz="toggle-picks">${hidePicks ? "Show single-barrel store picks (" + pickCount + ")" : "Hide store picks"}</button></div>` : ""}
        <div class="wiz-lines">
          ${shown.map((g) => renderWizLine(ctx, g)).join("") || emptyState("No bottles match. Try a different filter.")}
        </div>
        ${lines.length > shown.length ? `<p class="source-line">+ ${lines.length - shown.length} more — search to narrow.</p>` : ""}
      </div>
    `;
  }

  function renderWizLine(ctx, g) {
    const C = global.BarrelCollection;
    const b = g.rep;
    const owned = C.ownedCount(ctx.state, b.id);
    const entry = C.entry(ctx.state, b.id);
    const batchCount = entry && entry.batches ? entry.batches.length : 0;
    if (g.type === "batched" && g.line) {
      const expanded = ctx.ui.wizExpanded === b.id;
      const howTo = g.line.howToId ? `<p class="wiz-howto"><b>How to tell which one:</b> ${escapeHtml(g.line.howToId)}</p>` : "";
      // Per-barrel lines (e.g. Blanton's SFTB) have no fixed batches — every bottle
      // is unique, so log a count and read each bottle's details off the label.
      if (g.line.perBarrel) {
        return `
          <div class="wiz-line wiz-batched${owned ? " owned" : ""}${expanded ? " open" : ""}">
            <button class="wiz-line-head" type="button" data-wiz="expand" data-bottle="${escapeAttr(b.id)}">
              ${bottleVisual(b)}
              <span class="wiz-line-main"><strong>${escapeHtml(g.line.label)}</strong><small>${owned ? owned + " owned · each bottle unique" : "tap — every bottle is a unique single barrel"}</small></span>
              <span class="wiz-chev">${expanded ? "&#9662;" : "&#9656;"}</span>
            </button>
            ${expanded ? `<div class="wiz-batch-detail">${howTo}<div class="wiz-perbarrel"><span>How many do you own?</span><span class="wiz-stepper"><button class="step-btn" type="button" data-wiz="count" data-bottle="${escapeAttr(b.id)}" data-delta="-1">&minus;</button><b>${owned}</b><button class="step-btn" type="button" data-wiz="count" data-bottle="${escapeAttr(b.id)}" data-delta="1">+</button></span></div></div>` : ""}
          </div>
        `;
      }
      return `
        <div class="wiz-line wiz-batched${batchCount ? " owned" : ""}${expanded ? " open" : ""}">
          <button class="wiz-line-head" type="button" data-wiz="expand" data-bottle="${escapeAttr(b.id)}">
            ${bottleVisual(b)}
            <span class="wiz-line-main"><strong>${escapeHtml(g.line.label)}</strong><small>${batchCount ? batchCount + " batch" + (batchCount === 1 ? "" : "es") + " owned" : "tap to pick your batches"}</small></span>
            <span class="wiz-chev">${expanded ? "&#9662;" : "&#9656;"}</span>
          </button>
          ${expanded ? `<div class="wiz-batch-detail">${howTo}<div class="wiz-batches">${g.line.batches.map((bt) => {
            const C2 = global.BarrelCollection;
            const label = C2.batchLabel(bt);
            const proof = C2.batchProof(bt);
            const year = C2.batchYear(bt);
            const on = entry && entry.batches && entry.batches.includes(label);
            const title = [year, Number.isFinite(proof) ? proof + " proof" : ""].filter(Boolean).join(" · ");
            return `<button class="batch-chip${on ? " on" : ""}" type="button" data-wiz="batch" data-bottle="${escapeAttr(b.id)}" data-batch="${escapeAttr(label)}"${title ? ` title="${escapeAttr(title)}"` : ""}>${escapeHtml(label)}${Number.isFinite(proof) ? ` <i>${proof}</i>` : ""}</button>`;
          }).join("")}</div></div>` : ""}
        </div>
      `;
    }
    if (g.type === "pick") {
      return `
        <div class="wiz-line${owned ? " owned" : ""}">
          ${bottleVisual(b)}
          <span class="wiz-line-main"><strong>${escapeHtml(b.name)}</strong><small>store pick &middot; set how many</small></span>
          <span class="wiz-stepper"><button class="step-btn" type="button" data-wiz="count" data-bottle="${escapeAttr(b.id)}" data-delta="-1">&minus;</button><b>${owned}</b><button class="step-btn" type="button" data-wiz="count" data-bottle="${escapeAttr(b.id)}" data-delta="1">+</button></span>
        </div>
      `;
    }
    return `
      <button class="wiz-line${owned ? " owned" : ""}" type="button" data-wiz="own" data-bottle="${escapeAttr(b.id)}">
        ${bottleVisual(b)}
        <span class="wiz-line-main"><strong>${escapeHtml(b.name)}</strong><small>${escapeHtml([getBottleMaker(b), fmtProof(Number(b.proof))].filter(Boolean).join(" · "))}</small></span>
        <span class="wiz-check">${owned ? "&#10003;" : ""}</span>
      </button>
    `;
  }

  function renderWizReview(ctx) {
    const C = global.BarrelCollection;
    const fam = global.BarrelFamilies;
    const totals = C.totals(ctx.state);
    const byId = getBottlesById(ctx);
    const byHouse = {};
    for (const id in (ctx.state.collection || {})) {
      const b = byId[id];
      if (!b) continue;
      const h = fam.classify(b).distillery;
      (byHouse[h] = byHouse[h] || []).push({ b, e: ctx.state.collection[id] });
    }
    const houses = Object.entries(byHouse).sort((a, b) => b[1].length - a[1].length);
    return `
      <div class="search-panel">
        <div class="insight-grid">
          ${insight("Bottles", totals.bottles, "in your collection")}
          ${insight("Lines", totals.lines, "distinct releases")}
          ${insight("Houses", houses.length, "distilleries")}
          ${insight("Feeds", "For You", "sharper recs now")}
        </div>
        <div class="wiz-review">
          ${houses.map(([h, items]) => `<div class="wiz-review-house"><div class="wiz-review-top"><strong>${escapeHtml(h)}</strong><small>${items.length} line${items.length === 1 ? "" : "s"}</small></div><div class="wiz-review-items">${items.slice(0, 14).map((it) => `<span>${escapeHtml(shortName(it.b.name))}${it.e.count > 1 ? " ×" + it.e.count : ""}${it.e.batches && it.e.batches.length ? " · " + it.e.batches.length + "b" : ""}</span>`).join("")}</div></div>`).join("") || emptyState("Nothing logged yet — go back and tap some bottles.")}
        </div>
        <div class="wiz-actions">
          <button class="ghost-button" type="button" data-wiz="back-walk">&larr; Keep adding</button>
          <button class="primary-button" type="button" data-wiz="finish">Done</button>
        </div>
      </div>
    `;
  }

  // Quick add: the fastest way to enter a big collection. Type a few letters,
  // tap the bottle, keep typing — the input never loses focus, every tap is one
  // bottle owned (tap again for backups).
  function renderQuickAdd(ctx) {
    return `
      <section class="section-stack">
        <section class="search-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Quick add</p>
              <h2>Type a little, tap a lot</h2>
            </div>
            <button class="primary-button" type="button" data-action="quick-done">Done</button>
          </div>
          <p class="source-note">Search and tap to add to your shelf — the search stays put so you can rip through a cabinet. Tap again for a backup. <b id="quickCount">${ctx.ui.quickAdded || 0}</b> added this session.</p>
          <label class="field"><span>Bottle</span><input id="quickAdd" type="search" value="${escapeAttr(ctx.ui.quickQuery || "")}" placeholder="e.g. rare breed, weller, ecbp…" autocomplete="off" autofocus></label>
        </section>
        <section class="quickadd-results">${renderQuickResults(ctx)}</section>
      </section>
    `;
  }

  function renderQuickResults(ctx) {
    const C = global.BarrelCollection;
    const query = (ctx.ui.quickQuery || "").trim().toLowerCase();
    if (query.length < MIN_SEARCH_CHARS) {
      return `<p class="result-summary">Start typing — two letters is enough.</p>`;
    }
    const raw = [];
    for (const bottle of ctx.bottles) {
      if (raw.length >= 200) break;
      if (bottle._searchText.includes(query)) raw.push(bottle);
    }
    const collapsed = collapseVariants(ctx, raw);
    collapsed.sort((left, right) => scoreSearchResult(right, query) - scoreSearchResult(left, query));
    const rows = collapsed.slice(0, 30);
    if (!rows.length) return `<p class="result-summary">No matches — try fewer letters.</p>`;
    return rows.map((bottle) => {
      const count = C ? C.ownedCount(ctx.state, bottle.id) : 0;
      const owned = count > 0 || ctx.state.statuses[bottle.id] === "owned";
      return `
        <button class="night-result quick-row${owned ? " owned" : ""}" type="button" data-action="quick-own" data-bottle="${escapeAttr(bottle.id)}">
          <strong>${escapeHtml(bottle.name)}</strong>
          <small>${escapeHtml(getBottleMaker(bottle))}${bottle._variantCount > 1 ? " · " + bottle._variantCount + " listings" : ""}</small>
          <span class="quick-badge">${owned ? "✓" + (Math.max(1, count) > 1 ? " ×" + count : "") : "+"}</span>
        </button>
      `;
    }).join("");
  }

  function scheduleQuickResults(ctx) {
    if (ctx.ui.quickTimer) global.clearTimeout(ctx.ui.quickTimer);
    ctx.ui.quickTimer = global.setTimeout(() => {
      ctx.ui.quickTimer = null;
      const region = ctx.mount.querySelector ? ctx.mount.querySelector(".quickadd-results") : null;
      if (region) region.innerHTML = renderQuickResults(ctx);
      else render(ctx);
    }, 110);
  }

  function renderShelf(ctx) {
    if (ctx.ui.shelfMode === "wizard") return renderWizard(ctx);
    if (ctx.ui.shelfMode === "quick") return renderQuickAdd(ctx);
    const bottles = ctx.bottles.filter((bottle) => {
      const status = ctx.state.statuses[bottle.id] || "none";
      return ctx.ui.shelfFilter === "all" ? status !== "none" : status === ctx.ui.shelfFilter;
    });
    const C = global.BarrelCollection;
    const ownedBottles = ctx.bottles.filter((bottle) => ctx.state.statuses[bottle.id] === "owned");
    const countOf = (bottle) => (C ? Math.max(1, C.ownedCount(ctx.state, bottle.id)) : 1);
    const ownedValues = ownedBottles.map((bottle) => getBottleValue(bottle)).filter((value) => Number.isFinite(value));
    const ownedValue = ownedBottles.reduce((sum, bottle) => {
      const v = getBottleValue(bottle);
      return Number.isFinite(v) ? sum + v * countOf(bottle) : sum;
    }, 0);
    const unknownOwnedValue = ownedBottles.length - ownedValues.length;
    const totals = C ? C.totals(ctx.state) : { lines: 0, bottles: 0 };
    const tastedIds = new Set(ctx.state.tastings.map((tasting) => tasting.bottleId));
    const stillToTaste = ownedBottles.filter((bottle) => !tastedIds.has(bottle.id)).length;
    return `
      <section class="section-stack">
        <div class="shelf-cta">
          <div>
            <p class="eyebrow">Your collection</p>
            <strong>${totals.bottles}${totals.bottles ? " bottle" + (totals.bottles === 1 ? "" : "s") + " · " + totals.lines + " line" + (totals.lines === 1 ? "" : "s") : " bottles logged yet"}</strong>
          </div>
          <span class="shelf-cta-actions">
            <button class="ghost-button" type="button" data-action="quick-open">Quick add</button>
            <button class="primary-button shelf-build-btn" type="button" data-wiz="open">${totals.bottles ? "Browse houses" : "Build your shelf"}</button>
          </span>
        </div>
        <div class="insight-grid">
          ${insight("Shelf value", ownedValues.length ? rec.money(ownedValue) : "n/a", unknownOwnedValue ? unknownOwnedValue + " owned without value" : "fair value estimate")}
          ${insight("Still to taste", stillToTaste, ownedBottles.length ? "owned, no pour logged" : "nothing owned yet")}
          ${insight("Open targets", countStatus(ctx, "wishlist"), "wishlist bottles")}
          ${insight("Tastings", ctx.state.tastings.length, "logged pours")}
          ${insight("Proof lane", getProofLane(ctx), "average owned proof")}
        </div>
        ${renderCollectionBreakdown(ctx)}
        ${renderCollectionStyleBreakdown(ctx)}
        <div class="filter-row" aria-label="Shelf filters">
          ${filterButton(ctx, "all", "All")}
          ${filterButton(ctx, "owned", "Owned")}
          ${filterButton(ctx, "wishlist", "Wishlist")}
          ${filterButton(ctx, "passed", "Passed")}
          ${filterButton(ctx, "tasted", "Tasted")}
          ${filterButton(ctx, "finished", "Finished")}
        </div>
        <div class="shelf-grid">
          ${bottles.map((bottle) => renderShelfCard(ctx, bottle)).join("") || emptyState("No bottles in this view yet.")}
        </div>
      </section>
    `;
  }

  function renderCollectionStyleBreakdown(ctx) {
    const C = global.BarrelCollection;
    const fam = global.BarrelFamilies;
    if (!C || !fam) return "";
    const col = ctx.state.collection || {};
    const ids = Object.keys(col);
    if (!ids.length) return "";
    const byId = getBottlesById(ctx);
    const styles = {};
    let total = 0;
    for (const id of ids) {
      const bottle = byId[id];
      if (!bottle) continue;
      const count = col[id].count || 1;
      // Bourbon dominates a bourbon shelf, so for bourbon use the finer mash style
      // (Traditional / Wheated / High-rye); for everything else the whiskey type is
      // correct (the fine `style` field mislabels non-bourbon as "Traditional bourbon").
      const attrs = bottleAttrs(bottle);
      const style = (attrs.whiskeyType === "Bourbon" ? attrs.style : attrs.whiskeyType) || "Other whiskey";
      styles[style] = (styles[style] || 0) + count;
      total += count;
    }
    const rows = Object.entries(styles).sort((a, b) => b[1] - a[1]);
    // A single style isn't a meaningful "mix" — only show when there's variety.
    if (rows.length < 2) return "";
    const maxCount = rows[0][1] || 1;
    return `
      <div class="search-panel">
        <div class="panel-heading">
          <div>
            <h3>Your collection by style</h3>
            <p class="source-line">${total} bottle${total === 1 ? "" : "s"} across ${rows.length} styles — see where you're concentrated and where the gaps are</p>
          </div>
        </div>
        <div class="coll-bars">
          ${rows.map(([style, count]) => `<div class="coll-bar"><span class="coll-bar-name">${escapeHtml(style)}</span><div class="coll-bar-track"><span style="width:${Math.round((100 * count) / maxCount)}%"></span></div><span class="coll-bar-val">${count}</span></div>`).join("")}
        </div>
      </div>
    `;
  }

  function renderCollectionBreakdown(ctx) {
    const C = global.BarrelCollection;
    const fam = global.BarrelFamilies;
    if (!C || !fam) return "";
    const col = ctx.state.collection || {};
    const ids = Object.keys(col);
    if (!ids.length) return "";
    const byId = getBottlesById(ctx);
    const houses = {};
    let totalValue = 0;
    for (const id of ids) {
      const b = byId[id];
      if (!b) continue;
      const count = col[id].count || 1;
      const v = (getBottleValue(b) || 0) * count;
      totalValue += v;
      const h = fam.classify(b).distillery;
      const g = houses[h] || (houses[h] = { count: 0, value: 0 });
      g.count += count;
      g.value += v;
    }
    const rows = Object.entries(houses).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    if (!rows.length) return "";
    const maxCount = rows[0][1].count || 1;
    return `
      <div class="search-panel">
        <div class="panel-heading">
          <div>
            <h3>Your collection by house</h3>
            <p class="source-line">${totalValue ? rec.money(totalValue) + " estimated · uses your observed prices where logged" : "Log observed prices to value your shelf"}</p>
          </div>
        </div>
        <div class="coll-bars">
          ${rows.map(([h, g]) => `<div class="coll-bar"><span class="coll-bar-name">${escapeHtml(h)}</span><div class="coll-bar-track"><span style="width:${Math.round((100 * g.count) / maxCount)}%"></span></div><span class="coll-bar-val">${g.count}${g.value ? " · " + rec.money(g.value) : ""}</span></div>`).join("")}
        </div>
      </div>
    `;
  }

  function renderShelfCard(ctx, bottle) {
    const result = rec.scoreBottleDecision({
      bottle,
      shelfPrice: bottle.shelfAverage,
      palate: ctx.palate,
      friends: ctx.friends,
      status: ctx.state.statuses[bottle.id]
    });
    const C = global.BarrelCollection;
    const entry = C ? C.entry(ctx.state, bottle.id) : null;
    const count = entry ? entry.count : 0;
    const batches = entry && entry.batches ? entry.batches : [];
    return `
      <article class="shelf-card shelf-card-tap" data-tone="${escapeAttr(bottle.imageTone)}" data-open-card="${escapeAttr(bottle.id)}" data-card-context="shelf" role="button" tabindex="0" aria-label="Open ${escapeAttr(bottle.name)} scorecard">
        <div class="shelf-card-top">
          ${bottleVisual(bottle)}
          <span class="status-pill">${statusLabel(ctx.state.statuses[bottle.id])}</span>
          ${count > 1 ? `<span class="count-badge">&times;${count}</span>` : ""}
        </div>
        <h3>${escapeHtml(bottle.name)}</h3>
        <p>${escapeHtml(bottle.story || buildBottleStory(bottle))}</p>
        ${batches.length ? `<div class="shelf-batches">${batches.slice(0, 8).map((bt) => `<span>${escapeHtml(bt)}</span>`).join("")}</div>` : ""}
        <div class="card-meter">
          <span style="width:${result.confidence}%"></span>
        </div>
        <div class="card-footer">
          <strong>${result.decision}</strong>
          <small>${result.confidence} confidence</small>
        </div>
      </article>
    `;
  }

  function renderTastings(ctx) {
    const view = ctx.ui.tastingsView === "ratings" ? "ratings" : "log";
    const toggle = `
      <div class="filter-row tastings-toggle" aria-label="Tastings view">
        <button class="filter-button${view === "log" ? " active" : ""}" type="button" data-action="tastings-view" data-view="log">Log a pour</button>
        <button class="filter-button${view === "ratings" ? " active" : ""}" type="button" data-action="tastings-view" data-view="ratings">Your ratings</button>
      </div>
    `;
    if (view === "ratings") {
      return `<section class="section-stack">${toggle}${renderRatingsView(ctx)}</section>`;
    }
    return `<section class="section-stack">${toggle}${renderTastingLog(ctx)}</section>`;
  }

  function renderTastingFlavorWheel(ctx) {
    const custom = [...ctx.ui.tastingTags].filter((tag) => !ALL_WHEEL_TAGS.has(tag));
    return `
      <div class="field"><span>Flavors</span></div>
      ${TAG_GROUPS.map(([group, tags]) => `
        <div class="tag-group">
          <small>${escapeHtml(group)}</small>
          <div class="tag-picker">
            ${tags.map((tag) => `<button class="${ctx.ui.tastingTags.has(tag) ? "active" : ""}" type="button" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</button>`).join("")}
          </div>
        </div>
      `).join("")}
      <div class="tag-group">
        <small>Yours</small>
        <div class="tag-picker">
          ${custom.map((tag) => `<button class="active" type="button" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</button>`).join("")}
          <span class="custom-tag-add"><input id="customTag" type="text" placeholder="write your own…" maxlength="24" autocomplete="off"><button class="ghost-button" type="button" data-action="add-custom-tag">Add</button></span>
        </div>
      </div>
    `;
  }

  function renderTastingBatchPicker(ctx, bottle, draft) {
    const C = global.BarrelCollection;
    if (!C || !bottle) return "";
    const line = C.batchLineFor(bottle);
    if (!line) return "";
    if (line.perBarrel) {
      return `
        <label class="field">
          <span>Barrel / pick <em class="optional-tag">optional — it's on the label</em></span>
          <input name="barrel" type="text" value="${escapeAttr(draft.batch || "")}" placeholder="e.g. RIO-300, dump date, pick name" autocomplete="off">
        </label>
      `;
    }
    return `
      <div class="field">
        <span>Which batch? <em class="optional-tag">optional — batches drink differently</em></span>
        <div class="wiz-batches form-batches">
          ${line.batches.map((entry) => {
            const label = C.batchLabel(entry);
            const proof = C.batchProof(entry);
            const on = draft.batch === label;
            return `<button class="batch-chip${on ? " on" : ""}" type="button" data-action="tasting-batch" data-batch="${escapeAttr(label)}">${escapeHtml(label)}${Number.isFinite(proof) ? ` <i>${proof}</i>` : ""}</button>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderTastingLog(ctx) {
    const today = new Date().toISOString().slice(0, 10);
    const draft = ctx.ui.tastingDraft || { score: "8.5", context: "Neat pour", note: "", guess: "", blind: false };
    const picker = getTastingPickerBottles(ctx);
    const searching = (ctx.ui.tastingQuery || "").trim().length >= MIN_SEARCH_CHARS;
    const pickerHint = searching
      ? "Showing search matches."
      : "Showing your tracked bottles. Search to log anything else.";
    return `
      <section class="tasting-layout">
        <form class="tasting-form" data-tasting-form>
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Tasting</p>
              <h2>Log a pour</h2>
            </div>
          </div>
          <label class="field">
            <span>Find a bottle</span>
            <input id="tastingSearch" type="search" value="${escapeAttr(ctx.ui.tastingQuery || "")}" placeholder="Search by bottle, distillery, profile" autocomplete="off">
          </label>
          <label class="field">
            <span>Bottle</span>
            <select name="bottleId">
              ${picker.list.map((bottle) => `<option value="${escapeAttr(bottle.id)}" ${bottle.id === picker.chosenId ? "selected" : ""}>${escapeHtml(bottle.name)}</option>`).join("")}
            </select>
            <small class="source-line">${escapeHtml(pickerHint)}</small>
          </label>
          ${renderTastingBatchPicker(ctx, getBottleIndex(ctx).get(picker.chosenId), draft)}
          <div class="form-pair">
            <label class="field">
              <span>Date</span>
              <input name="date" type="date" value="${escapeAttr(draft.date || today)}">
            </label>
            <label class="field">
              <span>Score</span>
              <input name="score" type="number" min="1" max="10" step="0.1" value="${escapeAttr(draft.score)}">
            </label>
          </div>
          <div class="field">
            <span>How you tasted it</span>
            <div class="blind-toggle" role="group" aria-label="Sighted or blind">
              <button class="filter-button${draft.blind ? "" : " active"}" type="button" data-action="tasting-blind" data-blind="0">Knew the bottle</button>
              <button class="filter-button${draft.blind ? " active" : ""}" type="button" data-action="tasting-blind" data-blind="1">Blind</button>
            </div>
          </div>
          ${draft.blind ? `
            <label class="field">
              <span>What did you guess it was? <em class="optional-tag">optional · the fun part</em></span>
              <input name="guess" type="text" value="${escapeAttr(draft.guess)}" placeholder="e.g. Eagle Rare? Some wheater?" autocomplete="off">
            </label>
          ` : ""}
          <label class="field">
            <span>Context</span>
            <input name="context" type="text" value="${escapeAttr(draft.context)}">
          </label>
          ${renderTastingFlavorWheel(ctx)}
          <details class="npf-details"${draft.nose || draft.palateNote || draft.finish ? " open" : ""}>
            <summary>Structured notes — nose / palate / finish</summary>
            <label class="field"><span>Nose</span><input name="nose" type="text" value="${escapeAttr(draft.nose || "")}" autocomplete="off"></label>
            <label class="field"><span>Palate</span><input name="palateNote" type="text" value="${escapeAttr(draft.palateNote || "")}" autocomplete="off"></label>
            <label class="field"><span>Finish</span><input name="finish" type="text" value="${escapeAttr(draft.finish || "")}" autocomplete="off"></label>
          </details>
          <label class="field">
            <span>Notes</span>
            <textarea name="note" rows="4" placeholder="What stood out?">${escapeHtml(draft.note)}</textarea>
          </label>
          <button class="primary-button" type="submit">Save tasting</button>
        </form>
        <section class="tasting-list">
          ${ctx.state.tastings.map((tasting) => renderTasting(ctx, tasting)).join("")}
        </section>
      </section>
    `;
  }

  // Your ratings: per-bottle averages from your pours, sighted vs blind truth,
  // and leaderboards by style (BiB, cask strength, rye...).
  function renderRatingsView(ctx) {
    if (!ratingsLogic) return emptyState("Ratings unavailable.");
    const ratings = ratingsLogic.bottleRatings(ctx.state, (id) => resolveIdentity(ctx, id));
    const byId = getBottleIndex(ctx);
    const ratedIds = Object.keys(ratings).filter((id) => byId.get(id));
    if (!ratedIds.length) {
      return emptyState("No ratings yet. Score pours in “Log a pour” — and run a blind flight on the Night tab to start your blind-vs-sighted record.");
    }
    const tastings = ctx.state.tastings || [];
    const pourCount = tastings.filter((t) => Number.isFinite(Number(t.score))).length;
    const blindCount = tastings.filter((t) => ratingsLogic.isBlindTasting(t) && Number.isFinite(Number(t.score))).length;
    const gaps = ratingsLogic.blindGaps(ratings, 0.5).filter((gap) => byId.get(gap.bottleId)).slice(0, 8);
    const biggest = gaps[0];
    const biggestName = biggest ? byId.get(biggest.bottleId).name : null;

    // Your blind-call record from every guessed pour.
    const guessed = tastings.filter((t) => ratingsLogic.isBlindTasting(t) && t.guess);
    let nailedCount = 0, closeCount = 0;
    for (const t of guessed) {
      const verdict = getGuessVerdict(ctx, t, byId.get(t.bottleId));
      if (verdict && verdict.level === "nailed") nailedCount++;
      else if (verdict && verdict.level === "close") closeCount++;
    }

    const cat = ctx.ui.ratingsCategory || "all";
    const ratedBottles = ratedIds.map((id) => byId.get(id));
    const board = ratingsLogic.categoryBoard(ratings, ratedBottles, (bottle) => bottleAttrs(bottle), cat, 12);

    return `
      <div class="insight-grid">
        ${insight("Bottles rated", ratedIds.length, "from your scored pours")}
        ${insight("Pours scored", pourCount, blindCount ? blindCount + " of them blind" : "none blind yet")}
        ${insight("Blind gaps", gaps.length, "sighted vs blind ≥ 0.5")}
        ${insight("Biggest gap", biggest ? (biggest.delta > 0 ? "+" : "") + biggest.delta.toFixed(1) : "--", biggest ? shortName(biggestName) : "needs blind + sighted pours")}
        ${guessed.length ? insight("Blind calls", nailedCount + " of " + guessed.length, "🎯 nailed" + (closeCount ? " · " + closeCount + " 🔥 close" : "")) : ""}
      </div>

      <section class="search-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Blind truth</p>
            <h3>What changes when you can't see the label</h3>
          </div>
        </div>
        ${gaps.length ? `
          <div class="gap-list">
            ${gaps.map((gap) => {
              const bottle = byId.get(gap.bottleId);
              const over = gap.delta > 0;
              return `
                <button class="gap-row" type="button" data-open-card="${escapeAttr(bottle.id)}" data-card-context="shelf">
                  <span class="gap-name"><strong>${escapeHtml(bottle.name)}</strong><small>${gap.sightedCount} sighted · ${gap.blindCount} blind</small></span>
                  <span class="gap-bars">
                    <span class="gap-bar"><i>Sighted</i><span class="gap-track"><span style="width:${Math.round(gap.sightedAvg * 10)}%"></span></span><b>${gap.sightedAvg.toFixed(1)}</b></span>
                    <span class="gap-bar blind"><i>Blind</i><span class="gap-track"><span style="width:${Math.round(gap.blindAvg * 10)}%"></span></span><b>${gap.blindAvg.toFixed(1)}</b></span>
                  </span>
                  <span class="gap-delta ${over ? "over" : "under"}">${over ? "+" : ""}${gap.delta.toFixed(1)}<small>${over ? "label tax" : "blind star"}</small></span>
                </button>
              `;
            }).join("")}
          </div>
          <p class="source-line">Positive = you score it higher when you can see the label. Negative = it overperforms blind.</p>
        ` : `
          <p class="source-note">No overlap yet — this needs the same bottle scored both ways. Run a blind flight on the <b>Night</b> tab (your scores log automatically), then rate the same bottles sighted in “Log a pour”.</p>
        `}
      </section>

      ${renderCalibrationPanel(ctx, ratings, byId)}

      ${renderRebuyBoard(ctx, byId)}

      <section class="search-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Your boards</p>
            <h3>Best by style</h3>
          </div>
        </div>
        <div class="filter-row">
          ${ratingsLogic.CATEGORIES.map((category) => `<button class="filter-button${cat === category.key ? " active" : ""}" type="button" data-action="ratings-cat" data-cat="${escapeAttr(category.key)}">${escapeHtml(category.label)}</button>`).join("")}
        </div>
        ${board.rows.length ? `
          <p class="source-line">${board.summary.count} rated ${cat === "all" ? "bottle" : "in this style"}${board.summary.count === 1 ? "" : "s"} · your average ${board.summary.avg ? board.summary.avg.toFixed(1) : "--"}</p>
          <div class="board-list">
            ${board.rows.map((row, index) => `
              <button class="rank-row board-row" type="button" data-open-card="${escapeAttr(row.bottle.id)}" data-card-context="shelf">
                <span>${index + 1}</span>
                <div>
                  <strong>${escapeHtml(row.bottle.name)}</strong>
                  <small>${row.count} pour${row.count === 1 ? "" : "s"}${row.blindCount ? " · blind " + row.blindAvg.toFixed(1) : ""}${row.delta !== null ? " · " + (row.delta > 0 ? "+" : "") + row.delta.toFixed(1) + " sighted" : ""}</small>
                </div>
                <b>${row.avg.toFixed(1)}</b>
              </button>
            `).join("")}
          </div>
        ` : `<p class="source-note">Nothing rated in this style yet.</p>`}
      </section>
    `;
  }

  // Score calibration: your distribution (what an 8.5 actually means from you)
  // and where your numbers disagree with your blind Showdown picks.
  function renderCalibrationPanel(ctx, ratings, byId) {
    if (!ratingsLogic || !ratingsLogic.scoreDistribution) return "";
    const dist = ratingsLogic.scoreDistribution(ctx.state.tastings);
    if (!dist || dist.count < 3) return "";
    const maxCount = Math.max(...dist.buckets.map((bucket) => bucket.count), 1);
    const conflicts = ratingsLogic.ratingConflicts(ratings, ctx.state.matchups, byId).slice(0, 5);
    return `
      <section class="search-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Calibration</p>
            <h3>What your numbers actually mean</h3>
          </div>
        </div>
        <div class="calib-bars">
          ${dist.buckets.map((bucket) => `
            <div class="calib-bar">
              <i>${escapeHtml(bucket.label)}</i>
              <span class="gap-track"><span style="width:${Math.round((bucket.count / maxCount) * 100)}%"></span></span>
              <b>${bucket.count}</b>
            </div>
          `).join("")}
        </div>
        <p class="source-line">Median pour: ${dist.median.toFixed(1)} · a 9.0 is your top ${dist.topShare(9)}% · top decile starts at ${dist.p90.toFixed(1)}.</p>
        ${conflicts.length ? `
          <h4 class="calib-subhead">Your scores vs your blind picks</h4>
          <div class="conflict-list">
            ${conflicts.map((conflict) => {
              const higher = byId.get(conflict.ratedHigher);
              const picked = byId.get(conflict.pickedMore);
              return `<div class="conflict-row">You rate <button class="link-inline" type="button" data-open-card="${escapeAttr(higher.id)}" data-card-context="shelf">${escapeHtml(higher.name)}</button> ${conflict.ratedGap.toFixed(1)} higher — but you've picked <button class="link-inline" type="button" data-open-card="${escapeAttr(picked.id)}" data-card-context="shelf">${escapeHtml(picked.name)}</button> ${conflict.record} head-to-head.</div>`;
            }).join("")}
          </div>
        ` : ""}
      </section>
    `;
  }

  // The truest list in the app: not what you rated highest — what you actually
  // finished and would hand money over for again.
  function renderRebuyBoard(ctx, byId) {
    if (!ratingsLogic || !ratingsLogic.rebuyBoard) return "";
    const board = ratingsLogic.rebuyBoard(ctx.state.killLog);
    if (!board.finishedCount) return "";
    const row = (entry, cls, mark) => {
      const bottle = byId.get(entry.bottleId);
      if (!bottle) return "";
      return `<button class="rank-row board-row rebuy-row ${cls}" type="button" data-open-card="${escapeAttr(bottle.id)}" data-card-context="shelf"><span>${mark}</span><div><strong>${escapeHtml(bottle.name)}</strong><small>finished ${escapeHtml(entry.date || "")}</small></div></button>`;
    };
    return `
      <section class="search-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">The rebuy list</p>
            <h3>Bottles you finished — and your verdict</h3>
          </div>
          <strong>${board.finishedCount}</strong>
        </div>
        <div class="board-list">
          ${board.rebuys.map((entry) => row(entry, "yes", "↻")).join("")}
          ${board.enoughs.map((entry) => row(entry, "no", "—")).join("")}
        </div>
        ${board.unanswered.length ? `<p class="source-line">${board.unanswered.length} finished bottle${board.unanswered.length === 1 ? "" : "s"} still need${board.unanswered.length === 1 ? "s" : ""} a verdict — open ${board.unanswered.length === 1 ? "its" : "their"} scorecard and answer “Buy it again?”.</p>` : ""}
      </section>
    `;
  }

  function renderTasting(ctx, tasting) {
    const bottle = getBottleIndex(ctx).get(tasting.bottleId);
    const blind = ratingsLogic ? ratingsLogic.isBlindTasting(tasting) : false;
    const verdict = blind ? getGuessVerdict(ctx, tasting, bottle) : null;
    let guessLine = "";
    if (tasting.guess) {
      if (verdict && verdict.level === "nailed") {
        guessLine = `<p class="guess-line"><span class="guess-nailed">🎯 Nailed it</span> — guessed “${escapeHtml(tasting.guess)}”</p>`;
      } else if (verdict && verdict.level === "close") {
        guessLine = `<p class="guess-line"><span class="guess-close">🔥 Close</span> (${escapeHtml(verdict.why)}) — guessed “${escapeHtml(tasting.guess)}”</p>`;
      } else {
        guessLine = `<p class="guess-line">Guessed “${escapeHtml(tasting.guess)}”</p>`;
      }
    }
    return `
      <article class="tasting-card${blind ? " blind" : ""}">
        <div>
          <p class="eyebrow">${escapeHtml(tasting.date)}${tasting.batch ? ' · <span class="batch-tag">' + escapeHtml(tasting.batch) + "</span>" : ""}${blind ? ' · <span class="blind-chip">Blind</span>' : ""}</p>
          <h3>${escapeHtml(bottle ? bottle.name : "Unknown bottle")}</h3>
          ${guessLine}
          ${tasting.nose || tasting.palate || tasting.finish ? `<p class="npf-line">${[["N", tasting.nose], ["P", tasting.palate], ["F", tasting.finish]].filter(([, v]) => v).map(([k, v]) => `<b>${k}:</b> ${escapeHtml(v)}`).join(" · ")}</p>` : ""}
          <p>${escapeHtml(tasting.note || tasting.context)}</p>
          <div class="hero-tags">${(tasting.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        </div>
        <strong>${Number(tasting.score).toFixed(1)}</strong>
      </article>
    `;
  }

  function renderNight(ctx) {
    if (ctx.state.activeTastingGame) return renderTastingGame(ctx, ctx.state.activeTastingGame);
    const flight = ctx.state.activeFlight;
    if (!flight) return renderNightStart(ctx);
    if (flight.status === "setup") return renderNightSetup(ctx, flight);
    if (flight.status === "revealed") return renderNightReveal(ctx, flight);
    return renderNightScoring(ctx, flight);
  }

  function makeNightLookup(ctx) {
    const byId = getBottleIndex(ctx);
    return function lookup(bottleId) {
      const bottle = byId.get(bottleId);
      if (!bottle) return {};
      return { refPrice: rec.getReferencePrice(bottle), hype: bottle.hypeIndex };
    };
  }

  function renderNightStart(ctx) {
    const history = Array.isArray(ctx.state.flights) ? ctx.state.flights : [];
    const games = (Array.isArray(ctx.state.tastingGames) ? ctx.state.tastingGames : []).filter((g) => g.format !== "paired-table-v1");
    return `
      <section class="section-stack night-layout">
        ${global.BarrelTableUI ? global.BarrelTableUI.startCard() + global.BarrelTableUI.history(ctx) : ""}
        <details class="tt-other-formats"><summary>Other tasting formats</summary>
        <section class="search-panel night-intro">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Tasting night</p>
              <h2>Run the table game</h2>
            </div>
          </div>
          <p class="host-only-note">Host console only: run the round, then put the screen aside. The tasting belongs at the table.</p>
          <p class="source-note">Pick the bottles, pour them into numbered glasses, and let the room score blind. Reveal the ranking when you're ready — nobody sees a label until the big reveal.</p>
          <div class="club-actions">
            <button class="primary-button" type="button" data-action="game-new">Single-pour host game</button>
            <button class="ghost-button" type="button" data-action="night-new">Run a scored blind flight</button>
          </div>
        </section>
        </details>
        ${renderTastingGameHistory(ctx, games)}
        ${renderNightHistory(ctx, history)}
      </section>
    `;
  }

  function renderTastingGame(ctx, game) {
    if (game.currentRound) return renderTastingGameRound(ctx, game);
    if (game.status === "setup") return renderTastingGameSetup(ctx, game);
    return renderTastingGameLobby(ctx, game);
  }

  function renderTastingGameSetup(ctx, game) {
    const query = String(ctx.ui.gameQuery || "").trim().toLowerCase();
    const results = query.length >= MIN_SEARCH_CHARS ? ctx.bottles.filter((bottle) => bottle._searchText.includes(query)).slice(0, 8) : [];
    const teamFields = (game.teams || []).map((team) => `<label class="field"><span>Team</span><input value="${escapeAttr(team.name)}" data-game-team-name="${escapeAttr(team.id)}" maxlength="40"></label>`).join("");
    const entries = (game.entries || []).map((entry) => `<div class="game-entry"><b>${entry.slot}</b><div><strong>${escapeHtml(entry.name)}</strong><label><span>Exact release / pick</span><input value="${escapeAttr(entry.release || "")}" placeholder="Batch, year, recipe, or pick" data-game-entry-release="${escapeAttr(entry.id)}"></label></div><button type="button" class="icon-button" data-action="game-remove-entry" data-entry="${escapeAttr(entry.id)}" aria-label="Remove slot ${entry.slot}">&times;</button></div>`).join("");
    const catalogResults = results.map((bottle) => `<button class="night-result" type="button" data-action="game-add-bottle" data-bottle="${escapeAttr(bottle.id)}"><strong>${escapeHtml(bottle.name)}</strong><small>${escapeHtml([getBottleMaker(bottle), bottle.proof ? bottle.proof + " proof" : ""].filter(Boolean).join(" · "))}</small></button>`).join("");
    const firstTeam = (game.teams || [])[0] || { id: "", name: "Team One" };
    return `<section class="section-stack night-layout tasting-game"><section class="search-panel"><div class="panel-heading"><div><p class="eyebrow">Tasting Night · setup</p><h2>Set the table</h2></div><button class="ghost-button" type="button" data-action="game-discard">Cancel</button></div><p class="source-note">Enter the bottles in physical table order. Add an exact batch or store-pick detail before you play.</p><div class="game-team-names">${teamFields}</div><div class="game-lineup">${entries || `<p class="source-line">No lineup slots yet. Add what is on the table.</p>`}</div><label class="field"><span>Add from the catalog</span><input id="gameSearch" type="search" value="${escapeAttr(ctx.ui.gameQuery || "")}" placeholder="Search bottle or distillery" autocomplete="off"></label>${query.length >= MIN_SEARCH_CHARS ? `<div class="night-results">${catalogResults || `<p class="source-line">No catalog matches — add it as a table label below.</p>`}</div>` : ""}<div class="game-manual-add"><label class="field"><span>Table label not in catalog</span><input id="gameManualName" placeholder="Bottle name" maxlength="100"></label><label class="field"><span>Exact release (optional)</span><input id="gameManualRelease" placeholder="e.g. C923 or store pick" maxlength="80"></label><button class="ghost-button" type="button" data-action="game-add-manual">Add slot</button></div></section><div class="club-actions"><button class="primary-button" type="button" data-action="game-draw" data-team="${escapeAttr(firstTeam.id)}" ${(game.entries || []).length ? "" : "disabled"}>Start with ${escapeHtml(firstTeam.name)}</button></div></section>`;
  }

  function renderTastingGameLobby(ctx, game) {
    const remaining = nightLogic && nightLogic.remainingGameSlots ? nightLogic.remainingGameSlots(game) : 0;
    const preferred = (game.teams || [])[(game.rounds || []).length % 2] || (game.teams || [])[0] || {};
    return `<section class="section-stack night-layout tasting-game"><section class="search-panel"><div class="panel-heading"><div><p class="eyebrow">Tasting Night · scoreboard</p><h2>Choose the guessing team</h2></div><button class="ghost-button" type="button" data-action="game-save">Save &amp; finish</button></div>${renderGameScoreboard(game)}<p class="source-note">${remaining} table slot${remaining === 1 ? "" : "s"} remain. The host draws a random slot, pours it blind, then hands over the device.</p><div class="game-team-actions">${(game.teams || []).map((team) => `<button class="${team.id === preferred.id ? "primary-button" : "ghost-button"}" type="button" data-action="game-draw" data-team="${escapeAttr(team.id)}">Draw for ${escapeHtml(team.name)}</button>`).join("")}</div></section>${renderGameRoundList(game)}</section>`;
  }

  function renderTastingGameRound(ctx, game) {
    const round = game.currentRound;
    const entry = nightLogic && nightLogic.gameEntry ? nightLogic.gameEntry(game, round) : null;
    const team = (game.teams || []).find((item) => item.id === round.guessingTeamId) || {};
    if (round.revealed) return `<section class="section-stack night-layout tasting-game"><section class="search-panel game-reveal"><p class="eyebrow">Round reveal · slot ${round.slot}</p><h2>${escapeHtml(entry ? entry.name : "Unknown bottle")}</h2><p>${escapeHtml(entry && entry.release ? entry.release : "No release detail recorded")}</p><div class="game-points">${round.points} <span>point${round.points === 1 ? "" : "s"} · ${escapeHtml(team.name || "Team")}</span></div><p class="source-note">${round.correct ? "Correct on guess " + round.attempts.length + "." : "No correct guess in three attempts."}</p><button class="primary-button" type="button" data-action="game-next">Back to scoreboard</button></section></section>`;
    const attempts = round.attempts || [];
    return `<section class="section-stack night-layout tasting-game"><section class="search-panel game-blind-screen"><p class="eyebrow">Blind round</p><div class="game-slot">${round.slot}</div><h2>${escapeHtml(team.name || "Guessing team")}, what is it?</h2><p>Up to three guesses. Bottle identity stays hidden until the host resolves the call.</p><div class="game-attempts">${attempts.map((guess, index) => `<div><b>Guess ${index + 1}</b><span>${escapeHtml(guess)}</span></div>`).join("") || `<p class="source-line">No guesses yet.</p>`}</div>${attempts.length < 3 ? `<div class="game-guess"><input id="gameGuess" type="text" autofocus autocomplete="off" placeholder="Enter guess ${attempts.length + 1}"><button class="primary-button" type="button" data-action="game-guess">Lock guess</button></div>` : ""}<div class="game-host-controls"><span>Host control</span><button class="ghost-button" type="button" data-action="game-resolve" data-correct="1" ${attempts.length ? "" : "disabled"}>Correct · reveal</button><button class="ghost-button" type="button" data-action="game-resolve" data-correct="0" ${attempts.length >= 3 ? "" : "disabled"}>No match · reveal</button></div></section></section>`;
  }

  function renderGameScoreboard(game) {
    return `<div class="game-scoreboard">${(game.teams || []).map((team) => `<div><span>${escapeHtml(team.name)}</span><b>${Number(team.points || 0)}</b></div>`).join("")}</div>`;
  }

  function renderGameRoundList(game) {
    const rounds = game.rounds || [];
    if (!rounds.length) return "";
    return `<section class="search-panel"><div class="panel-heading"><div><p class="eyebrow">This session</p><h3>Rounds played</h3></div></div><div class="game-round-list">${rounds.slice().reverse().map((round) => { const entry = nightLogic.gameEntry(game, round) || {}; const team = (game.teams || []).find((item) => item.id === round.guessingTeamId) || {}; return `<div><b>Slot ${round.slot}</b><span>${escapeHtml(entry.name || "Unknown bottle")}${entry.release ? " · " + escapeHtml(entry.release) : ""}</span><small>${escapeHtml(team.name || "Team")} · ${round.points} pt${round.points === 1 ? "" : "s"}</small></div>`; }).join("")}</div></section>`;
  }

  function renderTastingGameHistory(ctx, games) {
    if (!games.length) return "";
    return `<section class="search-panel"><div class="panel-heading"><div><p class="eyebrow">Game history</p><h3>Past Tasting Nights</h3></div></div><div class="game-history">${games.slice(0, 6).map((game) => `<div><strong>${(game.teams || []).map((team) => escapeHtml(team.name) + " " + Number(team.points || 0)).join(" · ")}</strong><small>${(game.rounds || []).length} round${(game.rounds || []).length === 1 ? "" : "s"} · ${(game.savedAt || game.createdAt || "").slice(0, 10)}</small></div>`).join("")}</div></section>`;
  }

  function renderNightSetup(ctx, flight) {
    const byId = getBottleIndex(ctx);
    const chosen = (flight.bottleIds || []).map((id) => byId.get(id)).filter(Boolean);
    const tasters = flight.tasters || [];
    const query = (ctx.ui.nightQuery || "").trim().toLowerCase();
    const results = [];
    if (query.length >= MIN_SEARCH_CHARS) {
      const chosenSet = new Set(flight.bottleIds || []);
      for (const bottle of ctx.bottles) {
        if (results.length >= 8) break;
        if (chosenSet.has(bottle.id)) continue;
        if (bottle._searchText.includes(query)) results.push(bottle);
      }
    }
    const canStart = chosen.length >= 2 && tasters.length >= 1;
    return `
      <section class="section-stack night-layout">
        <section class="search-panel">
          <div class="panel-heading">
            <div><p class="eyebrow">Tasting night · setup</p><h2>Build the flight</h2></div>
            <button class="ghost-button" type="button" data-action="night-discard">Cancel</button>
          </div>
          <p class="source-note">Add 2–8 bottles and the people tasting. We'll pour them into shuffled glasses so the order gives nothing away.</p>
          <div class="night-chosen">
            ${chosen.length ? chosen.map((bottle) => `<span class="night-chip">${escapeHtml(bottle.name)}<button type="button" data-action="night-remove-bottle" data-bottle="${escapeAttr(bottle.id)}" aria-label="Remove ${escapeAttr(bottle.name)}">&times;</button></span>`).join("") : `<p class="source-line">No bottles yet — search below.</p>`}
          </div>
          <label class="field"><span>Add a bottle</span><input id="nightSearch" type="search" value="${escapeAttr(ctx.ui.nightQuery || "")}" placeholder="Search by bottle, distillery, profile" autocomplete="off"></label>
          ${query.length >= MIN_SEARCH_CHARS ? `<div class="night-results">${results.length ? results.map((bottle) => `<button class="night-result" type="button" data-action="night-add" data-bottle="${escapeAttr(bottle.id)}"><strong>${escapeHtml(bottle.name)}</strong><small>${escapeHtml([getBottleMaker(bottle), bottle.proof ? bottle.proof + " proof" : ""].filter(Boolean).join(" · "))}</small></button>`).join("") : `<p class="source-line">No matches.</p>`}</div>` : ""}
        </section>
        <section class="search-panel">
          <div class="panel-heading"><div><p class="eyebrow">Who's tasting</p><h3>The room</h3></div></div>
          <div class="night-chosen">
            ${tasters.length ? tasters.map((taster) => `<span class="night-chip">${escapeHtml(taster)}<button type="button" data-action="night-remove-taster" data-taster="${escapeAttr(taster)}" aria-label="Remove ${escapeAttr(taster)}">&times;</button></span>`).join("") : `<p class="source-line">Add at least one taster.</p>`}
          </div>
          <div class="night-add-taster">
            <label class="field"><span>Add a taster</span><input id="nightTaster" type="text" placeholder="Name" autocomplete="off" maxlength="40"></label>
            <button class="ghost-button" type="button" data-action="night-add-taster">Add</button>
          </div>
        </section>
        <div class="club-actions">
          <button class="primary-button" type="button" data-action="night-start" ${canStart ? "" : "disabled"}>Pour &amp; start scoring</button>
          ${canStart ? "" : `<small class="source-line">Need at least 2 bottles and 1 taster.</small>`}
        </div>
      </section>
    `;
  }

  function renderNightScoring(ctx, flight) {
    const tasters = flight.tasters || [];
    const scored = nightLogic ? nightLogic.scoredCount(flight) : 0;
    const expected = nightLogic ? nightLogic.expectedScores(flight) : 0;
    return `
      <section class="section-stack night-layout">
        <section class="search-panel">
          <div class="panel-heading">
            <div><p class="eyebrow">Tasting night · scoring</p><h2>Score the glasses</h2></div>
            <button class="ghost-button" type="button" data-action="night-discard">Discard</button>
          </div>
          <p class="source-note">Pour each bottle into its glass and score blind, 1–10. Labels stay hidden until you reveal. <strong>${scored} of ${expected}</strong> scores in.</p>
        </section>
        <div class="night-glasses">
          ${(flight.pours || []).map((pour) => renderNightGlass(flight, pour, tasters)).join("")}
        </div>
        <div class="club-actions">
          <button class="primary-button" type="button" data-action="night-reveal">Reveal results</button>
        </div>
      </section>
    `;
  }

  function renderNightGlass(flight, pour, tasters) {
    const row = (flight.scores || {})[pour.glass] || {};
    const guess = ((flight.guesses || {})[pour.glass]) || "";
    return `
      <section class="night-glass">
        <div class="night-glass-letter" aria-hidden="true">${escapeHtml(pour.glass)}</div>
        <div class="night-glass-scores">
          ${tasters.map((taster) => {
            const value = Number.isFinite(row[taster]) ? row[taster] : "";
            return `<label class="night-score"><span>${escapeHtml(taster)}</span><input type="number" min="1" max="10" step="0.1" inputmode="decimal" value="${value}" data-night-glass="${escapeAttr(pour.glass)}" data-night-taster="${escapeAttr(taster)}"></label>`;
          }).join("")}
          <label class="night-score night-guess-row"><span>Guess</span><input type="text" autocomplete="off" placeholder="what is it?" value="${escapeAttr(guess)}" data-night-guess="${escapeAttr(pour.glass)}"></label>
        </div>
      </section>
    `;
  }

  function renderNightReveal(ctx, flight) {
    const results = nightLogic.flightResults(flight, makeNightLookup(ctx));
    return `
      <section class="section-stack night-layout">
        <section class="search-panel">
          <div class="panel-heading"><div><p class="eyebrow">Tasting night · reveal</p><h2>The verdict</h2></div></div>
          ${results.headline ? `<p class="night-headline">${escapeHtml(results.headline)}</p>` : ""}
        </section>
        <div class="night-ranking">
          ${results.ranked.map((row, index) => renderNightRankRow(ctx, row, index)).join("") || emptyState("No scores were entered for this flight.")}
        </div>
        ${results.unscored.length ? `<p class="source-line">Not scored: ${results.unscored.map((row) => escapeHtml(row.glass + " · " + row.bottleName)).join(", ")}</p>` : ""}
        <div class="club-actions">
          <button class="primary-button" type="button" data-action="night-save">Save to history</button>
          <button class="ghost-button" type="button" data-action="night-share">Share recap</button>
          <button class="ghost-button" type="button" data-action="night-discard">Discard</button>
        </div>
      </section>
    `;
  }

  function renderNightRankRow(ctx, row, index) {
    let guessLine = "";
    if (row.guess) {
      const bottle = getBottleIndex(ctx).get(row.bottleId);
      const verdict = getGuessVerdict(ctx, { guess: row.guess }, bottle);
      if (verdict && verdict.level === "nailed") {
        guessLine = `<p class="guess-line"><span class="guess-nailed">🎯 Nailed it</span> — the room guessed “${escapeHtml(row.guess)}”</p>`;
      } else if (verdict && verdict.level === "close") {
        guessLine = `<p class="guess-line"><span class="guess-close">🔥 Close</span> (${escapeHtml(verdict.why)}) — guessed “${escapeHtml(row.guess)}”</p>`;
      } else {
        guessLine = `<p class="guess-line">The room guessed “${escapeHtml(row.guess)}”</p>`;
      }
    }
    return `
      <article class="night-rank${index === 0 ? " winner" : ""}">
        <span class="night-rank-pos">${index + 1}</span>
        <div class="night-rank-main">
          <strong>${escapeHtml(row.bottleName)}</strong>
          <small>Glass ${escapeHtml(row.glass)}${Number.isFinite(row.refPrice) ? " · " + rec.money(row.refPrice) : ""}</small>
          ${guessLine}
          <div class="night-rank-scores">${row.scores.map((entry) => `<span>${escapeHtml(entry.taster)} ${entry.score.toFixed(1)}</span>`).join("")}</div>
        </div>
        <b class="night-rank-avg">${row.average.toFixed(1)}</b>
      </article>
    `;
  }

  function renderNightHistory(ctx, history) {
    if (!history.length) return "";
    return `
      <section class="search-panel">
        <div class="panel-heading"><div><p class="eyebrow">History</p><h3>Past flights</h3></div></div>
        <div class="night-history">
          ${history.slice(0, 8).map((flight, flightIndex) => {
            const results = nightLogic.flightResults(flight, makeNightLookup(ctx));
            const winner = results.ranked[0];
            const date = flight.savedAt ? flight.savedAt.slice(0, 10) : "";
            const tasterCount = (flight.tasters || []).length;
            return `<div class="night-history-row"><div><strong>${winner ? escapeHtml(winner.bottleName) : "No scores"}</strong><small>${(flight.pours || []).length} bottles · ${tasterCount} taster${tasterCount === 1 ? "" : "s"}${date ? " · " + escapeHtml(date) : ""}</small></div><span class="night-history-actions">${winner ? `<b>${winner.average.toFixed(1)}</b>` : ""}<button class="ghost-button share-mini" type="button" data-action="night-share" data-flight-i="${flightIndex}">Share</button></span></div>`;
          }).join("")}
        </div>
      </section>
    `;
  }

  function saveFlight(ctx) {
    const flight = ctx.state.activeFlight;
    if (!flight) return;
    const owner = (ctx.palate && ctx.palate.name) ? String(ctx.palate.name) : "";
    const date = new Date().toISOString().slice(0, 10);
    let logged = 0;
    if (owner) {
      for (const pour of flight.pours || []) {
        const score = flight.scores && flight.scores[pour.glass] ? flight.scores[pour.glass][owner] : undefined;
        if (!Number.isFinite(score)) continue;
        const glassGuess = ((flight.guesses || {})[pour.glass]) || "";
        const nightTasting = {
          id: "taste-night-" + pour.glass + "-" + Date.now() + "-" + logged,
          bottleId: pour.bottleId,
          date,
          score: Number(score),
          context: "Blind — Tasting Night",
          blind: true,
          tags: [],
          note: "Glass " + pour.glass + ", scored blind"
        };
        if (glassGuess) nightTasting.guess = glassGuess;
        ctx.state.tastings.unshift(nightTasting);
        ctx.state.statuses[pour.bottleId] = ctx.state.statuses[pour.bottleId] || "tasted";
        logged += 1;
      }
    }
    const record = Object.assign({}, flight, { status: "revealed", savedAt: new Date().toISOString() });
    ctx.state.flights = [record].concat(Array.isArray(ctx.state.flights) ? ctx.state.flights : []).slice(0, 20);
    ctx.state.activeFlight = null;
    ctx._forYou = null;
    persist(ctx);
    render(ctx);
    showToast(ctx, logged ? "Flight saved — your " + logged + " score" + (logged === 1 ? "" : "s") + " added to Tastings." : "Flight saved to history.");
  }

  function saveTastingGame(ctx) {
    const game = ctx.state.activeTastingGame;
    if (!game) return;
    if (game.currentRound) {
      showToast(ctx, "Finish or reveal the active round before saving.");
      return;
    }
    const record = JSON.parse(JSON.stringify({ ...game, status: "complete", savedAt: new Date().toISOString() }));
    ctx.state.tastingGames = [record].concat(Array.isArray(ctx.state.tastingGames) ? ctx.state.tastingGames : []).slice(0, 20);
    ctx.state.activeTastingGame = null;
    persist(ctx);
    render(ctx);
    showToast(ctx, "Tasting Night saved to local history.");
  }

  function renderClub(ctx) {
    const hasFriends = ctx.friends.length > 0;
    const ranked = rec.rankBottlesForStore({
      bottles: getRecommendationCandidates(ctx),
      palate: ctx.palate,
      friends: ctx.friends,
      statuses: ctx.state.statuses
    }).slice(0, 5);
    return `
      <section class="club-layout">
        <section class="search-panel club-share-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Your club</p>
              <h2>${hasFriends ? ctx.friends.length + " in the room" : "Bring your group in"}</h2>
            </div>
          </div>
          <p class="source-note">Share your card, then import your friends'. No accounts, no servers — everyone's ratings live in their own private files and merge into the group's Buy / Consider / Pass calls.</p>
          <div class="club-actions">
            <button class="primary-button" type="button" data-action="club-share">Share my card</button>
            <button class="ghost-button" type="button" data-action="club-add">Add a friend's card</button>
          </div>
        </section>
        <div class="friend-grid">
          ${ctx.friends.map((friend) => renderFriend(ctx, friend)).join("") || emptyState("No friends in your club yet. Tap “Add a friend's card” to import the file a friend shared with you.")}
        </div>
        ${renderClubConsensus(ctx)}
        <section class="club-rankings">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">${hasFriends ? "Group signal" : "Personal model"}</p>
              <h2>${hasFriends ? "Best buys for the room" : "Best buys before friend ratings"}</h2>
            </div>
          </div>
          ${ranked.map((item, index) => `
            <article class="rank-row">
              <span>${index + 1}</span>
              <div>
                <strong>${escapeHtml(item.bottle.name)}</strong>
                <small>${escapeHtml(item.result.summary)}</small>
              </div>
              <b>${item.result.confidence}</b>
            </article>
          `).join("")}
        </section>
      </section>
    `;
  }

  function renderClubConsensus(ctx) {
    if (!clubLogic || !ctx.friends.length) return "";
    const byId = getBottleIndex(ctx);
    const ratedIds = new Set();
    for (const friend of ctx.friends) {
      for (const id of Object.keys(friend.ratings || {})) ratedIds.add(id);
    }
    const rows = [];
    for (const id of ratedIds) {
      const consensus = clubLogic.bottleConsensus(id, ctx.friends);
      const bottle = byId.get(id);
      if (consensus && bottle) rows.push({ bottle, consensus });
    }
    if (!rows.length) return "";
    rows.sort((a, b) => b.consensus.average - a.consensus.average || b.consensus.count - a.consensus.count);
    const top = rows.slice(0, 6);
    return `
      <section class="search-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Group signal</p>
            <h3>What the room rates highest</h3>
          </div>
        </div>
        <div class="club-consensus">
          ${top.map(({ bottle, consensus }) => `
            <div class="club-consensus-row">
              <strong>${escapeHtml(bottle.name)}</strong>
              <span>${consensus.average.toFixed(1)} avg · ${consensus.count} rater${consensus.count === 1 ? "" : "s"}${consensus.count > 1 ? " · " + consensus.low.toFixed(1) + "–" + consensus.high.toFixed(1) : ""}</span>
            </div>
          `).join("")}
        </div>
      </section>
    `;
  }

  function renderFriend(ctx, friend) {
    const byId = getBottleIndex(ctx);
    const ratingCount = friend.ratings ? Object.keys(friend.ratings).length : 0;
    const favNames = (friend.favorites || []).slice(0, 3).map((id) => {
      const bottle = byId.get(id);
      return bottle ? bottle.name : shortBottleName(id);
    });
    const removable = !(ctx.staticFriends || []).includes(friend);
    return `
      <article class="friend-card">
        <div class="friend-card-top">
          <div class="friend-avatar">${escapeHtml(friend.name.slice(0, 1))}</div>
          ${removable ? `<button class="friend-remove" type="button" data-action="club-remove" data-friend="${escapeAttr(friend.name)}" title="Remove ${escapeAttr(friend.name)}" aria-label="Remove ${escapeAttr(friend.name)} from your club">&times;</button>` : ""}
        </div>
        <h3>${escapeHtml(friend.name)}</h3>
        <p>${escapeHtml(friend.style || "")}</p>
        <div class="hero-tags">
          ${favNames.map((name) => `<span>${escapeHtml(name)}</span>`).join("") || `<span>${ratingCount} bottle${ratingCount === 1 ? "" : "s"} rated</span>`}
        </div>
        ${ratingCount ? `<small class="source-line">${ratingCount} rating${ratingCount === 1 ? "" : "s"} feeding the group model</small>` : ""}
      </article>
    `;
  }

  function renderCatalogQuality(ctx) {
    const report = buildCatalogQualityReport(ctx.bottles);
    const topShelf = buildTopShelfQueue(ctx);
    const secondaryMarket = buildSecondaryMarketQueue(ctx);
    const highRate = report.totalRecords ? Math.round((report.highBottleCount / report.totalRecords) * 100) + "%" : "0%";
    const cleanRate = report.totalRecords ? Math.round((report.cleanCount / report.totalRecords) * 100) + "%" : "0%";
    const issueCap = report.issueCount > report.issues.length
      ? `Showing the top ${report.issues.length} by severity.`
      : "All flagged records are shown.";
    return `
      <section class="section-stack qa-layout">
        <div class="insight-grid">
          ${insight("Visible records", report.totalRecords.toLocaleString("en-US"), "confidence-gated catalog")}
          ${insight("Clean records", report.cleanCount.toLocaleString("en-US"), cleanRate + " without QA flags")}
          ${insight("High risk", report.highCount.toLocaleString("en-US"), highRate + " of visible catalog")}
          ${insight("Review queue", report.issueCount.toLocaleString("en-US"), "deterministic QA findings")}
        </div>

        <section class="qa-panel top-shelf-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Top Shelf QA</p>
              <h2>Priority bottles to harden</h2>
            </div>
          </div>
          <p class="source-note">This queue narrows the work to premium, limited, allocated, high-hype, older, or review-visible bottles where weak data would be most obvious.</p>
          <div class="top-shelf-list">
            ${topShelf.items.map((item) => renderTopShelfItem(ctx, item)).join("") || emptyState("No top shelf risks flagged.")}
          </div>
        </section>

        <section class="qa-panel market-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">DramValue Match Queue</p>
              <h2>Secondary market candidates</h2>
            </div>
          </div>
          <p class="source-note">${secondaryMarket.matchedCount.toLocaleString("en-US")} matched, ${secondaryMarket.missingCount.toLocaleString("en-US")} need lookup. Use this for trophy bottles where MSRP alone would make the recommendation wrong.</p>
          <div class="market-match-list">
            ${secondaryMarket.items.map((item) => renderSecondaryMarketItem(ctx, item)).join("") || emptyState("No secondary-market candidates flagged.")}
          </div>
        </section>

        <section class="qa-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Catalog QA</p>
              <h2>Records needing review</h2>
            </div>
          </div>
          <p class="source-note">${escapeHtml(issueCap)} High severity usually means identity, producer, proof range, or pricing needs a manual source check. Low-severity enrichment gaps: ${report.lowCount.toLocaleString("en-US")}.</p>
          <div class="qa-category-grid">
            ${renderQualityCategoryCounts(report)}
          </div>
          <div class="qa-issue-list">
            ${report.issues.map((issue) => renderQualityIssue(ctx, issue)).join("") || emptyState("No visible catalog quality issues flagged.")}
          </div>
        </section>
      </section>
    `;
  }

  function renderSecondaryMarketItem(ctx, item) {
    const active = item.bottle.id === ctx.state.activeBottleId ? " active" : "";
    const marketText = item.hasMarket
      ? `${money(item.market.value)} ${item.market.label}${item.market.sampleSize ? ` / ${item.market.sampleSize} sales` : ""}`
      : item.query;
    return `
      <article class="market-match-card market-${escapeAttr(item.status)}${active}">
        <button type="button" data-bottle-id="${escapeAttr(item.bottle.id)}">
          <span class="market-status">${escapeHtml(item.statusLabel)}</span>
          <span class="market-match-copy">
            <strong>${escapeHtml(item.bottle.name)}</strong>
            <small>${escapeHtml(getBottleMaker(item.bottle))} / ${escapeHtml(marketText)}</small>
            <span class="mini-tags">
              ${item.tags.slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
            </span>
          </span>
        </button>
        <a class="ghost-link" href="${escapeAttr(item.url)}" target="_blank" rel="noopener">${item.hasMarket ? "Open source" : "Search DramValue"}</a>
      </article>
    `;
  }

  function renderTopShelfItem(ctx, item) {
    const active = item.bottle.id === ctx.state.activeBottleId ? " active" : "";
    return `
      <button class="top-shelf-card${active}" type="button" data-bottle-id="${escapeAttr(item.bottle.id)}">
        <span class="top-shelf-score">${item.score}</span>
        <span class="top-shelf-copy">
          <strong>${escapeHtml(item.bottle.name)}</strong>
          <small>${escapeHtml(getBottleMaker(item.bottle))} / ${escapeHtml(item.reason)}</small>
          <span class="mini-tags">
            ${item.gaps.slice(0, 5).map((gap) => `<span>${escapeHtml(gap)}</span>`).join("")}
          </span>
        </span>
      </button>
    `;
  }

  function renderQualityCategoryCounts(report) {
    const categories = Object.entries(report.categoryCounts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    return categories.map(([category, count]) => `
      <article class="qa-category">
        <span>${escapeHtml(category)}</span>
        <strong>${count.toLocaleString("en-US")}</strong>
      </article>
    `).join("");
  }

  function renderQualityIssue(ctx, issue) {
    const bottle = issue.bottle;
    const active = bottle.id === ctx.state.activeBottleId ? " active" : "";
    const proofText = bottle.proofDisplay || (Number.isFinite(bottle.proof) ? bottle.proof + " proof" : "proof n/a");
    const tags = [
      issue.category,
      getSourceCount(bottle) ? getSourceCount(bottle) + " source" + (getSourceCount(bottle) === 1 ? "" : "s") : "no sources",
      proofText
    ].concat(issue.tags || []);
    return `
      <button class="qa-issue-card qa-${escapeAttr(issue.severity)}${active}" type="button" data-bottle-id="${escapeAttr(bottle.id)}">
        <span class="qa-severity">${escapeHtml(issue.severity)}</span>
        <span class="qa-issue-copy">
          <strong>${escapeHtml(bottle.name)}</strong>
          <small>${escapeHtml(getBottleMaker(bottle))} / ${escapeHtml(issue.title)}</small>
          <span>${escapeHtml(issue.detail)}</span>
          <span class="mini-tags">
            ${tags.slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}
          </span>
        </span>
      </button>
    `;
  }

  function buildCatalogQualityReport(bottles) {
    const list = Array.isArray(bottles) ? bottles : [];
    const allIssues = list.flatMap((bottle) => getBottleQualityIssues(bottle));
    const reviewIssues = allIssues.filter((issue) => issue.severity !== "low");
    const categoryCounts = {};
    const bottleIdsWithIssues = new Set();
    const highBottleIds = new Set();
    const severityCounts = {
      high: 0,
      medium: 0,
      low: 0
    };

    for (const issue of allIssues) {
      severityCounts[issue.severity] += 1;
      if (issue.severity !== "low") {
        categoryCounts[issue.category] = (categoryCounts[issue.category] || 0) + 1;
        bottleIdsWithIssues.add(issue.bottle.id);
      }
      if (issue.severity === "high") highBottleIds.add(issue.bottle.id);
    }

    reviewIssues.sort((left, right) => {
      const severityDelta = QA_SEVERITY_SCORE[right.severity] - QA_SEVERITY_SCORE[left.severity];
      if (severityDelta) return severityDelta;
      const categoryDelta = (QA_CATEGORY_SCORE[right.category] || 0) - (QA_CATEGORY_SCORE[left.category] || 0);
      if (categoryDelta) return categoryDelta;
      const sourceDelta = getSourceCount(right.bottle) - getSourceCount(left.bottle);
      if (sourceDelta) return sourceDelta;
      return String(left.bottle.name || "").localeCompare(String(right.bottle.name || ""));
    });

    return {
      totalRecords: list.length,
      issueCount: reviewIssues.length,
      bottleIssueCount: bottleIdsWithIssues.size,
      cleanCount: Math.max(0, list.length - bottleIdsWithIssues.size),
      highCount: severityCounts.high,
      mediumCount: severityCounts.medium,
      lowCount: severityCounts.low,
      highBottleCount: highBottleIds.size,
      categoryCounts,
      issues: reviewIssues.slice(0, MAX_QA_ISSUES)
    };
  }

  function buildTopShelfQueue(ctxOrBottles) {
    const bottles = Array.isArray(ctxOrBottles) ? ctxOrBottles : (ctxOrBottles && ctxOrBottles.bottles) || [];
    const ctx = Array.isArray(ctxOrBottles)
      ? { reviewData: { reviewsByBottleId: {} }, state: { storePrice: 0 } }
      : ctxOrBottles || { reviewData: { reviewsByBottleId: {} }, state: { storePrice: 0 } };
    const items = bottles
      .filter(isTopShelfCandidate)
      .map((bottle) => buildTopShelfItem(ctx, bottle))
      .filter((item) => item.gaps.length)
      .sort((left, right) => right.score - left.score || String(left.bottle.name || "").localeCompare(String(right.bottle.name || "")));

    return {
      totalCandidates: bottles.filter(isTopShelfCandidate).length,
      issueCount: items.length,
      items: items.slice(0, MAX_TOP_SHELF_ITEMS)
    };
  }

  function buildSecondaryMarketQueue(ctxOrBottles) {
    const bottles = Array.isArray(ctxOrBottles) ? ctxOrBottles : (ctxOrBottles && ctxOrBottles.bottles) || [];
    const candidates = bottles
      .filter(isTopShelfCandidate)
      .map(buildSecondaryMarketItem)
      .filter((item) => item.shouldShow)
      .sort((left, right) => {
        const statusDelta = secondaryStatusWeight(right.status) - secondaryStatusWeight(left.status);
        if (statusDelta) return statusDelta;
        return right.score - left.score || String(left.bottle.name || "").localeCompare(String(right.bottle.name || ""));
      });
    const matchedCount = candidates.filter((item) => item.hasMarket).length;
    const missingCount = candidates.length - matchedCount;

    return {
      totalCandidates: bottles.filter(isTopShelfCandidate).length,
      matchedCount,
      missingCount,
      items: candidates.slice(0, MAX_SECONDARY_MARKET_ITEMS)
    };
  }

  function buildSecondaryMarketItem(bottle) {
    const market = rec.getSecondaryMarketInfo ? rec.getSecondaryMarketInfo(bottle) : { value: null };
    const hasMarket = Number.isFinite(market.value);
    const isStale = hasMarket && isOlderThanDays(market.observedAt, 120);
    const query = buildDramValueQuery(bottle);
    const url = hasMarket && market.url ? market.url : buildDramValueSearchUrl(bottle, query);
    const status = hasMarket ? (isStale ? "stale" : "matched") : "missing";
    const score = getTopShelfBaseScore(bottle) + (hasMarket ? 0 : 40) + (isStale ? 18 : 0);
    const tags = [
      hasMarket ? money(market.value) + " avg" : "needs secondary",
      hasMarket && market.latestPrice ? money(market.latestPrice) + " latest" : "",
      hasMarket && market.sampleSize ? market.sampleSize + " sales" : "",
      getDramValueCategoryLabel(bottle),
      bottle.rarity || ""
    ].filter(Boolean);

    return {
      bottle,
      hasMarket,
      market,
      query,
      url,
      status,
      statusLabel: status === "matched" ? "Matched" : status === "stale" ? "Refresh" : "Lookup",
      score,
      shouldShow: hasMarket || String(bottle.rarity || "").toLowerCase().includes("unicorn") || Number(bottle.hypeIndex) >= 72 || Number(getMarketReferenceCandidate(bottle)) >= 100,
      tags
    };
  }

  function secondaryStatusWeight(status) {
    if (status === "missing") return 300;
    if (status === "stale") return 200;
    return 100;
  }

  function buildDramValueQuery(bottle) {
    return [
      bottle.name,
      bottle.age && !/unknown|nas|batch/i.test(String(bottle.age)) ? bottle.age : "",
      Number.isFinite(bottle.proof) ? bottle.proof + " proof" : ""
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function buildDramValueSearchUrl(bottle, query) {
    const params = [
      ["q", query],
      ["has_price", "1"]
    ];
    const category = getDramValueCategory(bottle);
    if (category) params.push(["category", category]);
    return "https://www.dramvalue.com/bottles?" + params
      .map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value))
      .join("&");
  }

  function getDramValueCategory(bottle) {
    const text = [bottle.category, bottle.bottleKind, bottle.name].filter(Boolean).join(" ").toLowerCase();
    if (text.includes("rye")) return "rye";
    if (text.includes("bourbon") || text.includes("tennessee")) return "bourbon";
    if (text.includes("american single malt")) return "american_single_malt";
    if (text.includes("single malt") || text.includes("scotch")) return "scotch_single_malt";
    if (text.includes("irish")) return "irish";
    if (text.includes("japanese")) return "japanese";
    return "";
  }

  function getDramValueCategoryLabel(bottle) {
    const category = getDramValueCategory(bottle);
    return category ? category.replace(/_/g, " ") : "all categories";
  }

  function getMarketReferenceCandidate(bottle) {
    if (Number.isFinite(bottle.fairPrice)) return bottle.fairPrice;
    if (Number.isFinite(bottle.msrp)) return bottle.msrp;
    if (Number.isFinite(bottle.sourceRetailPrice)) return bottle.sourceRetailPrice;
    return null;
  }

  function isOlderThanDays(value, days) {
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return Date.now() - date.getTime() > days * 24 * 60 * 60 * 1000;
  }

  function buildTopShelfItem(ctx, bottle) {
    const review = buildReviewIntelligence(ctx, bottle);
    const confidence = getDatabaseConfidence(bottle);
    const priceWindow = getPriceWindow(bottle);
    const release = getReleaseTrust(bottle, review);
    const issues = getBottleQualityIssues(bottle);
    const gaps = [];
    let score = getTopShelfBaseScore(bottle);

    if (!bottle.curated || !bottle.curated.canonicalId) {
      gaps.push("curated overlay");
      score += 34;
    }
    if (!review.hasReviews) {
      gaps.push("cited reviews");
      score += 28;
    }
    if (!priceWindow.hasReference || priceWindow.confidence === "low") {
      gaps.push("price anchor");
      score += 20;
    }
    if (release.tone === "thin") {
      gaps.push("release match");
      score += 16;
    }
    if (confidence.level !== "Strong") {
      gaps.push(confidence.level.toLowerCase() + " confidence");
      score += confidence.level === "Thin" ? 20 : 10;
    }
    if (issues.some((issue) => issue.severity === "high")) {
      gaps.push("high QA risk");
      score += 24;
    }

    return {
      bottle,
      score,
      reason: getTopShelfReason(bottle),
      gaps: uniqueText(gaps)
    };
  }

  function isTopShelfCandidate(bottle) {
    const text = [
      bottle.id,
      bottle.name,
      bottle.producer,
      bottle.distillery,
      bottle.category,
      ...(bottle.aliases || [])
    ].filter(Boolean).join(" ").toLowerCase();
    const rarity = String(bottle.rarity || "").toLowerCase();
    const price = rec.getReferencePrice ? rec.getReferencePrice(bottle) : bottle.fairPrice || bottle.msrp || bottle.sourceRetailPrice;
    const sourceCount = getSourceCount(bottle);
    const ageYears = Number.isFinite(bottle.ageYears) ? bottle.ageYears : extractAgeYears(bottle.age);
    return (
      rarity.includes("unicorn") ||
      rarity.includes("allocated") ||
      rarity.includes("limited") ||
      Number(bottle.hypeIndex) >= 72 ||
      Number(price) >= 100 ||
      Number(ageYears) >= 12 ||
      sourceCount >= 6 ||
      /\b(pappy|van winkle|btac|stagg|weller|birthday|michter|found north|parker|heritage|king of kentucky|four roses limited|russell|cellar aged|little book|blood oath|barrell|bardstown discovery)\b/.test(text)
    );
  }

  function getTopShelfBaseScore(bottle) {
    let score = 0;
    if (String(bottle.rarity || "").toLowerCase().includes("unicorn")) score += 30;
    if (String(bottle.rarity || "").toLowerCase().includes("allocated")) score += 22;
    if (String(bottle.rarity || "").toLowerCase().includes("limited")) score += 18;
    if (Number(bottle.hypeIndex) >= 90) score += 24;
    else if (Number(bottle.hypeIndex) >= 72) score += 14;
    const reference = rec.getReferencePrice ? rec.getReferencePrice(bottle) : bottle.fairPrice || bottle.msrp || bottle.sourceRetailPrice;
    if (Number(reference) >= 200) score += 20;
    else if (Number(reference) >= 100) score += 12;
    return score;
  }

  function getTopShelfReason(bottle) {
    const reasons = [];
    if (bottle.rarity) reasons.push(bottle.rarity);
    if (Number(bottle.hypeIndex) >= 72) reasons.push("high hype");
    const reference = rec.getReferencePrice ? rec.getReferencePrice(bottle) : bottle.fairPrice || bottle.msrp || bottle.sourceRetailPrice;
    if (Number(reference) >= 100) reasons.push("premium price");
    const ageYears = Number.isFinite(bottle.ageYears) ? bottle.ageYears : extractAgeYears(bottle.age);
    if (Number(ageYears) >= 12) reasons.push(String(ageYears) + " year");
    return reasons.slice(0, 3).join(" / ") || "priority whiskey";
  }

  function extractAgeYears(value) {
    const match = String(value || "").match(/(\d+(?:\.\d+)?)\s*(?:year|yr|y)\b/i);
    if (!match) return null;
    const years = Number(match[1]);
    return Number.isFinite(years) ? years : null;
  }

  function uniqueText(values) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
      const clean = String(value || "").trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      result.push(clean);
    }
    return result;
  }

  function getBottleQualityIssues(bottle) {
    const issues = [];
    const sourceCount = getSourceCount(bottle);
    const priceStats = getQualityPriceStats(bottle);
    const proofRange = parseProofRange(bottle);
    const maker = getBottleMaker(bottle);

    if (hasAdminNameMarker(bottle.name)) {
      issues.push(qualityIssue(
        bottle,
        "high",
        "Identity",
        "display-admin-marker",
        "Administrative text in display name",
        "Visible name still contains source-system language that should not reach the app catalog.",
        ["name cleanup"]
      ));
    }

    if (hasWeakDisplayName(bottle.name)) {
      issues.push(qualityIssue(
        bottle,
        "high",
        "Identity",
        "weak-display-name",
        "Display name is not bottle identity",
        "Name looks like a pack, admin note, or size field instead of a real bottle label.",
        ["identity check"]
      ));
    }

    if (!maker || maker === "Unknown producer") {
      issues.push(qualityIssue(
        bottle,
        "high",
        "Identity",
        "missing-maker",
        "Missing producer or distillery",
        "A serious whiskey catalog should identify the maker, owner, or bottler before this record is trusted.",
        ["producer"]
      ));
    } else if (isSupplierOnlyMaker(bottle, maker)) {
      issues.push(qualityIssue(
        bottle,
        "medium",
        "Identity",
        "supplier-only-maker",
        "Maker appears supplier-only",
        "The best available maker field looks like a distributor or importer rather than the whiskey producer.",
        ["producer"]
      ));
    }

    if (!proofRange) {
      issues.push(qualityIssue(
        bottle,
        "medium",
        "Proof",
        "missing-proof",
        "Missing proof",
        "No usable proof value was parsed for this bottle.",
        ["proof"]
      ));
    } else if (proofRange.width >= 25) {
      issues.push(qualityIssue(
        bottle,
        "high",
        "Proof",
        "wide-proof-range",
        "Very wide proof range",
        `Proof spans ${formatProof(proofRange.min)}-${formatProof(proofRange.max)}, which usually means multiple expressions or batches were merged.`,
        ["merge risk"]
      ));
    } else if (proofRange.width >= 12) {
      issues.push(qualityIssue(
        bottle,
        "medium",
        "Proof",
        "wide-proof-range",
        "Wide proof range",
        `Proof spans ${formatProof(proofRange.min)}-${formatProof(proofRange.max)}. Review whether this is one variable-proof release or multiple records.`,
        ["merge risk"]
      ));
    }

    if (sourceCount && !priceStats.count && !Number.isFinite(bottle.sourceRetailPrice) && !Number.isFinite(bottle.fairPrice) && !Number.isFinite(bottle.msrp)) {
      issues.push(qualityIssue(
        bottle,
        "medium",
        "Pricing",
        "no-source-price",
        "No usable price",
        "Source-backed record has identity coverage but no retail, MSRP, or fair-value anchor.",
        ["price"]
      ));
    }

    if (Number.isFinite(priceStats.min) && Number.isFinite(priceStats.max) && priceStats.min > 0) {
      const spread = priceStats.max / priceStats.min;
      const isImplausibleLow = priceStats.min < getBelievablePriceFloorForQa(bottle);
      if (spread >= 10 || (spread >= 3 && isImplausibleLow)) {
        issues.push(qualityIssue(
          bottle,
          "high",
          "Pricing",
          "large-price-spread",
          "Implausible source price spread",
          `Source prices run from ${money(priceStats.min)} to ${money(priceStats.max)}. Check size, pack, vintage, or merge identity.`,
          ["price spread"]
        ));
      } else if (spread >= 2.5) {
        issues.push(qualityIssue(
          bottle,
          "medium",
          "Pricing",
          "large-price-spread",
          "Wide source price spread",
          `Source prices run from ${money(priceStats.min)} to ${money(priceStats.max)}. Review before trusting value guidance.`,
          ["price spread"]
        ));
      }
    }

    if (sourceCount === 1 && bottle.catalogConfidence !== "verified") {
      issues.push(qualityIssue(
        bottle,
        "low",
        "Coverage",
        "single-source",
        "Single-source record",
        "Only one official source currently backs this bottle.",
        ["source depth"]
      ));
    }

    if (!hasKnownAge(bottle)) {
      issues.push(qualityIssue(
        bottle,
        "low",
        "Specs",
        "missing-age",
        "Age not verified",
        "Age is missing, unknown, or NAS; this limits connoisseur-level bottle context.",
        ["age"]
      ));
    }

    if (!hasKnownMashBill(bottle)) {
      issues.push(qualityIssue(
        bottle,
        "low",
        "Specs",
        "missing-mashbill",
        "Mash bill not verified",
        "Mash bill is missing or undisclosed; flag for manual enrichment when the bottle matters.",
        ["mash bill"]
      ));
    }

    return issues;
  }

  function qualityIssue(bottle, severity, category, code, title, detail, tags) {
    return {
      bottle,
      severity,
      category,
      code,
      title,
      detail,
      tags: tags || []
    };
  }

  function getSourceCount(bottle) {
    const summaryCount = bottle.sourceSummary && Number.isFinite(bottle.sourceSummary.sourceCount)
      ? bottle.sourceSummary.sourceCount
      : 0;
    const refCount = (bottle.sourceRefs || bottle.sourcePreview || []).length;
    return Math.max(summaryCount, refCount);
  }

  function getQualityPriceStats(bottle) {
    const summary = bottle.sourceSummary || {};
    const prices = [];
    if (Number.isFinite(summary.minRetailPrice)) prices.push(summary.minRetailPrice);
    if (Number.isFinite(summary.maxRetailPrice)) prices.push(summary.maxRetailPrice);
    if (Number.isFinite(bottle.sourceRetailPrice)) prices.push(bottle.sourceRetailPrice);
    for (const price of bottle.prices || []) {
      if (Number.isFinite(price.retailPrice)) prices.push(price.retailPrice);
    }
    return {
      count: summary.priceObservationCount || prices.length,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null
    };
  }

  function parseProofRange(bottle) {
    const display = String(bottle.proofDisplay || "");
    const values = display.match(/\d+(?:\.\d+)?/g);
    const nums = values ? values.map(Number).filter(Number.isFinite) : [];
    if (!nums.length && Number.isFinite(bottle.proof)) nums.push(bottle.proof);
    if (!nums.length) return null;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    return { min, max, width: max - min };
  }

  function hasAdminNameMarker(name) {
    return /^\s*BP\b|(^|\s)(?:DNO|DISCO)(?:\s|$)|\buse code\b|\bingredient\b|\.{3,}|\b0\s*proof\b/i.test(String(name || ""));
  }

  function hasWeakDisplayName(name) {
    const value = String(name || "").trim();
    if (!value) return true;
    if (/^\(?[a-z]{1,5}\)?\s*\d+(?:\.\d+)?\s*(?:ml|l)$/i.test(value)) return true;
    if (/^\d+(?:\.\d+)?\s*(?:ml|l)$/i.test(value)) return true;
    if (/^(?:bourbon|rye|whiskey|whisky|scotch)$/i.test(value)) return true;
    return false;
  }

  function isSupplierOnlyMaker(bottle, maker) {
    if (bottle.distillery || bottle.producer) return false;
    return /\b(distributing|distribution|import|imports|wholesale|winebow|rndc|republic national|southern glazer|tri-vin)\b/i.test(String(maker || ""));
  }

  function hasKnownAge(bottle) {
    if (Number.isFinite(bottle.ageYears) && bottle.ageYears > 0) return true;
    const age = String(bottle.age || "").trim();
    return Boolean(age && !/^(unknown|nas|n\/a)$/i.test(age));
  }

  function hasKnownMashBill(bottle) {
    const mashBill = String(bottle.mashBill || "").trim();
    return Boolean(mashBill && !/^(unknown|undisclosed|n\/a)$/i.test(mashBill));
  }

  function getBelievablePriceFloorForQa(bottle) {
    const size = String(bottle.size || "").toLowerCase();
    if (/1\.75\s*l|1750\s*ml/.test(size)) return 20;
    if (/\b1\s*l|1000\s*ml/.test(size)) return 15;
    if (/700\s*ml|720\s*ml|750\s*ml/.test(size)) return 12;
    if (/375\s*ml/.test(size)) return 8;
    if (/200\s*ml/.test(size)) return 5;
    return 10;
  }

  function formatProof(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function getCocktailRankings(ctx, bottle) {
    if (!cocktailLogic || !cocktailLogic.rankCocktailsForBottle) {
      return (ctx.cocktails || []).map((cocktail) => ({ cocktail, score: 50, reason: "Use a balanced 100-proof bourbon." }));
    }
    return cocktailLogic.rankCocktailsForBottle(bottle, ctx.cocktails || []);
  }

  function getBestCocktailMatch(ctx, bottle) {
    return getCocktailRankings(ctx, bottle)[0] || null;
  }

  function getActiveCocktail(ctx, ranked) {
    const match = ranked.find((item) => item.cocktail.id === ctx.ui.activeCocktailId);
    if (match) return match;
    const first = ranked[0] || null;
    if (first) ctx.ui.activeCocktailId = first.cocktail.id;
    return first;
  }

  function getActiveBottle(ctx) {
    return ensureActiveBottle(ctx);
  }

  function ensureActiveBottle(ctx) {
    const active = ctx.bottles.find((bottle) => bottle.id === ctx.state.activeBottleId);
    if (active) return active;
    const fallback = ctx.bottles[0];
    if (fallback) ctx.state.activeBottleId = fallback.id;
    return fallback;
  }

  // User-taught "same bottle" links: duplicate catalog spellings resolve to one
  // canonical bottle for ratings and pour history.
  function resolveIdentity(ctx, id) {
    const links = ctx.state.identityLinks || {};
    return links[id] || id;
  }

  // Memoized id -> bottle lookup. ctx.bottles is immutable after boot, so build once.
  function getBottleIndex(ctx) {
    if (!ctx._bottleById) {
      ctx._bottleById = new Map(ctx.bottles.map((bottle) => [bottle.id, bottle]));
    }
    return ctx._bottleById;
  }

  // Bounded option set for the Tastings picker. Instead of rendering an <option> for
  // every one of ~8.6k catalog bottles on each render, show the user's tracked bottles
  // (plus the active/chosen one), or top search matches when they type. The chosen and
  // active bottles are always included so the selection survives a search re-render.
  function getTastingPickerBottles(ctx) {
    const index = getBottleIndex(ctx);
    const active = getActiveBottle(ctx);
    const chosenId = (ctx.ui.tastingBottleId && index.has(ctx.ui.tastingBottleId))
      ? ctx.ui.tastingBottleId
      : (active ? active.id : "");
    const byId = new Map();
    if (active) byId.set(active.id, active);
    if (chosenId && index.has(chosenId)) byId.set(chosenId, index.get(chosenId));

    const query = (ctx.ui.tastingQuery || "").trim().toLowerCase();
    if (query.length >= MIN_SEARCH_CHARS) {
      const raw = [];
      for (const bottle of ctx.bottles) {
        if (raw.length >= 200) break;
        if (bottle._searchText.includes(query)) raw.push(bottle);
      }
      for (const bottle of collapseVariants(ctx, raw).slice(0, 40)) {
        byId.set(bottle.id, bottle);
      }
    } else {
      for (const [id, status] of Object.entries(ctx.state.statuses || {})) {
        if (status && status !== "none") {
          const bottle = index.get(id);
          if (bottle) byId.set(id, bottle);
        }
      }
    }

    const list = Array.from(byId.values()).sort((left, right) => {
      if (left.id === chosenId) return -1;
      if (right.id === chosenId) return 1;
      return String(left.name).localeCompare(String(right.name));
    });
    return { list, chosenId };
  }

  // Candidate pool for "best buy" rankings. Scoring every one of ~8.6k catalog rows on
  // each Club render froze the tab; most imported rows also lack the review/hype/palate
  // signal that makes a recommendation meaningful. Restrict to bottles with rich decision
  // data (curated/seeded) plus anything the user tracks, plus the active bottle. The base
  // rich set is memoized since it never changes after boot.
  function getRecommendationCandidates(ctx) {
    if (!ctx._richBottles) {
      ctx._richBottles = ctx.bottles.filter((bottle) =>
        bottle.curated ||
        Number.isFinite(bottle.reviewScore) ||
        Number.isFinite(bottle.hypeIndex) ||
        bottle.priceBands ||
        !hasSourceRefs(bottle)
      );
    }
    const index = getBottleIndex(ctx);
    const byId = new Map(ctx._richBottles.map((bottle) => [bottle.id, bottle]));
    for (const [id, status] of Object.entries(ctx.state.statuses || {})) {
      if (status && status !== "none") {
        const bottle = index.get(id);
        if (bottle) byId.set(id, bottle);
      }
    }
    const active = getActiveBottle(ctx);
    if (active) byId.set(active.id, active);
    return Array.from(byId.values());
  }

  function bottleAttrs(bottle) {
    if (!bottle._attrs && global.BarrelFamilies) {
      bottle._attrs = global.BarrelFamilies.attributes(bottle);
    }
    return bottle._attrs || {};
  }

  function matchesStoreFilters(bottle, filters) {
    if (!filters) return true;
    const a = bottleAttrs(bottle);
    if (filters.type && a.whiskeyType !== filters.type) return false;
    if (filters.release) {
      if (filters.release === "single" && !a.singleBarrel) return false;
      if (filters.release === "smallbatch" && !a.smallBatch) return false;
      if (filters.release === "bonded" && !a.bottledInBond) return false;
      if (filters.release === "cask" && !a.caskStrength) return false;
      if (filters.release === "wheated" && a.style !== "Wheated bourbon") return false;
    }
    return true;
  }

  // ---- Variant collapsing: one row per real product ------------------------
  // The catalog carries many state-by-state spellings of the same bottle
  // ("Eagle Rare 10Y", "Eagle Rare 10YR Bourbon", ...). Display surfaces group
  // them by the collection lineKey and show the best representative.
  function bottleLineKey(ctx, bottle) {
    if (!bottle._lineKey) {
      const C = global.BarrelCollection;
      bottle._lineKey = C && C.lineKey ? C.lineKey(bottle) : bottle.id;
    }
    return bottle._lineKey;
  }

  function variantRepScore(bottle) {
    let score = 0;
    if (bottle.curated) score += 100;
    if (bottle.catalogConfidence === "verified") score += 50;
    else if (bottle.catalogConfidence === "cross-checked") score += 40;
    else if (bottle.catalogConfidence === "priced-source") score += 20;
    if (!hasSourceRefs(bottle)) score += 30; // seed bottles have the rich curated copy
    if (Number.isFinite(bottle.msrp)) score += 15;
    return score - String(bottle.name || "").length / 200;
  }

  function collapseVariants(ctx, bottles) {
    const groups = new Map();
    for (const bottle of bottles) {
      const key = bottleLineKey(ctx, bottle);
      const group = groups.get(key);
      if (!group) {
        groups.set(key, { bottle, count: 1 });
      } else {
        group.count += 1;
        if (variantRepScore(bottle) > variantRepScore(group.bottle)) group.bottle = bottle;
      }
    }
    const reps = [];
    for (const group of groups.values()) {
      group.bottle._variantCount = group.count;
      reps.push(group.bottle);
    }
    return reps;
  }

  // A genuine store / private / barrel-select pick (the clutter) — NOT a flagship
  // single-barrel product like Blanton's, Four Roses, or Russell's Reserve.
  function isStorePick(bottle) {
    const name = String(bottle && bottle.name || "").toLowerCase();
    return /\bbarrel select\b|\bbrl slct\b|single barrel select|\bstore pick\b|\bshop pick\b|\bbarrel pick\b|\bprivate (selection|barrel|stock|pick)\b|\bpersonal (selection|barrel)\b|\bhand[- ]?picked\b|\bexclusive\b|buy (the|entire) barrel|\(psb\)|\(sbs\)|\bpsb\b|\bsbs\b|selected by|chosen by|picked by/.test(name);
  }

  function getFilteredBottleInfo(ctx) {
    const query = ctx.ui.query.trim().toLowerCase();
    const filters = ctx.ui.storeFilters || {};
    const hasFilters = Boolean(filters.type || filters.release);
    const hasQuery = query.length >= MIN_SEARCH_CHARS;
    if (!hasQuery && !hasFilters) {
      const mode = query.length > 0 ? "too-short" : "idle";
      return { items: getDefaultStoreBottles(ctx), totalMatches: ctx.bottles.length, hiddenPicks: 0, mode, query };
    }
    const hidePicks = ctx.ui.storeHidePicks !== false;
    const matches = [];
    let totalMatches = 0;
    let hiddenPicks = 0;
    for (const bottle of ctx.bottles) {
      if (hasQuery && !bottle._searchText.includes(query)) continue;
      if (hasFilters && !matchesStoreFilters(bottle, filters)) continue;
      if (hidePicks && isStorePick(bottle)) { hiddenPicks += 1; continue; }
      totalMatches += 1;
      matches.push(bottle);
    }
    const collapsed = collapseVariants(ctx, matches);
    if (hasQuery) {
      collapsed.sort((left, right) => scoreSearchResult(right, query) - scoreSearchResult(left, query));
    } else {
      collapsed.sort((left, right) => (Number(right.hypeIndex) || 0) - (Number(left.hypeIndex) || 0));
    }
    return {
      items: collapsed.slice(0, MAX_SEARCH_RESULTS),
      totalMatches: collapsed.length,
      listingCount: totalMatches,
      hiddenPicks,
      mode: hasQuery ? "search" : "filter",
      query
    };
  }

  function scoreSearchResult(bottle, query) {
    const name = String(bottle.name || "").toLowerCase();
    const sourceCount = bottle.sourceSummary && bottle.sourceSummary.sourceCount ? bottle.sourceSummary.sourceCount : 0;
    const priceCount = bottle.sourceSummary && bottle.sourceSummary.priceObservationCount ? bottle.sourceSummary.priceObservationCount : 0;
    let score = 0;
    if (name === query) score += 120;
    if (name.startsWith(query)) score += 70;
    if (new RegExp("\\b" + escapeRegExp(query)).test(name)) score += 30;
    if (!hasSourceRefs(bottle)) score += 40;
    if (bottle.catalogConfidence === "verified") score += 36;
    if (bottle.catalogConfidence === "cross-checked") score += 28;
    if (bottle.catalogConfidence === "priced-source") score += 12;
    score += Math.min(sourceCount * 3, 24);
    score += Math.min(priceCount * 2, 16);
    if (getBottleMaker(bottle) !== "Unknown producer") score += 10;
    if (/\b(barrel select|buy the barrel|single barrel select|exclusive barrel)\b/i.test(name)) score -= 8;
    score -= Math.min(name.length / 40, 4);
    return score;
  }

  function getDefaultStoreBottles(ctx) {
    const active = getActiveBottle(ctx);
    const curated = ctx.bottles.filter((bottle) => !hasSourceRefs(bottle)).slice(0, MAX_EMPTY_RESULTS);
    return [active, ...curated].filter(Boolean).filter((bottle, index, all) => all.findIndex((item) => item.id === bottle.id) === index).slice(0, MAX_EMPTY_RESULTS);
  }

  function shortType(t) {
    return { "Rye whiskey": "Rye", "Tennessee whiskey": "Tennessee", "Irish whiskey": "Irish" }[t] || t;
  }

  function renderStoreFilters(ctx) {
    const f = ctx.ui.storeFilters || {};
    const types = ["Bourbon", "Rye whiskey", "Tennessee whiskey", "Scotch", "Irish whiskey"];
    const releases = [["single", "Single barrel"], ["smallbatch", "Small batch"], ["bonded", "Bottled in bond"], ["cask", "Cask strength"], ["wheated", "Wheated"]];
    const active = f.type || f.release;
    return `
      <div class="store-filters">
        <div class="filter-group">
          <span class="filter-label">Type</span>
          ${types.map((t) => `<button class="filter-button${f.type === t ? " active" : ""}" type="button" data-filtergroup="type" data-filtervalue="${escapeAttr(t)}" aria-pressed="${f.type === t}">${escapeHtml(shortType(t))}</button>`).join("")}
        </div>
        <div class="filter-group">
          <span class="filter-label">Release</span>
          ${releases.map(([v, l]) => `<button class="filter-button${f.release === v ? " active" : ""}" type="button" data-filtergroup="release" data-filtervalue="${v}" aria-pressed="${f.release === v}">${escapeHtml(l)}</button>`).join("")}
        </div>
        ${active ? `<button class="ghost-link store-filter-clear" type="button" data-action="clear-filters">Clear</button>` : ""}
      </div>
    `;
  }

  function renderStorePicksToggle(ctx, info) {
    if (info.mode !== "search" && info.mode !== "filter") return "";
    const hidePicks = ctx.ui.storeHidePicks !== false;
    // Nothing to reveal and already hiding → no need to show the control.
    if (hidePicks && !info.hiddenPicks) return "";
    return `
      <div class="wiz-picks-row">
        <button class="wiz-picks-toggle${hidePicks ? "" : " on"}" type="button" data-action="toggle-store-picks">${hidePicks ? "Show store picks (" + info.hiddenPicks + ")" : "Hide store picks"}</button>
      </div>
    `;
  }

  function renderSearchSummary(info) {
    if (info.mode === "idle") {
      return `<p class="result-summary">Showing a short starter lane. Search the full catalog, or filter by type and release below.</p>`;
    }
    if (info.mode === "too-short") {
      return `<p class="result-summary">Keep typing. Full-catalog search starts at ${MIN_SEARCH_CHARS} characters.</p>`;
    }
    if (info.mode === "filter") {
      const capped = info.totalMatches > info.items.length;
      return `<p class="result-summary">${info.totalMatches.toLocaleString("en-US")} bottle${info.totalMatches === 1 ? "" : "s"} match your filters${capped ? "; showing the top " + info.items.length + " by hype" : ""}.</p>`;
    }
    const capped = info.totalMatches > info.items.length;
    const listingNote = info.listingCount > info.totalMatches ? " (" + info.listingCount.toLocaleString("en-US") + " listings collapsed)" : "";
    return `<p class="result-summary">${info.totalMatches.toLocaleString("en-US")} bottle${info.totalMatches === 1 ? "" : "s"}${listingNote}${capped ? "; showing the best " + info.items.length : ""}.</p>`;
  }

  function buildBottleSearchText(bottle) {
    if (catalog) {
      return catalog.buildSearchText({
        ...bottle,
        producer: bottle.producer || bottle.distillery,
        supplier: bottle.supplier || bottle.producer,
        aliases: bottle.aliases || []
      });
    }
    return [
      bottle.name,
      bottle.distillery,
      bottle.producer,
      bottle.supplier,
      bottle.category,
      bottle.rarity,
      bottle.size,
      bottle.proof,
      ...(bottle.aliases || []),
      ...(bottle.profile || []),
      ...(bottle.bestFor || [])
    ].join(" ").toLowerCase();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getBottleMaker(bottle) {
    return bottle.distillery || bottle.producer || bottle.supplier || "Unknown producer";
  }

  function getBottleValue(bottle) {
    const value = rec.getReferencePrice(bottle);
    return Number.isFinite(value) ? value : null;
  }

  function getSourcePriceLabel(bottle) {
    const price = rec.getSourceRetailPrice(bottle);
    if (!Number.isFinite(price)) return "n/a";
    return rec.money(price);
  }

  function getReferencePriceMetric(bottle) {
    const info = rec.getReferencePriceInfo
      ? rec.getReferencePriceInfo(bottle)
      : { value: rec.getReferencePrice(bottle), label: "Reference" };
    if (!Number.isFinite(info.value)) return "n/a";
    return `${rec.money(info.value)} ${info.label ? `(${info.label})` : ""}`.trim();
  }

  function getMarketMetric(bottle) {
    const market = rec.getSecondaryMarketInfo ? rec.getSecondaryMarketInfo(bottle) : { value: null };
    if (Number.isFinite(market.value)) {
      return {
        label: "Secondary",
        value: rec.money(market.value)
      };
    }
    return {
      label: "Source",
      value: getSourcePriceLabel(bottle)
    };
  }

  function buildBottleStory(bottle) {
    const price = rec.getSourceRetailPrice(bottle);
    const priceText = Number.isFinite(price) ? " Official source price: " + rec.money(price) + "." : "";
    return `${bottle.name} is a source-backed catalog record from ${getBottleMaker(bottle)}.${priceText}`;
  }

  function renderSourceLine(bottle) {
    const sourceRefs = bottle.sourceRefs || bottle.sourcePreview || [];
    const summaryCount = bottle.sourceSummary && bottle.sourceSummary.sourceCount ? bottle.sourceSummary.sourceCount : 0;
    if (!sourceRefs.length && !summaryCount) {
      return '<p class="source-line">Starter catalog record. Price fields are not source-verified yet.</p>';
    }
    const totalSources = summaryCount || sourceRefs.length;
    const labels = sourceRefs.slice(0, 3).map((source) => source.sourceId.replace(/_/g, " ")).join(", ");
    const extra = totalSources > 3 ? " +" + (totalSources - 3) + " more" : "";
    const labelText = labels ? ": " + escapeHtml(labels) + escapeHtml(extra) : "";
    return `<p class="source-line">Source-backed by ${totalSources} record${totalSources === 1 ? "" : "s"}${labelText}</p>`;
  }

  function hasSourceRefs(bottle) {
    return (Array.isArray(bottle.sourceRefs) && bottle.sourceRefs.length > 0) ||
      (Array.isArray(bottle.sourcePreview) && bottle.sourcePreview.length > 0) ||
      Boolean(bottle.sourceSummary && bottle.sourceSummary.sourceCount);
  }

  function tabButton(ctx, id, label) {
    const isActive = ctx.ui.tab === id;
    return `<button class="tab-button${isActive ? " active" : ""}" type="button" role="tab" data-tab="${id}" aria-selected="${isActive}">${escapeHtml(label)}</button>`;
  }

  function statusButton(ctx, status, label) {
    const active = ctx.state.statuses[ctx.state.activeBottleId] === status;
    return `<button class="ghost-button${active ? " active" : ""}" type="button" data-status="${status}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
  }

  function filterButton(ctx, filter, label) {
    const active = ctx.ui.shelfFilter === filter;
    return `<button class="filter-button${active ? " active" : ""}" type="button" data-filter="${filter}" aria-pressed="${active}">${escapeHtml(label)}</button>`;
  }

  const WHISKEY_COLORS = {
    amber: "#b56b29",
    mahogany: "#7a3420",
    garnet: "#8a3a3a",
    copper: "#a85f36",
    gold: "#c0903a",
    black: "#241a16",
    walnut: "#7a512f",
    bronze: "#9b6b3d",
    cream: "#c89d59",
    scarlet: "#8d2f2c"
  };

  function resolveWhiskeyTone(bottle) {
    if (bottle && bottle.imageTone && WHISKEY_COLORS[bottle.imageTone]) return bottle.imageTone;
    const text = [bottle && bottle.category, bottle && bottle.mashBill, bottle && bottle.name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (/\brye\b/.test(text) && !/bourbon/.test(text)) return "walnut";
    if (/wheat/.test(text)) return "gold";
    const age = bottle ? Number(bottle.ageYears) : NaN;
    if (Number.isFinite(age) && age >= 12) return "mahogany";
    if (Number.isFinite(age) && age >= 8) return "copper";
    return "amber";
  }

  // Premium, data-driven bottle illustration. Whiskey color is derived from the
  // bottle's style/age; the brand monogram sits on a real label. Falls back here
  // whenever no real photo URL is present, so it never looks like a placeholder.
  function bottleArtSvg(bottle) {
    const tone = resolveWhiskeyTone(bottle);
    const liquid = WHISKEY_COLORS[tone] || WHISKEY_COLORS.amber;
    const mono = escapeHtml(initials(bottle.name));
    return `<svg class="bottle-svg" viewBox="0 0 54 80" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path d="M22 11 L22 24 C18 26 13 30 13 40 L13 71 C13 74 14 75 17 75 L37 75 C40 75 41 74 41 71 L41 40 C41 30 36 26 32 24 L32 11 Z" fill="#1b1411" stroke="rgba(241,205,132,0.26)" stroke-width="0.8"/>
      <path d="M14 30 L14 71 C14 73.4 15 74 17 74 L37 74 C39 74 40 73.4 40 71 L40 30 C40 28 38 27 36 27 L18 27 C16 27 14 28 14 30 Z" fill="${liquid}"/>
      <rect x="14.5" y="29" width="25" height="1.4" rx="0.7" fill="rgba(255,255,255,0.3)"/>
      <rect x="16.5" y="30" width="3" height="44" rx="1.5" fill="rgba(255,255,255,0.12)"/>
      <rect x="23.6" y="12" width="1.5" height="11" fill="rgba(255,255,255,0.12)"/>
      <rect x="22" y="5.5" width="10" height="7" rx="1.2" fill="#c79a4f"/>
      <rect x="23.5" y="2.4" width="7" height="4.2" rx="1.6" fill="#e8c277"/>
      <rect x="22" y="11.3" width="10" height="1.3" fill="rgba(0,0,0,0.32)"/>
      <rect x="16" y="48" width="22" height="18" rx="2" fill="#f3e8d2" stroke="rgba(149,100,45,0.55)" stroke-width="0.7"/>
      <text x="27" y="59.6" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="7.4" font-weight="600" fill="#2c1b12">${mono}</text>
      <rect x="20" y="61.6" width="14" height="0.8" rx="0.4" fill="rgba(149,100,45,0.5)"/>
    </svg>`;
  }

  function bottleImageUrl(bottle) {
    if (!bottle) return "";
    if (bottle.imageUrl) return String(bottle.imageUrl);
    const refs = Array.isArray(bottle.sourceRefs) ? bottle.sourceRefs : [];
    const withImage = refs.find((ref) => ref && ref.imageUrl);
    return withImage ? String(withImage.imageUrl) : "";
  }

  function bottleVisual(bottle) {
    const url = bottleImageUrl(bottle);
    if (url) {
      // Real photo on top; illustration sits behind as the fallback if the image fails.
      return `
        <span class="bottle-visual has-photo" aria-hidden="true">
          ${bottleArtSvg(bottle)}
          <img class="bottle-photo" src="${escapeAttr(url)}" alt="" loading="lazy" onerror="this.remove()">
        </span>
      `;
    }
    return `<span class="bottle-visual" aria-hidden="true">${bottleArtSvg(bottle)}</span>`;
  }

  function metric(label, value) {
    return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  }

  function insight(label, value, note) {
    return `
      <article class="insight-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(value))}</strong>
        <small>${escapeHtml(note)}</small>
      </article>
    `;
  }

  function emptyState(text) {
    return `<div class="empty-state">${escapeHtml(text)}</div>`;
  }

  function countStatus(ctx, status) {
    return Object.values(ctx.state.statuses).filter((value) => value === status).length;
  }

  function getProofLane(ctx) {
    const owned = ctx.bottles.filter((bottle) => ctx.state.statuses[bottle.id] === "owned");
    const proof = average(owned.map((bottle) => bottle.proof));
    return proof ? Math.round(proof) : "--";
  }

  function statusLabel(status) {
    const labels = {
      owned: "On shelf",
      wishlist: "Wishlist",
      passed: "Passed",
      tasted: "Tasted",
      finished: "Finished",
      none: "New"
    };
    return labels[status || "none"] || "New";
  }

  function average(values) {
    const clean = values.filter((value) => Number.isFinite(value));
    if (!clean.length) return null;
    return clean.reduce((sum, value) => sum + value, 0) / clean.length;
  }

  function toggleTag(set, tag) {
    if (set.has(tag)) {
      set.delete(tag);
    } else {
      set.add(tag);
    }
  }

  function buildResearchPrompt(ctx, bottle) {
    if (!research) {
      return "Research " + bottle.name + " using source-backed facts and cited URLs.";
    }
    return research.buildBottleResearchPrompt({
      bottle,
      shelfPrice: ctx.state.storePrice,
      palate: ctx.palate
    });
  }

  function buildReviewResearchPrompt(bottle) {
    if (!reviewLogic || !reviewLogic.buildReviewResearchPrompt) {
      return "Research cited review consensus for " + bottle.name + ". Use real sources only and include URLs.";
    }
    return reviewLogic.buildReviewResearchPrompt({ bottle });
  }

  function getDatabaseConfidence(bottle) {
    if (!research || !research.getDatabaseConfidence) {
      return {
        level: "Partial",
        score: 50,
        missing: ["Database confidence unavailable"],
        shouldScout: true,
        summary: "Scout can help verify missing facts."
      };
    }
    return research.getDatabaseConfidence(bottle);
  }

  async function copyText(text) {
    if (global.navigator && global.navigator.clipboard && global.isSecureContext !== false) {
      await global.navigator.clipboard.writeText(text);
      return true;
    }

    const doc = global.document;
    if (!doc || !doc.createElement || !doc.body) return false;

    const field = doc.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    doc.body.appendChild(field);
    field.select();
    const copied = doc.execCommand ? doc.execCommand("copy") : false;
    doc.body.removeChild(field);
    return copied;
  }

  function showToast(ctx, message) {
    const doc = global.document;
    if (!doc || !doc.body) return;
    let el = doc.getElementById("bp-toast");
    if (!el) {
      el = doc.createElement("div");
      el.id = "bp-toast";
      el.className = "bp-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      doc.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    if (ctx._toastTimer) clearTimeout(ctx._toastTimer);
    ctx._toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function exportState(state) {
    const payload = { app: "barrel-proof", exportedAt: new Date().toISOString(), state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = "barrel-proof-backup-" + stamp + ".json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importState(ctx) {
    const input = global.document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new global.FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          const raw = parsed && parsed.state && typeof parsed.state === "object" ? parsed.state : parsed;
          if (!raw || typeof raw !== "object") throw new Error("not a state object");
          const store = global.BarrelStore;
          const defaults = (global.BarrelData && global.BarrelData.initialState) || {};
          const bottleIds = ctx.bottles.map((b) => b.id);
          const next = store && store.normalizeState ? store.normalizeState(raw, defaults, { bottleIds }) : raw;
          for (const key of Object.keys(ctx.state)) delete ctx.state[key];
          Object.assign(ctx.state, next);
          refreshFriends(ctx);
          ctx._forYou = null;
          for (const b of ctx.bottles) {
            delete b.observedPrice;
            delete b.observedCount;
          }
          persist(ctx);
          render(ctx);
          showToast(ctx, "Backup restored.");
        } catch (error) {
          global.alert("That doesn't look like a Barrel Proof backup file.");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function exportClubCard(ctx) {
    if (!clubLogic) return;
    const card = clubLogic.buildCardFromState(ctx.state, ctx.palate);
    const payload = { app: clubLogic.CARD_APP, exportedAt: new Date().toISOString(), card };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const slug = String(card.name || "me").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "me";
    link.href = url;
    link.download = "barrel-proof-club-" + slug + ".json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importClubCard(ctx) {
    if (!clubLogic) return;
    const input = global.document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new global.FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (parsed && parsed.app && parsed.app !== clubLogic.CARD_APP) throw new Error("wrong file");
          const card = clubLogic.normalizeCard(parsed);
          if (!card) throw new Error("not a club card");
          if (!ctx.state.club || typeof ctx.state.club !== "object") ctx.state.club = { friends: [] };
          ctx.state.club.friends = clubLogic.mergeFriend(ctx.state.club.friends, card);
          refreshFriends(ctx);
          ctx._forYou = null;
          persist(ctx);
          render(ctx);
          showToast(ctx, card.name + "'s card added to your club.");
        } catch (error) {
          global.alert("That doesn't look like a Barrel Proof club card.");
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function initials(name) {
    return name
      .replace(/[^a-z0-9 ]/gi, "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  function shortBottleName(id) {
    return id
      .split("-")
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function icon(name) {
    if (name === "download") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11"></path><path d="m7 10 5 5 5-5"></path><path d="M5 20h14"></path></svg>';
    }
    if (name === "upload") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V10"></path><path d="m7 14 5-5 5 5"></path><path d="M5 4h14"></path></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"></path><path d="M20 4v6h-6"></path></svg>';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  global.BarrelUI = {
    createApp,
    getFilteredBottleInfo,
    buildBottleSearchText,
    buildBottleIntelligence,
    buildReviewIntelligence,
    buildDecisionTrust,
    buildMarketReality,
    buildBottleDossier,
    buildTopShelfQueue,
    buildSecondaryMarketQueue,
    buildCatalogQualityReport,
    constants: {
      MIN_SEARCH_CHARS,
      MAX_EMPTY_RESULTS,
      MAX_SEARCH_RESULTS,
      MAX_QA_ISSUES,
      MAX_TOP_SHELF_ITEMS,
      MAX_SECONDARY_MARKET_ITEMS
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
