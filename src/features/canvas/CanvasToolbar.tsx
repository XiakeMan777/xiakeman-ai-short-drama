import { useState, useCallback, useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { useSettingsDialogStore } from "@/features/canvas/compat/SettingsDialog";
import { useAssetStore } from "@/features/canvas/stores/assetStore";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useChatStore } from "@/features/canvas/stores/chatStore";
import { nodeRegistry } from "./domain/nodeRegistry";
import { GroupedNodeMenu } from "./ui/GroupedNodeMenu";

export function CanvasToolbar() {
  const openSettings = useSettingsDialogStore((s) => s.openSettings);
  const setSettingsTab = useSettingsDialogStore((s) => s.setActiveTab);
  const openAssetPanel = useAssetStore((s) => s.openPanel);
  const addNode = useCanvasStore((s) => s.addNode);
  const openChatPanel = useChatStore((s) => s.openPanel);
  const { screenToFlowPosition } = useReactFlow();

  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const handleOpenAssetLibrary = useCallback(() => {
    openAssetPanel();
  }, [openAssetPanel]);

  const handleOpenTutorial = useCallback(() => {
    openSettings();
    setSettingsTab("tutorial");
    setShowAddMenu(false);
  }, [openSettings, setSettingsTab]);

  const handleAddNode = useCallback((type: string) => {
    const def = nodeRegistry[type];
    if (!def) return;
    const nodeCount = useCanvasStore.getState().nodes.length;
    const MAX_NODES = 300;
    if (nodeCount >= MAX_NODES) {
      console.warn(`[CanvasToolbar] Node limit reached (${MAX_NODES}). Node not added.`);
      return;
    }
    const flowPosition = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const node = {
      id: `${type}-${Date.now()}`,
      type: def.type,
      position: flowPosition,
      data: def.createDefaultData(),
    };
    addNode(node);
    setShowAddMenu(false);
  }, [addNode, screenToFlowPosition]);

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div
      className="absolute z-10"
      style={{
        left: '12px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
        backgroundColor: 'var(--glass-bg)',
        backdropFilter: 'blur(var(--glass-blur))',
        WebkitBackdropFilter: 'blur(var(--glass-blur))',
        border: '1px solid var(--glass-border)',
        borderRadius: '12px',
        padding: '6px 4px',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* 添加节点 + */}
      <div ref={addMenuRef} style={{ position: 'relative' }}>
        <ToolbarButton
          onClick={() => { setShowAddMenu(!showAddMenu); }}
          title="添加节点"
          active={showAddMenu}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          }
        />
        {showAddMenu && (
          <div
            style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              marginLeft: 8,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <GroupedNodeMenu onAddNode={handleAddNode} />
          </div>
        )}
      </div>

      {/* 素材库 */}
      <ToolbarButton
        onClick={handleOpenAssetLibrary}
        title="素材库"
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
            <line x1="12" y1="10" x2="12" y2="16"/>
            <line x1="9" y1="13" x2="15" y2="13"/>
          </svg>
        }
      />

      {/* AI 对话 */}
      <ToolbarButton
        onClick={openChatPanel}
        title="AI 对话"
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        }
      />

      {/* 分隔线 */}
      <div style={{
        width: '20px',
        height: '1px',
        backgroundColor: 'var(--border)',
        margin: '4px 0',
        flexShrink: 0,
      }} />

      {/* 设置 */}
      <ToolbarButton
        onClick={openSettings}
        title="画布模型设置"
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        }
      />

      <ToolbarButton
        onClick={handleOpenTutorial}
        title="画布使用教程"
        icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
            <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/>
            <path d="M8 7h8"/>
            <path d="M8 11h6"/>
          </svg>
        }
      />
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  icon,
  active = false,
}: {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '34px',
        height: '34px',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        borderRadius: '8px',
        backgroundColor: active ? 'rgba(255,255,255,0.04)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)';
          e.currentTarget.style.color = 'var(--text-primary)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.color = 'var(--text-secondary)';
        }
      }}
    >
      {icon}
    </button>
  );
}



