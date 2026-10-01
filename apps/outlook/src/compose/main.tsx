import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ComposeApp } from "./ComposeApp";
import { awaitOffice, installStorageAdapter } from "../lib/office";
import { installApiTracer } from "../lib/diagnostics";
import { applyUrlParamConfig } from "@iusehalo/halo-api";

async function bootstrap() {
  await awaitOffice();
  installStorageAdapter();
  installApiTracer("compose");
  await applyUrlParamConfig();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <FluentProvider theme={webLightTheme}>
        <ComposeApp />
      </FluentProvider>
    </React.StrictMode>,
  );
}

bootstrap().catch((err) => {
  // Last-resort error display before React mounts
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `<div style="padding:16px;color:#a4262c;font-family:Segoe UI,system-ui,sans-serif">
      <strong>Initialization failed</strong><br/>${String(err)}
    </div>`;
  }
});
