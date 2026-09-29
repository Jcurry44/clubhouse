(function attachCocktailData(global) {
  const cocktails = [
    {
      id: "old-fashioned",
      name: "Old Fashioned",
      family: "Spirit-forward",
      proofLane: "95-115 proof",
      idealProof: 105,
      bottleStyles: ["balanced bourbon", "rye spice", "barrel proof", "oak", "caramel"],
      protectRareBottles: false,
      glassware: "Double rocks",
      ice: "One large clear cube",
      garnish: "Wide orange coin, expressed over the glass",
      ingredients: [
        ["2 oz", "bourbon", "100-110 proof is the sweet spot"],
        ["0.25 oz", "2:1 demerara syrup", "rich, not thin simple syrup"],
        ["2 dashes", "Angostura bitters", ""],
        ["1 dash", "orange bitters", ""]
      ],
      technique: [
        "Stir bourbon, syrup, and bitters with cold dense ice until glossy and chilled.",
        "Strain over one large cube.",
        "Express orange oil across the surface and rim."
      ],
      barNotes: "The syrup should season the whiskey, not sweeten it. If the bourbon is below 95 proof, pull syrup back to a barspoon."
    },
    {
      id: "manhattan",
      name: "Bourbon Manhattan",
      family: "Spirit-forward",
      proofLane: "95-110 proof",
      idealProof: 100,
      bottleStyles: ["oak", "cherry", "rye spice", "balanced bourbon"],
      protectRareBottles: false,
      glassware: "Chilled Nick & Nora",
      ice: "Stirred, served up",
      garnish: "Brandied cherry on pick",
      ingredients: [
        ["2 oz", "bourbon", "oak and spice hold the line"],
        ["1 oz", "Carpano Antica or Cocchi Vermouth di Torino", "fresh and refrigerated"],
        ["2 dashes", "Angostura bitters", ""],
        ["1 dash", "orange bitters", ""]
      ],
      technique: [
        "Stir all ingredients with cold dense ice for 20-25 seconds.",
        "Strain into a frozen glass.",
        "Garnish with one high-quality cherry."
      ],
      barNotes: "Use a structured bourbon. Soft wheaters can disappear unless the vermouth is dialed back."
    },
    {
      id: "boulevardier",
      name: "Boulevardier",
      family: "Bitter",
      proofLane: "100-120 proof",
      idealProof: 110,
      bottleStyles: ["barrel proof", "rye spice", "oak", "dark cherry", "baking spice"],
      protectRareBottles: false,
      glassware: "Double rocks or chilled coupe",
      ice: "Large cube or served up",
      garnish: "Orange coin",
      ingredients: [
        ["1.5 oz", "bourbon", "100 proof minimum"],
        ["0.75 oz", "Campari", ""],
        ["0.75 oz", "sweet vermouth", "Cocchi or Carpano, fresh"]
      ],
      technique: [
        "Stir until properly chilled and lightly diluted.",
        "Strain over a large cube or into a chilled coupe.",
        "Express orange oil and garnish."
      ],
      barNotes: "Barrel proof bourbon is excellent here. If using 115+ proof, keep equal parts bittersweet components and let dilution do the polish."
    },
    {
      id: "whiskey-sour",
      name: "Whiskey Sour",
      family: "Sour",
      proofLane: "90-105 proof",
      idealProof: 100,
      bottleStyles: ["citrus", "vanilla", "caramel", "balanced bourbon"],
      protectRareBottles: true,
      glassware: "Chilled coupe",
      ice: "Shaken, served up",
      garnish: "Angostura bitters pattern or lemon coin",
      ingredients: [
        ["2 oz", "bourbon", ""],
        ["0.75 oz", "fresh lemon juice", "strained"],
        ["0.5 oz", "2:1 simple syrup", ""],
        ["0.5 oz", "egg white", "optional but preferred for luxury texture"]
      ],
      technique: [
        "Dry shake if using egg white.",
        "Add ice and hard shake until the tin is frosted.",
        "Fine strain into a chilled coupe."
      ],
      barNotes: "The drink should be bright and plush, not candy-sour. Avoid wasting rare bottles here unless the pour is already open and shared."
    },
    {
      id: "gold-rush",
      name: "Gold Rush",
      family: "Sour",
      proofLane: "95-110 proof",
      idealProof: 100,
      bottleStyles: ["honey", "vanilla", "oak", "balanced bourbon"],
      protectRareBottles: true,
      glassware: "Rocks",
      ice: "Large cube",
      garnish: "Lemon wheel or expressed lemon coin",
      ingredients: [
        ["2 oz", "bourbon", ""],
        ["0.75 oz", "fresh lemon juice", ""],
        ["0.75 oz", "3:1 honey syrup", "wildflower or orange blossom honey"]
      ],
      technique: [
        "Shake hard with ice.",
        "Fine strain over a large cube.",
        "Garnish with a restrained lemon expression."
      ],
      barNotes: "Honey syrup should carry aroma and texture. High-proof bourbon keeps the drink from turning soft."
    },
    {
      id: "mint-julep",
      name: "Mint Julep",
      family: "Crushed ice",
      proofLane: "95-115 proof",
      idealProof: 105,
      bottleStyles: ["oak", "vanilla", "caramel", "rye spice"],
      protectRareBottles: false,
      glassware: "Julep cup",
      ice: "Fine crushed ice",
      garnish: "Heavy mint bouquet, powdered sugar optional",
      ingredients: [
        ["2.5 oz", "bourbon", "bold proof preferred"],
        ["0.5 oz", "2:1 demerara syrup", ""],
        ["8-10 leaves", "mint", "plus bouquet"]
      ],
      technique: [
        "Gently press mint with syrup in the cup; do not shred it.",
        "Add bourbon and crushed ice, then swizzle until frosted.",
        "Crown with more crushed ice and a mint bouquet."
      ],
      barNotes: "The cup should frost. The mint should smell alive. Over-muddled mint is the enemy."
    },
    {
      id: "brown-derby",
      name: "Brown Derby",
      family: "Sour",
      proofLane: "90-105 proof",
      idealProof: 95,
      bottleStyles: ["honey", "citrus", "soft oak", "approachable"],
      protectRareBottles: true,
      glassware: "Chilled coupe",
      ice: "Shaken, served up",
      garnish: "Grapefruit coin",
      ingredients: [
        ["2 oz", "bourbon", ""],
        ["1 oz", "fresh grapefruit juice", "pink grapefruit preferred"],
        ["0.5 oz", "3:1 honey syrup", ""]
      ],
      technique: [
        "Shake hard with ice.",
        "Fine strain into a chilled coupe.",
        "Express grapefruit oil across the surface."
      ],
      barNotes: "A softer bourbon works here. Bitter grapefruit and honey should frame the whiskey rather than bury it."
    },
    {
      id: "paper-plane",
      name: "Paper Plane",
      family: "Modern classic",
      proofLane: "95-110 proof",
      idealProof: 100,
      bottleStyles: ["bright", "rye spice", "cherry", "balanced bourbon"],
      protectRareBottles: true,
      glassware: "Chilled coupe",
      ice: "Shaken, served up",
      garnish: "None or tiny lemon expression",
      ingredients: [
        ["0.75 oz", "bourbon", ""],
        ["0.75 oz", "Amaro Nonino", ""],
        ["0.75 oz", "Aperol", ""],
        ["0.75 oz", "fresh lemon juice", ""]
      ],
      technique: [
        "Shake hard with ice.",
        "Fine strain into a chilled coupe.",
        "Serve immediately while bright."
      ],
      barNotes: "Use a bourbon with enough proof and citrus lift. Very oaky bottles can flatten the drink."
    },
    {
      id: "kentucky-mule",
      name: "Kentucky Mule",
      family: "Highball",
      proofLane: "90-110 proof",
      idealProof: 100,
      bottleStyles: ["spice", "vanilla", "value", "balanced bourbon"],
      protectRareBottles: true,
      glassware: "Copper mug or highball",
      ice: "Clear spear or dense cubes",
      garnish: "Mint sprig and lime wheel",
      ingredients: [
        ["2 oz", "bourbon", ""],
        ["0.5 oz", "fresh lime juice", ""],
        ["0.25 oz", "ginger syrup", "optional if ginger beer is dry"],
        ["3 oz", "premium ginger beer", "cold and spicy"]
      ],
      technique: [
        "Build bourbon, lime, and syrup over ice.",
        "Top with ginger beer and lift gently.",
        "Garnish with mint and lime."
      ],
      barNotes: "Use a dry, spicy ginger beer. The drink should snap, not taste like soda."
    },
    {
      id: "revolver",
      name: "Revolver",
      family: "Spirit-forward",
      proofLane: "95-110 proof",
      idealProof: 100,
      bottleStyles: ["oak", "vanilla", "caramel", "coffee", "spice"],
      protectRareBottles: false,
      glassware: "Chilled coupe",
      ice: "Stirred, served up",
      garnish: "Flamed orange coin",
      ingredients: [
        ["2 oz", "bourbon", ""],
        ["0.5 oz", "coffee liqueur", "Mr Black or a dry coffee liqueur"],
        ["2 dashes", "orange bitters", ""]
      ],
      technique: [
        "Stir with ice until cold and satin-textured.",
        "Strain into a chilled coupe.",
        "Flame or express orange oil over the drink."
      ],
      barNotes: "Keep the coffee liqueur dry. Sweet coffee liqueur will dominate the bourbon."
    },
    {
      id: "bourbon-smash",
      name: "Bourbon Smash",
      family: "Crushed ice",
      proofLane: "95-110 proof",
      idealProof: 100,
      bottleStyles: ["vanilla", "caramel", "fruit", "mint", "value"],
      protectRareBottles: true,
      glassware: "Rocks",
      ice: "Crushed ice",
      garnish: "Mint bouquet and seasonal fruit",
      ingredients: [
        ["2 oz", "bourbon", ""],
        ["0.75 oz", "fresh lemon juice", ""],
        ["0.5 oz", "2:1 simple syrup", ""],
        ["6 leaves", "mint", ""],
        ["2 pieces", "seasonal fruit", "peach, berry, or orange"]
      ],
      technique: [
        "Gently muddle fruit, mint, and syrup.",
        "Add bourbon, lemon, and ice; shake briefly.",
        "Dump over crushed ice and crown."
      ],
      barNotes: "Keep fruit seasonal and restrained. It is a whiskey drink first."
    },
    {
      id: "new-york-sour",
      name: "New York Sour",
      family: "Sour",
      proofLane: "95-110 proof",
      idealProof: 100,
      bottleStyles: ["oak", "cherry", "vanilla", "balanced bourbon"],
      protectRareBottles: true,
      glassware: "Rocks",
      ice: "Large cube",
      garnish: "Red wine float",
      ingredients: [
        ["2 oz", "bourbon", ""],
        ["0.75 oz", "fresh lemon juice", ""],
        ["0.5 oz", "2:1 simple syrup", ""],
        ["0.5 oz", "dry red wine", "float; Syrah or Malbec works well"],
        ["0.5 oz", "egg white", "optional"]
      ],
      technique: [
        "Shake bourbon, lemon, syrup, and egg white if using.",
        "Strain over a large cube.",
        "Float red wine slowly over the back of a spoon."
      ],
      barNotes: "A dry red wine float gives structure and drama. Avoid jammy wine."
    },
    {
      id: "lion-tail",
      name: "Lion's Tail",
      family: "Spiced sour",
      proofLane: "95-110 proof",
      idealProof: 100,
      bottleStyles: ["baking spice", "oak", "rye spice", "caramel"],
      protectRareBottles: true,
      glassware: "Chilled coupe",
      ice: "Shaken, served up",
      garnish: "Lime coin",
      ingredients: [
        ["2 oz", "bourbon", ""],
        ["0.5 oz", "allspice dram", ""],
        ["0.5 oz", "fresh lime juice", ""],
        ["0.25 oz", "2:1 demerara syrup", ""],
        ["2 dashes", "Angostura bitters", ""]
      ],
      technique: [
        "Shake hard with ice.",
        "Fine strain into a chilled coupe.",
        "Garnish with a thin lime coin."
      ],
      barNotes: "Allspice dram is powerful. Keep syrup restrained and let the bourbon's oak keep the drink adult."
    },
    {
      id: "bourbon-sidecar",
      name: "Bourbon Sidecar",
      family: "Sour",
      proofLane: "95-105 proof",
      idealProof: 100,
      bottleStyles: ["citrus", "vanilla", "soft oak", "balanced bourbon"],
      protectRareBottles: true,
      glassware: "Chilled coupe",
      ice: "Shaken, served up",
      garnish: "Half sugared rim and lemon coin",
      ingredients: [
        ["1.75 oz", "bourbon", ""],
        ["0.75 oz", "Pierre Ferrand Dry Curacao", ""],
        ["0.75 oz", "fresh lemon juice", ""],
        ["0.25 oz", "2:1 simple syrup", "only if needed"]
      ],
      technique: [
        "Half-rim the glass with superfine sugar.",
        "Shake ingredients hard with ice.",
        "Fine strain into the prepared coupe."
      ],
      barNotes: "The half rim lets the guest choose sweetness. Avoid cheap orange liqueur."
    },
    {
      id: "bourbon-sazerac",
      name: "Bourbon Sazerac Variation",
      family: "Spirit-forward",
      proofLane: "100-120 proof",
      idealProof: 110,
      bottleStyles: ["rye spice", "oak", "barrel proof", "baking spice"],
      protectRareBottles: false,
      glassware: "Frozen rocks glass",
      ice: "Stirred, served down without ice",
      garnish: "Lemon peel expressed and discarded",
      ingredients: [
        ["2 oz", "high-proof bourbon", "rye-forward preferred"],
        ["0.25 oz", "2:1 demerara syrup", ""],
        ["3 dashes", "Peychaud's bitters", ""],
        ["1 dash", "Angostura bitters", ""],
        ["1 rinse", "absinthe", ""]
      ],
      technique: [
        "Rinse a frozen glass with absinthe and discard excess.",
        "Stir bourbon, syrup, and bitters with ice.",
        "Strain into the prepared glass and express lemon oil."
      ],
      barNotes: "This is a bourbon variation, not the canonical rye Sazerac. It needs proof and spice to survive the absinthe."
    },
    {
      id: "hot-toddy",
      name: "Hot Toddy",
      family: "Hot",
      proofLane: "90-105 proof",
      idealProof: 95,
      bottleStyles: ["honey", "vanilla", "oak", "approachable"],
      protectRareBottles: true,
      glassware: "Heated mug",
      ice: "None",
      garnish: "Lemon wheel studded with clove",
      ingredients: [
        ["2 oz", "bourbon", ""],
        ["0.5 oz", "3:1 honey syrup", ""],
        ["0.25 oz", "fresh lemon juice", ""],
        ["4 oz", "hot water", "not boiling"],
        ["1 dash", "Angostura bitters", "optional"]
      ],
      technique: [
        "Preheat the mug with hot water and discard.",
        "Build ingredients in the mug and stir gently.",
        "Garnish with lemon and clove."
      ],
      barNotes: "Use water just off the boil so the whiskey remains aromatic instead of cooked."
    }
  ];

  global.BarrelCocktailData = {
    cocktails
  };
})(typeof window !== "undefined" ? window : globalThis);
