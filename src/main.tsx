import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startTheme } from "./lib/theme";
import { lockZoom } from "./lib/zoom";
import { forgetFreshParam, watchForStaleChunks } from "./lib/staleBuild";
import "./styles/app.css";

// Before the first render, not inside it: a card painted white and repainted
// dark a frame later is a flash of the wrong screen.
startTheme();
// The tag a fresh reload arrived with, and boot.js's note that it tried one:
// the app is running, so both have done their job.
forgetFreshParam();
try {
  sessionStorage.removeItem("church-directory:boot-retry");
} catch {
  // Storage switched off: boot.js could not have written the note either.
}
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
