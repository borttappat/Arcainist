import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
import { applyTheme } from "./prefs.ts";

applyTheme();

createRoot(document.getElementById("root")!).render(<App />);
