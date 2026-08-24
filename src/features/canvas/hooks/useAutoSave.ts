import { useEffect, useRef } from "react";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useProjectStore } from "@/features/canvas/stores/projectStore";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import { useToastStore } from "@/features/canvas/compat/Toast";

/**
 * Auto-save hook: saves canvas state to project store when canvas changes.
 * Uses debounce to avoid excessive saves.
 *
 * CRASH RECOVERY: Also saves immediately on beforeunload (window close/refresh)
 * so that the project state is persisted even if the app crashes or is killed.
 *
 * PERFORMANCE: Only subscribes to `isDirty` flag — never to nodes/edges/history.
 * Reading data via getState() inside the timer avoids re-rendering on every node change.
 */
export function useAutoSave() {
  const isDirty = useCanvasStore((s) => s.isDirty);
  const markClean = useCanvasStore((s) => s.markClean);
  const currentProject = useProjectStore((s) => s.currentProject);
  const autoSave = useSettingsStore((s) => s.autoSave);
  const saveProject = useProjectStore((s) => s.saveProject);
  const saveViewport = useProjectStore((s) => s.saveViewport);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced auto-save on dirty state change
  useEffect(() => {
    if (!autoSave || !currentProject || !isDirty) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        // Read data from store directly — avoids subscribing to nodes/edges/history
        const { nodes, edges, history } = useCanvasStore.getState();
        await saveProject({
          nodesJson: JSON.stringify(nodes),
          edgesJson: JSON.stringify(edges),
          historyJson: JSON.stringify(history),
          nodeCount: nodes.length,
        });
        markClean();
      } catch (e) {
        console.error("Auto-save failed:", e);
        try { useToastStore.getState().addToast("error", "自动保存失败，请检查磁盘空间或手动保存"); } catch {}
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isDirty, autoSave, currentProject, saveProject, markClean]);

  // Save viewport separately with throttle
  useEffect(() => {
    if (!currentProject) return;
    const viewport = useCanvasStore.getState().viewport;

    if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);

    viewportTimerRef.current = setTimeout(async () => {
      try {
        await saveViewport(JSON.stringify(viewport));
      } catch (e) {
        console.error("Viewport save failed:", e);
      }
    }, 500);

    return () => {
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    };
  }, [currentProject, saveViewport]);

  // EMERGENCY SAVE: Persist state immediately on beforeunload
  // This ensures the project is saved even if the app crashes, is killed,
  // or the window is closed/refreshed with unsaved changes.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { isDirty: dirty, nodes, edges, history } = useCanvasStore.getState();
      if (!dirty) return;

      const project = useProjectStore.getState().currentProject;
      if (!project) return;

      const autoSaveEnabled = useSettingsStore.getState().autoSave;
      if (!autoSaveEnabled) return;

      // Use saveProject (fire-and-forget) so that image persistence
      // and compression run before the process exits.
      useProjectStore.getState().saveProject({
        nodesJson: JSON.stringify(nodes),
        edgesJson: JSON.stringify(edges),
        historyJson: JSON.stringify(history),
        nodeCount: nodes.length,
      }).then(() => markClean()).catch(() => { /* best effort */ });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [markClean]);
}



