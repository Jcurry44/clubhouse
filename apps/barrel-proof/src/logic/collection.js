(function attachCollection(global) {
  // Fast, tap-don't-type collection model.
  //
  // - Curated batch lists for marquee batched lines (ECBP, Larceny BP, Stagg,
  //   Four Roses recipes, Booker's, BTAC) so you select REAL batches, no typing.
  // - Open-ended picks (single-barrel store picks) get tap-to-own + a count and
  //   an optional label.
  // - Everything else is one tap.
  //
  // Collection lives on state.collection[bottleId] = { count, batches[], note }.
  // statuses[bottleId] = "owned" is kept in sync so the shelf and recommender
  // (which read statuses) just work.

  // How to read Buffalo Trace's laser bottling-date code (shared by BTAC, EHT, etc.).
  const BT_LASER_CODE = "Buffalo Trace laser-etches a date code low on the glass (often on the back below the label — shine a light through to read it). Modern format e.g. “L 18 096 01 1050 K”: L = lot, 18 = year bottled (2018), 096 = day of year (≈96th day, early Apr), then plant / time / line. 2007–11 bottles read “K 259 10 15:47” = day 259, year 2010. The 2-digit year is your bottling year.";

  // Real batch data — proofs/years researched from community batch guides
  // (Breaking Bourbon, bourbinsane, et al.), since producers publish no master
  // list. Proofs can vary ~0.1 between sources. A batch is a string or
  // { label, proof, year }. `howToId` tells the user how to identify their bottle.
  const BATCH_LINES = [
    {
      match: ["elijah craig barrel", "elijah craig bp", "elijah craig b p"],
      label: "Elijah Craig Barrel Proof",
      howToId: "From 2017 on, the batch code is on the front label: letter = release of the year (A = Jan, B = May, C = Sept), then month digit, then year — e.g. C923 = 3rd release, Sept 2023. Pre-2017 bottles carry no code: identify them by the stated proof (no two early batches share one). All pre-2020 batches were 12-year age-stated.",
      batches: [
        { label: "Batch 1", year: 2013, proof: 134.2 }, { label: "Batch 2", year: 2013, proof: 137.0 }, { label: "Batch 3", year: 2013, proof: 133.2 },
        { label: "Batch 4", year: 2014, proof: 132.4 }, { label: "Batch 5", year: 2014, proof: 134.8 }, { label: "Batch 6", year: 2014, proof: 140.2 },
        { label: "Batch 7", year: 2015, proof: 128.0 }, { label: "Batch 8", year: 2015, proof: 139.8 }, { label: "Batch 9", year: 2015, proof: 135.6 },
        { label: "Batch 10", year: 2016, proof: 138.8 }, { label: "Batch 11", year: 2016, proof: 139.4 }, { label: "Batch 12", year: 2016, proof: 136.0 },
        { label: "A117", year: 2017, proof: 127.0 }, { label: "B517", year: 2017, proof: 124.2 }, { label: "C917", year: 2017, proof: 131.0 },
        { label: "A118", year: 2018, proof: 130.6 }, { label: "B518", year: 2018, proof: 133.4 }, { label: "C918", year: 2018, proof: 131.4 },
        { label: "A119", year: 2019, proof: 135.2 }, { label: "B519", year: 2019, proof: 122.2 }, { label: "C919", year: 2019, proof: 136.8 },
        { label: "A120", year: 2020, proof: 136.6 }, { label: "B520", year: 2020, proof: 127.2 }, { label: "C920", year: 2020, proof: 132.8 },
        { label: "A121", year: 2021, proof: 123.6 }, { label: "B521", year: 2021, proof: 118.2 }, { label: "C921", year: 2021, proof: 120.2 },
        { label: "A122", year: 2022, proof: 120.8 }, { label: "B522", year: 2022, proof: 121.0 }, { label: "C922", year: 2022, proof: 124.8 },
        { label: "A123", year: 2023, proof: 125.6 }, { label: "B523", year: 2023, proof: 124.2 }, { label: "C923", year: 2023, proof: 125.2 },
        { label: "A124", year: 2024, proof: 119.0 }, { label: "B524", year: 2024, proof: 130.6 }, { label: "C924", year: 2024, proof: 129.0 },
        { label: "A125", year: 2025, proof: 118.2 }, { label: "B525", year: 2025, proof: 126.2 }, { label: "C925", year: 2025, proof: 129.0 }
      ]
    },
    {
      match: ["larceny barrel", "larceny bp", "larceny b p"],
      label: "Larceny Barrel Proof",
      howToId: "Same code as ECBP on the front label: letter = release of the year (A = Jan, B = May, C = Sept), then month, then year — e.g. A120 = 1st release, Jan 2020.",
      batches: [
        { label: "A120", year: 2020, proof: 123.2 }, { label: "B520", year: 2020, proof: 122.2 }, { label: "C920", year: 2020, proof: 122.4 },
        { label: "A121", year: 2021, proof: 114.8 }, { label: "B521", year: 2021, proof: 121.0 }, { label: "C921", year: 2021, proof: 122.6 },
        { label: "A122", year: 2022, proof: 124.4 }, { label: "B522", year: 2022, proof: 123.8 }, { label: "C922", year: 2022, proof: 126.6 },
        { label: "A123", year: 2023, proof: 125.8 }, { label: "B523", year: 2023, proof: 124.4 }, { label: "C923", year: 2023, proof: 126.4 },
        { label: "A124", year: 2024, proof: 124.2 }, { label: "B524", year: 2024, proof: 125.4 }, { label: "C924", year: 2024, proof: 125.1 },
        { label: "A125", year: 2025, proof: 125.0 }, { label: "B525", year: 2025, proof: 117.4 }, { label: "C925", year: 2025, proof: 119.6 }
      ]
    },
    {
      // Matches "Stagg Jr" and the post-2022 rebrand to plain "Stagg", but NOT the
      // allocated "George T. Stagg" (handled by its own line below).
      match: ["stagg jr", "stagg junior", "stagg"],
      exclude: ["george t stagg", "george t. stagg", "gts"],
      label: "Stagg (Jr.)",
      howToId: "Older bottles read “Stagg Jr.” (Batches 1–17); from 2022 it's just “Stagg” with a year code (e.g. 23A). Match the label proof to the batch above.",
      batches: [
        { label: "Batch 1", year: 2013, proof: 134.4 },
        { label: "Batch 2", year: 2014, proof: 128.7 },
        { label: "Batch 3", year: 2014, proof: 132.1 },
        { label: "Batch 4", year: 2015, proof: 132.2 },
        { label: "Batch 5", year: 2015, proof: 129.7 },
        { label: "Batch 6", year: 2016, proof: 132.5 },
        { label: "Batch 7", year: 2016, proof: 130.0 },
        { label: "Batch 8", year: 2017, proof: 129.5 },
        { label: "Batch 9", year: 2017, proof: 131.9 },
        { label: "Batch 10", year: 2018, proof: 126.4 },
        { label: "Batch 11", year: 2018, proof: 127.9 },
        { label: "Batch 12", year: 2019, proof: 132.3 },
        { label: "Batch 13", year: 2019, proof: 128.4 },
        { label: "Batch 14", year: 2020, proof: 130.2 },
        { label: "Batch 15", year: 2020, proof: 131.1 },
        { label: "Batch 16", year: 2021, proof: 130.9 },
        { label: "Batch 17", year: 2021, proof: 128.7 },
        { label: "Batch 18", year: 2022, proof: 131.0 },
        { label: "Batch 19", year: 2022, proof: 130.0 },
        { label: "Batch 20", year: 2023, proof: 132.2 },
        { label: "Batch 21", year: 2023, proof: 130.2 },
        { label: "Batch 22", year: 2023, proof: 127.8 },
        { label: "Batch 23", year: 2023, proof: 125.9 },
        { label: "Batch 24", year: 2024, proof: 127.6 },
        { label: "Batch 25", year: 2024, proof: 127.8 },
        { label: "Batch 26", year: 2024, proof: 128.9 },
        { label: "Batch 27", year: 2025, proof: 126.5 }
      ]
    },
    {
      match: ["four roses single barrel", "four roses private", "four roses store pick", "four roses obsv", "four roses recipe"],
      label: "Four Roses (recipe)",
      howToId: "The 4-letter recipe code (e.g. OBSV) is the key: 2nd letter = mashbill (B = 35% rye, E = 20% rye), 4th letter = yeast. It's printed on single-barrel / store-pick labels.",
      batches: ["OBSV", "OBSK", "OBSF", "OBSO", "OBSQ", "OESV", "OESK", "OESF", "OESO", "OESQ"]
    },
    {
      // The release year sits between "Four Roses" and "Limited Edition" in catalog
      // names, so use matchAll (both tokens present) rather than a contiguous phrase.
      matchAll: ["four roses", "limited edition"],
      match: ["four roses le small batch", "ltd edition small batch", "anniversary small batch"],
      label: "Four Roses Limited Edition Small Batch",
      howToId: "The release year is on the front label; anniversary years are named (2013 = 125th, 2018 = 130th, 2023 = 135th). Each bottle is hand-numbered with its recipe blend on the back.",
      batches: [
        { label: "2012", year: 2012, proof: 103.4 },
        { label: "2013 · 125th", year: 2013, proof: 103.2 },
        { label: "2014", year: 2014, proof: 111.8 },
        { label: "2015", year: 2015, proof: 108.6 },
        { label: "2016", year: 2016, proof: 111.2 },
        { label: "2017", year: 2017, proof: 108.0 },
        { label: "2018 · 130th", year: 2018, proof: 108.3 },
        { label: "2019", year: 2019, proof: 112.6 },
        { label: "2020", year: 2020, proof: 111.4 },
        { label: "2021", year: 2021, proof: 114.2 },
        { label: "2022", year: 2022, proof: 109.0 },
        { label: "2023 · 135th", year: 2023, proof: 108.0 },
        { label: "2024", year: 2024, proof: 108.2 },
        { label: "2025", year: 2025, proof: 109.0 }
      ]
    },
    {
      match: ["booker s", "bookers"],
      label: "Booker's",
      howToId: "The batch code (e.g. 2024-01) and its name are on the front label, with the exact proof and the age statement (years-months-days) just below.",
      batches: [
        { label: "2018-01 Kathleen's", year: 2018, proof: 127.4 },
        { label: "2018-02 Backyard BBQ", year: 2018, proof: 128.8 },
        { label: "2018-03 Kentucky Chew", year: 2018, proof: 126.7 },
        { label: "2018-04 Kitchen Table", year: 2018, proof: 128.0 },
        { label: "2019-01 Teresa's", year: 2019, proof: 125.9 },
        { label: "2019-02 Shiny Barrel", year: 2019, proof: 124.0 },
        { label: "2019-03 Country Ham", year: 2019, proof: 124.7 },
        { label: "2019-04 Beaten Biscuits", year: 2019, proof: 126.1 },
        { label: "2020-01 Granny's", year: 2020, proof: 126.4 },
        { label: "2020-02 Boston", year: 2020, proof: 126.5 },
        { label: "2020-03 Pigskin", year: 2020, proof: 127.3 },
        { label: "2021-01 Donohoe's", year: 2021, proof: 125.3 },
        { label: "2021-02 Tagalong", year: 2021, proof: 127.9 },
        { label: "2021-03 Bardstown", year: 2021, proof: 125.5 },
        { label: "2021-04 Noe Strangers", year: 2021, proof: 124.4 },
        { label: "2022-01 Ronnie's", year: 2022, proof: 124.3 },
        { label: "2022-02 The Lumberyard", year: 2022, proof: 124.8 },
        { label: "2022-03 Kentucky Tea", year: 2022, proof: 126.5 },
        { label: "2022-04 Pinkie's", year: 2022, proof: 122.4 },
        { label: "2023-01 Charlie's", year: 2023, proof: 126.6 },
        { label: "2023-02 Apprentice", year: 2023, proof: 125.5 },
        { label: "2023-03 Mighty Fine", year: 2023, proof: 126.6 },
        { label: "2023-04 The Storyteller", year: 2023, proof: 127.8 },
        { label: "2024-01 Springfield", year: 2024, proof: 124.5 },
        { label: "2024-02 The Beam House", year: 2024, proof: 124.6 },
        { label: "2024-03 Master Distiller's", year: 2024, proof: 130.3 },
        { label: "2024-04 Jimmy's", year: 2024, proof: 125.8 },
        { label: "2025-01 Barry's", year: 2025, proof: 125.7 },
        { label: "2025-02 By The Pond", year: 2025, proof: 125.8 },
        { label: "2025-03 Jerry's", year: 2025, proof: 124.7 },
        { label: "2025-04 Phantom Pipes", year: 2025, proof: 126.4 }
      ]
    },
    {
      match: ["george t stagg", "gts"],
      label: "George T. Stagg",
      howToId: "BTAC labels don't print the year on the front — match the unique annual proof above. To confirm, read the laser code on the glass. " + BT_LASER_CODE,
      // Not released in 2021 (no batch met the profile). 2005 had multiple lots.
      batches: [
        { label: "2002", year: 2002, proof: 137.6 }, { label: "2003", year: 2003, proof: 142.7 },
        { label: "2004", year: 2004, proof: 129.0 }, { label: "2005", year: 2005, proof: 141.2 },
        { label: "2006", year: 2006, proof: 140.6 }, { label: "2007", year: 2007, proof: 144.8 },
        { label: "2008", year: 2008, proof: 141.8 }, { label: "2009", year: 2009, proof: 141.4 },
        { label: "2010", year: 2010, proof: 143.0 }, { label: "2011", year: 2011, proof: 142.6 },
        { label: "2012", year: 2012, proof: 142.8 }, { label: "2013", year: 2013, proof: 128.2 },
        { label: "2014", year: 2014, proof: 138.1 }, { label: "2015", year: 2015, proof: 138.2 },
        { label: "2016", year: 2016, proof: 144.1 }, { label: "2017", year: 2017, proof: 129.2 },
        { label: "2018", year: 2018, proof: 124.9 }, { label: "2019", year: 2019, proof: 116.9 },
        { label: "2020", year: 2020, proof: 130.4 }, { label: "2022", year: 2022, proof: 138.7 },
        { label: "2023", year: 2023, proof: 135.0 }, { label: "2024", year: 2024, proof: 136.1 },
        { label: "2025", year: 2025, proof: 142.8 }
      ]
    },
    {
      // NOTE: do not match "w l w" — it substring-matches "W L Weller ..." and
      // hijacked every standard W.L. Weller bottle into this BTAC line.
      match: ["william larue weller", "william larue", "wlw"],
      label: "William Larue Weller",
      howToId: "The year isn't on the front — match the annual proof above, or read the glass laser code. " + BT_LASER_CODE,
      batches: [
        { label: "2005", year: 2005, proof: 121.9 }, { label: "2006", year: 2006, proof: 129.9 },
        { label: "2007", year: 2007, proof: 117.9 }, { label: "2008", year: 2008, proof: 125.3 },
        { label: "2009", year: 2009, proof: 134.8 }, { label: "2010", year: 2010, proof: 126.6 },
        { label: "2011", year: 2011, proof: 133.5 }, { label: "2012", year: 2012, proof: 123.4 },
        { label: "2013", year: 2013, proof: 136.2 }, { label: "2014", year: 2014, proof: 140.2 },
        { label: "2015", year: 2015, proof: 134.6 }, { label: "2016", year: 2016, proof: 135.4 },
        { label: "2017", year: 2017, proof: 128.2 }, { label: "2018", year: 2018, proof: 125.7 },
        { label: "2019", year: 2019, proof: 128.0 }, { label: "2020", year: 2020, proof: 134.5 },
        { label: "2021", year: 2021, proof: 125.3 }, { label: "2022", year: 2022, proof: 124.7 },
        { label: "2023", year: 2023, proof: 133.6 }, { label: "2024", year: 2024, proof: 125.8 },
        { label: "2025", year: 2025, proof: 129.0 }
      ]
    },
    {
      match: ["thomas h handy", "thomas handy"],
      label: "Thomas H. Handy",
      howToId: "Handy's proof is fairly steady year to year, so the glass laser code is the surest way to date it. " + BT_LASER_CODE,
      batches: [
        { label: "2006", year: 2006, proof: 132.7 }, { label: "2007", year: 2007, proof: 134.8 },
        { label: "2008", year: 2008, proof: 127.5 }, { label: "2009", year: 2009, proof: 129.0 },
        { label: "2010", year: 2010, proof: 126.9 }, { label: "2011", year: 2011, proof: 128.6 },
        { label: "2012", year: 2012, proof: 132.4 }, { label: "2013", year: 2013, proof: 128.4 },
        { label: "2014", year: 2014, proof: 129.2 }, { label: "2015", year: 2015, proof: 126.9 },
        { label: "2016", year: 2016, proof: 126.2 }, { label: "2017", year: 2017, proof: 127.2 },
        { label: "2018", year: 2018, proof: 128.8 }, { label: "2019", year: 2019, proof: 125.7 },
        { label: "2020", year: 2020, proof: 129.0 }, { label: "2021", year: 2021, proof: 129.5 },
        { label: "2022", year: 2022, proof: 130.9 }, { label: "2023", year: 2023, proof: 124.9 },
        { label: "2024", year: 2024, proof: 127.2 }, { label: "2025", year: 2025, proof: 129.8 }
      ]
    },
    {
      match: ["eagle rare 17"],
      label: "Eagle Rare 17",
      howToId: "Proof tells the era only: 90 = 2005–2017, 101 = 2018 on. To pin the exact year, read the glass laser code. " + BT_LASER_CODE,
      batches: [
        { label: "2005", year: 2005, proof: 90 }, { label: "2006", year: 2006, proof: 90 },
        { label: "2007", year: 2007, proof: 90 }, { label: "2008", year: 2008, proof: 90 },
        { label: "2009", year: 2009, proof: 90 }, { label: "2010", year: 2010, proof: 90 },
        { label: "2011", year: 2011, proof: 90 }, { label: "2012", year: 2012, proof: 90 },
        { label: "2013", year: 2013, proof: 90 }, { label: "2014", year: 2014, proof: 90 },
        { label: "2015", year: 2015, proof: 90 }, { label: "2016", year: 2016, proof: 90 },
        { label: "2017", year: 2017, proof: 90 }, { label: "2018", year: 2018, proof: 101 },
        { label: "2019", year: 2019, proof: 101 }, { label: "2020", year: 2020, proof: 101 },
        { label: "2021", year: 2021, proof: 101 }, { label: "2022", year: 2022, proof: 101 },
        { label: "2023", year: 2023, proof: 101 }, { label: "2024", year: 2024, proof: 101 },
        { label: "2025", year: 2025, proof: 101 }
      ]
    },
    {
      // Bottles are usually named "Colonel E.H. Taylor, Jr. Barrel Proof" — the
      // "Jr." sits mid-name, so match both with and without it.
      match: ["taylor barrel proof", "taylor jr barrel proof", "e h taylor barrel proof", "e h taylor jr barrel proof", "eht barrel proof"],
      label: "E.H. Taylor Barrel Proof",
      howToId: "Proofs repeat across years, so decode the bottling date from the glass. " + BT_LASER_CODE + " EHT Barrel Proof is bottled once a year, so the code's year = your batch.",
      batches: [
        { label: "Batch 1", year: 2012, proof: 134.5 },
        { label: "Batch 2", year: 2013, proof: 135.4 },
        { label: "Batch 3", year: 2014, proof: 129.0 },
        { label: "Batch 4", year: 2015, proof: 127.2 },
        { label: "Batch 5", year: 2016, proof: 127.5 },
        { label: "Batch 6", year: 2017, proof: 128.1 },
        { label: "Batch 7", year: 2018, proof: 129.7 },
        { label: "Batch 8", year: 2019, proof: 129.3 },
        { label: "Batch 9", year: 2020, proof: 130.3 },
        { label: "Batch 10", year: 2021, proof: 127.3 },
        { label: "Batch 11", year: 2022, proof: 129.0 },
        { label: "Batch 12", year: 2023, proof: 131.1 },
        { label: "Batch 13", year: 2024, proof: 127.3 },
        { label: "Batch 14", year: 2025, proof: 127.3 }
      ]
    },
    {
      match: ["straight from the barrel"],
      label: "Blanton's Straight From The Barrel",
      perBarrel: true,
      howToId: "Every bottle is a unique single barrel — no batch number. Read the hand-written label: dump date (first line, M-D-YY), Barrel No., Warehouse (always H), Rick No., Bottle No., and the exact barrel proof (~125–140). Log the dump date + barrel # + proof to make yours unique."
    },
    {
      match: ["van winkle", "pappy"],
      label: "Van Winkle (Pappy / Old Rip)",
      howToId: "No vintage year on the front, and each expression's proof is fixed (above). For the release year, read the laser code on the glass (back, below the label) — the 2-digit year segment is the bottling year (≈ the release). Pre-2007 bottles: date by glass tint and 'Lawrenceburg' vs 'Frankfort' on the label.",
      batches: [
        { label: "Old Rip Van Winkle 10 Year", proof: 107 },
        { label: "Special Reserve 'Lot B' 12 Year", proof: 90.4 },
        { label: "Pappy Van Winkle 15 Year", proof: 107 },
        { label: "Pappy Van Winkle 20 Year", proof: 90.4 },
        { label: "Pappy Van Winkle 23 Year", proof: 95.6 },
        { label: "Family Reserve Rye 13 Year", proof: 95.6 }
      ]
    },
    {
      match: ["old fitzgerald"],
      label: "Old Fitzgerald Bottled-in-Bond",
      howToId: "Every release is 100 proof (bottled-in-bond) — the AGE on the front (e.g. 19 Year) is the differentiator, confirmed by the back label's distilled/bottled seasons. Label color: Spring = green, Fall = black.",
      batches: [
        { label: "Spring 2018 · 11 yr", year: 2018, proof: 100 }, { label: "Fall 2018 · 9 yr", year: 2018, proof: 100 },
        { label: "Spring 2019 · 13 yr", year: 2019, proof: 100 }, { label: "Fall 2019 · 15 yr", year: 2019, proof: 100 },
        { label: "Spring 2020 · 9 yr", year: 2020, proof: 100 }, { label: "Fall 2020 · 14 yr", year: 2020, proof: 100 },
        { label: "Spring 2021 · 8 yr", year: 2021, proof: 100 }, { label: "Fall 2021 · 11 yr", year: 2021, proof: 100 },
        { label: "Spring 2022 · 17 yr", year: 2022, proof: 100 }, { label: "Fall 2022 · 19 yr", year: 2022, proof: 100 },
        { label: "Spring 2023 · 10 yr", year: 2023, proof: 100 }, { label: "Fall 2023 · 8 yr", year: 2023, proof: 100 },
        { label: "Spring 2024 · 10 yr", year: 2024, proof: 100 }, { label: "Fall 2024 · 11 yr", year: 2024, proof: 100 },
        { label: "Spring 2025 · 9 yr", year: 2025, proof: 100 }, { label: "Fall 2025 · 11 yr", year: 2025, proof: 100 }
      ]
    },
    {
      matchRe: /michter.*?\b20\s*(?:yr|year)/,
      label: "Michter's 20 Year",
      howToId: "Each release is a hand-selected small batch proofed to a constant 114.2 — so the vintage/batch code on the label (e.g. 19H1440), not the proof, identifies the release.",
      batches: [
        { label: "2016", year: 2016, proof: 114.2 }, { label: "2018", year: 2018, proof: 114.2 },
        { label: "2019", year: 2019, proof: 114.2 }, { label: "2021", year: 2021, proof: 114.2 },
        { label: "2022", year: 2022, proof: 114.2 }, { label: "2024", year: 2024, proof: 114.2 }
      ]
    },
    {
      matchRe: /michter.*?\b25\s*(?:yr|year)/,
      label: "Michter's 25 Year",
      howToId: "Proofed to a constant 116.2 each release; the vintage/batch code on the label identifies which year.",
      batches: [
        { label: "2017", year: 2017, proof: 116.2 }, { label: "2020", year: 2020, proof: 116.2 },
        { label: "2023", year: 2023, proof: 116.2 }
      ]
    },
    {
      matchRe: /michter.*?\b10\s*(?:yr|year)/,
      label: "Michter's 10 Year",
      perBarrel: true,
      howToId: "Single barrel — each bottling is one barrel, identified by the barrel/batch code on the back label. Bottled at a fixed 94.4 proof (Bourbon) or 92.8 proof (Rye)."
    },
    {
      match: ["old forester birthday", "birthday bourbon"],
      label: "Old Forester Birthday Bourbon",
      howToId: "Vintage-dated — the release year is on the front label. Age and proof change every year (shown above).",
      batches: [
        { label: "2005 · 12 yr", year: 2005, proof: 96 }, { label: "2006 · 13 yr", year: 2006, proof: 96 },
        { label: "2007 · 12 yr", year: 2007, proof: 94 }, { label: "2008 · 12 yr", year: 2008, proof: 94 },
        { label: "2009 · 12 yr", year: 2009, proof: 97 }, { label: "2010 · 12 yr", year: 2010, proof: 95 },
        { label: "2011 · 12 yr", year: 2011, proof: 98 }, { label: "2012 · 12 yr", year: 2012, proof: 97 },
        { label: "2013 · 12 yr", year: 2013, proof: 98 }, { label: "2014 · 12 yr", year: 2014, proof: 97 },
        { label: "2015 · 12 yr", year: 2015, proof: 100 }, { label: "2016 · 12 yr", year: 2016, proof: 97 },
        { label: "2017 · 12 yr", year: 2017, proof: 96 }, { label: "2018 · 12 yr", year: 2018, proof: 101 },
        { label: "2019 · 11 yr", year: 2019, proof: 105 }, { label: "2020 · 10 yr", year: 2020, proof: 98 },
        { label: "2021 · 12 yr", year: 2021, proof: 104 }, { label: "2022 · 11 yr", year: 2022, proof: 96 },
        { label: "2023 · 12 yr", year: 2023, proof: 96 }, { label: "2024 · 12 yr", year: 2024, proof: 107 },
        { label: "2025 · 12 yr", year: 2025, proof: 92 }
      ]
    },
    {
      match: ["parker s heritage", "parkers heritage"],
      label: "Parker's Heritage Collection",
      howToId: "Every edition is a one-off named whiskey — the type, age, and proof on the label pin the year, and later bottles print the edition number (e.g. “16th Edition”) outright.",
      batches: [
        { label: "Ed. 1 · Cask Strength", year: 2007 },
        { label: "Ed. 2 · 27 yr", year: 2008, proof: 96 },
        { label: "Ed. 3 · Golden Anniv.", year: 2009, proof: 100 },
        { label: "Ed. 4 · Wheated 10 yr", year: 2010, proof: 127.8 },
        { label: "Ed. 5 · Cognac Finish", year: 2011, proof: 100 },
        { label: "Ed. 6 · Blend of Mashbills", year: 2012 },
        { label: "Ed. 7 · Promise of Hope", year: 2013, proof: 96 },
        { label: "Ed. 8 · Wheat Whiskey", year: 2014, proof: 127.4 },
        { label: "Ed. 9 · Malt 8 yr", year: 2015, proof: 108 },
        { label: "Ed. 10 · 24 yr BiB", year: 2016, proof: 100 },
        { label: "Ed. 11 · Single Barrel 11 yr", year: 2017, proof: 122 },
        { label: "Ed. 12 · Curaçao Finish", year: 2018, proof: 110 },
        { label: "Ed. 13 · Heavy Char Rye", year: 2019, proof: 105 },
        { label: "Ed. 14 · Heavy Char Bourbon", year: 2020, proof: 120 },
        { label: "Ed. 15 · Heavy Char Wheat", year: 2021, proof: 122 },
        { label: "Ed. 16 · Double Barreled", year: 2022, proof: 132.2 },
        { label: "Ed. 17 · Rye 10 yr", year: 2023, proof: 128.8 },
        { label: "Ed. 18 · Cognac Malt 14 yr", year: 2024, proof: 107 },
        { label: "Ed. 19 · Am. Whiskey Blend", year: 2025, proof: 122.5 }
      ]
    },
    {
      // Order matters: the rye line must sit before the bourbon line, which
      // excludes rye/sour mash to claim the rest of the toasted family.
      matchRe: /michter.*toast.*rye|michter.*rye.*toast/,
      label: "Michter's Toasted Barrel Rye",
      howToId: "Bottled at barrel strength, so the exact proof is printed on YOUR bottle (typically 107–112) — releases came in 2017, 2020, and 2023; the batch code on the label gives the year.",
      batches: [
        { label: "2017", year: 2017 },
        { label: "2020", year: 2020 },
        { label: "2023", year: 2023 }
      ]
    },
    {
      matchRe: /michter.*toast/,
      exclude: ["rye", "sour mash"],
      label: "Michter's Toasted Barrel Bourbon",
      howToId: "Always 91.4 proof, so the release is identified by the batch code on the bottle (e.g. 24H2817 → 2024).",
      batches: [
        { label: "2014", year: 2014, proof: 91.4 },
        { label: "2015", year: 2015, proof: 91.4 },
        { label: "2018", year: 2018, proof: 91.4 },
        { label: "2021", year: 2021, proof: 91.4 },
        { label: "2024", year: 2024, proof: 91.4 }
      ]
    },
    {
      // Stave-code names also contain "cask strength", so this sits before the
      // Cask Strength line.
      matchRe: /maker.*(wood finish|rc6|se4|fae|brt|bep|heart release|keepers release|stewards)/,
      label: "Maker's Mark Wood Finishing Series",
      howToId: "The stave code (RC6, SE4xPR5, FAE-01/02, BRT-01/02, BEP) or release name (The Heart / Keepers / Stewards) is on the front label with the year; these are cask strength, so your bottle's exact proof is in its alcohol statement.",
      batches: [
        { label: "RC6", year: 2019, proof: 108.2 },
        { label: "SE4 x PR5", year: 2020, proof: 110.8 },
        { label: "FAE-01", year: 2021, proof: 110.6 },
        { label: "FAE-02", year: 2021, proof: 109.1 },
        { label: "BRT-01", year: 2022, proof: 109.4 },
        { label: "BRT-02", year: 2022, proof: 109.4 },
        { label: "BEP", year: 2023, proof: 110.7 },
        { label: "The Heart Release", year: 2024, proof: 111.7 },
        { label: "The Keepers Release", year: 2025, proof: 109.2 },
        { label: "The Stewards Release", year: 2026 }
      ]
    },
    {
      matchRe: /maker.*cask/,
      label: "Maker's Mark Cask Strength",
      howToId: "Read the “BATCH NO. XX-YY” box on the front label (XX = year, YY = batch that year) and the exact proof in the label's alcohol statement. Batches run 108–114 proof and aren't centrally catalogued, so log your label's code + proof even if it isn't listed here.",
      batches: [
        { label: "14-01", year: 2014, proof: 113.2 },
        { label: "15-01", year: 2015, proof: 111.3 }, { label: "15-02", year: 2015, proof: 111.6 }, { label: "15-03", year: 2015, proof: 111.4 },
        { label: "15-04", year: 2015, proof: 110.4 }, { label: "15-05", year: 2015, proof: 110.3 },
        { label: "16-01", year: 2016, proof: 112.2 }, { label: "16-02", year: 2016, proof: 111.5 }, { label: "16-03", year: 2016, proof: 111.6 },
        { label: "17-01", year: 2017, proof: 110.9 }, { label: "17-02", year: 2017, proof: 110.7 },
        { label: "18-01", year: 2018, proof: 111.5 },
        { label: "19-01", year: 2019 }, { label: "19-02", year: 2019, proof: 109.6 },
        { label: "20-01", year: 2020 }, { label: "20-02", year: 2020, proof: 110.4 }, { label: "20-03", year: 2020 }, { label: "20-05", year: 2020 },
        { label: "21-01", year: 2021, proof: 110.6 }, { label: "21-02", year: 2021, proof: 110.4 },
        { label: "22-01", year: 2022 }, { label: "22-02", year: 2022, proof: 110.7 },
        { label: "23-01", year: 2023, proof: 110.0 }, { label: "23-02", year: 2023, proof: 109.6 }, { label: "23-03", year: 2023 }, { label: "23-05", year: 2023 },
        { label: "24-01", year: 2024 }, { label: "24-02", year: 2024 },
        { label: "25-01", year: 2025, proof: 112.6 }
      ]
    },
    {
      match: ["master s keep", "masters keep"],
      label: "Wild Turkey Master's Keep",
      howToId: "Each release has a unique name on the label, so name + proof identifies it outright — only Decades needs the batch number checked (0001 vs 0002, both 104 proof).",
      batches: [
        { label: "17 Year", year: 2015, proof: 86.8 },
        { label: "Decades", year: 2017, proof: 104 },
        { label: "1894 (AUS only)", year: 2017, proof: 90 },
        { label: "Revival", year: 2018, proof: 101 },
        { label: "Cornerstone Rye", year: 2019, proof: 109 },
        { label: "Bottled in Bond 17 yr", year: 2020, proof: 100 },
        { label: "One", year: 2021, proof: 101 },
        { label: "Unforgotten", year: 2022, proof: 105 },
        { label: "Voyage", year: 2023, proof: 106 },
        { label: "Triumph Rye", year: 2024, proof: 104 },
        { label: "Beacon (final)", year: 2025, proof: 118 }
      ]
    },
    {
      matchRe: /russell.*13/,
      label: "Russell's Reserve 13 Year",
      howToId: "Batches 1–5 share identical 114.8-proof labels — tell them apart by the laser code near the bottle's base: LL/JD = B1 (Apr ’21), LL/JL = B2 (Dec ’21), LL/KE = B3 (’22), LL/LC = B4 (Mar ’23), LL/LE = B5 (May ’23). From 2025 the season/year and a unique barrel proof are printed on the label.",
      batches: [
        { label: "Batch 1", year: 2021, proof: 114.8 },
        { label: "Batch 2", year: 2021, proof: 114.8 },
        { label: "Batch 3", year: 2022, proof: 114.8 },
        { label: "Batch 4", year: 2023, proof: 114.8 },
        { label: "Batch 5", year: 2023, proof: 114.8 },
        { label: "Batch 6", year: 2025, proof: 123.8 },
        { label: "Batch 7", year: 2026, proof: 121.2 }
      ]
    },
    {
      matchRe: /russell.*15/,
      label: "Russell's Reserve 15 Year",
      howToId: "One release so far — the 2024 debut at 117.2 proof (non-chill filtered, Camp Nelson barrels).",
      batches: [
        { label: "2024", year: 2024, proof: 117.2 }
      ]
    },
    {
      matchAll: ["heaven hill", "heritage"],
      label: "Heaven Hill Heritage Collection",
      howToId: "Identified by year + age statement on the label (each edition is a different whiskey); labels also carry production date, rickhouse, and floor.",
      batches: [
        { label: "2022 · 17 yr Bourbon", year: 2022, proof: 118.2 },
        { label: "2023 · 20 yr Corn", year: 2023, proof: 115 },
        { label: "2024 · 18 yr Bourbon", year: 2024, proof: 120 },
        { label: "2025 · 19 yr Wheat", year: 2025, proof: 100 },
        { label: "2026 · 22 yr Bourbon", year: 2026, proof: 129.2 }
      ]
    },
    {
      match: ["coy hill"],
      label: "Jack Daniel's Coy Hill High Proof",
      perBarrel: true,
      howToId: "Per-barrel and uncut from the top ricks of Coy Hill barrelhouses 8 and 13 — proofs ran 137.4 up to 148.3 (JD's highest ever). Your bottle's neck label shows the barrelhouse, rick, barrel number, bottling date, and its exact proof — log those."
    },
    {
      // The age-stated 10/12/14-year Barrel Proof releases are separate batched
      // products — keep them out of this per-barrel line.
      matchAll: ["daniel", "barrel proof"],
      exclude: ["coy hill", "tanyard", "10yr", "10 yr", "12yr", "12 yr", "14yr", "14 yr"],
      label: "Jack Daniel's Single Barrel Barrel Proof",
      perBarrel: true,
      howToId: "Every bottle is one uncut barrel, typically 125–140 proof. The neck label carries the rick number, barrel number, and bottling date, plus your bottle's exact proof — log those to make yours unique."
    },
    {
      // Must sit after William Larue Weller (BTAC) in this list.
      match: ["weller"],
      exclude: ["william larue", "daniel weller"],
      label: "Weller",
      howToId: "The expression name and its fixed proof are on the front label. To date a bottle, read the Buffalo Trace laser code. " + BT_LASER_CODE,
      batches: [
        { label: "Special Reserve", proof: 90 },
        { label: "Antique 107", proof: 107 },
        { label: "12 Year", proof: 90 },
        { label: "Full Proof", proof: 114 },
        { label: "C.Y.P.B.", proof: 95 },
        { label: "Single Barrel", proof: 97 },
        { label: "Millennium", proof: 99 }
      ]
    },
    {
      // Names like "Old Cassidy by Rare Character" must hit this BEFORE the
      // Rare Character catch-all below.
      match: ["old cassidy"],
      perBarrel: true,
      label: "Old Cassidy (Rare Character)",
      howToId: "Rare Character's top-shelf batched line from special parcels. Log the batch/bottle details from the label — age, proof, and parcel notes vary per release."
    },
    {
      match: ["brook hill"],
      perBarrel: true,
      label: "Brook Hill (Rare Character)",
      howToId: "Every Brook Hill is a well-aged cask-strength Kentucky single barrel (roughly 8–20 yrs), and most carry a barrel NICKNAME (e.g. “Villain”, “Scarlet”). Log the nickname, age, exact proof, and who selected it — that combination is your bottle."
    },
    {
      match: ["rare character"],
      perBarrel: true,
      label: "Rare Character (Single Barrel)",
      howToId: "Almost everything is a unique cask-strength single barrel (~110–135 proof, some hazmat). Read the label: “Selected by ___” (store/club), the barrel code like RIO-300 or TRT-07 (the 3-letter prefix = mash bill + source state, decoded on rarecharacterwhiskey.com/barrelbreakdown), age in years AND months, exact proof to decimals, mash bill, and distilled/bottled dates. For RCLR Limited Release blends, log the batch number instead."
    },
    {
      matchRe: /old forester.*117|117 series/,
      label: "Old Forester 117 Series",
      howToId: "Distillery-exclusive 375 ml series — the release name is on the front label, and repeated expressions (High Angels' Share, Extra Extra Old, Bottled in Bond) carry a Batch 00X number.",
      batches: [
        { label: "High Angels' Share B1", year: 2021, proof: 110 },
        { label: "Warehouse K", year: 2021, proof: 110 },
        { label: "1910 Extra Old", year: 2022, proof: 93 },
        { label: "Whiskey Row Fire", year: 2022, proof: 100 },
        { label: "1910 Extra Extra Old B1", year: 2022, proof: 93 },
        { label: "Warehouse H", year: 2023, proof: 98 },
        { label: "Bottled in Bond", year: 2023, proof: 100 },
        { label: "Scotch Cask Finish", year: 2023, proof: 93 },
        { label: "High Angels' Share B2", year: 2024, proof: 110 },
        { label: "Rum Finish", year: 2024, proof: 95 },
        { label: "Warehouse I", year: 2024, proof: 95 },
        { label: "High Angels' Share B3", year: 2025, proof: 110 },
        { label: "Bottled in Bond Rye", year: 2025, proof: 100 },
        { label: "1910 Extra Extra Old B2", year: 2025, proof: 93 },
        { label: "Prohibition Era Still Proof", year: 2025, proof: 130 },
        { label: "High Angels' Share Rye", year: 2026, proof: 110 }
      ]
    },
    {
      // The aged limiteds only — Knob Creek 9/12/Single Barrel Reserve are
      // fixed-proof core products and stay out of this line.
      matchRe: /knob creek.*\b(15|18|21|2001)\b|knob creek.*(15|18|21)\s*y/,
      label: "Knob Creek Aged Limiteds",
      howToId: "All bottled at 100 proof — the age statement plus the KC batch code on the label (KC001/KC002/KC003) pins the release; the 2001 vintage prints Batch 1/2/3.",
      batches: [
        { label: "2001 LE · Batch 1", year: 2016, proof: 100 },
        { label: "2001 LE · Batch 2", year: 2016, proof: 100 },
        { label: "2001 LE · Batch 3", year: 2016, proof: 100 },
        { label: "15 Yr · KC001", year: 2020, proof: 100 },
        { label: "15 Yr · KC002", year: 2021, proof: 100 },
        { label: "18 Yr · debut", year: 2022, proof: 100 },
        { label: "18 Yr · KC002", year: 2023, proof: 100 },
        { label: "18 Yr · KC003", year: 2024, proof: 100 },
        { label: "21 Yr", year: 2025, proof: 100 }
      ]
    },
    {
      matchRe: /1792.*(aged twelve|12\s*y)/,
      label: "1792 Aged Twelve Years",
      howToId: "One small batch each summer since 2019, always 96.6 proof — the label doesn't change, so read the laser-etched bottling date code on the glass for the year.",
      batches: [
        { label: "2019", year: 2019, proof: 96.6 },
        { label: "2020", year: 2020, proof: 96.6 },
        { label: "2021", year: 2021, proof: 96.6 },
        { label: "2022", year: 2022, proof: 96.6 },
        { label: "2023", year: 2023, proof: 96.6 },
        { label: "2024", year: 2024, proof: 96.6 },
        { label: "2025", year: 2025, proof: 96.6 }
      ]
    }
  ];

  function norm(value) {
    return " " + String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  }

  // Which curated batch line (if any) a bottle belongs to.
  function batchLineFor(bottle) {
    const raw = String(bottle && bottle.name || "").toLowerCase();
    const hay = norm(bottle && bottle.name);
    const has = (m) => hay.indexOf(norm(m).trim()) !== -1;
    for (const line of BATCH_LINES) {
      if (line.exclude && line.exclude.some(has)) continue;
      if (line.matchRe && line.matchRe.test(raw)) return line;
      if (line.matchAll && line.matchAll.length && line.matchAll.every(has)) return line;
      if (line.match && line.match.some(has)) return line;
    }
    return null;
  }

  // A batch entry is either a plain string ("2024") or { label, proof, year }.
  function batchLabel(batch) {
    return batch && typeof batch === "object" ? batch.label : batch;
  }
  function batchProof(batch) {
    return batch && typeof batch === "object" && Number.isFinite(batch.proof) ? batch.proof : null;
  }
  function batchYear(batch) {
    return batch && typeof batch === "object" && batch.year ? batch.year : null;
  }

  // A normalized "line" key so the catalog's many spellings of one release
  // collapse to a single card in the wizard.
  function lineKey(bottle) {
    const line = batchLineFor(bottle);
    if (line) return "line:" + line.label.toLowerCase();
    let n = String((bottle && bottle.name) || "").toLowerCase();
    n = n
      .replace(/\([^)]*\)/g, " ")                              // parentheticals
      .replace(/\b\d+(\.\d+)?\s*(ml|l|liter|litre)\b/g, " ")   // bottle sizes (keep ages)
      .replace(/\b(19|20)\d{2}\b/g, " ")                       // years
      .replace(/\bbatch\s*[a-z]?\d+\b/g, " ")                  // batch codes
      .replace(/\b[a-z]\d{2,3}\b/g, " ")                       // A123-style codes
      .replace(/\b(kentucky|tennessee|straight|bourbon|whiskey|whisky|spirit)\b/g, " ")
      .replace(/\b(store|private|single barrel|barrel|pick|selection|select|hand picked|handpicked|btb|psb)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return n || String((bottle && bottle.id) || "");
  }

  // Is this an open-ended store-pick line (no finite batch list)?
  function isOpenPick(bottle) {
    if (batchLineFor(bottle)) return false;
    const n = norm(bottle && bottle.name);
    return /\bsingle barrel\b|\bstore pick\b|\bprivate\b|\bselection\b|\bhand picked\b|\bbtb\b|\bbarrel select\b/.test(n);
  }

  function lineType(bottle) {
    if (batchLineFor(bottle)) return "batched";
    if (isOpenPick(bottle)) return "pick";
    return "standard";
  }

  // Collapse a list of bottles into one card per release line.
  function collapse(bottles) {
    const map = new Map();
    for (const bottle of bottles) {
      const key = lineKey(bottle);
      let group = map.get(key);
      if (!group) {
        group = { key, rep: bottle, members: [], type: lineType(bottle), line: batchLineFor(bottle) };
        map.set(key, group);
      }
      group.members.push(bottle);
      // Prefer a representative with curated metadata / shorter name.
      if (String(bottle.name).length < String(group.rep.name).length) group.rep = bottle;
    }
    return [...map.values()];
  }

  // ---- Model mutators (operate on state.collection, sync statuses) ---------

  function ensure(state) {
    if (!state.collection || typeof state.collection !== "object") state.collection = {};
    if (!state.statuses || typeof state.statuses !== "object") state.statuses = {};
    return state.collection;
  }

  function entry(state, bottleId) {
    const col = ensure(state);
    return col[bottleId] || null;
  }

  function ownedCount(state, bottleId) {
    const e = entry(state, bottleId);
    return e ? e.count : 0;
  }

  function setCount(state, bottleId, count) {
    const col = ensure(state);
    const c = Math.max(0, Math.round(count));
    if (c <= 0) {
      delete col[bottleId];
      if (state.statuses[bottleId] === "owned") delete state.statuses[bottleId];
      return;
    }
    const prev = col[bottleId] || { count: 0, batches: [], note: "" };
    col[bottleId] = { count: c, batches: prev.batches || [], note: prev.note || "" };
    state.statuses[bottleId] = "owned";
  }

  function toggle(state, bottleId) {
    if (ownedCount(state, bottleId) > 0) setCount(state, bottleId, 0);
    else setCount(state, bottleId, 1);
    return ownedCount(state, bottleId) > 0;
  }

  function setBatches(state, bottleId, batches) {
    const col = ensure(state);
    const clean = Array.from(new Set((batches || []).filter(Boolean)));
    if (!clean.length) {
      if (col[bottleId]) {
        col[bottleId].batches = [];
        if (col[bottleId].count <= 0) setCount(state, bottleId, 0);
      }
      return;
    }
    const prev = col[bottleId] || { count: 0, batches: [], note: "" };
    col[bottleId] = { count: Math.max(prev.count, clean.length), batches: clean, note: prev.note || "" };
    state.statuses[bottleId] = "owned";
  }

  function toggleBatch(state, bottleId, batch) {
    const e = entry(state, bottleId);
    const set = new Set((e && e.batches) || []);
    if (set.has(batch)) set.delete(batch);
    else set.add(batch);
    setBatches(state, bottleId, [...set]);
    return set.has(batch);
  }

  function totals(state) {
    const col = ensure(state);
    let lines = 0;
    let bottles = 0;
    for (const id in col) {
      lines += 1;
      bottles += col[id].count || 0;
    }
    return { lines, bottles };
  }

  global.BarrelCollection = {
    BATCH_LINES,
    batchLineFor,
    batchLabel,
    batchProof,
    batchYear,
    lineKey,
    isOpenPick,
    lineType,
    collapse,
    ownedCount,
    entry,
    setCount,
    toggle,
    setBatches,
    toggleBatch,
    totals
  };
})(typeof window !== "undefined" ? window : globalThis);
