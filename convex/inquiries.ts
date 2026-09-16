import { AgentMail, type OutboundId } from "@agentmail/convex";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireUser } from "./users";
import type { Id } from "./_generated/dataModel";

const mail = new AgentMail(components.agentmail);

export const send = mutation({
  args: { listingId: v.id("listings"), subject: v.string(), body: v.string() },
  handler: async (ctx, args): Promise<Id<"inquiries">> => {
    const user = await requireUser(ctx);
    const listing = await ctx.db.get(args.listingId);
    const search = listing ? await ctx.db.get(listing.searchId) : null;
    if (!listing || search?.userId !== user._id) throw new ConvexError("Listing not found.");
    if (!listing.contactEmail) throw new ConvexError("This listing has no published email contact.");
    if (!args.subject.trim() || args.subject.length > 200 || /[\r\n]/.test(args.subject) || !args.body.trim() || args.body.length > 5000) throw new ConvexError("Please check the subject and message.");
    const existing = await ctx.db.query("inquiries").withIndex("by_user_listing", q => q.eq("userId", user._id).eq("listingId", listing._id)).first();
    if (existing) {
      // Only preparation failures are safe to retry: no outbound message exists.
      if (existing.status === "failed" && !existing.outboundId) {
        await ctx.db.patch(existing._id, { subject: args.subject, body: args.body, status: "preparing", error: undefined });
        await ctx.scheduler.runAfter(0, internal.inquiries.prepare, { inquiryId: existing._id });
      }
      return existing._id;
    }
    const recent = await ctx.db.query("inquiries").withIndex("by_user", q => q.eq("userId", user._id)).order("desc").take(10);
    if (recent.filter(i => Date.now() - i._creationTime < 86400000).length >= 10) throw new ConvexError("You can send up to 10 inquiries per day.");
    const inquiryId = await ctx.db.insert("inquiries", { ...args, userId: user._id, status: "preparing" });
    await ctx.scheduler.runAfter(0, internal.inquiries.prepare, { inquiryId });
    return inquiryId;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const items = await ctx.db.query("inquiries").withIndex("by_user", q => q.eq("userId", user._id)).order("desc").take(30);
    return Promise.all(items.map(async item => ({
      ...item, title: (await ctx.db.get(item.listingId))?.title ?? "Apartment inquiry",
      delivery: item.outboundId ? await mail.status(ctx, item.outboundId as OutboundId) : null,
    })));
  },
});

export const get = internalQuery({
  args: { inquiryId: v.id("inquiries") },
  handler: async (ctx, { inquiryId }) => {
    const inquiry = await ctx.db.get(inquiryId);
    if (!inquiry) return null;
    return { inquiry, user: await ctx.db.get(inquiry.userId), listing: await ctx.db.get(inquiry.listingId) };
  },
});

export const enqueue = internalMutation({
  args: { inquiryId: v.id("inquiries"), inboxId: v.string() },
  handler: async (ctx, { inquiryId, inboxId }) => {
    const inquiry = await ctx.db.get(inquiryId);
    if (!inquiry || inquiry.status !== "preparing") return;
    const listing = await ctx.db.get(inquiry.listingId);
    if (!listing?.contactEmail) throw new Error("Missing listing contact");
    await ctx.db.patch(inquiry.userId, { inboxId });
    const outboundId = await mail.sendMessage(ctx, inboxId, { to: listing.contactEmail, subject: inquiry.subject, text: inquiry.body });
    await ctx.db.patch(inquiryId, { outboundId, status: "queued" });
  },
});
export const fail = internalMutation({
  args: { inquiryId: v.id("inquiries") },
  handler: async (ctx, { inquiryId }) => {
    const item = await ctx.db.get(inquiryId);
    if (item?.status === "preparing") await ctx.db.patch(inquiryId, { status: "failed", error: "Could not prepare this inquiry. No message was queued." });
  },
});
export const prepare = internalAction({
  args: { inquiryId: v.id("inquiries") },
  handler: async (ctx, { inquiryId }) => {
    try {
      const data = await ctx.runQuery(internal.inquiries.get, { inquiryId });
      if (!data?.user || data.inquiry.status !== "preparing") return;
      const inboxId = data.user.inboxId ?? (await mail.createInbox(ctx, { displayName: "Apartment Hunter", clientId: data.user._id })).inbox_id;
      if (typeof inboxId !== "string") throw new Error("No inbox returned");
      await ctx.runMutation(internal.inquiries.enqueue, { inquiryId, inboxId });
    } catch (error) {
      // Keep service details out of the UI while retaining a server-side diagnosis.
      console.error("Inquiry preparation failed", error instanceof Error ? error.message : "Unknown error");
      await ctx.runMutation(internal.inquiries.fail, { inquiryId });
    }
  },
});

export const threadAccess = internalQuery({
  args: { inquiryId: v.id("inquiries") },
  handler: async (ctx, { inquiryId }) => {
    const user = await requireUser(ctx);
    const inquiry = await ctx.db.get(inquiryId);
    if (!inquiry || inquiry.userId !== user._id) throw new ConvexError("Inquiry not found.");
    const status = inquiry.outboundId ? await mail.status(ctx, inquiry.outboundId as OutboundId) : null;
    return { inboxId: user.inboxId, threadId: status?.threadId };
  },
});
// Replies are fetched on demand; no webhook registration is needed for this first pass.
export const replies = action({
  args: { inquiryId: v.id("inquiries") },
  handler: async (ctx, args): Promise<Array<{ id: string; text: string; incoming: boolean }>> => {
    const access = await ctx.runQuery(internal.inquiries.threadAccess, args);
    if (!access.inboxId || !access.threadId) return [];
    const thread = await mail.getThread(ctx, access.inboxId, access.threadId);
    const messages: Array<Record<string, unknown>> = Array.isArray(thread.messages) ? thread.messages : [];
    return messages.slice(-30).map((m, i) => ({
      id: typeof m.message_id === "string" ? m.message_id : String(i),
      text: typeof m.text === "string" ? m.text.slice(0, 20000) : typeof m.preview === "string" ? m.preview : "Open the original message to view its content.",
      incoming: Array.isArray(m.labels) && m.labels.includes("received"),
    }));
  },
});
