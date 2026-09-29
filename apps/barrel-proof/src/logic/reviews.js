(function attachReviews(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BarrelReviews = factory();
  }
})(typeof self !== "undefined" ? self : this, function createReviewsModule() {
  const SUGGESTED_SOURCES = [
    "Breaking Bourbon",
    "Bourbon Culture",
    "Whiskey Raiders",
    "r/bourbon",
    "producer tasting notes"
  ];

  function buildReviewIntelligence(input) {
    const bottle = input.bottle || {};
    const entries = getBottleReviewEntries(bottle, input.reviewData || {});
    const editorial = entries.filter((entry) => entry.sourceType === "editorial");
    const community = entries.filter((entry) => entry.sourceType === "community");
    const takeaways = entries.flatMap((entry) => entry.takeaways.map((text) => ({
      text,
      sourceName: entry.sourceName,
      sourceType: entry.sourceType,
      url: entry.url
    })));

    return {
      hasReviews: entries.length > 0,
      sourceCount: entries.length,
      editorialCount: editorial.length,
      communityCount: community.length,
      consensus: buildConsensus(entries),
      verdicts: entries
        .filter((entry) => entry.verdict)
        .map((entry) => ({
          verdict: entry.verdict,
          sourceName: entry.sourceName,
          sourceType: entry.sourceType,
          url: entry.url
        }))
        .slice(0, 4),
      takeaways: takeaways.slice(0, 6),
      sources: entries.map((entry) => ({
        sourceName: entry.sourceName,
        sourceType: entry.sourceType,
        url: entry.url,
        retrievedAt: entry.retrievedAt || "",
        verdict: entry.verdict || ""
      })),
      suggestedSources: SUGGESTED_SOURCES
    };
  }

  function getBottleReviewEntries(bottle, reviewData) {
    const reviewsByBottleId = reviewData.reviewsByBottleId || {};
    const ids = getBottleIds(bottle, reviewData);
    const entries = ids.flatMap((id) => reviewsByBottleId[id] || []);
    const seen = new Set();
    return entries
      .map(normalizeReviewEntry)
      .filter(isUsableReviewEntry)
      .filter((entry) => {
        const key = entry.sourceId || entry.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function getBottleIds(bottle, reviewData) {
    const reviewAliases = reviewData.reviewAliases || {};
    const ids = [
      bottle.id,
      ...(bottle.reviewIds || [])
    ].filter(Boolean);
    const aliases = ids.flatMap((id) => normalizeAliasTargets(reviewAliases[id]));
    return [
      ...ids,
      ...aliases
    ].filter(Boolean);
  }

  function normalizeAliasTargets(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(clean).filter(Boolean);
    return [clean(value)].filter(Boolean);
  }

  function normalizeReviewEntry(entry) {
    return {
      sourceId: clean(entry.sourceId),
      sourceName: clean(entry.sourceName || entry.sourceId || "Review source"),
      sourceType: normalizeSourceType(entry.sourceType),
      url: clean(entry.url),
      retrievedAt: clean(entry.retrievedAt),
      verdict: clean(entry.verdict),
      takeaways: (entry.takeaways || []).map(clean).filter(Boolean)
    };
  }

  function normalizeSourceType(value) {
    const cleanValue = clean(value).toLowerCase();
    if (cleanValue === "community" || cleanValue === "reddit") return "community";
    return "editorial";
  }

  function isUsableReviewEntry(entry) {
    return Boolean(entry.url && entry.takeaways.length);
  }

  function buildConsensus(entries) {
    if (!entries.length) {
      return "No cited review sources are attached to this bottle yet.";
    }
    const editorial = entries.filter((entry) => entry.sourceType === "editorial").length;
    const community = entries.filter((entry) => entry.sourceType === "community").length;
    const parts = [];
    if (editorial) parts.push(editorial + " editorial source" + (editorial === 1 ? "" : "s"));
    if (community) parts.push(community + " community source" + (community === 1 ? "" : "s"));
    return "Consensus is based on " + parts.join(" and ") + ".";
  }

  function buildReviewResearchPrompt(input) {
    const bottle = input.bottle || {};
    const known = [
      pair("Name", bottle.name),
      pair("Producer/distillery", bottle.distillery || bottle.producer || bottle.supplier),
      pair("Category", bottle.category),
      pair("Proof", bottle.proofDisplay || (Number.isFinite(bottle.proof) ? bottle.proof + " proof" : "")),
      pair("Age", bottle.age),
      pair("Size", bottle.size)
    ].filter(Boolean);

    return [
      "Research cited review consensus for Barrel Proof.",
      "",
      "Rules:",
      "- Use real sources only. Do not invent ratings, tasting notes, reviewer claims, or community sentiment.",
      "- Prefer reputable editorial reviews, producer tasting notes, and clearly relevant Reddit review threads.",
      "- For copyrighted editorial reviews, paraphrase high-level takeaways and include the URL. Do not copy review paragraphs.",
      "- For Reddit, summarize consensus across relevant posts/comments and include thread URLs.",
      "- Separate editorial opinion from community sentiment.",
      "",
      "Bottle:",
      known.map((fact) => "- " + fact).join("\n"),
      "",
      "Suggested sources to check:",
      SUGGESTED_SOURCES.map((source) => "- " + source).join("\n"),
      "",
      "Return this format:",
      "1. Review consensus bullets with source URL after each bullet.",
      "2. Editorial sources checked, with one-sentence paraphrased takeaway each.",
      "3. Community sources checked, with one-sentence sentiment summary each.",
      "4. Conflicts or caveats.",
      "5. Safe-to-import review entries for Barrel Proof: sourceName, sourceType, url, retrievedAt, verdict, takeaways."
    ].join("\n");
  }

  function pair(label, value) {
    if (value === null || value === undefined || value === "") return "";
    return label + ": " + value;
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  // Strip catalog noise (sizes, store-pick tags, shelf codes) so search engines
  // see the product, not the shelf row.
  function cleanBottleNameForSearch(name) {
    return String(name || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\b\d+(\.\d+)?\s*(ml|l|liter|litre)\b/gi, " ")
      .replace(/\b(buy (the|entire) barrel|btb|psb|sbs|hal|lto)\b/gi, " ")
      .replace(/[#*]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 70);
  }

  // Every bottle gets a review path, even with zero curated entries: honest
  // deep-links to the places bourbon people actually read. No invented scores.
  function buildReviewSearchLinks(bottle) {
    const name = cleanBottleNameForSearch(bottle && bottle.name);
    if (!name) return [];
    const q = encodeURIComponent(name);
    return [
      { sourceName: "r/bourbon", url: "https://www.reddit.com/r/bourbon/search/?q=" + q + "&restrict_sr=1" },
      { sourceName: "Breaking Bourbon", url: "https://www.google.com/search?q=" + encodeURIComponent("site:breakingbourbon.com " + name) },
      { sourceName: "Whiskybase", url: "https://www.whiskybase.com/search?q=" + q }
    ];
  }

  return {
    buildReviewIntelligence,
    buildReviewResearchPrompt,
    buildReviewSearchLinks,
    cleanBottleNameForSearch,
    getBottleReviewEntries
  };
});
