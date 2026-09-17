import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";

const firecrawl = new FirecrawlClient(components.firecrawl);
const nullable = (type: string) => ({ type: [type, "null"] });
const unit = {
  type: "object", properties: {
    title: nullable("string"), rent: nullable("number"), bedrooms: nullable("number"),
  },
};
const schema = {
  type: "object", properties: {
    isListing: { type: "boolean" }, city: nullable("string"), summary: nullable("string"),
    cats: nullable("boolean"), dogs: nullable("boolean"), parking: nullable("boolean"),
    laundry: nullable("boolean"), contactEmail: nullable("string"),
    units: { type: "array", items: unit },
  },
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function scrapeDiagnostic(value: unknown) {
  const outer = record(value); const data = record(outer?.data) ?? outer;
  const metadata = record(data?.metadata);
  const status = metadata?.statusCode ?? data?.statusCode ?? data?.status;
  const message = typeof data?.message === "string" ? data.message : typeof metadata?.error === "string" ? metadata.error : "";
  const statusCode = typeof status === "number" ? status : Number(message.match(/failed \((\d{3})\)/)?.[1]) || "unknown";
  const headers = record(metadata?.headers) ?? record(data?.headers);
  const challenge = Object.entries(headers ?? {}).some(([key, value]) => key.toLowerCase() === "cf-mitigated" && value === "challenge");
  const reason = statusCode !== 403 ? undefined : /we do not support this site/i.test(message) ? "Firecrawl policy refusal"
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
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const search = await ctx.runQuery(internal.searches.get, { searchId });
    if (!search || search.status !== "searching") return;
    const p = search.preferences;
    const counts = { urlsReturned: 0, urlsAfterDeduplication: 0, urlsSelectedForScrape: 0,
      pagesWithContent: 0, listingsInserted: 0, unitsExtracted: 0, unitsInserted: 0 };
    let error: string | undefined;
    try {
      const response = await firecrawl.search(ctx,
        `Named apartment communities in Ann Arbor Michigan with ${p.bedrooms === 0 ? "studio" : `${p.bedrooms} bedroom`} floor plan pages and leasing contacts ${p.pets === "none" ? "" : `${p.pets} friendly`}`,
        { limit: 8, location: "Ann Arbor, Michigan, United States", sources: ["web"],
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
      const urls = uniqueUrls.slice(0, 5);
      counts.urlsSelectedForScrape = urls.length;
      console.info("Firecrawl selected URLs", { searchId, urls });
      let scraped = 0;
      await Promise.all(urls.map(async url => {
        try {
          const page = await firecrawl.scrape(ctx, url, {
            formats: ["markdown", { type: "json", schema, prompt: "Extract every apartment floor plan offered for rent on this page into the units array, with one entry per floor plan. Include every published floor plan regardless of its rent or bedroom count. Each unit's title must be its published floor plan name; rent and bedrooms must describe that same plan. Do not invent a floor plan or infer one from search criteria. Return an empty units array when no floor plans are stated. Keep city, summary, contactEmail, cats, dogs, parking, and laundry at the property level. Property-specific floor-plan pages are listings; isListing must be false for general city-wide search directories, articles, or pages without a specific rental. Only use explicitly stated facts. city must be the property's actual city name without state or country. rent must be monthly USD for the same unit as bedrooms, not a deposit, per-person price, or price across unrelated units. laundry means in-unit laundry, not a shared laundry room. Use null for unknowns or ambiguous price ranges. contactEmail must be the leasing contact published on this page, never the website support address. Do not guess." }],
            onlyMainContent: false, timeout: 45000, maxAge: 0,
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
          if ((p.pets === "cat" && d.cats === false) || (p.pets === "dog" && d.dogs === false) || (p.parking && d.parking === false) || (p.laundry && d.laundry === false)) return;
          const email = typeof d.contactEmail === "string" ? d.contactEmail.trim() : "";
          const contactEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && page.markdown?.toLowerCase().includes(email.toLowerCase()) ? email : undefined;
          const drops = { "rent out of range": 0, "bedrooms mismatch": 0 };
          for (const value of units) {
            const u = record(value);
            if (!u) continue;
            const rent = typeof u.rent === "number" && u.rent >= 0 ? u.rent : undefined;
            const bedrooms = typeof u.bedrooms === "number" && u.bedrooms >= 0 ? u.bedrooms : undefined;
            if (rent !== undefined && (rent < p.minRent || rent > p.maxRent)) { drops["rent out of range"]++; continue; }
            if (bedrooms !== undefined && bedrooms !== p.bedrooms) { drops["bedrooms mismatch"]++; continue; }
            const matches = city === undefined ? [] : ["Ann Arbor"];
            const unknowns = ["Move-in availability and current pricing need confirmation"];
            if (city === undefined) unknowns.push("City not confirmed");
            if (rent === undefined) unknowns.push("Rent not confirmed"); else matches.push("Within your rent range");
            if (bedrooms === undefined) unknowns.push("Bedrooms not confirmed"); else matches.push(`${bedrooms === 0 ? "Studio" : `${bedrooms} bedrooms`}`);
            for (const [needed, value, label] of [
              [p.pets === "cat", d.cats, "Cats allowed"], [p.pets === "dog", d.dogs, "Dogs allowed"],
              [p.parking, d.parking, "Parking"], [p.laundry, d.laundry, "In-unit laundry"],
            ] as const) {
              if (needed) (value === true ? matches : unknowns).push(value === true ? label : `${label}: not confirmed`);
            }
            if (p.notes) unknowns.push("Additional preferences need confirmation");
            await ctx.runMutation(internal.searches.addListing, {
              searchId, url, title: typeof u.title === "string" ? u.title.slice(0, 180) : "Ann Arbor apartment",
              summary: typeof d.summary === "string" ? d.summary.slice(0, 600) : "View the original listing for details.",
              rent, bedrooms, contactEmail, matches, unknowns,
            });
          }
          console.info("Firecrawl unit drops", { searchId, url, ...drops });
        } catch (error) {
          // One inaccessible listing must not discard other results.
          console.error("Firecrawl page failed", { searchId, url, ...scrapeDiagnostic(error) }, error);
        }
      }));
      counts.listingsInserted = await ctx.runQuery(internal.discovery.listingCount, { searchId });
      counts.unitsInserted = counts.listingsInserted;
      error = urls.length > 0 && scraped === 0 ? "The listing sites could not be read. Please try again." : undefined;
    } catch (cause) {
      console.error("Firecrawl discovery failed", { searchId }, cause);
      error = "The listing search failed. Please try again shortly.";
    }
    console.info("Firecrawl discovery counts", { searchId, ...counts });
    await ctx.runMutation(internal.searches.finish, { searchId, error });
  },
});
