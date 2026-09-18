import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { Preferences as SearchPreferences } from "../convex/schema";
import Modal from "./Modal";

export const amenityLabels = { parking: "Parking", laundry: "In-unit laundry", dishwasher: "Dishwasher", airConditioning: "Air conditioning",
  balcony: "Balcony", gym: "Gym", pool: "Pool", elevator: "Elevator", furnished: "Furnished" };
const amenityKeys = Object.keys(amenityLabels) as Array<keyof typeof amenityLabels>;

function Choices<T extends number | string>({ label, options, values, onChange }: {
  label: string; options: Array<{ value: T; label: string }>; values: T[]; onChange: (values: T[]) => void;
}) {
  return <fieldset className="criterion"><legend>{label}</legend><div className="value-toggles">
    {options.map(option => <button type="button" key={option.value} aria-pressed={values.includes(option.value)} onClick={() =>
      onChange(values.includes(option.value) ? values.filter(value => value !== option.value) : [...values, option.value])}>{option.label}</button>)}
  </div></fieldset>;
}

export default function Preferences({ initial, onClose, onSearch }: { initial?: Doc<"users">["preferences"]; onClose: () => void; onSearch: (id: Id<"searches">) => void }) {
  const start = useMutation(api.searches.start);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [criteria, setCriteria] = useState<SearchPreferences>(initial ?? {
    city: "Ann Arbor, Michigan", minRent: 800, maxRent: 2000, moveIn: "", notes: "",
    bedrooms: { values: [], weight: "must" }, bathrooms: { values: [], weight: "must" }, floors: { values: [], weight: "must" },
    leaseMonths: { values: [], weight: "must" }, sqft: { weight: "must" }, pets: { values: [], weight: "must" }, amenities: [],
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      onSearch(await start({ preferences: { ...criteria, minRent: Number(data.get("minRent")), maxRent: Number(data.get("maxRent")),
        moveIn: String(data.get("moveIn")), notes: String(data.get("notes")),
        bedrooms: { ...criteria.bedrooms, weight: "must" }, bathrooms: { ...criteria.bathrooms, weight: "must" },
        floors: { ...criteria.floors, weight: "must" }, leaseMonths: { ...criteria.leaseMonths, weight: "must" },
        sqft: { ...criteria.sqft, weight: "must" }, pets: { ...criteria.pets, weight: "must" },
        amenities: criteria.amenities.map(item => ({ ...item, weight: "must" })),
      } }));
    } catch (e) { setError(e instanceof ConvexError ? String(e.data) : "We couldn't start your search. Please try again."); }
    finally { setPending(false); }
  }
  return <Modal title="What feels like home?" onClose={onClose}><p className="muted">Let's find your place in Ann Arbor, Michigan.</p>
    <form onSubmit={submit}><fieldset disabled={pending}><div className="form-grid">
      <label>Minimum monthly rent<input name="minRent" type="number" min="0" max="20000" defaultValue={initial?.minRent ?? 800} required /></label>
      <label>Maximum monthly rent<input name="maxRent" type="number" min="0" max="20000" defaultValue={initial?.maxRent ?? 2000} required /></label>
      <label>Move-in date<input name="moveIn" type="date" defaultValue={initial?.moveIn} required /></label>
    </div>
    <p className="fine-print">Only listings with confirmed matches for every selected filter will appear. Leave a filter blank if you have no preference.</p>
    <Choices label="Bedrooms" options={[0, 1, 2, 3, 4, 5, 6].map(value => ({ value, label: value === 0 ? "Studio" : `${value} bedroom${value > 1 ? "s" : ""}` }))}
      values={criteria.bedrooms.values} onChange={values => setCriteria({ ...criteria, bedrooms: { values, weight: "must" } })} />
    <Choices label="Bathrooms" options={[{ value: 1, label: "1 bathroom" }, { value: 1.5, label: "1.5 bathrooms" }, { value: 2, label: "2+ bathrooms" }]}
      values={criteria.bathrooms.values} onChange={values => setCriteria({ ...criteria, bathrooms: { values, weight: "must" } })} />
    <fieldset className="criterion"><legend>Square footage</legend><div className="form-grid">
      <label>Minimum square feet<input type="number" min="0" value={criteria.sqft.min ?? ""} onChange={e => setCriteria({ ...criteria, sqft: { ...criteria.sqft, min: e.target.value === "" ? undefined : Number(e.target.value) } })} /></label>
      <label>Maximum square feet<input type="number" min="0" value={criteria.sqft.max ?? ""} onChange={e => setCriteria({ ...criteria, sqft: { ...criteria.sqft, max: e.target.value === "" ? undefined : Number(e.target.value) } })} /></label>
    </div></fieldset>
    <Choices label="Floors" options={[{ value: 1, label: "Ground / first" }, { value: 2, label: "Second" }, { value: 3, label: "Third or higher" }]}
      values={criteria.floors.values} onChange={values => setCriteria({ ...criteria, floors: { values, weight: "must" } })} />
    <Choices label="Pets" options={[{ value: "cat" as const, label: "Cat" }, { value: "dog" as const, label: "Dog" }]}
      values={criteria.pets.values} onChange={values => setCriteria({ ...criteria, pets: { values, weight: "must" } })} />
    <Choices label="Lease length" options={[1, 6, 9, 12].map(value => ({ value, label: value === 1 ? "Month to month" : `${value} months` }))}
      values={criteria.leaseMonths.values} onChange={values => setCriteria({ ...criteria, leaseMonths: { values, weight: "must" } })} />
    <fieldset className="criterion"><legend>Amenities</legend><div className="amenity-grid">{amenityKeys.map(key => {
      const selected = criteria.amenities.find(item => item.key === key);
      return <div className="amenity-option" key={key}><button type="button" aria-pressed={!!selected} onClick={() => setCriteria({ ...criteria,
        amenities: selected ? criteria.amenities.filter(item => item.key !== key) : [...criteria.amenities, { key, weight: "must" }],
      })}>{amenityLabels[key]}</button></div>;
    })}</div></fieldset>
    <label>Anything else? <span className="muted">Optional</span><textarea name="notes" maxLength={500} defaultValue={initial?.notes} placeholder="Accessibility needs, lease length, preferred neighborhoods…" /></label>
    <p className="fine-print">We'll flag details that need confirmation, including move-in availability and additional preferences.</p>
    {error && <p role="alert" className="error">{error}</p>}<button>{pending ? "Starting search…" : "Find my apartments"}</button>
    </fieldset></form></Modal>;
}
