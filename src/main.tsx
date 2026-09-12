import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startTheme } from "./lib/theme";
import { lockZoom } from "./lib/zoom";
import { watchForStaleChunks } from "./lib/staleBuild";
import "./styles/app.css";

// Before the first render, not inside it: a card painted white and repainted
// dark a frame later is a flash of the wrong screen.
startTheme();
lockZoom();
// Registered before anything can be imported on demand, since the screens
// below the shell are fetched when they are opened and a deploy in between is
// what this is here for.
watchForStaleChunks();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
