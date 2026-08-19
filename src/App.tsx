import { Island } from "./components/island/island";
import { CompositionLab } from "./lab/composition-lab";
import { MotionLab } from "./lab/motion-lab";
import { SettingsApp } from "./settings/app";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const surface = params.get("surface");
  if (surface === "settings") {
    return <SettingsApp />;
  }
  if (surface === "compose") {
    return <CompositionLab />;
  }
  if (surface === "motion") {
    return <MotionLab />;
  }
  return <Island />;
}
