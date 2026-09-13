import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import App from "./App";
import "./styles.css";

const deploymentUrl = import.meta.env.VITE_CONVEX_URL;
const client = deploymentUrl ? new ConvexReactClient(deploymentUrl) : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {client ? (
      <ConvexAuthProvider client={client} api={{ refreshSession: api.auth.refreshSession, signOut: api.auth.signOut }}><App connected /></ConvexAuthProvider>
    ) : <App connected={false} />}
  </StrictMode>,
);
