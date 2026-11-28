import test from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, matchOption } from "../../src/lib/countries.js";
import { STATES } from "../../src/lib/usStates.js";
import { searchPlaces } from "../../src/lib/osm.js";

test("typed country and state names: full name, code, or an unambiguous start", () => {
  assert.equal(matchOption(COUNTRIES, "united states").code, "US");
  assert.equal(matchOption(COUNTRIES, "sy").code, "SY", "code");
  assert.equal(matchOption(COUNTRIES, "ger").code, "DE");
  assert.equal(matchOption(COUNTRIES, "united"), null, "ambiguous: United Kingdom, United States, United Arab Emirates…");
  assert.equal(matchOption(STATES, "MI").name, "Michigan");
  assert.equal(matchOption(STATES, "mich").name, "Michigan");
  assert.equal(matchOption(STATES, "new"), null);
  assert.equal(matchOption(STATES, "new york").code, "NY");
  assert.ok(COUNTRIES.length > 240 && COUNTRIES.find((c) => c.code === "SY").name === "Syria");
});

test("search within a country: its area, then only places in it", async () => {
  const f = (name, cc, lon, lat) => ({ type: "Feature", properties: { osm_type: "W", osm_id: Math.round(Math.abs(lon * lat * 1000)), name, countrycode: cc, osm_value: "university" }, geometry: { type: "Point", coordinates: [lon, lat] } });
  const real = globalThis.fetch;
  let asked;
  globalThis.fetch = async (url) => { asked = new URL(url); return { ok: true, json: async () => ({ features: [f("Hama University", "SY", 36.7, 35.1), f("Hama", "NO", 11.1, 61.0)] }) }; };
  try {
    const sy = await searchPlaces("hama", { country: { code: "SY", name: "Syria", area: { bbox: [35.47, 32.31, 42.37, 37.32], centre: { lat: 35, lon: 38 } } } });
    assert.equal(asked.searchParams.get("bbox"), "34.97,31.81,42.87,37.82");
    assert.deepEqual(sy.map((p) => p.name), ["Hama University"]);
    // Across the date line (no box): no area and no location bias (a bias
    // to the middle of the US buried The Ohio State University).
    await searchPlaces("hama", { country: { code: "US", name: "United States", area: { bbox: null, centre: { lat: 39.8, lon: -98.6 } } } });
    assert.equal(asked.searchParams.get("bbox"), null);
    assert.equal(asked.searchParams.get("lat"), null);
  } finally { globalThis.fetch = real; }
});

test("suggestions: the place itself before its airport, dam or bus stop", async () => {
  const { rankPlaces } = await import("../../src/lib/osm.js");
  const P = (name, kind, area = true) => ({ name, kind, area });
  const ranked = rankPlaces([
    P("Ohio State University Airport", "aerodrome"), P("Ohio State University Lima", "university"), P("Ohio State University Golf Course Lake Dam", "dam"),
    P("Ohio State University Greyhound Stop", "bus stop", false), P("The Ohio State University", "university"), P("Kent State University", "university"),
  ], "ohio state university");
  assert.equal(ranked[0].name, "The Ohio State University");
  assert.ok(ranked.findIndex((p) => /Dam/.test(p.name)) > ranked.findIndex((p) => /Lima/.test(p.name)));
  assert.equal(ranked.at(-1).name, "Ohio State University Greyhound Stop");
});
