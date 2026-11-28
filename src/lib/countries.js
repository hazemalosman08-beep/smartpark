// Countries for "search only in this country": ISO 3166-1 codes, names from
// the browser (Intl.DisplayNames), and the country's area from the place
// search (Photon), looked up once and kept on this device.
import { PHOTON } from "./osm.js";

const CODES = ("AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ " +
  "OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");

let names = null;
function nameOf(code) {
  try {
    names = names || new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(code) || code;
  } catch {
    return code;
  }
}

export const COUNTRIES = CODES.map((code) => ({ code, name: nameOf(code) })).sort((a, b) => a.name.localeCompare(b.name));

export const countryByCode = (code) => COUNTRIES.find((c) => c.code === code) || null;

/**
 * What was typed -> an option: exact name or code, else the only option
 * whose name starts with (then contains) the text. options: [{ code, name }].
 */
export function matchOption(options, text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  const exact = options.find((o) => o.name.toLowerCase() === t || o.code.toLowerCase() === t);
  if (exact) return exact;
  const starts = options.filter((o) => o.name.toLowerCase().startsWith(t));
  if (starts.length === 1) return starts[0];
  const has = options.filter((o) => o.name.toLowerCase().includes(t));
  return has.length === 1 ? has[0] : null;
}

const AREA_KEY = "smartpark.countryArea.";

/**
 * The country's search area: a bounding box [w, s, e, n], or (for countries
 * across the date line, e.g. the US with Alaska) none, and a centre to
 * search around. Looked up once per country.
 */
export async function countryArea(country, { signal } = {}) {
  if (!country) return null;
  try { const hit = localStorage.getItem(AREA_KEY + country.code); if (hit) return JSON.parse(hit); } catch { /* blocked */ }
  const url = new URL(PHOTON);
  url.searchParams.set("q", country.name);
  url.searchParams.set("osm_tag", "place:country");
  url.searchParams.set("limit", "5");
  url.searchParams.set("lang", "en");
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const f = (await res.json()).features?.find((x) => x.properties?.countrycode === country.code);
  if (!f) return null;
  const e = f.properties.extent; // [west, north, east, south]
  const wide = !e || e[2] - e[0] > 180;
  const area = { bbox: wide ? null : [e[0], e[3], e[2], e[1]], centre: { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] } };
  try { localStorage.setItem(AREA_KEY + country.code, JSON.stringify(area)); } catch { /* blocked */ }
  return area;
}
