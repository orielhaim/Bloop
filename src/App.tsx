import { Island } from "./components/island/island";
import { SettingsApp } from "./settings/app";

export default function App() {
  const settings =
    new URLSearchParams(window.location.search).get("surface") === "settings";
  return settings ? <SettingsApp /> : <Island />;
}
