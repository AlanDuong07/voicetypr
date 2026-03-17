import React from "react";
import ReactDOM from "react-dom/client";
import { RecordingPill } from "./components/RecordingPill";
import { SettingsProvider } from "./contexts/SettingsContext";
import "./globals.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      <div className="flex h-screen w-screen items-center justify-center bg-transparent px-4 py-3">
        <RecordingPill />
      </div>
    </SettingsProvider>
  </React.StrictMode>,
);