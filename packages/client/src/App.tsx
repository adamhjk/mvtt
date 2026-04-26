import { RootSurface } from "@vtt/substrate";
import { Surface } from "@vtt/substrate/client";

export function App() {
  return <Surface name={RootSurface.name} />;
}
