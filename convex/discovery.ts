import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import type { Preferences } from "./schema";

const firecrawl = new FirecrawlClient(components.firecrawl);
const nullable = (type: string) => ({ type: [type, "null"] });
const unit = {
  type: "object", properties: {
    title: nullable("string"), rent: nullable("number"), bedrooms: nullable("number"),
    bathrooms: nullable("number"), sqft: nullable("number"), floor: nullable("number"),
  },
};
const schema = {
  type: "object", properties: {
    isListing: { type: "boolean" }, city: nullable("string"), summary: nullable("string"),
    cats: nullable("boolean"), dogs: nullable("boolean"), parking: nullable("boolean"),
    laundry: nullable("boolean"), contactEmail: nullable("string"),
    dishwasher: nullable("boolean"), airConditioning: nullable("boolean"),
    balcony: nullable("boolean"), gym: nullable("boolean"), pool: nullable("boolean"),
    elevator: nullable("boolean"), furnished: nullable("boolean"),
    leaseMonths: { type: "array", items: { type: "number" } },
    units: { type: "array", items: unit },
  },
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const nonnegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const amenityLabels = { parking: "Parking", laundry: "In-unit laundry", dishwasher: "Dishwasher", airConditioning: "Air conditioning",
  balcony: "Balcony", gym: "Gym", pool: "Pool", elevator: "Elevator", furnished: "Furnished" };

function scoreUnit(p: Preferences, u: Record<string, unknown>, d: Record<string, unknown>, city: string | undefined) {
  const rent = nonnegative(u.rent);
  const rawBedrooms = nonnegative(u.bedrooms); const bedrooms = Number.isInteger(rawBedrooms) ? rawBedrooms : undefined;
  const bathrooms = nonnegative(u.bathrooms); const sqft = nonnegative(u.sqft);
  const rawFloor = nonnegative(u.floor); const floor = rawFloor !== undefined && rawFloor >= 1 && Number.isInteger(rawFloor) ? rawFloor : undefined;
  const matches = city === undefined ? [] : ["Ann Arbor"];
  const unknowns = ["Move-in availability and current pricing need confirmation"];
  if (city === undefined) unknowns.push("City not confirmed");
  let score = 0; let mustMisses = 0;
  const points = { must: 5, want: 3, nice: 1 };
  const evaluate = (weight: Preferences["bedrooms"]["weight"], outcome: boolean | undefined, label: string,
    unconfirmed: string, confirmed: string[] = [label]) => {
    if (outcome === undefined) { unknowns.push(unconfirmed); return; }
    score += outcome ? points[weight] : -points[weight];
    if (outcome) matches.push(...confirmed);
    else {
      if (weight === "must") mustMisses++;
      unknowns.push(`${label}: conflicts with ${weight === "must" ? "must-have" : "preference"}`);
    }
  };
  evaluate("must", rent === undefined ? undefined : rent >= p.minRent && rent <= p.maxRent,
    "Rent range", "Rent not confirmed", ["Within your rent range"]);
  if (p.bedrooms.values.length) evaluate(p.bedrooms.weight, bedrooms === undefined ? undefined : p.bedrooms.values.includes(bedrooms),
    p.bedrooms.values.length === 1 && p.bedrooms.values[0] === 0 ? "Studio" : `${p.bedrooms.values.map(value => value === 0 ? "studio" : value).join(" or ")} bedrooms`,
    "Bedrooms not confirmed", [bedrooms === 0 ? "Studio" : `${bedrooms} bedrooms`]);
  if (p.bathrooms.values.length) evaluate(p.bathrooms.weight,
    bathrooms === undefined ? undefined : p.bathrooms.values.some(value => value === 2 ? bathrooms >= 2 : bathrooms === value),
    `${p.bathrooms.values.map(value => value === 2 ? "2+" : value).join(" or ")} bathrooms`, "Bathrooms not confirmed", [`${bathrooms} bathrooms`]);
  if (p.sqft.min !== undefined || p.sqft.max !== undefined) evaluate(p.sqft.weight,
    sqft === undefined ? undefined : (p.sqft.min === undefined || sqft >= p.sqft.min) && (p.sqft.max === undefined || sqft <= p.sqft.max),
    "Square footage", "Square footage not confirmed", [`${sqft} sq ft`]);
  if (p.floors.values.length) evaluate(p.floors.weight,
    floor === undefined ? undefined : p.floors.values.some(value => value === 3 ? floor >= 3 : floor === value),
    `Floor ${p.floors.values.map(value => value === 3 ? "3 or higher" : value).join(" or ")}`, "Floor not confirmed", [`Floor ${floor}`]);
  if (p.pets.values.length) {
    const facts = p.pets.values.map(pet => d[pet === "cat" ? "cats" : "dogs"]);
    const labels = p.pets.values.map(pet => pet === "cat" ? "Cats allowed" : "Dogs allowed");
    const outcome = facts.some(value => value === false) ? false : facts.every(value => value === true) ? true : undefined;
    evaluate(p.pets.weight, outcome, labels.join(" and "), `${labels.join(" and ")}: not confirmed`, labels);
  }
  if (p.leaseMonths.values.length) {
    const terms = Array.isArray(d.leaseMonths) ? d.leaseMonths.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0) : [];
    const accepted = terms.filter(value => p.leaseMonths.values.includes(value));
    evaluate(p.leaseMonths.weight, terms.length ? accepted.length > 0 : undefined,
      `${p.leaseMonths.values.map(value => value === 1 ? "month-to-month" : `${value}-month`).join(" or ")} lease`,
      "Lease length not confirmed", [`${accepted.join(" or ")} month lease`]);
  }
  for (const amenity of p.amenities) {
    const value = d[amenity.key]; const label = amenityLabels[amenity.key];
    evaluate(amenity.weight, typeof value === "boolean" ? value : undefined, label, `${label}: not confirmed`);
  }
  if (p.notes) unknowns.push("Additional preferences need confirmation");
  return { rent, bedrooms, matches, unknowns, score, mustMisses };
}

