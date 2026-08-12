/**
 * Editorial taxonomy of the open gTLD space. There is no machine-readable
 * category source for TLDs, so this is a curated map — a TLD can sit in more
 * than one bucket (.app is tech, .shop is commerce, .io is tech even though it
 * is technically a ccTLD).
 */

export type CategoryId =
  | "tech"
  | "business"
  | "commerce"
  | "creative"
  | "web"
  | "community"
  | "health"
  | "food"
  | "travel"
  | "education"
  | "realestate"
  | "fun"
  | "crypto"
  | "geo"
  | "adult";

export const CATEGORIES: Array<{ id: CategoryId; label: string }> = [
  { id: "tech", label: "Technology" },
  { id: "business", label: "Business & finance" },
  { id: "commerce", label: "Commerce & retail" },
  { id: "creative", label: "Creative & media" },
  { id: "web", label: "Web & generic" },
  { id: "community", label: "People & community" },
  { id: "health", label: "Health & sport" },
  { id: "food", label: "Food & drink" },
  { id: "travel", label: "Travel" },
  { id: "education", label: "Education & science" },
  { id: "realestate", label: "Real estate & building" },
  { id: "fun", label: "Entertainment & games" },
  { id: "crypto", label: "Crypto & web3" },
  { id: "geo", label: "Cities & regions" },
  { id: "adult", label: "18+" },
];

const MAP: Record<CategoryId, string[]> = {
  tech: [
    "app", "dev", "tech", "technology", "software", "systems", "cloud", "digital",
    "computer", "network", "hosting", "host", "domains", "codes", "code", "data",
    "database", "email", "mail", "chat", "bot", "ai", "io", "sh", "js", "py",
    "engineering", "engineer", "科技", "download", "search", "search", "wiki",
    "security", "safety", "vpn", "server", "cyber", "dat", "tel", "mobi", "web",
    "api", "sql", "git", "npm", "byte", "bit", "hack", "geek", "nerd", "robot",
  ],
  business: [
    "biz", "business", "company", "co", "ltd", "llc", "inc", "gmbh", "srl", "sarl",
    "corp", "agency", "consulting", "management", "marketing", "finance", "financial",
    "capital", "fund", "money", "bank", "insurance", "accountant", "accountants",
    "tax", "legal", "law", "lawyer", "attorney", "expert", "partners", "ventures",
    "holdings", "industries", "enterprises", "solutions", "services", "works",
    "trade", "trading", "market", "exchange", "invest", "investments", "loans",
    "credit", "cash", "salary", "jobs", "career", "careers", "recruitment", "hr",
    "consulting", "associates", "advisor", "office", "team", "group", "global",
  ],
  commerce: [
    "shop", "store", "shopping", "sale", "deals", "discount", "buy", "market",
    "bargains", "cheap", "boutique", "outlet", "supply", "supplies", "wholesale",
    "商店", "商城", "gifts", "delivery", "shoes", "clothing", "fashion", "style",
    "jewelry", "watch", "bike", "auto", "cars", "car", "parts", "furniture",
    "toys", "baby", "kids", "pet", "pets", "garden", "tools", "equipment",
  ],
  creative: [
    "design", "studio", "art", "gallery", "photo", "photography", "photos", "pics",
    "pictures", "graphics", "media", "film", "movie", "video", "tv", "audio",
    "music", "band", "fm", "am", "radio", "show", "theater", "theatre", "dance",
    "ink", "tattoo", "fashion", "style", "creative", "productions", "digital",
    "press", "news", "blog", "review", "reviews", "reviews", "book", "books",
  ],
  web: [
    "com", "net", "org", "info", "site", "online", "website", "web", "page", "link",
    "click", "space", "world", "life", "live", "today", "now", "one", "plus", "pro",
    "xyz", "top", "vip", "zone", "place", "center", "direct", "network", "cc", "ws",
    "name", "me", "us", "cyou", "icu", "bond", "sbs", "rest", "click", "quest",
  ],
  community: [
    "club", "community", "social", "family", "friends", "group", "team", "church",
    "faith", "charity", "ngo", "ong", "foundation", "care", "help", "support",
    "forum", "chat", "dating", "singles", "love", "wedding", "party", "gift",
    "gives", "give", "vote", "voto", "green", "earth", "eco", "bio", "org",
    "lgbt", "gay", "moe", "fans", "fan", "guru", "expert", "ninja", "boss",
  ],
  health: [
    "health", "healthcare", "clinic", "doctor", "dentist", "surgery", "hospital",
    "care", "med", "medical", "pharmacy", "dental", "vet", "fit", "fitness", "gym",
    "yoga", "run", "bike", "ski", "surf", "golf", "soccer", "football", "rugby",
    "tennis", "basketball", "hockey", "sport", "sports", "team", "coach", "life",
    "diet", "beauty", "hair", "spa", "salon", "skin", "wellness", "rehab",
  ],
  food: [
    "food", "restaurant", "cafe", "coffee", "bar", "pub", "beer", "wine", "vin",
    "pizza", "kitchen", "cooking", "recipes", "menu", "catering", "bistro", "eat",
    "farm", "organic", "vodka", "whisky", "rest", "diet", "delivery", "bakery",
  ],
  travel: [
    "travel", "tours", "tour", "vacations", "holiday", "holidays", "flights", "fly",
    "cruise", "cruises", "hotel", "hotels", "hostel", "camp", "camping", "rentals",
    "voyage", "reise", "reisen", "viajes", "taxi", "cab", "car", "bus", "train",
    "airport", "guide", "map", "maps", "place", "city", "town", "beach", "island",
  ],
  education: [
    "edu", "education", "school", "college", "university", "academy", "institute",
    "courses", "course", "training", "study", "student", "teacher", "class",
    "lessons", "learn", "science", "research", "lab", "engineering", "math",
    "mba", "degree", "diploma", "phd", "prof", "library", "book", "books", "wiki",
  ],
  realestate: [
    "estate", "realestate", "realty", "properties", "property", "homes", "house",
    "haus", "immo", "immobilien", "apartments", "rent", "rentals", "lease", "land",
    "build", "builders", "building", "construction", "contractors", "architect",
    "design", "garden", "furniture", "kitchen", "bathroom", "repair", "plumbing",
    "roofing", "solar", "energy", "electric", "town", "village", "city",
  ],
  fun: [
    "fun", "games", "game", "play", "casino", "bet", "bingo", "poker", "lotto",
    "toys", "party", "events", "event", "tickets", "show", "cool", "rocks", "lol",
    "wtf", "fyi", "buzz", "joy", "hot", "best", "win", "boo", "gg", "quest",
    "esports", "stream", "gg", "tube", "media", "video", "movie", "fans",
  ],
  crypto: [
    "crypto", "bitcoin", "btc", "eth", "nft", "dao", "chain", "blockchain", "coin",
    "token", "wallet", "defi", "web3", "exchange", "finance", "money", "mint",
  ],
  geo: [
    "berlin", "nyc", "london", "paris", "tokyo", "moscow", "vegas", "miami",
    "barcelona", "madrid", "amsterdam", "wien", "koeln", "cologne", "hamburg",
    "bayern", "saarland", "ruhr", "brussels", "budapest", "roma", "milano",
    "quebec", "boston", "capetown", "durban", "joburg", "melbourne", "sydney",
    "taipei", "osaka", "kyoto", "nagoya", "okinawa", "ryukyu", "yokohama",
    "abudhabi", "dubai", "istanbul", "krakow", "warszawa", "swiss", "tirol",
    "scot", "wales", "cymru", "irish", "eus", "gal", "cat", "alsace", "bzh",
    "corsica", "africa", "asia", "eu", "lat", "nrw", "bar", "vlaanderen",
    "frl", "gent", "stockholm", "helsinki", "zuerich", "basel", "luxe",
  ],
  adult: ["adult", "porn", "sex", "sexy", "xxx", "cam", "dating", "singles", "tube"],
};

