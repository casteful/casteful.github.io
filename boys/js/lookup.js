// ============================================================
// Film metadata lookup — Wikipedia + Wikidata (free, no API keys)
//
// The user only enters the film title (+ release year).
// Everything else is fetched automatically:
//   1. Search uk + en Wikipedia and Wikidata labels for candidates
//   2. Resolve each candidate to its Wikidata item (QID)
//   3. Read structured claims:
//        P577 release year      P57  directors
//        P495 country of origin P136 genres
//        P345  IMDb ID          P18  poster image
//   4. Labels resolved in Ukrainian (fallback English)
//
// All APIs are CORS-enabled (origin=*) and keyless.
// ============================================================

const WIKI_API = (lang) => `https://${lang}.wikipedia.org/w/api.php`;
const ORIGIN = "&origin=*";

async function apiGet(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// is the title Latin script (search EN wiki too) or Cyrillic (search UK wiki)?
function isLatin(s) {
  return /^[A-Za-z0-9'"“”’\-:.,!?\s]+$/.test(s);
}

// ---------- candidate search across uk/en Wikipedia + Wikidata ----------
export async function searchFilms(title, year) {
  title = String(title || "").trim();
  year = year ? String(year).trim() : "";
  if (!title) return [];
  const q = year ? `${title} ${year}` : title;

  const jobs = [];

  // uk Wikipedia always (club titles are Ukrainian)
  jobs.push(
    apiGet(`${WIKI_API("uk")}?action=query&list=search&srlimit=8&srsearch=${encodeURIComponent(q)}${ORIGIN}&format=json`)
      .then((d) => (d?.query?.search || []).map((s) => ({ source: "ukwiki", pageTitle: s.title, snippet: s.snippet || "" })))
      .catch(() => [])
  );

  // en Wikipedia for Latin titles
  if (isLatin(title)) {
    jobs.push(
      apiGet(`${WIKI_API("en")}?action=query&list=search&srlimit=8&srsearch=${encodeURIComponent(q)}${ORIGIN}&format=json`)
        .then((d) => (d?.query?.search || []).map((s) => ({ source: "enwiki", pageTitle: s.title, snippet: s.snippet || "" })))
        .catch(() => [])
    );
  } else {
    // Cyrillic title — also try ru Wikipedia (some films only have an ru article;
    // displayed data still resolves to Ukrainian labels/links via Wikidata)
    jobs.push(
      apiGet(`${WIKI_API("ru")}?action=query&list=search&srlimit=8&srsearch=${encodeURIComponent(q)}${ORIGIN}&format=json`)
        .then((d) => (d?.query?.search || []).map((s) => ({ source: "ruwiki", pageTitle: s.title, snippet: s.snippet || "" })))
        .catch(() => [])
    );
  }

  // Wikidata label/alias search (finds films by uk/en/ru titles)
  const wdLangs = ["uk", "en", "ru"];
  wdLangs.forEach((lang) => {
    jobs.push(
      apiGet(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(title)}&language=${lang}&uselang=${lang}&type=item&limit=8${ORIGIN}&format=json`)
        .then((d) => (d?.search || []).map((s) => ({ source: "wikidata", pageTitle: s.label || "", desc: s.description || "", qid: s.id })))
        .catch(() => [])
    );
  });

  const settled = await Promise.allSettled(jobs);
  const raw = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // for wiki pages, resolve pageprops (wikibase item) + thumbnail
  const wikiPages = raw.filter((p) => p.source !== "wikidata");
  const wdOnly = raw.filter((p) => p.source === "wikidata");

  const withProps = await Promise.allSettled(
    wikiPages.map((p) =>
      apiGet(`${WIKI_API(p.source === "ukwiki" ? "uk" : p.source === "ruwiki" ? "ru" : "en")}?action=query&prop=pageprops|pageimages|description&piprop=thumbnail&pithumbsize=400&redirects=1&titles=${encodeURIComponent(p.pageTitle)}${ORIGIN}&format=json`)
        .then((d) => {
          const page = Object.values(d?.query?.pages || {})[0];
          if (!page) return null;
          return {
            source: p.source,
            pageTitle: page.title,
            qid: page.pageprops?.wikibase_item || null,
            thumb: page.thumbnail?.source || null,
            desc: page.description || p.desc || "",
          };
        })
    )
  );
  const resolved = withProps.map((r) => (r.status === "fulfilled" ? r.value : null)).filter(Boolean);

  // merge + dedupe by QID
  const byQid = new Map();
  [...resolved.filter((c) => c.qid), ...wdOnly].forEach((c) => {
    if (!c.qid) return;
    const prev = byQid.get(c.qid);
    if (!prev) byQid.set(c.qid, c);
    else if (!prev.thumb && c.thumb) byQid.set(c.qid, { ...prev, thumb: c.thumb });
  });
  const cands = [...byQid.values()];
  if (!cands.length) return [];

  // batch-fetch claims for all unique QIDs
  const claimMap = {};
  const ids = cands.map((c) => c.qid);
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25).join("|");
    try {
      const d = await apiGet(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&ids=${chunk}${ORIGIN}&format=json`);
      Object.assign(claimMap, d?.entities || {});
    } catch (e) { /* keep going with what we have */ }
  }

  // strict film check: instance-of Q11424 (film) only.
  // (P345 alone is NOT enough — e.g. wrestlers/actors have IMDb IDs too)
  const out = cands.map((c) => {
    const claims = claimMap[c.qid]?.claims || {};
    const p31 = (claims.P31 || []).map((s) => s?.mainsnak?.datavalue?.value?.id);
    const isFilm = p31.includes("Q11424");
    const t = claims.P577?.[0]?.mainsnak?.datavalue?.value?.time || "";
    const wdYear = t ? parseInt(t.slice(1, 5), 10) : null;
    return { ...c, isFilm, year: wdYear };
  });

  // films first, then closest release year, then source priority (uk > en > ru > wd)
  const SRC_RANK = { ukwiki: 0, enwiki: 1, ruwiki: 2, wikidata: 3 };
  const y = parseInt(year, 10);
  out.sort((a, b) =>
    (b.isFilm - a.isFilm) ||
    (y ? (Math.abs((a.year || 9999) - y) - Math.abs((b.year || 9999) - y)) : 0) ||
    ((SRC_RANK[a.source] ?? 9) - (SRC_RANK[b.source] ?? 9))
  );
  return out;
}

// ---------- resolve QIDs → labels (uk preferred, en fallback) ----------
async function resolveLabels(qids) {
  const out = {};
  const uniq = [...new Set(qids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50).join("|");
    try {
      const d = await apiGet(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=uk|en&ids=${chunk}${ORIGIN}&format=json`);
      for (const [qid, ent] of Object.entries(d?.entities || {})) {
        out[qid] = ent.labels?.uk?.value || ent.labels?.en?.value || null;
      }
    } catch (e) { /* ignore chunk */ }
  }
  return out;
}

function refIds(claims, prop) {
  return (claims[prop] || [])
    .map((s) => s?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
}
function firstStr(claims, prop) {
  return claims[prop]?.[0]?.mainsnak?.datavalue?.value || null;
}
function firstYear(claims, prop) {
  const t = claims[prop]?.[0]?.mainsnak?.datavalue?.value?.time;
  return t ? parseInt(t.slice(1, 5), 10) : null;
}

// ---------- full details for a chosen candidate ----------
export async function getFilmDetails(cand) {
  const d = await apiGet(`https://www.wikidata.org/wiki/Special:EntityData/${cand.qid}.json`);
  const ent = d?.entities?.[cand.qid];
  if (!ent) throw new Error("Wikidata item not found");
  const claims = ent.claims || {};

  const titleEn =
    ent.labels?.en?.value ||
    ent.sitelinks?.enwiki?.title ||
    cand.pageTitle ||
    "";

  const directorIds = refIds(claims, "P57");
  const countryIds = refIds(claims, "P495");
  const genreIds = refIds(claims, "P136");
  const labels = await resolveLabels([...directorIds, ...countryIds, ...genreIds]);

  const cleanGenre = (g) =>
    String(g).replace(/^фільм\s+/i, "").replace(/\s+фільм$/i, "").replace(/\s+film$/i, "");

  const director = directorIds.map((id) => labels[id]).filter(Boolean).join(", ");
  const country = countryIds.map((id) => labels[id]).filter(Boolean).join(", ");
  const genre = [...new Set(genreIds.map((id) => labels[id]).filter(Boolean).map(cleanGenre))].join(", ");

  const year = firstYear(claims, "P577") || cand.year || null;
  const imdbId = firstStr(claims, "P345");
  const image = firstStr(claims, "P18");

  const ukTitle = ent.sitelinks?.ukwiki?.title || null;
  const enTitle = ent.sitelinks?.enwiki?.title || null;
  const wiki = ukTitle
    ? `https://uk.wikipedia.org/wiki/${encodeURIComponent(ukTitle.replace(/ /g, "_"))}`
    : enTitle
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enTitle.replace(/ /g, "_"))}`
      : "";

  // strip utm_* tracking params Wikipedia adds to thumbnail URLs
  const cleanUrl = (u) => u ? u.replace(/([?&])utm_[^&]*/g, "$1").replace(/[?&]+$/, "") : u;
  const poster = cleanUrl(
    cand.thumb
    || (image ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image.replace(/ /g, "_"))}?width=500` : "")
  ) || "";

  return {
    titleEn,
    year,
    country,
    director,
    genre,
    imdb: imdbId ? `https://www.imdb.com/title/${imdbId}/` : "",
    wiki,
    poster,
  };
}
