import React from "react";
import ReactDOM from "react-dom/client";
import { FeedbackToast } from "./components/FeedbackToast";
import "./globals.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <div className="h-screen w-screen overflow-visible bg-transparent">
      <FeedbackToast />
    </div>
  </React.StrictMode>,
);
