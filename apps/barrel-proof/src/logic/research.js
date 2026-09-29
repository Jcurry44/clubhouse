(function attachResearch(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BarrelResearch = factory();
  }
})(typeof self !== "undefined" ? self : this, function createResearchModule() {
  function buildBottleResearchPrompt(input) {
    const bottle = input.bottle || {};
    const shelfPrice = Number(input.shelfPrice);
    const knownFacts = buildKnownFacts(bottle, shelfPrice);
    const missingFacts = buildMissingFacts(bottle);

    return [
      "Research this bourbon bottle for Barrel Proof.",
      "",
      "Rules:",
      "- Use source-backed facts only. Do not invent proof, age, mash bill, MSRP, release details, reviews, or UPCs.",
      "- Prefer official producer pages, TTB COLA records, control-state catalogs, and reputable review sources.",
      "- Include a URL for every factual claim that is not already listed in the known facts.",
      "- If a field cannot be verified, write Unknown and explain what source would be needed.",
      "- Separate verified facts from opinion/review consensus.",
      "",
      "Bottle to research:",
      knownFacts.map((fact) => "- " + fact).join("\n"),
      "",
      "Missing or weak fields to verify:",
      missingFacts.map((fact) => "- " + fact).join("\n"),
      "",
      "Return this format:",
      "1. Verdict for an in-store buyer: Buy / Consider / Pass / Not enough verified data.",
      "2. Verified facts table: field, value, source URL, confidence.",
      "3. Price context: MSRP if verified, official/control-state prices, recent retail context, and whether the entered shelf price is fair.",
      "4. Review consensus: summarize only cited reviews or reputable tasting notes; do not make up a score.",
      "5. Import candidates: facts that are safe to add to the Barrel Proof database, each with source URL and confidence.",
      "6. Research gaps: what still needs a better source."
    ].join("\n");
  }

  function getDatabaseConfidence(bottle) {
    const missing = buildMissingFacts(bottle);
    const hasSourceRef = (Array.isArray(bottle.sourceRefs) && bottle.sourceRefs.length > 0) ||
      (Array.isArray(bottle.sourcePreview) && bottle.sourcePreview.length > 0) ||
      Boolean(bottle.sourceSummary && bottle.sourceSummary.sourceCount);
    const hasPrice = (Array.isArray(bottle.prices) && bottle.prices.some((price) => Number.isFinite(price.retailPrice))) ||
      Boolean(bottle.sourceSummary && bottle.sourceSummary.priceObservationCount);
    const hasProof = Number.isFinite(bottle.proof);
    const hasAge = Boolean(bottle.age && bottle.age !== "Unknown" && bottle.age !== "NAS" && bottle.age !== "Batch dependent");
    const hasMaker = Boolean(getMaker(bottle) && getMaker(bottle) !== "Unknown producer");
    const hasContext = Boolean(bottle.story || Number.isFinite(bottle.msrp) || bottle.mashBill && bottle.mashBill !== "Unknown" && bottle.mashBill !== "Undisclosed");

    let score = 0;
    if (hasSourceRef) score += 28;
    if (hasPrice) score += 22;
    if (hasProof) score += 16;
    if (hasAge) score += 10;
    if (hasMaker) score += 12;
    if (hasContext) score += 12;

    let level = "Thin";
    if (score >= 74 && missing.length <= 2) level = "Strong";
    else if (score >= 45) level = "Partial";

    return {
      level,
      score,
      missing,
      shouldScout: level !== "Strong",
      summary: buildConfidenceSummary(level, score, missing)
    };
  }

  function buildConfidenceSummary(level, score, missing) {
    if (level === "Strong") {
      return "Our database has enough source-backed detail to lead with Barrel Proof's answer.";
    }
    if (level === "Partial") {
      return "Barrel Proof has useful source data, but Scout can research the remaining gaps.";
    }
    return "This record is thin. Scout should research before treating the recommendation as complete.";
  }

  function buildKnownFacts(bottle, shelfPrice) {
    const facts = [
      pair("Name", bottle.name),
      pair("Distillery/producer", getMaker(bottle)),
      pair("Category", bottle.category),
      pair("Proof", bottle.proof ? bottle.proof + " proof" : ""),
      pair("Age", bottle.age),
      pair("Size", bottle.size),
      pair("Mash bill", bottle.mashBill),
      pair("Entered shelf price", Number.isFinite(shelfPrice) && shelfPrice > 0 ? money(shelfPrice) : "")
    ].filter(Boolean);

    const priceFacts = formatPriceObservations(bottle);
    const sourceFacts = formatSourceRefs(bottle);
    const labelFacts = formatLabelApprovals(bottle);

    return [...facts, ...priceFacts, ...sourceFacts, ...labelFacts];
  }

  function buildMissingFacts(bottle) {
    const missing = [];
    if (!bottle.proof) missing.push("Proof");
    if (!bottle.age || bottle.age === "Unknown" || bottle.age === "NAS" || bottle.age === "Batch dependent") missing.push("Age statement or batch-specific age");
    if (!bottle.mashBill || bottle.mashBill === "Unknown" || bottle.mashBill === "Undisclosed") missing.push("Mash bill");
    if (!Number.isFinite(bottle.msrp)) missing.push("Verified MSRP");
    if (!bottle.story) missing.push("Official product story or producer description");
    if (!hasSourceEvidence(bottle)) missing.push("Source-backed identity record");
    if (!hasPriceEvidence(bottle)) missing.push("Official or control-state price observation");
    return missing.length ? missing : ["Look for newer batch, release, price, or review updates."];
  }

  function formatPriceObservations(bottle) {
    const prices = (bottle.prices || [])
      .filter((price) => Number.isFinite(price.retailPrice))
      .slice(0, 6)
      .map((price) => {
        const details = [
          price.sourceId,
          price.region,
          price.size,
          price.status,
          price.asOfDate ? "as of " + price.asOfDate : "",
          price.retrievedAt ? "retrieved " + price.retrievedAt.slice(0, 10) : ""
        ].filter(Boolean).join(", ");
        return "Price observation: " + money(price.retailPrice) + (details ? " (" + details + ")" : "");
      });
    if (prices.length) return prices;
    const summary = bottle.sourceSummary || {};
    if (summary.priceObservationCount && Number.isFinite(summary.minRetailPrice) && Number.isFinite(summary.maxRetailPrice)) {
      const range = summary.minRetailPrice === summary.maxRetailPrice
        ? money(summary.minRetailPrice)
        : money(summary.minRetailPrice) + " to " + money(summary.maxRetailPrice);
      return ["Source price range: " + range + " across " + summary.priceObservationCount + " official observation" + (summary.priceObservationCount === 1 ? "" : "s") + "."];
    }
    return [];
  }

  function formatSourceRefs(bottle) {
    return (bottle.sourceRefs || bottle.sourcePreview || [])
      .slice(0, 6)
      .map((source) => {
        const details = [
          source.sourceId,
          source.sourceRecordId,
          source.sourceUrl,
          source.retrievedAt ? "retrieved " + source.retrievedAt.slice(0, 10) : ""
        ].filter(Boolean).join(" / ");
        return "Source reference: " + details;
      });
  }

  function hasSourceEvidence(bottle) {
    return (Array.isArray(bottle.sourceRefs) && bottle.sourceRefs.length > 0) ||
      (Array.isArray(bottle.sourcePreview) && bottle.sourcePreview.length > 0) ||
      Boolean(bottle.sourceSummary && bottle.sourceSummary.sourceCount);
  }

  function hasPriceEvidence(bottle) {
    return (Array.isArray(bottle.prices) && bottle.prices.length) ||
      Boolean(bottle.sourceSummary && bottle.sourceSummary.priceObservationCount);
  }

  function formatLabelApprovals(bottle) {
    return (bottle.labelApprovals || [])
      .slice(0, 4)
      .map((approval) => {
        const details = [
          approval.ttbId ? "TTB ID " + approval.ttbId : "",
          approval.completedDate ? "completed " + approval.completedDate : "",
          approval.classType,
          approval.detailUrl
        ].filter(Boolean).join(" / ");
        return "Label approval: " + details;
      });
  }

  function pair(label, value) {
    if (value === null || value === undefined || value === "") return "";
    return label + ": " + value;
  }

  function getMaker(bottle) {
    return bottle.distillery || bottle.producer || bottle.supplier || "";
  }

  function money(value) {
    if (!Number.isFinite(value)) return "";
    return "$" + Number(value).toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2
    });
  }

  return {
    buildBottleResearchPrompt,
    buildKnownFacts,
    buildMissingFacts,
    getDatabaseConfidence,
    formatPriceObservations,
    formatSourceRefs
  };
});
