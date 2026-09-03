import { ReactFlowProvider } from "@xyflow/react";
import { CanvasApp } from "./canvas/CanvasApp";

export function App() {
  return (
    <ReactFlowProvider>
      <CanvasApp />
    </ReactFlowProvider>
  );
}
