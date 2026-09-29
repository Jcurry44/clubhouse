(function attachFamilies(global) {
  // ------------------------------------------------------------------
  // Distillery taxonomy. Each distillery rolls up to a parent company and
  // holds the brands it produces, with match tokens used to classify bottles
  // from messy catalog names. Tokens are matched on word boundaries after
  // normalization, so "weller" hits "W.L. Weller 12" but not "dweller".
  // ------------------------------------------------------------------
  const DISTILLERIES = [
    {
      id: "buffalo-trace", name: "Buffalo Trace", parent: "Sazerac", region: "Frankfort, KY",
      brands: [
        { name: "Buffalo Trace", match: ["buffalo trace"] },
        { name: "Eagle Rare", match: ["eagle rare"] },
        { name: "Blanton's", match: ["blanton"] },
        { name: "Weller", match: ["weller", "w l weller"] },
        { name: "Pappy Van Winkle", match: ["pappy", "pappy van winkle"] },
        { name: "Old Rip Van Winkle", match: ["van winkle", "old rip"] },
        { name: "E.H. Taylor", match: ["e h taylor", "colonel e h taylor"] },
        { name: "Stagg", match: ["george t stagg", "stagg jr", "stagg"] },
        { name: "Sazerac Rye", match: ["sazerac rye"] },
        { name: "Thomas H. Handy", match: ["thomas h handy", "handy sazerac"] },
        { name: "Benchmark", match: ["benchmark", "mcafee s benchmark"] },
        { name: "Ancient Age", match: ["ancient age"] },
        { name: "Elmer T. Lee", match: ["elmer t lee"] },
        { name: "Rock Hill Farms", match: ["rock hill farms"] },
        { name: "Hancock's", match: ["hancock s president"] },
        { name: "Old Charter", match: ["old charter"] },
        { name: "Wheatley", match: ["wheatley"] }
      ]
    },
    {
      id: "barton-1792", name: "Barton 1792", parent: "Sazerac", region: "Bardstown, KY",
      brands: [
        { name: "1792", match: ["1792"] },
        { name: "Very Old Barton", match: ["very old barton"] },
        { name: "Kentucky Gentleman", match: ["kentucky gentleman"] },
        { name: "Ten High", match: ["ten high"] },
        { name: "Tom Moore", match: ["tom moore"] }
      ]
    },
    {
      id: "a-smith-bowman", name: "A. Smith Bowman", parent: "Sazerac", region: "Fredericksburg, VA",
      brands: [{ name: "Bowman", match: ["bowman brothers", "john j bowman", "abraham bowman", "a smith bowman", "isaac bowman"] }]
    },
    {
      id: "jim-beam", name: "Jim Beam", parent: "Suntory Global Spirits", region: "Clermont, KY",
      brands: [
        { name: "Jim Beam", match: ["jim beam"] },
        { name: "Knob Creek", match: ["knob creek"] },
        { name: "Booker's", match: ["booker s", "bookers"] },
        { name: "Baker's", match: ["baker s single", "bakers single", "baker s 7", "baker s bourbon"] },
        { name: "Basil Hayden", match: ["basil hayden"] },
        { name: "Old Grand-Dad", match: ["old grand dad", "old granddad"] },
        { name: "Old Crow", match: ["old crow"] },
        { name: "Little Book", match: ["little book"] },
        { name: "Legent", match: ["legent"] },
        { name: "Old Tub", match: ["old tub"] }
      ]
    },
    {
      id: "makers-mark", name: "Maker's Mark", parent: "Suntory Global Spirits", region: "Loretto, KY",
      brands: [{ name: "Maker's Mark", match: ["maker s mark", "makers mark", "maker s 46", "star hill farm"] }]
    },
    {
      id: "heaven-hill", name: "Heaven Hill", parent: "Heaven Hill Brands", region: "Bardstown, KY",
      brands: [
        { name: "Elijah Craig", match: ["elijah craig"] },
        { name: "Evan Williams", match: ["evan williams"] },
        { name: "Henry McKenna", match: ["henry mckenna"] },
        { name: "Larceny", match: ["larceny"] },
        { name: "Old Fitzgerald", match: ["old fitzgerald"] },
        { name: "Bernheim", match: ["bernheim"] },
        { name: "Parker's Heritage", match: ["parker s heritage", "parkers heritage"] },
        { name: "Heaven Hill", match: ["heaven hill"] },
        { name: "Pikesville", match: ["pikesville"] },
        { name: "Rittenhouse", match: ["rittenhouse"] },
        { name: "Mellow Corn", match: ["mellow corn"] },
        { name: "Fighting Cock", match: ["fighting cock"] },
        { name: "Cabin Still", match: ["cabin still"] }
      ]
    },
    {
      id: "wild-turkey", name: "Wild Turkey", parent: "Campari Group", region: "Lawrenceburg, KY",
      brands: [
        { name: "Wild Turkey", match: ["wild turkey"] },
        { name: "Russell's Reserve", match: ["russell s reserve", "russells reserve"] },
        { name: "Rare Breed", match: ["rare breed"] },
        { name: "Kentucky Spirit", match: ["kentucky spirit"] },
        { name: "Longbranch", match: ["longbranch"] },
        { name: "Master's Keep", match: ["master s keep", "masters keep"] },
        { name: "American Honey", match: ["american honey"] }
      ]
    },
    {
      id: "four-roses", name: "Four Roses", parent: "Kirin", region: "Lawrenceburg, KY",
      brands: [{ name: "Four Roses", match: ["four roses"] }]
    },
    {
      id: "brown-forman", name: "Brown-Forman (Old Forester / Woodford)", parent: "Brown-Forman", region: "Louisville / Versailles, KY",
      brands: [
        { name: "Old Forester", match: ["old forester"] },
        { name: "Woodford Reserve", match: ["woodford reserve", "woodford"] },
        { name: "Coopers' Craft", match: ["coopers craft"] },
        { name: "King of Kentucky", match: ["king of kentucky"] },
        { name: "Early Times", match: ["early times"] }
      ]
    },
    {
      id: "jack-daniels", name: "Jack Daniel's", parent: "Brown-Forman", region: "Lynchburg, TN",
      brands: [
        { name: "Jack Daniel's", match: ["jack daniel"] },
        { name: "Gentleman Jack", match: ["gentleman jack"] }
      ]
    },
    {
      id: "michters", name: "Michter's", parent: "Michter's (independent)", region: "Louisville, KY",
      brands: [
        { name: "Michter's", match: ["michter"] },
        { name: "Shenk's", match: ["shenk"] },
        { name: "Bomberger's", match: ["bomberger"] }
      ]
    },
    {
      id: "mgp-ross-squibb", name: "Ross & Squibb (MGP)", parent: "MGP Ingredients", region: "Lawrenceburg, IN",
      brands: [
        { name: "George Remus", match: ["george remus", "remus"] },
        { name: "Rossville Union", match: ["rossville union"] },
        { name: "Eight & Sand", match: ["eight sand"] }
      ]
    },
    {
      id: "willett", name: "Willett (KBD)", parent: "Willett (independent)", region: "Bardstown, KY",
      brands: [
        { name: "Willett", match: ["willett"] },
        { name: "Noah's Mill", match: ["noah s mill", "noahs mill"] },
        { name: "Rowan's Creek", match: ["rowan s creek", "rowans creek"] },
        { name: "Johnny Drum", match: ["johnny drum"] },
        { name: "Old Bardstown", match: ["old bardstown"] }
      ]
    },
    {
      id: "bardstown-bourbon", name: "Bardstown Bourbon Company", parent: "Bardstown (independent)", region: "Bardstown, KY",
      brands: [{ name: "Bardstown Bourbon", match: ["bardstown bourbon", "bardstown discovery", "bardstown origin"] }]
    },
    {
      id: "barrell", name: "Barrell Craft Spirits", parent: "Barrell (blender)", region: "Louisville, KY",
      brands: [
        { name: "Barrell", match: ["barrell"] },
        { name: "Stellum", match: ["stellum"] }
      ]
    },
    {
      id: "lux-row", name: "Lux Row / Limestone Branch", parent: "MGP / Luxco", region: "Bardstown / Lebanon, KY",
      brands: [
        { name: "Ezra Brooks", match: ["ezra brooks"] },
        { name: "Rebel", match: ["rebel yell", "rebel 100", "rebel bourbon", "rebel 10"] },
        { name: "Blood Oath", match: ["blood oath"] },
        { name: "David Nicholson", match: ["david nicholson"] },
        { name: "Yellowstone", match: ["yellowstone"] }
      ]
    },
    {
      id: "diageo", name: "Diageo (Dickel / Bulleit)", parent: "Diageo", region: "Tullahoma, TN / KY",
      brands: [
        { name: "George Dickel", match: ["george dickel", "dickel"] },
        { name: "Bulleit", match: ["bulleit"] },
        { name: "Blade and Bow", match: ["blade and bow"] },
        { name: "I.W. Harper", match: ["i w harper", "iw harper"] }
      ]
    },
    {
      id: "angels-envy", name: "Angel's Envy", parent: "Bacardi", region: "Louisville, KY",
      brands: [{ name: "Angel's Envy", match: ["angel s envy", "angels envy"] }]
    },
    {
      id: "new-riff", name: "New Riff", parent: "New Riff (independent)", region: "Newport, KY",
      brands: [{ name: "New Riff", match: ["new riff"] }]
    },
    {
      id: "wilderness-trail", name: "Wilderness Trail", parent: "Campari Group", region: "Danville, KY",
      brands: [{ name: "Wilderness Trail", match: ["wilderness trail"] }]
    },
    {
      id: "jeffersons", name: "Jefferson's", parent: "Pernod Ricard", region: "Sourced / Kentucky",
      brands: [{ name: "Jefferson's", match: ["jefferson s", "jeffersons"] }]
    },
    {
      id: "uncle-nearest", name: "Uncle Nearest", parent: "Uncle Nearest (independent)", region: "Shelbyville, TN",
      brands: [{ name: "Uncle Nearest", match: ["uncle nearest"] }]
    },
    {
      id: "garrison-brothers", name: "Garrison Brothers", parent: "Garrison Brothers (independent)", region: "Hye, TX",
      brands: [{ name: "Garrison Brothers", match: ["garrison brothers", "garrison bros"] }]
    },
    {
      id: "high-west", name: "High West", parent: "Constellation Brands", region: "Park City, UT",
      brands: [{ name: "High West", match: ["high west"] }]
    },
    {
      id: "sagamore", name: "Sagamore Spirit", parent: "Sagamore (independent)", region: "Baltimore, MD",
      brands: [{ name: "Sagamore", match: ["sagamore"] }]
    },
    {
      id: "found-north", name: "Found North", parent: "Found North (blender)", region: "Canada (sourced)",
      brands: [{ name: "Found North", match: ["found north"] }]
    },
    {
      id: "smoke-wagon", name: "Smoke Wagon", parent: "Nevada H&C (blender)", region: "Las Vegas, NV (sourced)",
      brands: [{ name: "Smoke Wagon", match: ["smoke wagon"] }]
    },
    {
      id: "penelope", name: "Penelope", parent: "MGCP / Penelope", region: "Sourced / Indiana",
      brands: [{ name: "Penelope", match: ["penelope"] }]
    },
    {
      id: "whistlepig", name: "WhistlePig", parent: "WhistlePig (independent)", region: "Shoreham, VT",
      brands: [{ name: "WhistlePig", match: ["whistlepig", "piggyback", "boss hog"] }]
    },
    {
      id: "old-elk", name: "Old Elk", parent: "Old Elk (independent)", region: "Fort Collins, CO",
      brands: [{ name: "Old Elk", match: ["old elk"] }]
    },
    {
      id: "smooth-ambler", name: "Smooth Ambler", parent: "Pernod Ricard", region: "Maxwelton, WV",
      brands: [{ name: "Smooth Ambler", match: ["smooth ambler", "old scout"] }]
    },
    {
      id: "kentucky-owl", name: "Kentucky Owl", parent: "Stoli Group", region: "Bardstown, KY (sourced)",
      brands: [{ name: "Kentucky Owl", match: ["kentucky owl"] }]
    },
    {
      id: "blue-run", name: "Blue Run", parent: "Molson Coors", region: "Georgetown, KY",
      brands: [{ name: "Blue Run", match: ["blue run"] }]
    },
    {
      id: "rabbit-hole", name: "Rabbit Hole", parent: "Pernod Ricard", region: "Louisville, KY",
      brands: [{ name: "Rabbit Hole", match: ["rabbit hole"] }]
    },
    {
      id: "starlight", name: "Starlight Distillery", parent: "Huber's (independent)", region: "Borden, IN",
      brands: [{ name: "Starlight", match: ["starlight"] }]
    },
    {
      id: "hard-truth", name: "Hard Truth", parent: "Hard Truth (independent)", region: "Nashville, IN",
      brands: [{ name: "Hard Truth", match: ["hard truth"] }]
    },
    {
      id: "oak-eden", name: "Oak & Eden", parent: "Oak & Eden (independent)", region: "Lubbock, TX",
      brands: [{ name: "Oak & Eden", match: ["oak eden", "oak and eden"] }]
    },
    {
      id: "redwood-empire", name: "Redwood Empire", parent: "Purple Brands", region: "Graton, CA",
      brands: [{ name: "Redwood Empire", match: ["redwood empire"] }]
    },
    {
      id: "iron-fish", name: "Iron Fish", parent: "Iron Fish (independent)", region: "Thompsonville, MI",
      brands: [{ name: "Iron Fish", match: ["iron fish"] }]
    },
    {
      id: "chicken-cock", name: "Chicken Cock", parent: "Grain & Barrel", region: "Sourced / Kentucky",
      brands: [{ name: "Chicken Cock", match: ["chicken cock"] }]
    },
    {
      id: "calumet-farm", name: "Calumet Farm", parent: "Western Spirits", region: "Bardstown, KY (sourced)",
      brands: [{ name: "Calumet Farm", match: ["calumet"] }]
    },
    {
      id: "cedar-ridge", name: "Cedar Ridge", parent: "Cedar Ridge (independent)", region: "Swisher, IA",
      brands: [{ name: "Cedar Ridge", match: ["cedar ridge"] }]
    },
    {
      id: "templeton", name: "Templeton", parent: "Templeton (sourced MGP)", region: "Templeton, IA",
      brands: [{ name: "Templeton", match: ["templeton"] }]
    },
    {
      id: "three-chord", name: "Three Chord", parent: "Three Chord (independent)", region: "Sourced",
      brands: [{ name: "Three Chord", match: ["three chord"] }]
    },
    {
      id: "town-branch", name: "Town Branch", parent: "Alltech Lexington", region: "Lexington, KY",
      brands: [{ name: "Town Branch", match: ["town branch"] }]
    },
    {
      id: "middle-west", name: "Middle West Spirits", parent: "Middle West (independent)", region: "Columbus, OH",
      brands: [{ name: "Middle West", match: ["middle west"] }]
    },
    {
      id: "still-austin", name: "Still Austin", parent: "Still Austin (independent)", region: "Austin, TX",
      brands: [{ name: "Still Austin", match: ["still austin"] }]
    },
    {
      id: "wyoming-whiskey", name: "Wyoming Whiskey", parent: "Wyoming Whiskey (independent)", region: "Kirby, WY",
      brands: [{ name: "Wyoming Whiskey", match: ["wyoming whiskey"] }]
    },
    {
      id: "nelsons-green-brier", name: "Nelson's Green Brier", parent: "Constellation Brands", region: "Nashville, TN",
      brands: [{ name: "Nelson Bros / Belle Meade", match: ["nelson bros", "nelson s green brier", "belle meade"] }]
    },
    {
      id: "buzzards-roost", name: "Buzzard's Roost", parent: "Buzzard's Roost (sourced)", region: "Louisville, KY",
      brands: [{ name: "Buzzard's Roost", match: ["buzzard s roost", "buzzards roost"] }]
    },
    {
      id: "bib-tucker", name: "Bib & Tucker", parent: "Deutsch Family", region: "Sourced",
      brands: [{ name: "Bib & Tucker", match: ["bib tucker", "bib and tucker"] }]
    },
    {
      id: "clyde-mays", name: "Clyde May's", parent: "Conecuh Brands", region: "Sourced / Alabama",
      brands: [{ name: "Clyde May's", match: ["clyde may"] }]
    },
    {
      id: "bird-dog", name: "Bird Dog", parent: "Western Spirits", region: "Sourced / Kentucky",
      brands: [{ name: "Bird Dog", match: ["bird dog"] }]
    },
    {
      id: "driftless-glen", name: "Driftless Glen", parent: "Driftless Glen (independent)", region: "Baraboo, WI",
      brands: [{ name: "Driftless Glen", match: ["driftless glen"] }]
    },
    {
      id: "luca-mariano", name: "Luca Mariano", parent: "Luca Mariano (independent)", region: "Danville, KY",
      brands: [{ name: "Luca Mariano", match: ["luca mariano"] }]
    },
    {
      id: "pinhook", name: "Pinhook", parent: "Pinhook (sourced)", region: "Bardstown, KY",
      brands: [{ name: "Pinhook", match: ["pinhook"] }]
    },
    {
      id: "dark-arts", name: "Dark Arts", parent: "Dark Arts (independent)", region: "Lincoln, NE",
      brands: [{ name: "Dark Arts", match: ["dark arts"] }]
    },
    {
      id: "traverse-city", name: "Traverse City", parent: "Traverse City (independent)", region: "Traverse City, MI",
      brands: [{ name: "Traverse City", match: ["traverse city"] }]
    },
    {
      id: "frey-ranch", name: "Frey Ranch", parent: "Frey Ranch (independent)", region: "Fallon, NV",
      brands: [{ name: "Frey Ranch", match: ["frey ranch"] }]
    },
    {
      id: "balcones", name: "Balcones", parent: "Diageo", region: "Waco, TX",
      brands: [{ name: "Balcones", match: ["balcones"] }]
    },
    {
      id: "kentucky-peerless", name: "Kentucky Peerless", parent: "Peerless (independent)", region: "Louisville, KY",
      brands: [{ name: "Peerless", match: ["peerless"] }]
    },
    {
      id: "castle-key", name: "Castle & Key", parent: "Castle & Key (independent)", region: "Frankfort, KY",
      brands: [{ name: "Castle & Key", match: ["castle key", "castle and key"] }]
    },
    {
      id: "james-e-pepper", name: "James E. Pepper", parent: "Georgetown Trading", region: "Lexington, KY",
      brands: [{ name: "James E. Pepper", match: ["james e pepper", "old pepper"] }]
    },
    {
      id: "widow-jane", name: "Widow Jane", parent: "Samson & Surrey", region: "Brooklyn, NY",
      brands: [{ name: "Widow Jane", match: ["widow jane"] }]
    },
    {
      id: "heavens-door", name: "Heaven's Door", parent: "Heaven's Door (independent)", region: "Pleasureville, KY",
      brands: [{ name: "Heaven's Door", match: ["heaven s door", "heavens door"] }]
    },
    {
      id: "2xo", name: "2XO", parent: "2XO (Dixon Dedman)", region: "Sourced / Kentucky",
      brands: [{ name: "2XO", match: ["2xo"] }]
    },
    {
      id: "boone-county", name: "Boone County", parent: "Boone County (independent)", region: "Independence, KY",
      brands: [{ name: "Boone County", match: ["boone county"] }]
    },
    {
      id: "long-road", name: "Long Road", parent: "Long Road (independent)", region: "Grand Rapids, MI",
      brands: [{ name: "Long Road", match: ["long road"] }]
    },
    {
      id: "rd-one", name: "RD1 Spirits", parent: "RD1 (independent)", region: "Lexington, KY",
      brands: [{ name: "RD1", match: ["rd one", "rd1"] }]
    },
    {
      id: "cody-road", name: "Cody Road", parent: "Mississippi River Distilling", region: "Le Claire, IA",
      brands: [{ name: "Cody Road", match: ["cody road"] }]
    },
    {
      id: "johnnie-walker", name: "Johnnie Walker (Diageo Scotch)", parent: "Diageo", region: "Scotland",
      brands: [{ name: "Johnnie Walker", match: ["johnnie walker", "lagavulin", "talisker", "oban", "mortlach", "clynelish", "cardhu", "caol ila"] }]
    },
    {
      id: "edrington-scotch", name: "Macallan / Highland Park (Edrington)", parent: "Edrington", region: "Scotland",
      brands: [{ name: "The Macallan", match: ["macallan"] }, { name: "Highland Park", match: ["highland park"] }, { name: "Glenrothes", match: ["glenrothes"] }]
    },
    {
      id: "pernod-scotch", name: "Chivas / Glenlivet / Aberlour (Pernod)", parent: "Pernod Ricard", region: "Scotland",
      brands: [{ name: "The Glenlivet", match: ["glenlivet"] }, { name: "Chivas Regal", match: ["chivas"] }, { name: "Aberlour", match: ["aberlour"] }, { name: "Glenfiddich", match: ["glenfiddich"] }, { name: "Balvenie", match: ["balvenie"] }]
    },
    {
      id: "dewars", name: "Dewar's / Aberfeldy (Bacardi)", parent: "Bacardi", region: "Scotland",
      brands: [{ name: "Dewar's", match: ["dewar s", "dewars"] }, { name: "Aberfeldy", match: ["aberfeldy"] }]
    },
    {
      id: "dalmore", name: "The Dalmore (Whyte & Mackay)", parent: "Whyte & Mackay", region: "Scotland",
      brands: [{ name: "The Dalmore", match: ["dalmore"] }, { name: "Jura", match: ["isle of jura", "jura "] }]
    },
    {
      id: "crown-royal", name: "Crown Royal (Diageo Canada)", parent: "Diageo", region: "Gimli, Canada",
      brands: [{ name: "Crown Royal", match: ["crown royal"] }]
    },
    {
      id: "canadian-club", name: "Canadian Club / Seagram's", parent: "Suntory / Sazerac", region: "Canada",
      brands: [{ name: "Canadian Club", match: ["canadian club"] }, { name: "Seagram's", match: ["seagram"] }]
    },
    {
      id: "irish-whiskey", name: "Irish Whiskey (Jameson & others)", parent: "Various (Ireland)", region: "Ireland",
      brands: [{ name: "Jameson", match: ["jameson"] }, { name: "Bushmills", match: ["bushmills"] }, { name: "Redbreast", match: ["redbreast"] }, { name: "Green Spot", match: ["green spot", "yellow spot"] }, { name: "Tullamore D.E.W.", match: ["tullamore"] }, { name: "Knappogue", match: ["knappogue"] }, { name: "Powers", match: ["powers gold", "powers john"] } ]
    },
    {
      id: "japanese-whisky", name: "Japanese Whisky", parent: "Various (Japan)", region: "Japan",
      brands: [{ name: "Suntory / Hibiki / Yamazaki", match: ["hibiki", "yamazaki", "hakushu", "toki", "chita"] }, { name: "Nikka", match: ["nikka", "yoichi", "miyagikyo", "taketsuru"] }]
    }
  ];

  // Brands typically built on a wheated mash bill (mash bill data is sparse on
  // imported records, so a small brand list backstops the text check).
  const WHEATED_TOKENS = ["weller", "pappy", "van winkle", "maker s mark", "makers mark",
    "old fitzgerald", "larceny", "rebel", "bernheim"];
  const HIGH_RYE_TOKENS = ["old grand dad", "old granddad", "bulleit", "basil hayden", "four roses"];

  const UNKNOWN_NAMES = new Set(["", "unknown", "unknown producer", "undisclosed", "n a", "na"]);

  // Flatten taxonomy into a fast lookup list of normalized tokens.
  const TOKEN_INDEX = [];
  for (const distillery of DISTILLERIES) {
    for (const brand of distillery.brands) {
      for (const token of brand.match) {
        TOKEN_INDEX.push({ token: " " + norm(token) + " ", distillery: distillery, brand: brand.name });
      }
    }
  }
  // Longer tokens first so "russell s reserve" wins over a stray "reserve".
  TOKEN_INDEX.sort((a, b) => b.token.length - a.token.length);

  function norm(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function nameHaystack(bottle) {
    const parts = [bottle && bottle.name];
    if (bottle && Array.isArray(bottle.aliases)) parts.push(bottle.aliases.join(" "));
    return " " + norm(parts.filter(Boolean).join(" ")) + " ";
  }

  function metaHaystack(bottle) {
    return " " + norm([bottle && bottle.distillery, bottle && bottle.producer].filter(Boolean).join(" ")) + " ";
  }

  // Foreign-whiskey keywords. Distributors (e.g. Buffalo Trace's import arm)
  // stamp distillery="Buffalo Trace" onto imported Japanese/Irish/Scotch
  // whiskies; a name like this must never inherit a Kentucky distillery.
  const FOREIGN_RE = /\b(scotch|irish|japanese|canadian|world whisk|single malt|sngl malt|indian whisk|islay|speyside|highland|campbeltown|mizunara)\b/;

  // Per-bottle memo (non-enumerable so it never leaks into exported state).
  function memo(bottle, key, compute) {
    if (!bottle || typeof bottle !== "object") return compute();
    if (bottle[key]) return bottle[key];
    const value = compute();
    try {
      Object.defineProperty(bottle, key, { value, enumerable: false, configurable: true, writable: true });
    } catch (error) {
      bottle[key] = value;
    }
    return value;
  }

  function classify(bottle) {
    return memo(bottle, "_fam", () => classifyUncached(bottle));
  }

  function classifyUncached(bottle) {
    const make = (entry) => ({
      matched: true,
      distilleryId: entry.distillery.id,
      distillery: entry.distillery.name,
      parent: entry.distillery.parent,
      region: entry.distillery.region,
      brand: entry.brand
    });

    // 1. The bottle NAME is authoritative.
    const hayName = nameHaystack(bottle);
    for (const entry of TOKEN_INDEX) {
      if (hayName.indexOf(entry.token) !== -1) return make(entry);
    }

    const isForeign = FOREIGN_RE.test(hayName) || FOREIGN_RE.test(norm(bottle && bottle.category));

    // 2. Fall back to the distillery/producer field — but only for bottles that
    //    aren't clearly an imported world whisky.
    if (!isForeign) {
      const hayMeta = metaHaystack(bottle);
      for (const entry of TOKEN_INDEX) {
        if (hayMeta.indexOf(entry.token) !== -1) return make(entry);
      }
    } else {
      const wt = attributes(bottle).whiskeyType;
      const label = wt && wt !== "Other whiskey" ? wt : "World whisky";
      return { matched: false, distilleryId: "type-" + norm(label).replace(/\s+/g, "-"), distillery: label, parent: "Imported / world whisky", region: "", brand: "" };
    }

    // 3. Group by the bottle's own distillery/producer text when present.
    const raw = bottle && bottle.distillery && !UNKNOWN_NAMES.has(norm(bottle.distillery))
      ? bottle.distillery
      : (bottle && bottle.producer && !UNKNOWN_NAMES.has(norm(bottle.producer)) ? bottle.producer : "");
    if (raw) {
      return {
        matched: false,
        distilleryId: "raw-" + norm(raw).replace(/\s+/g, "-"),
        distillery: raw,
        parent: (bottle && bottle.producer) || raw,
        region: "",
        brand: ""
      };
    }
    return { matched: false, distilleryId: "other-uncatalogued", distillery: "Other / Uncatalogued", parent: "Various", region: "", brand: "" };
  }

  function attributes(bottle) {
    return memo(bottle, "_attrs", () => attributesUncached(bottle));
  }

  function attributesUncached(bottle) {
    const text = " " + norm([bottle && bottle.name, bottle && bottle.category, bottle && bottle.mashBill].filter(Boolean).join(" ")) + " ";
    const cat = norm(bottle && bottle.category);
    const mb = norm(bottle && bottle.mashBill);
    const proof = Number(bottle && bottle.proof);

    const isRye = (/\brye\b/.test(cat) && !/bourbon/.test(cat)) || /\brye whiskey\b/.test(text);
    const isWheatWhiskey = /wheat whiskey/.test(text);
    const singleBarrel = /\bsingle barrel\b|\bsingle bbl\b|\bsngl brrl\b|\bsingle brrl\b/.test(text);
    const smallBatch = /\bsmall batch\b/.test(text);
    const bottledInBond = /\bbottled in bond\b|\bbonded\b|\bbib\b/.test(text);
    // Cask/barrel strength: stated on the label, or implied by a proof no
    // standard-strength bottle reaches (≥120). Catches Stagg, Booker's, etc.
    const caskStrength = /\bcask strength\b|\bbarrel proof\b|\bbarrel strength\b|\bfull proof\b/.test(text) ||
      (Number.isFinite(proof) && proof >= 120);
    const finished = /\bfinish\b|\bport\b|\bsherry\b|\bcognac\b|\brum\b|\bmaple\b|\btoasted\b|\bmizunara\b|\bsauternes\b|\bcigar\b/.test(text);
    const sourced = /\bmgp\b|\bindiana\b|\bsourced\b|\bundisclosed\b|blend of straight/.test(text);

    let style = "Traditional bourbon";
    if (isRye) style = "Rye whiskey";
    else if (isWheatWhiskey) style = "Wheat whiskey";
    else if (/wheat/.test(mb) || WHEATED_TOKENS.some((t) => text.indexOf(" " + norm(t) + " ") !== -1)) style = "Wheated bourbon";
    else if (/high rye|high-rye/.test(mb) || HIGH_RYE_TOKENS.some((t) => text.indexOf(" " + norm(t) + " ") !== -1)) style = "High-rye bourbon";

    let proofTier = "";
    if (Number.isFinite(proof)) {
      if (proof < 100) proofTier = "Standard (≤100)";
      else if (proof < 115) proofTier = "High proof (100–115)";
      else if (proof < 140) proofTier = "Barrel/cask (115–140)";
      else proofTier = "Hazmat (≥140)";
    }

    const ctext = " " + norm([bottle && bottle.category, bottle && bottle.name].filter(Boolean).join(" ")) + " ";
    let whiskeyType = "Other whiskey";
    if (/\btennessee\b/.test(ctext) && !/\bbourbon\b/.test(ctext)) whiskeyType = "Tennessee whiskey";
    else if (/\bbourbon\b/.test(ctext)) whiskeyType = "Bourbon";
    else if (/\brye\b/.test(ctext)) whiskeyType = "Rye whiskey";
    else if (/\bscotch\b|\bislay\b|speyside|\bhighland\b/.test(ctext)) whiskeyType = "Scotch";
    else if (/\birish\b/.test(ctext)) whiskeyType = "Irish whiskey";
    else if (/\bcanadian\b/.test(ctext)) whiskeyType = "Canadian whisky";
    else if (/\bjapanese\b/.test(ctext)) whiskeyType = "Japanese whisky";
    else if (/single malt/.test(ctext)) whiskeyType = "Single malt";
    else if (/wheat whiskey/.test(ctext)) whiskeyType = "Wheat whiskey";
    else if (/\bcorn whiskey\b/.test(ctext)) whiskeyType = "Corn whiskey";

    return { isRye, isWheatWhiskey, singleBarrel, smallBatch, bottledInBond, caskStrength, finished, sourced, style, proofTier, whiskeyType };
  }

  function median(values) {
    const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!clean.length) return null;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  }

  function avg(values) {
    const clean = values.filter((v) => Number.isFinite(v));
    if (!clean.length) return null;
    return clean.reduce((s, v) => s + v, 0) / clean.length;
  }

  function rank(group) {
    // Curated distilleries first (by bottle count), raw/unknown groups last.
    const known = group.matched ? 0 : 1;
    return known * 1e6 - group.count;
  }

  // Build the full distillery index with analytics. Cache-friendly: pure of UI.
  function buildIndex(bottles) {
    const groups = new Map();
    for (const bottle of bottles || []) {
      const family = classify(bottle);
      const attrs = attributes(bottle);
      let group = groups.get(family.distilleryId);
      if (!group) {
        group = {
          id: family.distilleryId,
          name: family.distillery,
          parent: family.parent,
          region: family.region,
          matched: family.matched,
          bottles: [],
          brands: new Map()
        };
        groups.set(family.distilleryId, group);
      }
      group.bottles.push({ bottle, family, attrs });
      const brandName = family.brand || bottle.name || "Other";
      group.brands.set(brandName, (group.brands.get(brandName) || 0) + 1);
    }

    const list = [];
    for (const group of groups.values()) {
      const items = group.bottles;
      const proofs = items.map((i) => Number(i.bottle.proof));
      const msrps = items.map((i) => Number(i.bottle.msrp)).filter(Number.isFinite);
      const hypes = items.map((i) => Number(i.bottle.hypeIndex)).filter(Number.isFinite);

      const styleMix = {};
      const rarityMix = {};
      const typeMix = {};
      let bib = 0, single = 0, small = 0, cask = 0, sourced = 0, finished = 0;
      for (const i of items) {
        styleMix[i.attrs.style] = (styleMix[i.attrs.style] || 0) + 1;
        if (i.attrs.whiskeyType) typeMix[i.attrs.whiskeyType] = (typeMix[i.attrs.whiskeyType] || 0) + 1;
        const rarity = i.bottle.rarity || "Source-backed";
        rarityMix[rarity] = (rarityMix[rarity] || 0) + 1;
        if (i.attrs.bottledInBond) bib++;
        if (i.attrs.singleBarrel) single++;
        if (i.attrs.smallBatch) small++;
        if (i.attrs.caskStrength) cask++;
        if (i.attrs.sourced) sourced++;
        if (i.attrs.finished) finished++;
      }
      const topType = Object.entries(typeMix).sort((a, b) => b[1] - a[1])[0];

      const notable = items
        .slice()
        .sort((a, b) => (Number(b.bottle.hypeIndex) || 0) - (Number(a.bottle.hypeIndex) || 0))
        .slice(0, 12);

      const brands = [...group.brands.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      list.push({
        id: group.id,
        name: group.name,
        parent: group.parent,
        region: group.region,
        matched: group.matched,
        count: items.length,
        avgProof: avg(proofs),
        minProof: proofs.filter(Number.isFinite).length ? Math.min(...proofs.filter(Number.isFinite)) : null,
        maxProof: proofs.filter(Number.isFinite).length ? Math.max(...proofs.filter(Number.isFinite)) : null,
        medianMsrp: median(msrps),
        minMsrp: msrps.length ? Math.min(...msrps) : null,
        maxMsrp: msrps.length ? Math.max(...msrps) : null,
        avgHype: avg(hypes),
        styleMix,
        rarityMix,
        typeMix,
        topType: topType ? topType[0] : "",
        counts: { bib, single, small, cask, sourced, finished },
        brands,
        notable
      });
    }

    list.sort((a, b) => rank(a) - rank(b));
    return list;
  }

  global.BarrelFamilies = {
    DISTILLERIES,
    classify,
    attributes,
    buildIndex
  };
})(typeof window !== "undefined" ? window : globalThis);
