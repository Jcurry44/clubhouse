(function attachCatalog(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BarrelCatalog = factory();
  }
})(typeof self !== "undefined" ? self : this, function createCatalogModule() {
  function decodeHtml(value) {
    return String(value || "")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&nbsp;/g, " ")
      .replace(/&ndash;/g, "-")
      .replace(/&mdash;/g, "-")
      .replace(/<[^>]+>/g, "");
  }

  function normalizeWhitespace(value) {
    return decodeHtml(value).replace(/\s+/g, " ").trim();
  }

  function slugify(value) {
    return normalizeWhitespace(value)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function parseCurrency(value) {
    const cleaned = normalizeWhitespace(value).replace(/[$,]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseProof(value) {
    const cleaned = normalizeWhitespace(value).replace(/[^0-9.]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function parseAge(value) {
    const clean = normalizeWhitespace(value);
    if (!clean || clean === "000M" || clean === "0Y") return { raw: clean, label: "NAS", years: null };

    const yearMatch = clean.match(/^0*(\d+(?:\.\d+)?)Y$/i);
    if (yearMatch) {
      const years = Number(yearMatch[1]);
      return { raw: clean, label: years + " year" + (years === 1 ? "" : "s"), years };
    }

    const monthMatch = clean.match(/^0*(\d+(?:\.\d+)?)M$/i);
    if (monthMatch) {
      const months = Number(monthMatch[1]);
      return { raw: clean, label: months + " month" + (months === 1 ? "" : "s"), years: months / 12 };
    }

    return { raw: clean, label: clean, years: null };
  }

  function normalizeSize(value) {
    const clean = normalizeWhitespace(value).toUpperCase();
    if (!clean) return null;
    if (clean === ".75L") return "750ml";
    if (clean === ".375L") return "375ml";
    if (clean === "1.00L") return "1L";
    if (clean.endsWith("ML")) return clean.toLowerCase();
    return clean;
  }

  function normalizeProductNameForMerge(value) {
    return normalizeWhitespace(value)
      .toLowerCase()
      .replace(/\bbrbn\b/g, "bourbon")
      .replace(/\bbbn\b/g, "bourbon")
      .replace(/\bbourb\b/g, "bourbon")
      .replace(/\bwky\b/g, "whiskey")
      .replace(/\bwhsky\b/g, "whiskey")
      .replace(/\btenn\b/g, "tennessee")
      .replace(/\bstrt\b/g, "straight")
      .replace(/\bky\b/g, "kentucky")
      .replace(/\bksbw\b/g, "kentucky straight bourbon whiskey")
      .replace(/\bus\s*1\b/g, "us1")
      .replace(/\bu\.?s\.?\s*1\b/g, "us1")
      .replace(/\bno\.\s*/g, "no ")
      .replace(/\b\d+(?:\.\d+)?\s*(?:ml|ltr?|liter|litre)s?\b/g, " ")
      .replace(/\baged\s+(\d+(?:\.\d+)?)/g, " $1 ")
      .replace(/\b(\d+(?:\.\d+)?)\s*(?:years?|yrs?|yr|yo|y)\b(?:\s*old)?/g, " $1 ")
      .replace(/\b(?:kentucky|straight|bourbon|whisk(?:e)?y|brandy|spirit)\b/g, " ")
      .replace(/\bbottled\s+in\s+bond\b/g, "bib")
      .replace(/\bb\.?i\.?b\.?\b/g, "bib")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function categoryFamily(record) {
    const text = [record.category, record.name, record.bottleKind].filter(Boolean).join(" ").toLowerCase();
    if (text.includes("rye")) return "rye";
    if (text.includes("wheat") || text.includes("wheated")) return "wheated";
    if (text.includes("bourbon")) return "bourbon";
    if (text.includes("tennessee")) return "tennessee";
    if (text.includes("scotch")) return "scotch";
    if (text.includes("canadian")) return "canadian";
    if (text.includes("irish")) return "irish";
    if (text.includes("japanese")) return "japanese";
    if (text.includes("single malt")) return "single-malt";
    if (text.includes("whiskey") || text.includes("whisky")) return "whiskey";
    return "";
  }

  function proofBucket(value) {
    const proof = parseProof(value);
    return Number.isFinite(proof) ? Math.round(proof) : "";
  }

  function makeCanonicalIdentityKey(record) {
    const nameKey = normalizeProductNameForMerge(record.name);
    const size = normalizeSize(record.size) || "";
    const family = categoryFamily(record);
    if (!nameKey) return "";
    return [nameKey, size, family].filter(Boolean).join("|");
  }

  function makeReleaseFamilyIdentityKey(record) {
    const text = [
      record && record.name,
      ...((record && record.aliases) || [])
    ].filter(Boolean).join(" ").toLowerCase();
    const size = normalizeSize(record && record.size) || "";
    if (/\bgeorge\s+t\.?\s+stagg\b/.test(text) && !/\b(corazon|tequila|mezcal|anejo|a\u00f1ejo|reposado|blanco|rum|vodka|gin|cognac|brandy)\b/.test(text)) {
      return ["release-family", "george-t-stagg", size || "unknown-size", "bourbon"].join("|");
    }
    return "";
  }

  function hasCompatibleProof(left, right) {
    const leftProof = parseProof(left.proof);
    const rightProof = parseProof(right.proof);
    if (!Number.isFinite(leftProof) || !Number.isFinite(rightProof)) return true;
    return Math.abs(leftProof - rightProof) <= 1.5;
  }

  function hasCompatibleAge(left, right) {
    const leftAge = Number.isFinite(left.ageYears) ? left.ageYears : null;
    const rightAge = Number.isFinite(right.ageYears) ? right.ageYears : null;
    if (leftAge === null || rightAge === null) return true;
    return Math.abs(leftAge - rightAge) <= 1;
  }

  function hasHighAgeIdentityConflict(left, right) {
    const leftAge = Number.isFinite(left && left.ageYears) ? left.ageYears : null;
    const rightAge = Number.isFinite(right && right.ageYears) ? right.ageYears : null;
    if (leftAge === null && rightAge === null) return false;
    if (leftAge !== null && rightAge !== null) return Math.abs(leftAge - rightAge) > 1;
    const aged = leftAge !== null ? left : right;
    const unaged = leftAge !== null ? right : left;
    const agedYears = leftAge !== null ? leftAge : rightAge;
    if (agedYears < 12) return false;
    return hasExplicitAgeSignal(aged) && !hasExplicitAgeSignal(unaged);
  }

  function hasExplicitAgeSignal(record) {
    const ageYears = Number.isFinite(record && record.ageYears) ? Math.round(record.ageYears) : null;
    const text = [
      record && record.name,
      ...((record && record.aliases) || [])
    ].filter(Boolean).join(" ");
    if (!text.trim()) return false;
    if (/\b\d+(?:\.\d+)?\s*(?:years?|yrs?|yr|yo)\b/i.test(text)) return true;
    return Number.isFinite(ageYears) && new RegExp("\\b" + ageYears + "\\b").test(text);
  }

  function canMergeCatalogRecords(left, right) {
    if (!left || !right) return false;
    const leftSize = normalizeSize(left.size) || "";
    const rightSize = normalizeSize(right.size) || "";
    if (leftSize && rightSize && leftSize !== rightSize) return false;
    if (!hasCompatibleNameAge(left, right)) return false;
    if (hasHighAgeIdentityConflict(left, right)) return false;
    if (hasSharedBarcode(left, right)) {
      return hasCompatibleAge(left, right) && hasCompatibleBarcodeIdentity(left, right);
    }
    if (makeReleaseFamilyIdentityKey(left) && makeReleaseFamilyIdentityKey(left) === makeReleaseFamilyIdentityKey(right)) {
      return hasCompatibleAge(left, right);
    }
    return hasCompatibleProof(left, right) && hasCompatibleAge(left, right);
  }

  function inferBottleKind(record) {
    const text = [record.category, record.name].filter(Boolean).join(" ").toLowerCase();
    if (text.includes("rye")) return "rye";
    if (text.includes("bourbon")) return "bourbon";
    if (text.includes("tennessee")) return "tennessee_whiskey";
    if (text.includes("scotch")) return "scotch_whisky";
    if (text.includes("canadian")) return "canadian_whisky";
    if (text.includes("irish")) return "irish_whiskey";
    if (text.includes("japanese")) return "japanese_whisky";
    if (text.includes("world whisky") || text.includes("world whiskey") || text.includes("international")) return "world_whisky";
    if (text.includes("american single malt")) return "american_single_malt";
    if (text.includes("single malt")) return "single_malt";
    if (text.includes("whiskey") || text.includes("whisky")) return "american_whiskey";
    return "unknown";
  }

  function makeIdentityKey(record) {
    return [
      slugify(record.name),
      slugify(record.producer || record.supplier || ""),
      slugify(record.size || ""),
      String(record.proof || "")
    ].filter(Boolean).join("|");
  }

  function normalizeImportedRecord(record) {
    const proof = parseProof(record.proof);
    const age = parseAge(record.age || record.ageRaw);
    const size = normalizeSize(record.size);
    const retailPrice = parseCurrency(record.retailPrice);
    const sourceId = record.sourceId || "unknown";
    const sourceRecordId = record.sourceRecordId || record.ncCode || "";
    const retrievedAt = record.retrievedAt || new Date().toISOString();
    const producer = normalizeWhitespace(record.producer || record.supplier);
    const name = normalizeWhitespace(record.name);
    const barcodes = getBarcodeValues(record);
    const normalized = {
      id: slugify([name, size, proof].filter(Boolean).join(" ")),
      identityKey: makeIdentityKey({ name, producer, size, proof }),
      name,
      producer,
      supplier: normalizeWhitespace(record.supplier || producer),
      category: normalizeWhitespace(record.category),
      bottleKind: inferBottleKind({ name, category: record.category }),
      proof,
      proofs: Number.isFinite(proof) ? [proof] : [],
      age: age.label,
      ageYears: Number.isFinite(record.ageYears) ? record.ageYears : age.years,
      size,
      upc: barcodes[0] || null,
      barcodes,
      aliases: unique([name, name.replace(/\bbourbon\b/ig, "").trim(), ...(record.aliases || []), ...barcodes]).filter(Boolean),
      sourceRefs: [
        {
          sourceId,
          sourceRecordId,
          sourceUrl: record.sourceUrl || "",
          retrievedAt,
          fields: ["name", "supplier", "category", "age", "proof", "size", "retailPrice"]
        }
      ],
      prices: []
    };

    if (retailPrice !== null) {
      normalized.prices.push({
        sourceId,
        region: record.region || "",
        retailPrice,
        size,
        retrievedAt
      });
    }

    return normalized;
  }

  // Every record consumed by a merge is remembered as a member {id, sourceIds}
  // so the build can emit an alias map — user data saved against an id that
  // merges away MUST be remappable to the surviving bottle.
  function memberOf(record) {
    return {
      id: record.id,
      sourceIds: unique((record.sourceRefs || []).map((ref) => ref.sourceId))
    };
  }

  function mergeCatalogRecords(records) {
    const byKey = new Map();
    const mergedRecords = [];
    for (const record of records) {
      const normalized = record.identityKey ? record : normalizeImportedRecord(record);
      const keys = getMergeKeys(normalized);
      const existing = keys
        .map((key) => byKey.get(key))
        .find((candidate) => candidate && canMergeCatalogRecords(candidate, normalized));
      if (!existing) {
        const next = {
          ...normalized,
          aliases: unique(normalized.aliases || []),
          barcodes: unique(normalized.barcodes || []),
          proofs: uniqueNumbers(normalized.proofs || []),
          sourceRefs: [...(normalized.sourceRefs || [])],
          prices: [...(normalized.prices || [])],
          members: [memberOf(normalized)]
        };
        mergedRecords.push(next);
        for (const key of keys) byKey.set(key, next);
        continue;
      }

      existing.members = [...(existing.members || []), memberOf(normalized)];
      existing.aliases = unique([...(existing.aliases || []), ...(normalized.aliases || [])]);
      existing.barcodes = unique([...(existing.barcodes || []), ...(normalized.barcodes || [])]);
      existing.upc = existing.upc || normalized.upc;
      existing.proofs = uniqueNumbers([
        ...(existing.proofs || []),
        existing.proof,
        ...(normalized.proofs || []),
        normalized.proof
      ]);
      existing.sourceRefs = mergeSources(existing.sourceRefs, normalized.sourceRefs);
      existing.prices = mergePrices(existing.prices, normalized.prices);
      existing.labelApprovals = mergeLabelApprovals(existing.labelApprovals, normalized.labelApprovals);
      if (shouldPreferName(existing.name, normalized.name)) {
        existing.name = normalized.name;
        existing.id = normalized.id || existing.id;
      }
      if (shouldPreferCategory(existing.category, normalized.category)) existing.category = normalized.category;
      existing.producer = existing.producer || normalized.producer;
      existing.supplier = existing.supplier || normalized.supplier;
      existing.bottleKind = inferBottleKind(existing);
      existing.proof = selectRepresentativeProof(existing.proofs, existing.proof || normalized.proof);
      if (shouldPreferAge(existing, normalized)) {
        existing.age = normalized.age;
        existing.ageYears = normalized.ageYears;
      }
      for (const key of keys) byKey.set(key, existing);
    }

    return mergedRecords.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Age-bearing names ("…8 Yr") must also be able to meet their ageless
  // siblings ("1792 Sweet Wheat"), so we add an age-stripped fallback key.
  // hasCompatibleNameAge() guards it: two names that BOTH state ages can only
  // merge when the ages agree, so ER10 can never reach ER17 through this.
  function extractNameAge(value) {
    const text = normalizeWhitespace(value).toLowerCase();
    const aged = text.match(/\baged\s+(\d+(?:\.\d+)?)/);
    if (aged) return Number(aged[1]);
    const suffixed = text.match(/\b(\d+(?:\.\d+)?)\s*(?:years?|yrs?|yr|yo|y)\b/);
    return suffixed ? Number(suffixed[1]) : null;
  }

  function hasCompatibleNameAge(left, right) {
    const leftAge = extractNameAge(left.name);
    const rightAge = extractNameAge(right.name);
    if (leftAge === null || rightAge === null) return true;
    return Math.abs(leftAge - rightAge) < 0.01;
  }

  function makeAgeAgnosticCanonicalIdentityKey(record) {
    const stripped = String(record.name || "")
      .replace(/\baged\s+\d+(?:\.\d+)?/gi, " ")
      .replace(/\b\d+(?:\.\d+)?\s*(?:years?|yrs?|yr|yo|y)\b(?:\s*old)?/gi, " ");
    const key = makeCanonicalIdentityKey({ ...record, name: stripped });
    return key ? "ageless|" + key : "";
  }

  function getMergeKeys(record) {
    return unique([
      record.identityKey,
      makeReleaseFamilyIdentityKey(record),
      makeCanonicalIdentityKey(record),
      makeProofAwareCanonicalIdentityKey(record),
      makeAgeAgnosticCanonicalIdentityKey(record),
      ...getBarcodeValues(record).map((barcode) => "barcode|" + barcode)
    ]);
  }

  function makeProofAwareCanonicalIdentityKey(record) {
    const base = makeCanonicalIdentityKey(record);
    const proof = proofBucket(record.proof);
    return base && proof ? base + "|" + proof : "";
  }

  function mergeSources(left, right) {
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

  function mergePrices(left, right) {
    const seen = new Set();
    const merged = [];
    for (const price of [...(left || []), ...(right || [])]) {
      const key = [
        price.sourceId,
        price.region,
        price.size,
        price.retailPrice,
        price.retrievedAt,
        price.effectiveFrom,
        price.effectiveThrough
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(price);
    }
    return merged;
  }

  function mergeLabelApprovals(left, right) {
    const seen = new Set();
    const merged = [];
    for (const approval of [...(left || []), ...(right || [])]) {
      const key = approval.ttbId || JSON.stringify(approval);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(approval);
    }
    return merged;
  }

  function hasSharedBarcode(left, right) {
    const leftBarcodes = new Set(getBarcodeValues(left));
    if (!leftBarcodes.size) return false;
    return getBarcodeValues(right).some((barcode) => leftBarcodes.has(barcode));
  }

  function hasCompatibleBarcodeIdentity(left, right) {
    const leftFamily = makeReleaseFamilyIdentityKey(left);
    const rightFamily = makeReleaseFamilyIdentityKey(right);
    if (leftFamily && leftFamily === rightFamily) return true;

    const leftTokens = meaningfulNameTokens(left);
    const rightTokens = meaningfulNameTokens(right);
    if (!leftTokens.length || !rightTokens.length) return false;
    const rightSet = new Set(rightTokens);
    return leftTokens.some((token) => rightSet.has(token));
  }

  function meaningfulNameTokens(record) {
    const stopWords = new Set([
      "barrel",
      "batch",
      "bbn",
      "bib",
      "bourbon",
      "bp",
      "brbn",
      "buy",
      "cask",
      "code",
      "disco",
      "dno",
      "ha",
      "kentucky",
      "limited",
      "lmtd",
      "malt",
      "old",
      "private",
      "proof",
      "reserve",
      "rye",
      "sbs",
      "select",
      "selection",
      "single",
      "small",
      "sp",
      "straight",
      "the",
      "use",
      "whiskey",
      "whisky",
      "yr",
      "year"
    ]);
    return normalizeProductNameForMerge(record && record.name)
      .split(/\s+/)
      .filter((token) => token.length > 1 && !/^\d+(?:\.\d+)?$/.test(token) && !stopWords.has(token));
  }

  function getBarcodeValues(record) {
    const values = [
      record && record.upc,
      ...((record && record.barcodes) || [])
    ];
    if (record && Array.isArray(record.aliases)) values.push(...record.aliases);
    return unique(values
      .map((value) => normalizeWhitespace(value).replace(/\D/g, ""))
      .filter((value) => value.length >= 8));
  }

  function shouldPreferName(currentName, candidateName) {
    const current = normalizeWhitespace(currentName);
    const candidate = normalizeWhitespace(candidateName);
    if (!candidate) return false;
    if (!current) return true;
    if (current.includes("...") && !candidate.includes("...") && candidate.length > current.length) return true;
    if (/\bbrbn\b|\bwky\b/i.test(current) && !/\bbrbn\b|\bwky\b/i.test(candidate)) return true;
    const currentScore = productNameCompletenessScore(current);
    const candidateScore = productNameCompletenessScore(candidate);
    return candidateScore > currentScore && candidate.length >= current.length;
  }

  function productNameCompletenessScore(value) {
    const clean = normalizeWhitespace(value).toLowerCase();
    let score = clean.length / 100;
    if (clean.includes("bourbon")) score += 2;
    if (clean.includes("straight")) score += 1;
    if (clean.includes("kentucky")) score += 0.5;
    if (clean.includes("rye")) score += 1;
    if (clean.includes("single malt")) score += 1;
    if (/\bbrbn\b|\bwky\b/.test(clean)) score -= 2;
    if (clean.includes("...")) score -= 5;
    return score;
  }

  function shouldPreferCategory(currentCategory, candidateCategory) {
    const current = normalizeWhitespace(currentCategory);
    const candidate = normalizeWhitespace(candidateCategory);
    if (!candidate) return false;
    if (!current) return true;
    const candidateBottledInBond = /\bbottled in bond\b|\bbib\b/i.test(candidate);
    const currentBottledInBond = /\bbottled in bond\b|\bbib\b/i.test(current);
    if (candidateBottledInBond && !currentBottledInBond && categoryFamily(candidate) === categoryFamily(current)) {
      return false;
    }
    return categorySpecificity(candidate) > categorySpecificity(current);
  }

  function categorySpecificity(category) {
    const text = normalizeWhitespace(category).toLowerCase();
    let score = text.length / 100;
    if (text.includes("wheated")) score += 4;
    if (text.includes("bottled in bond")) score += 3;
    if (text.includes("single malt")) score += 3;
    if (text.includes("rye")) score += 2;
    if (text.includes("bourbon")) score += 1;
    return score;
  }

  function shouldPreferAge(current, candidate) {
    const currentAge = Number.isFinite(current.ageYears) ? current.ageYears : null;
    const candidateAge = Number.isFinite(candidate.ageYears) ? candidate.ageYears : null;
    if (candidateAge === null) return false;
    if (currentAge === null) return true;
    return candidateAge > currentAge && hasCompatibleAge(current, candidate);
  }

  function buildSearchText(record) {
    return [
      record.name,
      record.producer,
      record.supplier,
      record.category,
      record.bottleKind,
      record.size,
      record.proof,
      ...(record.aliases || [])
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function unique(values) {
    return Array.from(new Set((values || []).map((value) => normalizeWhitespace(value)).filter(Boolean)));
  }

  function uniqueNumbers(values) {
    return Array.from(new Set((values || [])
      .map((value) => parseProof(value))
      .filter(Number.isFinite)))
      .sort((a, b) => a - b);
  }

  function selectRepresentativeProof(proofs, fallback) {
    const values = uniqueNumbers(proofs);
    if (values.length) return values[values.length - 1];
    const parsedFallback = parseProof(fallback);
    return Number.isFinite(parsedFallback) ? parsedFallback : null;
  }

  return {
    buildSearchText,
    canMergeCatalogRecords,
    categoryFamily,
    decodeHtml,
    getMergeKeys,
    inferBottleKind,
    makeCanonicalIdentityKey,
    makeIdentityKey,
    mergeCatalogRecords,
    mergePrices,
    normalizeImportedRecord,
    normalizeProductNameForMerge,
    normalizeSize,
    normalizeWhitespace,
    parseAge,
    parseCurrency,
    parseProof,
    slugify,
    shouldPreferName,
    unique
  };
});