function scrapeDiagnostic(value: unknown) {
  const outer = record(value); const data = record(outer?.data) ?? outer;
  const metadata = record(data?.metadata);
  const status = metadata?.statusCode ?? data?.statusCode ?? data?.status;
  const message = typeof data?.message === "string" ? data.message : typeof metadata?.error === "string" ? metadata.error : "";
  const statusCode = typeof status === "number" ? status : Number(message.match(/failed \((\d{3})\)/)?.[1]) || "unknown";
  const headers = record(metadata?.headers) ?? record(data?.headers);
  const challenge = Object.entries(headers ?? {}).some(([key, value]) => key.toLowerCase() === "cf-mitigated" && value === "challenge");
  const reason = statusCode === 429 ? "429 rate limited" : statusCode !== 403 ? undefined
    : /we do not support this site/i.test(message) ? "Firecrawl policy refusal"
    : challenge ? "Cloudflare challenge" : "Unclassified HTTP 403";
  return { statusCode, ...(reason ? { reason } : {}) };
}

export const listingCount = internalQuery({
  args: { searchId: v.id("searches") }, returns: v.number(),
  handler: async (ctx, { searchId }) => {
    // Count stored rows because addListing can skip a search that has timed out.
    const listings = await ctx.db.query("listings").withIndex("by_search", q => q.eq("searchId", searchId)).collect();
    return listings.length;
  },
});

