import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { lockZoom } from "./lib/zoom";
import "./styles/app.css";

lockZoom();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
