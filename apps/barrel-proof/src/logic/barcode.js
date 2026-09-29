(function attachBarcode(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BarrelBarcode = factory();
  }
})(typeof self !== "undefined" ? self : this, function createBarcodeModule() {
  // A scan and a catalog row rarely agree on formatting: UPC-A is 12 digits,
  // EAN-13 is the same code with a leading zero, and spreadsheet imports often
  // shed leading zeros entirely ("00086..." vs "86..."). We match on a family of
  // candidate keys so any spelling of the same code finds the same bottle.
  function candidateKeys(raw) {
    const digits = String(raw == null ? "" : raw).replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 14) return [];
    const keys = new Set();
    keys.add(digits);
    const trimmed = digits.replace(/^0+/, "");
    if (trimmed.length >= 6) keys.add(trimmed);
    if (trimmed.length <= 12) keys.add(trimmed.padStart(12, "0"));
    if (trimmed.length <= 13) keys.add(trimmed.padStart(13, "0"));
    return [...keys];
  }

  function isLikelyBarcode(raw) {
    return candidateKeys(raw).length > 0;
  }

  // Index every code spelling for every bottle. userLinks (code -> bottleId,
  // taught by the user when a scan misses) are applied last so they win.
  function buildIndex(bottles, userLinks) {
    const map = new Map();
    for (const bottle of bottles || []) {
      const codes = [bottle.upc, ...(bottle.barcodes || [])].filter(Boolean);
      for (const code of codes) {
        for (const key of candidateKeys(code)) {
          if (!map.has(key)) map.set(key, bottle.id);
        }
      }
    }
    for (const code of Object.keys(userLinks || {})) {
      for (const key of candidateKeys(code)) {
        map.set(key, userLinks[code]);
      }
    }
    return map;
  }

  function lookup(index, raw) {
    if (!index) return null;
    for (const key of candidateKeys(raw)) {
      const id = index.get(key);
      if (id) return id;
    }
    return null;
  }

  return {
    buildIndex,
    candidateKeys,
    isLikelyBarcode,
    lookup
  };
});
