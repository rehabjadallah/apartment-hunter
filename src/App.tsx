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
    <header><a className="brand" href="/">⌂ <span>Apartment Hunter</span></a><span className="badge">Ann Arbor, MI</span></header>
    <ErrorBoundary>
      {!connected ? <p>Connect the development deployment to get started.</p> : <>
        <AuthLoading><p role="status" className="empty">Getting your space ready…</p></AuthLoading>
        <Unauthenticated><div className="welcome"><section className="intro">
          <p className="eyebrow">Less searching. More living.</p>
          <h1>Your next place.<br /><span>Starts here.</span></h1>
          <p className="subtitle">Find an apartment in Ann Arbor that fits your life. Tell us what matters. We'll help with the search and the follow-up.</p>
          <div className="steps"><span>01 &nbsp; Set your preferences</span><span>02 &nbsp; Explore your matches</span><span>03 &nbsp; Start a conversation</span></div>
        </section><AuthForm /></div></Unauthenticated>
        <Authenticated><Dashboard /></Authenticated>
      </>}
    </ErrorBoundary>
    <footer>Apartment Hunter <span>Room for what's next.</span></footer>
  </main>;
}
