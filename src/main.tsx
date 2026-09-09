import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startTheme } from "./lib/theme";
import { lockZoom } from "./lib/zoom";
import "./styles/app.css";

// Before the first render, not inside it: a card painted white and repainted
// dark a frame later is a flash of the wrong screen.
startTheme();
lockZoom();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
