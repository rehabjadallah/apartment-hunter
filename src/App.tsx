import { Component, type ReactNode } from "react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import AuthForm from "./AuthForm";
import Dashboard from "./Dashboard";

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <section className="panel"><h2>We couldn't load your search.</h2><p>Please refresh and try again.</p><button onClick={() => window.location.reload()}>Refresh</button></section> : this.props.children; }
}
export default function App({ connected }: { connected: boolean }) {
  return <main>
    <header><a className="brand" href="/"><svg className="mark" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M3.5 10.2 12 3.5l8.5 6.7V20a.5.5 0 0 1-.5.5h-5.2v-6h-5.6v6H4a.5.5 0 0 1-.5-.5z" /></svg><span>Apartment Hunter</span></a><span className="badge">Ann Arbor, MI</span></header>
    <ErrorBoundary>
      {!connected ? <p>Connect the development deployment to get started.</p> : <>
        <AuthLoading><p role="status" className="empty">Loading…</p></AuthLoading>
        <Unauthenticated><div className="welcome"><section className="intro">
          <p className="eyebrow">Rentals in Ann Arbor</p>
          <h1>Only the listings that <span>actually match.</span></h1>
          <p className="subtitle">Set your filters once. Apartment Hunter reads each listing, keeps only the ones that confirm every filter on the page, and shows you what the listing left out.</p>
          <div className="steps"><span><b>01</b> Set your filters</span><span><b>02</b> See what each listing confirms</span><span><b>03</b> Email the landlord</span></div>
        </section><AuthForm /></div></Unauthenticated>
        <Authenticated><Dashboard /></Authenticated>
      </>}
    </ErrorBoundary>
    <footer>Apartment Hunter <span>Ann Arbor, Michigan</span></footer>
  </main>;
}