export const run = internalAction({
  args: { searchId: v.id("searches") }, returns: v.null(),
  handler: async (ctx, { searchId }) => {
    const search = await ctx.runQuery(internal.searches.get, { searchId });
    if (!search || search.status !== "searching") return null;
    const p = search.preferences;
    const queryBedrooms = p.bedrooms.values[0]; const queryPet = p.pets.values.length ? p.pets.values[0] : "none";
    const bedroomTerm = queryBedrooms === undefined ? "" : queryBedrooms === 0 ? "studio " : `${queryBedrooms} bedroom `;
    const counts = { urlsReturned: 0, urlsAfterDeduplication: 0, urlsSelectedForScrape: 0,
      pagesWithContent: 0, listingsInserted: 0, unitsExtracted: 0, unitsInserted: 0, unitsScored: 0, unitsWithMustMisses: 0 };
    let error: string | undefined;
    try {
      const response = await firecrawl.search(ctx,
        `Named apartment communities in Ann Arbor Michigan with ${bedroomTerm}floor plan pages ${queryPet === "none" ? "" : `${queryPet} friendly`}`,
        { limit: 20, location: "Ann Arbor, Michigan, United States", sources: ["web"],
          excludeDomains: ["zillow.com", "apartments.com", "realtor.com", "redfin.com", "reddit.com",
            "facebook.com", "yelp.com", "hometogo.com", "tripadvisor.com", "airbnb.com", "vrbo.com",
            "pinterest.com", "homes.com", "trulia.com"] });
      counts.urlsReturned = (response.web ?? []).filter(item => typeof item.url === "string").length;
      const seen = new Set<string>();
      const uniqueUrls = (response.web ?? []).flatMap(item => {
        if (typeof item.url !== "string") return [];
        try {
          const url = new URL(item.url);
          if (url.protocol !== "https:" || seen.has(url.href)) return [];
          seen.add(url.href);
          return [url.href];
        } catch { return []; }
      });
      counts.urlsAfterDeduplication = uniqueUrls.length;
      const urls = uniqueUrls.slice(0, 15);
      counts.urlsSelectedForScrape = urls.length;
      console.info("Firecrawl selected URLs", { searchId, urls });
      let scraped = 0;
      const scrape = async (url: string) => {
        try {
          const page = await firecrawl.scrape(ctx, url, {
            formats: ["markdown", { type: "json", schema, prompt: "Extract every apartment floor plan offered for rent on this page into the units array, with one entry per floor plan. Include every published floor plan regardless of its rent or bedroom count. Each unit's title must be its published floor plan name; rent and bedrooms must describe that same plan. Do not invent a floor plan or infer one from search criteria. Return an empty units array when no floor plans are stated. Keep city, summary, contactEmail, cats, dogs, parking, and laundry at the property level. Property-specific floor-plan pages are listings; isListing must be false for general city-wide search directories, articles, or pages without a specific rental. Only use explicitly stated facts. city must be the property's actual city name without state or country. rent must be monthly USD for the same unit as bedrooms, not a deposit, per-person price, or price across unrelated units. laundry means in-unit laundry, not a shared laundry room. Use null for unknowns or ambiguous price ranges. contactEmail must be the leasing contact published on this page, never the website support address. Do not guess. bathrooms is the bathroom count for the same floor plan as bedrooms. sqft is the plan's stated interior square footage. If the page states a range, return null. floor is the floor the plan sits on, counting the ground floor as 1. Return null unless the page states it. A garden level or a lower level is null, not 1. leaseMonths holds every lease length in months the property publishes. A month-to-month lease is 1. Return an empty array when no term is stated. Amenity fields are property-level and true only when the page states the property offers it." }],
            onlyMainContent: false, timeout: 45000, maxAge: 3600000,
            proxy: "auto", waitFor: 3000,
          });
          scraped++;
          const d = record(page.json);
          const units: unknown[] = Array.isArray(d?.units) ? d.units : [];
          counts.unitsExtracted += units.length;
          console.info("Firecrawl page", { searchId, url, ...scrapeDiagnostic(page),
            isListing: d?.isListing ?? null, city: d?.city ?? null, unitsExtracted: units.length });
          if (page.markdown?.trim() || Object.keys(record(page.json) ?? {}).length > 0) counts.pagesWithContent++;
          if (!d || units.length === 0) {
            console.info("Firecrawl page rejected", { searchId, url, reason: "units empty", value: units.length });
            return;
          }
          const city = typeof d.city === "string" ? d.city.trim() : undefined;
          if (city !== undefined && !/^ann arbor(?: charter township)?(?:,?\s+(?:mi|michigan))?$/i.test(city)) {
            console.info("Firecrawl page rejected", { searchId, url, reason: "city conflict", value: d.city });
            return;
          }
          const email = typeof d.contactEmail === "string" ? d.contactEmail.trim() : "";
          const contactEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && page.markdown?.toLowerCase().includes(email.toLowerCase()) ? email : undefined;
          const scored = { units: 0, withMustMisses: 0 };
          for (const value of units) {
            const u = record(value);
            if (!u) continue;
            const result = scoreUnit(p, u, d, city);
            scored.units++; counts.unitsScored++;
            if (result.mustMisses > 0) { scored.withMustMisses++; counts.unitsWithMustMisses++; }
            await ctx.runMutation(internal.searches.addListing, {
              searchId, url, title: typeof u.title === "string" ? u.title.slice(0, 180) : "Ann Arbor apartment",
              summary: typeof d.summary === "string" ? d.summary.slice(0, 600) : "View the original listing for details.",
              ...result, contactEmail,
            });
          }
          console.info("Firecrawl units scored", { searchId, url, ...scored });
        } catch (error) {
          // One inaccessible listing must not discard other results.
          console.error("Firecrawl page failed", { searchId, url, ...scrapeDiagnostic(error) }, error);
        }
      };
      for (let i = 0; i < urls.length; i += 5) {
        await Promise.all(urls.slice(i, i + 5).map(scrape));
      }
      counts.listingsInserted = await ctx.runQuery(internal.discovery.listingCount, { searchId });
      counts.unitsInserted = counts.listingsInserted;
      error = urls.length > 0 && scraped === 0 ? "The listing sites could not be read. Please try again." : undefined;
    } catch (cause) {
      console.error("Firecrawl discovery failed", { searchId }, cause);
      error = "The listing search failed. Please try again shortly.";
    }
    console.info("Firecrawl discovery counts", { searchId, ...counts });
    await ctx.runMutation(internal.searches.finish, { searchId, error });
    return null;
  },
});
