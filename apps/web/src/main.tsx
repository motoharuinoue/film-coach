import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-jp";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createServices } from "./composition";
import { App } from "./presentation/App";
import { ServicesProvider } from "./presentation/services";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ServicesProvider services={createServices()}>
      <App />
    </ServicesProvider>
  </StrictMode>,
);
