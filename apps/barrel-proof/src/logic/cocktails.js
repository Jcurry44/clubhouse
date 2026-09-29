(function attachCocktails(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BarrelCocktails = factory();
  }
})(typeof self !== "undefined" ? self : this, function createCocktailModule() {
  function rankCocktailsForBottle(bottle, cocktails) {
    return (cocktails || [])
      .map((cocktail) => ({
        cocktail,
        score: scoreCocktailForBottle(bottle, cocktail),
        reason: getCocktailFitReason(bottle, cocktail)
      }))
      .sort((left, right) => right.score - left.score);
  }

  function getBestCocktailForBottle(bottle, cocktails) {
    return rankCocktailsForBottle(bottle, cocktails)[0] || null;
  }

  function scoreCocktailForBottle(bottle, cocktail) {
    const proof = Number(bottle.proof);
    const idealProof = Number(cocktail.idealProof) || 100;
    const proofScore = Number.isFinite(proof)
      ? Math.max(0, 34 - Math.abs(proof - idealProof) * 1.6)
      : 12;
    const bottleStyleText = getBottleStyleText(bottle);
    const styleHits = (cocktail.bottleStyles || []).filter((style) => bottleStyleText.includes(style.toLowerCase())).length;
    const styleScore = Math.min(28, styleHits * 9);
    const categoryScore = getCategoryScore(bottle, cocktail);
    const rarityPenalty = cocktail.protectRareBottles && isRareBottle(bottle) ? 18 : 0;
    const sourcePenalty = !Number.isFinite(proof) && !bottleStyleText ? 8 : 0;

    return Math.max(0, Math.round(38 + proofScore + styleScore + categoryScore - rarityPenalty - sourcePenalty));
  }

  function getCocktailFitReason(bottle, cocktail) {
    const proof = Number(bottle.proof);
    if (cocktail.protectRareBottles && isRareBottle(bottle)) {
      return "Great drink, but this spec protects rare bottles from citrus-heavy use.";
    }
    if (Number.isFinite(proof)) {
      if (proof >= cocktail.idealProof - 8 && proof <= cocktail.idealProof + 10) {
        return "Proof sits in the ideal lane for this spec.";
      }
      if (proof > cocktail.idealProof + 10) {
        return "High proof can work if dilution is handled carefully.";
      }
      return "Works, but a slightly stronger bourbon would give the drink more structure.";
    }
    return "Use a balanced 100-proof bourbon if this bottle's proof is not verified yet.";
  }

  function getBottleStyleText(bottle) {
    return [
      bottle.category,
      bottle.rarity,
      ...(bottle.profile || []),
      ...(bottle.bestFor || [])
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function getCategoryScore(bottle, cocktail) {
    const text = [bottle.category, bottle.name].filter(Boolean).join(" ").toLowerCase();
    if (text.includes("barrel proof") && cocktail.family === "Spirit-forward") return 10;
    if (text.includes("wheated") && ["Sour", "Highball", "Hot"].includes(cocktail.family)) return 7;
    if (text.includes("single barrel") && cocktail.family === "Spirit-forward") return 6;
    if (text.includes("rye") && (cocktail.bottleStyles || []).includes("rye spice")) return 8;
    return 0;
  }

  function isRareBottle(bottle) {
    return ["Allocated", "Unicorn", "Limited"].includes(bottle.rarity);
  }

  function formatIngredients(cocktail) {
    return (cocktail.ingredients || []).map(([amount, item, note]) => {
      return [amount, item, note].filter(Boolean).join(" ");
    });
  }

  return {
    formatIngredients,
    getBestCocktailForBottle,
    rankCocktailsForBottle,
    scoreCocktailForBottle
  };
});
