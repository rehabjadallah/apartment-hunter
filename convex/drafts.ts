import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";
import { requireUser } from "./users";
import type { Doc } from "./_generated/dataModel";
import type { Preferences } from "./schema";

// Overridable without a code deploy so the model can be changed from the dashboard.
// Exported so the health check reports on the model drafting will actually use.
export const model = () => process.env.OPENAI_MODEL ?? "gpt-5.1";

// Mirrors the limits enforced by inquiries.send so a generated draft can always be sent.
const MAX_SUBJECT = 200;
const MAX_BODY = 5000;
const cleanSubject = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SUBJECT);
const cleanBody = (value: string) => value.trim().slice(0, MAX_BODY);

const instructions = `You help a real person write a short email to an apartment leasing office about an apartment they just found online.

You receive JSON with the listing and the renter's saved search preferences.

Sound like a person who is apartment hunting, not a form letter. Short sentences. Contractions are fine. Specific beats polite.

Structure, in order:
1. One line naming the apartment and that you found it online.
2. What they need, with real numbers from the JSON: rent range, bedroom count, move-in timing, pets, must-have amenities. Only what is actually in the JSON.
3. The questions. "openQuestions" lists what the listing page never stated. Ask about each one directly, by name, in the renter's own terms. When a preference makes the reason obvious, say it (a dog means asking about pet rent, deposits, and weight or breed limits; a move-in date means asking what is actually available then).
   If "notes" is present, turn it into a real question of its own. Never ask the office to tell you the renter's own preferences.
4. One short closing line about seeing the place.

Never write these:
- "I am writing to inquire", "I am interested in", "I would like to confirm", "I hope this email finds you"
- "Additionally", "Furthermore", "at your earliest convenience", "I look forward to hearing from you", "Please let me know if you have any questions"
- a sentence with no specific fact in it
- anything not in the JSON: no neighborhood claims, no compliments about the building, no invented budget or dates
- a signature, a name, or a bracketed placeholder like [Your Name]
- a raw date like 2026-11-01; write dates the way a person says them ("early November")

"confirmedOnPage" lists what the page already answered. Do not ask about those.

Keep the body under 150 words. End after the closing line.

Respond with JSON matching exactly: {"subject": string, "body": string}
The subject is one line under 200 characters, naming the apartment. Plain, not salesy.`;

type Listing = Doc<"listings">;

// Exported so a draft can be generated from fixture data without an authenticated caller.
export function draftFacts(listing: Listing, p: Preferences) {
  // A listing only reaches the results grid when every selected filter was confirmed,
  // so the useful open questions are the standing unknowns, not the per-filter ones.
  // Conflicts are excluded: those are known misses, not questions.
  const openQuestions = listing.unknowns.filter(line => !line.includes(": conflicts with"))
    .map(line => line.replace(/:? not confirmed$/i, "").replace(/ needs? confirmation$/i, "").trim().toLowerCase())
    // This one only marks the renter's free-text notes as unverified; the notes themselves
    // are in the payload, and passing it through made models ask the office to state them.
    .filter(line => line && line !== "additional preferences");
  return {
    listing: {
      title: listing.title, complexName: listing.complexName ?? null, url: listing.url,
      rent: listing.rent ?? null, bedrooms: listing.bedrooms ?? null,
      summary: listing.summary, confirmedOnPage: listing.matches, openQuestions,
    },
    renter: {
      city: p.city, budget: { min: p.minRent, max: p.maxRent }, moveIn: p.moveIn,
      bedrooms: p.bedrooms.values, bathrooms: p.bathrooms.values, leaseMonths: p.leaseMonths.values,
      sqft: { min: p.sqft.min ?? null, max: p.sqft.max ?? null },
      pets: p.pets.values, amenities: p.amenities.map(item => item.key), notes: p.notes,
    },
  };
}

// Separate from compose so a draft can be generated without an authenticated caller.
export async function generate(key: string, facts: ReturnType<typeof draftFacts>, model: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: JSON.stringify(facts) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("No message content returned");
    const parsed = JSON.parse(content);
    const subject = cleanSubject(typeof parsed.subject === "string" ? parsed.subject : "");
    const body = cleanBody(typeof parsed.body === "string" ? parsed.body : "");
    // The caller falls back to its template rather than showing an empty form.
    if (!subject || !body) throw new Error("Generated draft was empty");
    return { subject, body };
  } finally {
    clearTimeout(timeout);
  }
}

export const draftContext = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }) => {
    const user = await requireUser(ctx);
    const listing = await ctx.db.get(listingId);
    const search = listing ? await ctx.db.get(listing.searchId) : null;
    // Matches inquiries.send: ownership failures are indistinguishable from a missing listing.
    if (!listing || search?.userId !== user._id) throw new ConvexError("Listing not found.");
    return { listing, preferences: search.preferences };
  },
});

export const compose = action({
  args: { listingId: v.id("listings") },
  handler: async (ctx, args): Promise<{ subject: string; body: string }> => {
    const { listing, preferences } = await ctx.runQuery(internal.drafts.draftContext, args);
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new ConvexError("Drafting is unavailable right now.");
    try {
      return await generate(key, draftFacts(listing, preferences), model());
    } catch (error) {
      // Keep provider details out of the UI while retaining a server-side diagnosis.
      console.error("Draft generation failed", error instanceof Error ? error.message : "Unknown error");
      throw new ConvexError("Couldn't draft this message.");
    }
  },
});
