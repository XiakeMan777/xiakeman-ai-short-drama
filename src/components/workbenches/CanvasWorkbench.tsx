import { useEffect } from "react";
import { Canvas } from "@/features/canvas/Canvas";
import { useProjectStore } from "@/features/canvas/stores/projectStore";
import { ToastContainer } from "@/features/canvas/compat/Toast";
import { ConfirmDialog } from "@/features/canvas/compat/ConfirmDialog";
import { ErrorDialog } from "@/features/canvas/compat/ErrorDialog";
import { PromptDialog } from "@/features/canvas/compat/PromptDialog";
import { SettingsDialog } from "@/features/canvas/compat/SettingsDialog";

type CanvasWorkbenchProps = {
  onExit?: () => void;
};

export function CanvasWorkbench({ onExit }: CanvasWorkbenchProps) {
  useEffect(() => {
    void useProjectStore.getState().autoOpenLastProject();
  }, []);

  return (
    <div className="xkm-copilot-canvas">
      {onExit ? (
        <button type="button" className="xkm-canvas-return-button" onClick={onExit}>
          返回网站
        </button>
      ) : null}
      <Canvas />
      <ToastContainer />
      <ConfirmDialog />
      <ErrorDialog />
      <PromptDialog />
      <SettingsDialog />
    </div>
  );
}
