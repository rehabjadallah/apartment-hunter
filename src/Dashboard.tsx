import { useEffect, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import Preferences, { amenityLabels } from "./Preferences";
import Modal from "./Modal";
import PasswordSettings from "./PasswordSettings";
import NamePrompt from "./NamePrompt";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

// The picker reads best as one short phrase, so an unnamed search describes itself: beds, budget, and the day it was saved.
function searchLabel(search: Doc<"searches">) {
  const p = search.preferences;
  const when = new Date(search._creationTime).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (search.label) return `${search.label} \u00b7 ${when}`;
  const beds = p.bedrooms.values.length
    ? `${[...p.bedrooms.values].sort((a, b) => a - b).map(value => value === 0 ? "Studio" : value).join("\u2013")}${p.bedrooms.values.every(value => value === 0) ? "" : " bed"}`
    : "Any beds";
  const budget = p.minRent > 0 ? `${money(p.minRent)}\u2013${money(p.maxRent)}` : `up to ${money(p.maxRent)}`;
  return `${beds} \u00b7 ${budget} \u00b7 ${when}`;
}


export default function Dashboard() {
  const user = useQuery(api.users.current);
  const searches = useQuery(api.searches.list);
  const { signOut } = useAuthActions();
  const [editing, setEditing] = useState<boolean | null>(null);
  const [settings, setSettings] = useState(window.location.pathname === "/.well-known/change-password");
  const [selected, setSelected] = useState<Id<"searches"> | null>(null);
  const [tab, setTab] = useState<"search" | "inbox">("search");
  const [error, setError] = useState("");
  const searchId = selected ?? searches?.[0]?._id;
  if (!user || !searches) return <p role="status" className="empty">Loading your searches…</p>;
  return <>
    <div className="account-bar"><span>{user.name ? `Hello, ${user.name}` : "Welcome!"}</span><div><button className="text-button" onClick={() => setSettings(true)}>Account</button><button className="text-button" onClick={() => { void signOut().catch(() => setError("Unable to sign out. Please try again.")); }}>Sign out</button></div></div>
    {error && <p role="alert" className="error">{error}</p>}
    {!user.name ? <NamePrompt /> : <>
    <section className="dashboard-heading"><div><p className="eyebrow">Ann Arbor, Michigan</p><h1>Your searches</h1></div><button onClick={() => setEditing(true)}>New apartment search</button></section>
    <nav className="tabs" aria-label="Your apartment search"><button aria-current={tab === "search" ? "page" : undefined} onClick={() => setTab("search")}>Apartments</button><button aria-current={tab === "inbox" ? "page" : undefined} onClick={() => setTab("inbox")}>Conversations</button></nav>
    {tab === "search" ? <>
      {searches.length > 0 && <label className="search-picker">Your saved searches<select value={searchId} onChange={e => setSelected(e.target.value as Id<"searches">)}>{searches.map(s => <option key={s._id} value={s._id}>{searchLabel(s)}</option>)}</select></label>}
      {searchId ? <Results key={searchId} searchId={searchId} onSent={() => setTab("inbox")} /> : <section className="empty panel"><h2>No searches yet</h2><p>Set your rent range and filters. Apartment Hunter checks Ann Arbor listings against every one of them.</p><button onClick={() => setEditing(true)}>Set my preferences</button></section>}
    </> : <Conversations />}
    {(editing ?? (!user.preferences && !settings)) && <Preferences initial={user.preferences} onClose={() => setEditing(false)} onSearch={id => { setSelected(id); setEditing(false); setTab("search"); }} />}
    </>}
    {settings && <PasswordSettings username={user.username ?? ""} onClose={() => setSettings(false)} />}
  </>;
}

export function Results({ searchId, onSent }: { searchId: Id<"searches">; onSent: () => void }) {
  const results = useQuery(api.searches.results, { searchId });
  const [contact, setContact] = useState<Doc<"listings"> | null>(null);
  if (!results) return <p role="status">Loading apartments…</p>;
  return <>
    {results.status === "searching" && <div className="search-progress" role="status"><span className="spinner" /><div><strong>Checking Ann Arbor listings…</strong><p>Results appear here as each listing is read.</p></div></div>}
    {results.error && <p role="alert" className="error">{results.error}</p>}
    {results.status === "complete" && !results.listings.length && <section className="empty panel"><h2>No listings match your selected filters.</h2><p>Try removing a filter or widening your budget.</p></section>}
    {results.listings.length > 0 && <section className="listing-group">
    <div className="listing-group-head"><h2>Matching apartments</h2><p className="results-count" role="status">{results.listings.length} result{results.listings.length === 1 ? "" : "s"}</p></div>
    <div className="listing-grid">{results.listings.map(listing =>
      <ListingCard key={listing._id} listing={listing} preferences={results.preferences} onFollowUp={() => setContact(listing)} />)}</div></section>}
    {contact && <InquiryForm listing={contact} preferences={results.preferences} onClose={() => setContact(null)} onSent={() => { setContact(null); onSent(); }} />}
  </>;
}

// Rent leads, then the community, then the floor plan: one entry point per card rather
// than three headings of near-equal size.
const VISIBLE_TAGS = 3;

function ListingCard({ listing, preferences, onFollowUp }: { listing: Doc<"listings">; preferences: Doc<"searches">["preferences"]; onFollowUp: () => void }) {
  const [showAllTags, setShowAllTags] = useState(false);
  const beds = listing.bedrooms === undefined ? "Beds unconfirmed" : listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bed`;
  const heading = listing.complexName ?? listing.title;
  // The city, the rent range, and the bedroom count are already on the card above, so as
  // chips they spend the three visible slots without telling the reader anything new.
  // They sort to the back rather than being dropped, so a thin listing still shows chips.
  const city = preferences.city.split(",")[0];
  const echoesTheCard = (match: string) =>
    match === city || match === "Within your rent range" || match === "Studio" || /^\d+ bedrooms$/.test(match);
  const ranked = [...listing.matches].sort((a, b) => Number(echoesTheCard(a)) - Number(echoesTheCard(b)));
  const tags = showAllTags ? ranked : ranked.slice(0, VISIBLE_TAGS);
  const hidden = ranked.length - tags.length;
  return <article className="listing-card">
    <div className="listing-top"><span>{beds}</span></div>
    {listing.rent === undefined
      ? <p className="price-unknown">Ask about pricing</p>
      : <p className="price">{money(listing.rent)} <small>/ month</small></p>}
    <h3>{heading}</h3>
    {listing.complexName && <p className="floor-plan">{listing.title}</p>}
    <p className="summary">{listing.summary}</p>
    {listing.matches.length > 0 && <div className="match-tags">
      {tags.map(m => <span key={m}>{m}</span>)}
      {hidden > 0 && <button type="button" onClick={() => setShowAllTags(true)}>+{hidden} more</button>}
    </div>}
    {listing.unknowns.length > 0 && <details><summary>Details to confirm ({listing.unknowns.length})</summary><ul>{listing.unknowns.map(u => <li key={u}>{u}</li>)}</ul></details>}
    <div className="listing-actions"><a href={listing.url} target="_blank" rel="noopener noreferrer">View listing ↗</a>
      <span className="follow-up" tabIndex={!listing.contactEmail ? 0 : undefined} aria-describedby={!listing.contactEmail ? `contact-tooltip-${listing._id}` : undefined}>
        <button disabled={!listing.contactEmail} onClick={onFollowUp}>Follow up</button>
        {!listing.contactEmail && <span role="tooltip" id={`contact-tooltip-${listing._id}`} className="contact-tooltip">No email contact found. Use the listing's contact form.</span>}
      </span>
    </div>
  </article>;
}

function InquiryForm({ listing, preferences: p, onClose, onSent }: { listing: Doc<"listings">; preferences: Doc<"searches">["preferences"]; onClose: () => void; onSent: () => void }) {
  const send = useMutation(api.inquiries.send);
  const compose = useAction(api.drafts.compose);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const bedrooms = p.bedrooms.values;
  const counts = bedrooms.filter(value => value > 0);
  const apartment = [bedrooms.includes(0) ? "a studio" : "", counts.length ? `a ${counts.join(" or ")} bedroom apartment` : ""].filter(Boolean).join(" or ") || "an apartment";
  const conjunction = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });
  const amenities = p.amenities.map(item => amenityLabels[item.key].toLowerCase());
  const unconfirmed = listing.unknowns.filter(line => line.endsWith(" not confirmed"))
    .map(line => line.replace(/:? not confirmed$/, "").toLowerCase());
  // Used until the model answers, and kept as the draft when drafting fails.
  const fallbackSubject = `Apartment inquiry: ${listing.title}`.slice(0, 200);
  const fallbackDraft = `Hello,\n\nI'm interested in ${listing.title}:\n${listing.url}\n\nI'm looking for ${apartment} in Ann Arbor, with monthly rent between ${money(p.minRent)} and ${money(p.maxRent)}, and a move-in date around ${p.moveIn}.\n${p.pets.values.length ? `I have a ${p.pets.values.join(" and a ")}. Please confirm your pet policy and any fees.\n` : ""}${amenities.length ? `I'm looking for ${conjunction.format(amenities)}.\n` : ""}${p.notes ? `Additional preferences: ${p.notes}\n` : ""}${unconfirmed.length ? `Could you clarify the details the listing did not confirm: ${conjunction.format(unconfirmed)}?\n` : ""}\nCould you confirm availability, total monthly costs, lease terms, and how to schedule a tour?\n\nThank you!`;
  const [subject, setSubject] = useState(fallbackSubject);
  const [body, setBody] = useState(fallbackDraft);
  const [drafting, setDrafting] = useState(true);
  // OpenAI writes the inquiry from the listing's unconfirmed details; the modal opens first and fills in.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const draft = await compose({ listingId: listing._id });
        if (active) { setSubject(draft.subject); setBody(draft.body); }
      } catch { /* The fallback template is already in state. */ }
      finally { if (active) setDrafting(false); }
    })();
    return () => { active = false; };
  }, [compose, listing._id]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try { await send({ listingId: listing._id, subject, body }); onSent(); }
    catch (e) { setError(e instanceof ConvexError ? String(e.data) : "Couldn't send your inquiry. Please try again."); }
    finally { setPending(false); }
  }
  const busy = pending || drafting;
  return <Modal title="Email the landlord" onClose={onClose}><p className="muted">To: {listing.contactEmail}</p><form onSubmit={submit}>
    <label>Subject<input name="subject" value={subject} onChange={event => setSubject(event.target.value)} maxLength={200} required disabled={busy} /></label>
    <label>Your message<textarea className="email-body" name="body" value={body} onChange={event => setBody(event.target.value)} maxLength={5000} required disabled={busy} /></label>
    {drafting && <p role="status" className="muted">Drafting your message…</p>}
    <p className="fine-print">Sending creates an inbox for you, and replies arrive under Conversations. Check the recipient and the message before you send.</p>
    {error && <p role="alert" className="error">{error}</p>}<button disabled={busy}>{drafting ? "Drafting…" : pending ? "Preparing inquiry…" : "Send inquiry"}</button>
  </form></Modal>;
}

function Conversations() {
  const inquiries = useQuery(api.inquiries.list);
  const replies = useAction(api.inquiries.replies);
  const [thread, setThread] = useState<{ title: string; messages: Array<{ id: string; text: string; incoming: boolean }> } | null>(null);
  const [pending, setPending] = useState<Id<"inquiries"> | null>(null);
  const [error, setError] = useState("");
  if (!inquiries) return <p role="status">Loading conversations…</p>;
  return <>
    {error && <p role="alert" className="error">{error}</p>}
    {!inquiries.length && <section className="empty panel"><h2>No inquiries sent yet</h2><p>Pick a listing and send the landlord a message. Their replies arrive here.</p></section>}
    {inquiries.map(item => <article className="conversation panel" key={item._id}><div className="panel-heading"><h2>{item.title}</h2><span className="pill">{item.delivery?.status ?? item.status}</span></div><p>{item.subject}</p>
      {(item.error || item.delivery?.errorMessage) && <p role="alert" className="error">{item.error ?? "There was a problem delivering this inquiry."}</p>}
      <button className="secondary" disabled={pending !== null || !item.delivery?.threadId} onClick={async () => {
        setPending(item._id); setError("");
        try { setThread({ title: item.title, messages: await replies({ inquiryId: item._id }) }); }
        catch { setError("Couldn't load replies. Please try again."); } finally { setPending(null); }
      }}>{pending === item._id ? "Checking…" : "Check replies"}</button>
    </article>)}
    {thread && <Modal title={thread.title} onClose={() => setThread(null)}>{thread.messages.length ? thread.messages.map(m => <article className="message" key={m.id}><strong>{m.incoming ? "Property reply" : "Your inquiry"}</strong><p>{m.text}</p></article>) : <p>No messages available yet. Check back shortly.</p>}</Modal>}
  </>;
}
