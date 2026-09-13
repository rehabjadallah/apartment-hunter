import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import Modal from "./Modal";

export default function Preferences({ initial, onClose, onSearch }: { initial?: Doc<"users">["preferences"]; onClose: () => void; onSearch: (id: Id<"searches">) => void }) {
  const start = useMutation(api.searches.start);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      onSearch(await start({ preferences: {
        city: "Ann Arbor, Michigan", minRent: Number(data.get("minRent")), maxRent: Number(data.get("maxRent")), bedrooms: Number(data.get("bedrooms")), moveIn: String(data.get("moveIn")),
        pets: data.get("pets") as "none" | "cat" | "dog", parking: data.has("parking"), laundry: data.has("laundry"), notes: String(data.get("notes")),
      } }));
    } catch (e) { setError(e instanceof ConvexError ? String(e.data) : "We couldn't start your search. Please try again."); }
    finally { setPending(false); }
  }
  return <Modal title="What feels like home?" onClose={onClose}><p className="muted">Let's find your place in Ann Arbor, Michigan.</p>
    <form onSubmit={submit}><fieldset disabled={pending}><div className="form-grid">
      <label>Minimum monthly rent<input name="minRent" type="number" min="0" max="20000" defaultValue={initial?.minRent ?? 800} required /></label>
      <label>Maximum monthly rent<input name="maxRent" type="number" min="0" max="20000" defaultValue={initial?.maxRent ?? 2000} required /></label>
      <label>Bedrooms<select name="bedrooms" defaultValue={initial?.bedrooms ?? 1}>{[0,1,2,3,4,5,6].map(n => <option key={n} value={n}>{n === 0 ? "Studio" : `${n} bedroom${n > 1 ? "s" : ""}`}</option>)}</select></label>
      <label>Move-in date<input name="moveIn" type="date" defaultValue={initial?.moveIn} required /></label>
      <label>Pets<select name="pets" defaultValue={initial?.pets ?? "none"}><option value="none">No pets</option><option value="cat">Cat</option><option value="dog">Dog</option></select></label>
    </div><p className="field-caption">Other must-haves</p><div className="checks"><label><input name="parking" type="checkbox" defaultChecked={initial?.parking} /> Parking</label><label><input name="laundry" type="checkbox" defaultChecked={initial?.laundry} /> In-unit laundry</label></div>
    <label>Anything else? <span className="muted">Optional</span><textarea name="notes" maxLength={500} defaultValue={initial?.notes} placeholder="Accessibility needs, lease length, preferred neighborhoods…" /></label>
    <p className="fine-print">We'll flag details that need confirmation, including move-in availability and additional preferences.</p>
    {error && <p role="alert" className="error">{error}</p>}<button>{pending ? "Starting search…" : "Find my apartments"}</button>
    </fieldset></form></Modal>;
}
