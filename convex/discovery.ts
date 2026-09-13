import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const firecrawl = new FirecrawlClient(components.firecrawl);
const nullable = (type: string) => ({ type: [type, "null"] });
const schema = {
  type: "object", properties: {
    isListing: { type: "boolean" }, city: nullable("string"), title: nullable("string"),
    summary: nullable("string"), rent: nullable("number"), bedrooms: nullable("number"),
    cats: nullable("boolean"), dogs: nullable("boolean"), parking: nullable("boolean"),
    laundry: nullable("boolean"), contactEmail: nullable("string"),
  },
};

export const run = internalAction({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const search = await ctx.runQuery(internal.searches.get, { searchId });
    if (!search || search.status !== "searching") return;
    const p = search.preferences;
    try {
      const response = await firecrawl.search(ctx,
        `Ann Arbor Michigan ${p.bedrooms === 0 ? "studio" : `${p.bedrooms} bedroom`} apartments floor plans rent ${p.pets === "none" ? "" : `${p.pets} friendly`}`,
        { limit: 8, location: "Ann Arbor, Michigan, United States", sources: ["web"],
          excludeDomains: ["zillow.com", "apartments.com", "realtor.com", "redfin.com", "reddit.com"] });
      const seen = new Set<string>();
      const urls = (response.web ?? []).flatMap(item => {
        if (typeof item.url !== "string") return [];
        try {
          const url = new URL(item.url);
          if (url.protocol !== "https:" || seen.has(url.href)) return [];
          seen.add(url.href);
          return [url.href];
        } catch { return []; }
      }).slice(0, 5);
      let scraped = 0;
      await Promise.all(urls.map(async url => {
        try {
          const page = await firecrawl.scrape(ctx, url, {
            formats: ["markdown", { type: "json", schema, prompt: `Extract one specific apartment or floor plan offered for rent on this page. Prefer a ${p.bedrooms}-bedroom unit costing between ${p.minRent} and ${p.maxRent} USD monthly, if explicitly listed. Include its floor plan name in title. Property-specific floor-plan pages are listings; isListing must be false for general city-wide search directories, articles, or pages without a specific rental. Only use explicitly stated facts. city must be the property's actual city name without state or country. rent must be monthly USD for the same unit as bedrooms, not a deposit, per-person price, or price across unrelated units. laundry means in-unit laundry, not a shared laundry room. Use null for unknowns or ambiguous price ranges. contactEmail must be the leasing contact published on this page, never the website support address. Do not guess.` }],
            onlyMainContent: true, timeout: 45000, maxAge: 3600000,
          });
          scraped++;
          const d = page.json as Record<string, unknown> | undefined;
          if (!d || d.isListing !== true || typeof d.city !== "string" || !/^ann arbor(?:,?\s+(?:mi|michigan))?$/i.test(d.city.trim())) return;
          const rent = typeof d.rent === "number" && d.rent >= 0 ? d.rent : undefined;
          const bedrooms = typeof d.bedrooms === "number" && d.bedrooms >= 0 ? d.bedrooms : undefined;
          if (rent !== undefined && (rent < p.minRent || rent > p.maxRent)) return;
          if (bedrooms !== undefined && bedrooms !== p.bedrooms) return;
          if ((p.pets === "cat" && d.cats === false) || (p.pets === "dog" && d.dogs === false) || (p.parking && d.parking === false) || (p.laundry && d.laundry === false)) return;
          const matches = ["Ann Arbor"];
          const unknowns = ["Move-in availability and current pricing need confirmation"];
          if (rent === undefined) unknowns.push("Rent not confirmed"); else matches.push("Within your rent range");
          if (bedrooms === undefined) unknowns.push("Bedrooms not confirmed"); else matches.push(`${bedrooms === 0 ? "Studio" : `${bedrooms} bedrooms`}`);
          for (const [needed, value, label] of [
            [p.pets === "cat", d.cats, "Cats allowed"], [p.pets === "dog", d.dogs, "Dogs allowed"],
            [p.parking, d.parking, "Parking"], [p.laundry, d.laundry, "In-unit laundry"],
          ] as const) {
            if (needed) (value === true ? matches : unknowns).push(value === true ? label : `${label}: not confirmed`);
          }
          if (p.notes) unknowns.push("Additional preferences need confirmation");
          const email = typeof d.contactEmail === "string" ? d.contactEmail.trim() : "";
          const contactEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && page.markdown?.toLowerCase().includes(email.toLowerCase()) ? email : undefined;
          await ctx.runMutation(internal.searches.addListing, {
            searchId, url, title: typeof d.title === "string" ? d.title.slice(0, 180) : "Ann Arbor apartment",
            summary: typeof d.summary === "string" ? d.summary.slice(0, 600) : "View the original listing for details.",
            rent, bedrooms, contactEmail, matches, unknowns,
          });
        } catch { /* One inaccessible listing must not discard other results. */ }
      }));
      await ctx.runMutation(internal.searches.finish, { searchId,
        error: urls.length > 0 && scraped === 0 ? "The listing sites could not be read. Please try again." : undefined });
    } catch {
      await ctx.runMutation(internal.searches.finish, { searchId, error: "The listing search failed. Please try again shortly." });
    }
  },
});