const INDEX = new Map<string, CategoryId[]>();
for (const [cat, tlds] of Object.entries(MAP) as Array<[CategoryId, string[]]>) {
  for (const tld of tlds) {
    const list = INDEX.get(tld) ?? [];
    if (!list.includes(cat)) list.push(cat);
    INDEX.set(tld, list);
  }
}

export type TldKind = "generic" | "country" | "geo" | "idn" | "multi" | "brand";

/** Every ccTLD that the world uses as a generic namespace rather than a country one. */
const GEO_SET = new Set(MAP.geo);

export function classify(tld: string, sellable: boolean): {
  kind: TldKind;
  categories: CategoryId[];
} {
  const last = tld.split(".").pop()!;
  const categories = INDEX.get(last) ?? [];

  let kind: TldKind;
  if (tld.includes(".")) kind = "multi";
  else if (tld.startsWith("xn--")) kind = "idn";
  else if (tld.length === 2) kind = "country";
  else if (GEO_SET.has(tld)) kind = "geo";
  else if (sellable) kind = "generic";
  // no registrar sells it and it is not a country code: brand / restricted registry
  else kind = "brand";

  return { kind, categories };
}

export const KIND_LABEL: Record<TldKind, string> = {
  generic: "Generic (gTLD)",
  country: "Country (ccTLD)",
  geo: "City / region",
  idn: "Non-Latin (IDN)",
  multi: "Multi-level (.co.uk)",
  brand: "Brand / restricted",
};
