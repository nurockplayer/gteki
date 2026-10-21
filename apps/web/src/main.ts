import "./styles.css";
import { App } from "./ui/app.ts";

const root = document.getElementById("app")!;
new App(root).start().catch((err) => {
  root.textContent = `GTEki failed to start: ${String(err)}`;
  console.error(err);
});
