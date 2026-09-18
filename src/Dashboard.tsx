import { useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import Preferences from "./Preferences";
import Modal from "./Modal";
import PasswordSettings from "./PasswordSettings";
import NamePrompt from "./NamePrompt";

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

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
    <section className="dashboard-heading"><div><p className="eyebrow">Ann Arbor, Michigan</p><h1>Find your <span>next chapter.</span></h1><p className="muted">Your preferences. Your shortlist. Your conversations.</p></div><button onClick={() => setEditing(true)}>New apartment search</button></section>
    <nav className="tabs" aria-label="Your apartment search"><button aria-current={tab === "search" ? "page" : undefined} onClick={() => setTab("search")}>Apartments</button><button aria-current={tab === "inbox" ? "page" : undefined} onClick={() => setTab("inbox")}>Conversations</button></nav>
    {tab === "search" ? <>
      {searches.length > 0 && <label className="search-picker">Your saved searches<select value={searchId} onChange={e => setSelected(e.target.value as Id<"searches">)}>{searches.map(s => <option key={s._id} value={s._id}>{new Date(s._creationTime).toLocaleDateString()} · {money(s.preferences.minRent)}–{money(s.preferences.maxRent)} · {s.preferences.bedrooms.values.length ? `${s.preferences.bedrooms.values.join(", ")} bed` : "Any"}</option>)}</select></label>}
      {searchId ? <Results key={searchId} searchId={searchId} onSent={() => setTab("inbox")} /> : <section className="empty panel"><h2>A place that fits your life.</h2><p>Start with your budget and must-haves. We'll look for apartments in Ann Arbor.</p><button onClick={() => setEditing(true)}>Set my preferences</button></section>}
    </> : <Conversations />}
    {(editing ?? (!user.preferences && !settings)) && <Preferences initial={user.preferences} onClose={() => setEditing(false)} onSearch={id => { setSelected(id); setEditing(false); setTab("search"); }} />}
    </>}
    {settings && <PasswordSettings username={user.username ?? ""} onClose={() => setSettings(false)} />}
  </>;
}

function Results({ searchId, onSent }: { searchId: Id<"searches">; onSent: () => void }) {
  const results = useQuery(api.searches.results, { searchId });
  const [contact, setContact] = useState<Doc<"listings"> | null>(null);
  if (!results) return <p role="status">Loading apartments…</p>;
  return <>
    {results.status === "searching" && <div className="search-progress" role="status"><span className="spinner" /><div><strong>Looking around Ann Arbor…</strong><p>Finding listings and checking the details. Results will appear here as they're ready.</p></div></div>}
    {results.error && <p role="alert" className="error">{results.error}</p>}
    {results.status === "complete" && !results.listings.length && <section className="empty panel"><h2>No suitable listings in this batch.</h2><p>We checked a small set of web results. Try another search or a wider budget.</p></section>}
    {results.listings.length > 0 && <p className="muted">{results.listings.length} potential {results.listings.length === 1 ? "match" : "matches"} · Confirm availability and details with the property.</p>}
    <div className="listing-grid">{results.listings.map(listing => <article className="listing-card" key={listing._id}>
      <div className="listing-top"><span>Ann Arbor</span><span>{listing.bedrooms === undefined ? "Beds unconfirmed" : listing.bedrooms === 0 ? "Studio" : `${listing.bedrooms} bed`}</span></div>
      <h2>{listing.title}</h2><p className="price">{listing.rent === undefined ? "Ask about pricing" : <>{money(listing.rent)} <small>/ month</small></>}</p>
      <p>{listing.summary}</p><div className="match-tags">{listing.matches.map(m => <span key={m}>{m}</span>)}</div>
      <details><summary>Details to confirm ({listing.unknowns.length})</summary><ul>{listing.unknowns.map(u => <li key={u}>{u}</li>)}</ul></details>
      <div className="listing-actions"><a href={listing.url} target="_blank" rel="noopener noreferrer">View listing ↗</a>
        <span className="follow-up" tabIndex={!listing.contactEmail ? 0 : undefined} aria-describedby={!listing.contactEmail ? `contact-tooltip-${listing._id}` : undefined}>
          <button disabled={!listing.contactEmail} onClick={() => setContact(listing)}>Follow up</button>
          {!listing.contactEmail && <span role="tooltip" id={`contact-tooltip-${listing._id}`} className="contact-tooltip">No email contact found. Use the listing's contact form.</span>}
        </span>
      </div>
    </article>)}</div>
    {contact && <InquiryForm listing={contact} preferences={results.preferences} onClose={() => setContact(null)} onSent={() => { setContact(null); onSent(); }} />}
  </>;
}

function InquiryForm({ listing, preferences: p, onClose, onSent }: { listing: Doc<"listings">; preferences: Doc<"searches">["preferences"]; onClose: () => void; onSent: () => void }) {
  const send = useMutation(api.inquiries.send);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const bedrooms = p.bedrooms.values;
  const draft = `Hello,\n\nI'm interested in ${listing.title}:\n${listing.url}\n\nI'm looking for ${bedrooms.length === 1 && bedrooms[0] === 0 ? "a studio" : bedrooms.length ? `a ${bedrooms.join(" or ")}-bedroom apartment` : "an apartment"} in Ann Arbor, with monthly rent between ${money(p.minRent)} and ${money(p.maxRent)}, and a move-in date around ${p.moveIn}.\n${p.pets.values.length ? `I have a ${p.pets.values.join(" and a ")}. Please confirm your pet policy and any fees.\n` : ""}${p.amenities.some(item => item.key === "parking") ? "I need parking.\n" : ""}${p.amenities.some(item => item.key === "laundry") ? "I need in-unit laundry.\n" : ""}${p.notes ? `Additional preferences: ${p.notes}\n` : ""}\nCould you confirm availability, total monthly costs, lease terms, and how to schedule a tour?\n\nThank you!`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setPending(true); setError("");
    try { await send({ listingId: listing._id, subject: String(data.get("subject")), body: String(data.get("body")) }); onSent(); }
    catch (e) { setError(e instanceof ConvexError ? String(e.data) : "Couldn't send your inquiry. Please try again."); }
    finally { setPending(false); }
  }
  return <Modal title="Start the conversation" onClose={onClose}><p className="muted">To: {listing.contactEmail}</p><form onSubmit={submit}>
    <label>Subject<input name="subject" defaultValue={`Apartment inquiry: ${listing.title}`.slice(0, 200)} maxLength={200} required disabled={pending} /></label>
    <label>Your message<textarea className="email-body" name="body" defaultValue={draft} maxLength={5000} required disabled={pending} /></label>
    <p className="fine-print">Sending creates an Apartment Hunter inbox for you. Check replies in Conversations. Only send after reviewing the recipient and message.</p>
    {error && <p role="alert" className="error">{error}</p>}<button disabled={pending}>{pending ? "Preparing inquiry…" : "Send inquiry"}</button>
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
    {!inquiries.length && <section className="empty panel"><h2>Your conversations start here.</h2><p>Choose an apartment and review an inquiry to get in touch.</p></section>}
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
