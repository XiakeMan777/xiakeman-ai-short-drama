import { useState, useCallback, useMemo, memo, useRef } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useToastStore } from "@/features/canvas/compat/Toast";
import type { ScriptResultNodeData, ScriptFrame, CharacterEntity, SceneEntity } from "../domain/canvasNodes";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { CANVAS_NODE_TYPES } from "../domain/canvasNodes";
import { nodeRegistry } from "../domain/nodeRegistry";
import Papa from "papaparse";

/** Build a composite AI image prompt from structured frame data */
export function buildCompositePrompt(frame: ScriptFrame): string {
  const parts: string[] = [];
  if (frame.sceneDescription) parts.push(frame.sceneDescription);
  if (frame.shotType) parts.push(`${frame.shotType}镜头`);
  if (frame.cameraAngle) parts.push(`${frame.cameraAngle}视角`);
  if (frame.characterAction) parts.push(frame.characterAction);
  if (frame.emotion) parts.push(frame.emotion);
  if (frame.lighting) parts.push(frame.lighting);
  if (frame.character) parts.push(frame.character);
  if (frame.sceneTag) parts.push(frame.sceneTag);
  return parts.join("，");
}

/** View mode for ScriptResultNode */
type ViewMode = "table" | "libtv";

/** Step index for LibTV-style three-step navigation */
type StepIndex = 1 | 2 | 3;

/** Predefined options for select fields */
const SHOT_TYPE_OPTIONS = ["特写", "近景", "中景", "全景", "远景", "大远景"];
const CAMERA_ANGLE_OPTIONS = ["平视", "仰视", "俯视", "鸟瞰", "低角度", "高角度"];
const CAMERA_MOVEMENT_OPTIONS = ["固定", "推", "拉", "摇", "移", "跟", "升", "降", "环绕", "手持"];
const DURATION_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 15];
const LIGHTING_OPTIONS = ["自然光", "柔光", "硬光", "逆光", "侧光", "顶光", "暖光", "冷光", "霓虹光"];

/** Extract unique characters from frame descriptions (@角色 references) */
function extractCharactersFromFrames(frames: ScriptFrame[]): CharacterEntity[] {
  const map = new Map<string, CharacterEntity>();
  for (const f of frames) {
    if (f.sceneDescription) {
      const charMatches = f.sceneDescription.matchAll(/@([^\s,，。！？；：\d]+)/g);
      for (const m of charMatches) {
        const name = m[1];
        const existing = map.get(name);
        if (existing) {
          if (!existing.shotNumbers.includes(f.shotNumber ?? 0)) existing.shotNumbers.push(f.shotNumber ?? 0);
        } else {
          map.set(name, { name, avatar: null, description: "", shotNumbers: [f.shotNumber ?? 0] });
        }
      }
    }
    // Also extract from character field
    if (f.character) {
      const names = f.character.split(/[,，、\s]+/).filter(Boolean);
      for (const name of names) {
        const existing = map.get(name);
        if (existing) {
          if (!existing.shotNumbers.includes(f.shotNumber ?? 0)) existing.shotNumbers.push(f.shotNumber ?? 0);
        } else {
          map.set(name, { name, avatar: null, description: "", shotNumbers: [f.shotNumber ?? 0] });
        }
      }
    }
  }
  return Array.from(map.values());
}

/** Extract unique scenes from frame sceneTag fields */
function extractScenesFromFrames(frames: ScriptFrame[]): SceneEntity[] {
  const map = new Map<string, SceneEntity>();
  for (const f of frames) {
    const name = f.sceneTag;
    if (name) {
      const existing = map.get(name);
      if (existing) {
        if (!existing.shotNumbers.includes(f.shotNumber ?? 0)) existing.shotNumbers.push(f.shotNumber ?? 0);
      } else {
        map.set(name, { name, referenceImage: null, description: "", shotNumbers: [f.shotNumber ?? 0] });
      }
    }
  }
  return Array.from(map.values());
}

/** Merge extracted characters with existing persisted characters */
function mergeCharacters(
  extracted: CharacterEntity[],
  persisted: CharacterEntity[] | undefined
): CharacterEntity[] {
  const persistedMap = new Map<string, CharacterEntity>();
  for (const c of persisted || []) persistedMap.set(c.name, c);
  return extracted.map((c) => {
    const existing = persistedMap.get(c.name);
    if (existing) {
      // Merge shotNumbers from extracted, keep avatar/description from persisted
      return { ...existing, shotNumbers: c.shotNumbers };
    }
    return c;
  });
}

/** Merge extracted scenes with existing persisted scenes */
function mergeScenes(
  extracted: SceneEntity[],
  persisted: SceneEntity[] | undefined
): SceneEntity[] {
  const persistedMap = new Map<string, SceneEntity>();
  for (const s of persisted || []) persistedMap.set(s.name, s);
  return extracted.map((s) => {
    const existing = persistedMap.get(s.name);
    if (existing) {
      return { ...existing, shotNumbers: s.shotNumbers };
    }
    return s;
  });
}

/** CSV table headers matching the ScriptResultNode display columns */
const CSV_HEADERS = [
  "镜号", "时长", "画面描述", "景别", "机位", "运动",
  "动作", "情绪", "对白", "光影", "场景", "音效", "角色", "角色描述",
];

/** Map ScriptFrame fields to CSV row order (same as CSV_HEADERS) */
function frameToCsvRow(frame: ScriptFrame, idx: number): string[] {
  return [
    String(frame.shotNumber ?? idx + 1),
    String(frame.duration ?? ""),
    frame.sceneDescription || "",
    frame.shotType || "",
    frame.cameraAngle || "",
    frame.cameraMovement || "",
    frame.characterAction || "",
    frame.emotion || "",
    frame.dialogue || "",
    frame.lighting || "",
    frame.sceneTag || "",
    frame.sound || "",
    frame.character || "",
    frame.characterDesc || "",
  ];
}

/** Trigger a file download from a Blob in the browser */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Script Result Node — displays AI-generated storyboard frames.
 *
 * Features:
 * - Two view modes: traditional table + LibTV-style 3-step workflow
 * - LibTV mode: ①输入镜头 → ②准备资产 → ③合成提示词
 * - Step3 has inline editable table (all cells editable/selectable)
 * - Step2 has character/scene cards with click-to-edit drawer panel
 * - Push to StoryboardGenNode
 * - Export to CSV / Excel
 * - Shows streaming skeleton while generating
 */
export const ScriptResultNode = memo(function ScriptResultNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as ScriptResultNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const addToast = useToastStore((s) => s.addToast);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [currentStep, setCurrentStep] = useState<StepIndex>(1);
  const [previewingFrame, setPreviewingFrame] = useState<number | null>(null);
  // Character/scene editing drawer
  const [editingCharacter, setEditingCharacter] = useState<string | null>(null); // character name being edited
  const [editingScene, setEditingScene] = useState<string | null>(null); // scene name being edited
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const nodeWidth = nodeData.width || (viewMode === "libtv" ? 960 : 900);
  const nodeHeight = nodeData.height || (viewMode === "libtv" ? 680 : 580);
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  const frames = nodeData.frames || [];
  const isStreaming = nodeData.isStreaming ?? false;

  // ── Derived characters/scenes (merge extracted with persisted) ──
  const characters = useMemo(
    () => mergeCharacters(extractCharactersFromFrames(frames), nodeData.characters),
    [frames, nodeData.characters]
  );
  const scenes = useMemo(
    () => mergeScenes(extractScenesFromFrames(frames), nodeData.scenes),
    [frames, nodeData.scenes]
  );
  const totalDuration = useMemo(() => frames.reduce((sum, f) => sum + (Number(f.duration) || 5), 0), [frames]);

  // ── Cell change handler (works for both table and LibTV Step3) ──
  const handleCellChange = useCallback(
    (frameIdx: number, field: keyof ScriptFrame, value: string | number) => {
      const newFrames = [...frames];
      newFrames[frameIdx] = { ...newFrames[frameIdx], [field]: value };
      updateNodeData(id, { frames: newFrames });
    },
    [id, frames, updateNodeData]
  );

  const handleDeleteFrame = useCallback(
    (frameIdx: number) => {
      const newFrames = frames.filter((_, i) => i !== frameIdx);
      updateNodeData(id, {
        frames: newFrames,
        displayName: `分镜脚本(${newFrames.length}镜)`,
      });
    },
    [id, frames, updateNodeData]
  );

  // ── Character/scene entity update handlers ──
  const handleCharacterUpdate = useCallback(
    (name: string, updates: Partial<CharacterEntity>) => {
      const currentChars = characters.map((c) =>
        c.name === name ? { ...c, ...updates } : c
      );
      updateNodeData(id, { characters: currentChars });
    },
    [id, characters, updateNodeData]
  );

  const handleSceneUpdate = useCallback(
    (name: string, updates: Partial<SceneEntity>) => {
      const currentScenes = scenes.map((s) =>
        s.name === name ? { ...s, ...updates } : s
      );
      updateNodeData(id, { scenes: currentScenes });
    },
    [id, scenes, updateNodeData]
  );

  const handlePushToStoryboard = useCallback(() => {
    if (frames.length === 0) {
      addToast("warning", "没有可分镜的帧");
      return;
    }

    const entry = nodeRegistry[CANVAS_NODE_TYPES.storyboardGen];
    if (!entry) {
      addToast("error", "无法创建分镜节点");
      return;
    }

    const store = useCanvasStore.getState();
    const { nodes, edges } = store;

    const existingEdge = edges.find(
      (e) => e.source === id && nodes.find((n) => n.id === e.target)?.type === entry.type
    );

    const storyboardFrames = frames.map((f) => ({
      index: f.shotNumber,
      label: `镜头${f.shotNumber}`,
      description: buildCompositePrompt(f),
      notes: `景别:${f.shotType}|机位:${f.cameraAngle}|运动:${f.cameraMovement}|情绪:${f.emotion}|对白:${f.dialogue}`,
      imageUrl: null,
      duration: f.duration ?? 5,
    }));

    // Auto-calculate cols: 2 cols for ≤2 frames, 3 cols for 3-6, 4 cols for 7+
    const autoCols = storyboardFrames.length <= 2 ? 2 : storyboardFrames.length <= 6 ? 3 : 4;
    const autoRows = Math.ceil(storyboardFrames.length / autoCols);

    if (existingEdge) {
      const targetNode = nodes.find((n) => n.id === existingEdge.target);
      if (targetNode) {
        store.updateNodeData(targetNode.id, {
          frames: storyboardFrames,
          rows: autoRows,
          cols: autoCols,
          displayName: `剧本分镜(${storyboardFrames.length}镜)`,
        });
        addToast("success", `已更新分镜节点(${storyboardFrames.length} 帧)`);
        return;
      }
    }

    const currentNode = nodes.find((n) => n.id === id);
    const posX = currentNode?.position?.x ?? 0;
    const posY = currentNode?.position?.y ?? 0;

    const newNode = {
      id: `sb-${id}-${Date.now()}`,
      type: entry.type,
      position: { x: posX + nodeWidth + 40, y: posY },
      data: {
        ...entry.createDefaultData(),
        frames: storyboardFrames,
        rows: autoRows,
        cols: autoCols,
        displayName: `剧本分镜(${storyboardFrames.length}镜)`,
      },
    };

    store.addNode(newNode);
    store.onConnect({
      source: id,
      target: newNode.id,
      sourceHandle: null,
      targetHandle: null,
    });
    addToast("success", `已创建分镜节点(${storyboardFrames.length} 帧)`);
  }, [frames, id, nodeWidth, addToast]);

  // ── Export handlers ──────────────────────────────────────────────
  const handleExportCsv = useCallback(() => {
    if (frames.length === 0) { addToast("warning", "没有可导出的数据"); return; }
    const csvRows = [CSV_HEADERS, ...frames.map((f, i) => frameToCsvRow(f, i))];
    const csvContent = Papa.unparse(csvRows);
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `${nodeData.displayName || "分镜脚本"}.csv`);
    addToast("success", "已导出 CSV");
    setShowExportMenu(false);
  }, [frames, nodeData.displayName, addToast]);

  // ── Inline editable components for Step3 table ──────────────────────
  /** Inline select (for predefined options like 景别/机位/运动) */
  const InlineSelect = ({ value, options, onChange, placeholder }: {
    value: string; options: string[]; onChange: (v: string) => void; placeholder?: string;
  }) => (
    <select className="nodrag" value={value || ""} onChange={(e) => onChange(e.target.value)}
      style={{
        fontSize: "11px", border: "1px solid var(--border)", borderRadius: "4px",
        background: "var(--bg-surface)", color: value ? "var(--text-primary)" : "var(--text-muted)",
        padding: "2px 4px", cursor: "pointer", width: "100%",
      }}
    >
      <option value="">{placeholder || "选择"}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  /** Inline input (for text fields like 对白/音效) */
  const InlineInput = ({ value, onChange, placeholder }: {
    value: string; onChange: (v: string) => void; placeholder?: string;
  }) => (
    <input className="nodrag" value={value || ""} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        fontSize: "11px", border: "1px solid var(--border)", borderRadius: "4px",
        background: "var(--bg-surface)", color: "var(--text-primary)",
        padding: "2px 4px", width: "100%", outline: "none",
      }}
    />
  );

  /** Inline textarea (for sceneDescription) */
  const InlineTextarea = ({ value, onChange, placeholder }: {
    value: string; onChange: (v: string) => void; placeholder?: string;
  }) => (
    <textarea className="nodrag" value={value || ""} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        fontSize: "11px", border: "1px solid var(--border)", borderRadius: "4px",
        background: "var(--bg-surface)", color: "var(--text-primary)",
        padding: "4px 6px", width: "100%", minHeight: "28px", maxHeight: "80px",
        resize: "vertical", outline: "none", lineHeight: 1.4,
      }}
    />
  );

  // ── Render ──────────────────────────────────────────────────────
  return (
    <>
      <NodeDeleteButton id={id} selected={selected ?? false} />
      <div style={{ position: "relative" }} onClick={() => showExportMenu && setShowExportMenu(false)}>
        <div className="node-inner" style={{
          backgroundColor: "var(--bg-node)", border: "1px solid var(--border)",
          borderRadius: "var(--node-radius)", width: nodeWidth, height: nodeHeight,
          display: "flex", flexDirection: "column", boxSizing: "border-box",
          maxHeight: "75vh", boxShadow: "0 2px 12px rgba(0,0,0,.3)",
        }}>

          {/* ── Header ── */}
          <div className="flex items-center justify-between shrink-0" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)" }}>
                {nodeData.displayName || "分镜脚本"}
              </span>
              {isStreaming && (
                <span style={{ fontSize: "10px", color: "var(--accent-btn)", animation: "pulse 1.5s infinite" }}>
                  生成中…
                </span>
              )}
            </div>

            {/* View mode toggle + action buttons */}
            <div className="flex items-center gap-2">
              {/* View mode toggle */}
              <div className="flex items-center gap-1 nodrag">
                <button onClick={() => setViewMode("libtv")} style={{
                  padding: '3px 8px', borderRadius: '6px',
                  border: viewMode === 'libtv' ? '1px solid var(--accent)' : '1px solid var(--border)',
                  backgroundColor: viewMode === 'libtv' ? 'var(--bg-hover)' : 'transparent',
                  color: viewMode === 'libtv' ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: '11px', cursor: 'pointer', fontWeight: viewMode === 'libtv' ? 500 : 400,
                }} title="一键化模式">一键化</button>
                <button onClick={() => setViewMode("table")} style={{
                  padding: '3px 8px', borderRadius: '6px',
                  border: viewMode === 'table' ? '1px solid var(--accent)' : '1px solid var(--border)',
                  backgroundColor: viewMode === 'table' ? 'var(--bg-hover)' : 'transparent',
                  color: viewMode === 'table' ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: '11px', cursor: 'pointer', fontWeight: viewMode === 'table' ? 500 : 400,
                }} title="表格视图">表格</button>
              </div>

              <button onClick={handlePushToStoryboard} disabled={isStreaming || frames.length === 0}
                className="nodrag" style={{
                  padding: "4px 10px", borderRadius: "6px", backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "11px",
                  cursor: isStreaming || frames.length === 0 ? "not-allowed" : "pointer",
                  opacity: isStreaming || frames.length === 0 ? 0.5 : 1, whiteSpace: "nowrap",
                }} title="推送到分镜节点"
              >推送到分镜</button>

              {/* Export dropdown */}
              <div style={{ position: "relative" }} className="nodrag">
                <button onClick={() => setShowExportMenu((v) => !v)} disabled={isStreaming || frames.length === 0}
                  className="nodrag" style={{
                    padding: "4px 10px", borderRadius: "6px", backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: "11px",
                    cursor: isStreaming || frames.length === 0 ? "not-allowed" : "pointer",
                    opacity: isStreaming || frames.length === 0 ? 0.5 : 1, whiteSpace: "nowrap",
                  }} title="导出分镜脚本"
                >导出</button>
                {showExportMenu && (
                  <div style={{
                    position: "absolute", top: "100%", right: 0, marginTop: 4,
                    backgroundColor: "var(--bg-node)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.4)",
                    zIndex: 100, minWidth: 140, overflow: "hidden",
                  }} onClick={(e) => e.stopPropagation()}>
                    {[
                      { label: "导出 CSV（Excel 可打开）", handler: handleExportCsv },
                    ].map((item) => (
                      <button key={item.label} onClick={(e) => { e.stopPropagation(); item.handler(); }}
                        className="nodrag" style={{
                          display: "block", width: "100%", padding: "8px 14px", textAlign: "left",
                          background: "transparent", border: "none", color: "var(--text-primary)",
                          fontSize: "12px", cursor: "pointer", transition: "background .15s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >{item.label}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Three-step navigation (only in LibTV mode) ── */}
          {viewMode === "libtv" && (
            <div className="flex items-center gap-0 nodrag" style={{ padding: '0 16px 8px 16px', borderBottom: '1px solid var(--border)', marginBottom: '8px' }}>
              {([
                { step: 1, label: "输入镜头", icon: "1" },
                { step: 2, label: "准备资产", icon: "2" },
                { step: 3, label: "合成提示词", icon: "3" },
              ] as const).map(({ step, label, icon }) => (
                <button key={step} onClick={() => setCurrentStep(step as StepIndex)} style={{
                  flex: 1, padding: '6px 0', borderRadius: '6px',
                  border: currentStep === step ? '1px solid var(--accent)' : '0.5px solid var(--border)',
                  backgroundColor: currentStep === step ? 'var(--bg-hover)' : 'transparent',
                  color: currentStep === step ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: '11px', cursor: 'pointer', fontWeight: currentStep === step ? 500 : 400,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  transition: 'all 0.2s',
                }}>
                  <span style={{
                    width: '18px', height: '18px', borderRadius: '50%',
                    backgroundColor: currentStep === step ? 'var(--accent)' : 'var(--bg-secondary)',
                    color: currentStep === step ? '#fff' : 'var(--text-muted)',
                    fontSize: '10px', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    lineHeight: 1,
                  }}>{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* ── Prompt preview popup ── */}
          {previewingFrame !== null && frames[previewingFrame] && (
            <div className="nodrag" style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              padding: '16px', zIndex: 100, width: '360px', maxWidth: '90%',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  镜头 #{(frames[previewingFrame].shotNumber ?? previewingFrame + 1)} 提示词预览
                </span>
                <button onClick={() => setPreviewingFrame(null)}
                  style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px', padding: 0, lineHeight: 1 }}
                >x</button>
              </div>
              <div style={{
                fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6,
                backgroundColor: 'var(--bg-secondary)', borderRadius: '8px', padding: '12px',
                wordBreak: 'break-word', maxHeight: '200px', overflowY: 'auto',
              }}>
                {buildCompositePrompt(frames[previewingFrame])}
              </div>
              <button className="nodrag"
                onClick={() => {
                  navigator.clipboard.writeText(buildCompositePrompt(frames[previewingFrame]))
                    .then(() => addToast("success", "提示词已复制"));
                }}
                style={{
                  marginTop: '8px', padding: '4px 12px', borderRadius: '6px',
                  backgroundColor: 'var(--accent)', color: '#fff', fontSize: '11px',
                  border: 'none', cursor: 'pointer', fontWeight: 500,
                }}
              >复制提示词</button>
            </div>
          )}

          {/* ── Character edit drawer (Step2, slides from right) ── */}
          {editingCharacter !== null && (() => {
            const char = characters.find((c) => c.name === editingCharacter);
            if (!char) return null;
            return (
              <div className="nodrag" style={{
                position: 'absolute', top: 0, right: 0, bottom: 0,
                width: '280px', backgroundColor: 'var(--bg-surface)',
                borderLeft: '1px solid var(--border)', borderRadius: '0 var(--node-radius) var(--node-radius) 0',
                boxShadow: '-4px 0 16px rgba(0,0,0,0.3)', zIndex: 50,
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Drawer header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    编辑角色 @{char.name}
                  </span>
                  <button onClick={() => setEditingCharacter(null)}
                    style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px', padding: 0 }}
                  >x</button>
                </div>
                {/* Drawer content */}
                <div className="nowheel" style={{ flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Avatar */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <div onClick={() => avatarInputRef.current?.click()} style={{
                      width: '80px', height: '80px', borderRadius: '50%',
                      backgroundColor: 'var(--bg-secondary)', border: '2px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', overflow: 'hidden', position: 'relative',
                    }}>
                      {char.avatar ? (
                        <img src={char.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
                      ) : (
                        <span style={{ fontSize: '32px', fontWeight: 500, color: 'var(--text-muted)' }}>{char.name[0]}</span>
                      )}
                      {/* Hover overlay */}
                      <div style={{
                        position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: 0, transition: 'opacity 0.2s',
                        fontSize: '10px', color: '#fff', fontWeight: 500,
                      }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
                      >上传头像</div>
                    </div>
                    <input ref={avatarInputRef} type="file" accept="image/*" hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            handleCharacterUpdate(char.name, { avatar: ev.target?.result as string });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </div>
                  {/* Name */}
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>角色名称</label>
                    <input className="nodrag" value={char.name}
                      onChange={(e) => {
                        // Rename character — also update all frame references
                        const newName = e.target.value;
                        const oldName = char.name;
                        const newFrames = frames.map((f) => ({
                          ...f,
                          sceneDescription: f.sceneDescription?.replace(`@${oldName}`, `@${newName}`),
                          character: f.character === oldName ? newName : f.character?.replace(oldName, newName),
                        }));
                        // Also rename in characters array
                        const newChars = characters.map((c) =>
                          c.name === oldName ? { ...c, name: newName } : c
                        );
                        updateNodeData(id, { frames: newFrames, characters: newChars });
                        setEditingCharacter(newName);
                      }}
                      style={{
                        width: '100%', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '6px',
                        padding: '6px 8px', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none',
                      }}
                    />
                  </div>
                  {/* Description */}
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>角色描述</label>
                    <textarea className="nodrag" value={char.description || ""}
                      onChange={(e) => handleCharacterUpdate(char.name, { description: e.target.value })}
                      placeholder="描述角色的外貌、性格、穿着等..."
                      style={{
                        width: '100%', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '6px',
                        padding: '6px 8px', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)',
                        minHeight: '80px', maxHeight: '200px', resize: 'vertical', outline: 'none', lineHeight: 1.4,
                      }}
                    />
                  </div>
                  {/* Shot numbers info */}
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    出现镜头: {char.shotNumbers.join(", ")}
                  </div>
                </div>
                {/* Drawer bottom: save button */}
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                  <button className="nodrag"
                    onClick={() => {
                      addToast("success", `角色 @${char.name} 已保存`);
                      setEditingCharacter(null);
                    }}
                    style={{
                      width: '100%', padding: '8px', borderRadius: '8px',
                      backgroundColor: 'var(--accent)', color: '#fff', fontSize: '12px',
                      border: 'none', cursor: 'pointer', fontWeight: 500,
                    }}
                  >保存到AI角色库</button>
                </div>
              </div>
            );
          })()}

          {/* ── Scene edit drawer (Step2, slides from right) ── */}
          {editingScene !== null && (() => {
            const scene = scenes.find((s) => s.name === editingScene);
            if (!scene) return null;
            return (
              <div className="nodrag" style={{
                position: 'absolute', top: 0, right: 0, bottom: 0,
                width: '280px', backgroundColor: 'var(--bg-surface)',
                borderLeft: '1px solid var(--border)', borderRadius: '0 var(--node-radius) var(--node-radius) 0',
                boxShadow: '-4px 0 16px rgba(0,0,0,0.3)', zIndex: 50,
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                    编辑场景: {scene.name}
                  </span>
                  <button onClick={() => setEditingScene(null)}
                    style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px', padding: 0 }}
                  >x</button>
                </div>
                <div className="nowheel" style={{ flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Reference image */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '120px', height: '80px', borderRadius: '8px',
                      backgroundColor: 'var(--bg-secondary)', border: '2px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden', fontSize: '12px', color: 'var(--text-muted)',
                    }}>
                      {scene.referenceImage ? (
                        <img src={scene.referenceImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
                      ) : "参考图"}
                    </div>
                  </div>
                  {/* Name */}
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>场景名称</label>
                    <input className="nodrag" value={scene.name}
                      onChange={(e) => handleSceneUpdate(scene.name, { name: e.target.value })}
                      style={{
                        width: '100%', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '6px',
                        padding: '6px 8px', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none',
                      }}
                    />
                  </div>
                  {/* Description */}
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>场景描述</label>
                    <textarea className="nodrag" value={scene.description || ""}
                      onChange={(e) => handleSceneUpdate(scene.name, { description: e.target.value })}
                      placeholder="描述场景的环境、氛围..."
                      style={{
                        width: '100%', fontSize: '12px', border: '1px solid var(--border)', borderRadius: '6px',
                        padding: '6px 8px', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)',
                        minHeight: '60px', maxHeight: '150px', resize: 'vertical', outline: 'none', lineHeight: 1.4,
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    出现镜头: {scene.shotNumbers.join(", ")}
                  </div>
                </div>
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                  <button className="nodrag"
                    onClick={() => {
                      addToast("success", `场景 "${scene.name}" 已保存`);
                      setEditingScene(null);
                    }}
                    style={{
                      width: '100%', padding: '8px', borderRadius: '8px',
                      backgroundColor: 'var(--accent)', color: '#fff', fontSize: '12px',
                      border: 'none', cursor: 'pointer', fontWeight: 500,
                    }}
                  >保存场景</button>
                </div>
              </div>
            );
          })()}

          {/* ── Content area ── */}
          {viewMode === "table" ? (
            /* ── TABLE MODE (original) ── */
            <div className="nowheel" style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              {frames.length === 0 && isStreaming ? (
                <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                  <div style={{ marginBottom: "12px" }}>正在生成分镜脚本...</div>
                </div>
              ) : frames.length === 0 ? (
                <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                  暂无分镜数据
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", tableLayout: "fixed" }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 1, backgroundColor: "var(--bg-secondary)" }}>
                    <tr>
                      <Th w={36}>#</Th>
                      <Th w={48}>时长</Th>
                      <Th w={160}>画面描述</Th>
                      <Th w={48}>景别</Th>
                      <Th w={48}>机位</Th>
                      <Th w={48}>运动</Th>
                      <Th w={64}>动作</Th>
                      <Th w={48}>情绪</Th>
                      <Th w={80}>对白</Th>
                      <Th w={56}>光影</Th>
                      <Th w={56}>场景</Th>
                      <Th w={56}>音效</Th>
                      <Th w={56}>角色</Th>
                      <Th w={40}>操作</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {frames.map((frame, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid var(--border)", backgroundColor: idx % 2 === 0 ? "transparent" : "var(--bg-hover)" }}>
                        <Td center>{frame.shotNumber}</Td>
                        <Td center><EditableCell frameIdx={idx} field="duration" value={frame.duration} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="sceneDescription" value={frame.sceneDescription} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="shotType" value={frame.shotType} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="cameraAngle" value={frame.cameraAngle} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="cameraMovement" value={frame.cameraMovement} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="characterAction" value={frame.characterAction} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="emotion" value={frame.emotion} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="dialogue" value={frame.dialogue} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="lighting" value={frame.lighting} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="sceneTag" value={frame.sceneTag} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="sound" value={frame.sound} onChange={handleCellChange} /></Td>
                        <Td><EditableCell frameIdx={idx} field="character" value={frame.character} onChange={handleCellChange} /></Td>
                        <Td center>
                          <button onClick={() => handleDeleteFrame(idx)} className="nodrag"
                            style={{ border: "none", backgroundColor: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: "12px", padding: "2px 4px" }}
                            title="删除此行"
                          >x</button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            /* ── LIBTV MODE ── */
            <div className="nowheel" style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '16px' }}>
              {/* Step 1: 输入镜头 — editable frame card list */}
              {currentStep === 1 && (
                <div>
                  {frames.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                      暂无分镜数据，请从上游剧本节点生成或手动添加
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {frames.map((frame, idx) => (
                        <div key={idx} style={{
                          borderRadius: '8px', border: '1px solid var(--border)',
                          backgroundColor: idx % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-secondary)',
                          overflow: 'hidden',
                        }}>
                          {/* Row 1: header */}
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '4px 8px', backgroundColor: 'var(--bg-secondary)',
                            borderBottom: '1px solid var(--border)',
                          }}>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', minWidth: '28px' }}>
                              #{String(frame.shotNumber ?? idx + 1).padStart(2, "0")}
                            </span>
                            <select className="nodrag" value={frame.duration ?? 5}
                              onChange={(e) => handleCellChange(idx, "duration", Number(e.target.value))}
                              style={{
                                fontSize: '10px', border: '1px solid var(--border)', borderRadius: '4px',
                                background: 'var(--bg-surface)', color: 'var(--text-muted)', padding: '1px 4px', cursor: 'pointer',
                              }}
                            >
                              {DURATION_OPTIONS.map(s => <option key={s} value={s}>{s}s</option>)}
                            </select>
                            {frame.shotType && (
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-hover)', borderRadius: '4px', padding: '1px 6px' }}>
                                {frame.shotType}
                              </span>
                            )}
                            {frame.lighting && (
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-hover)', borderRadius: '4px', padding: '1px 6px' }}>
                                {frame.lighting}
                              </span>
                            )}
                            <div style={{ flex: 1 }} />
                            <button className="nodrag" onClick={() => setPreviewingFrame(idx)}
                              style={{ fontSize: '10px', color: 'var(--accent)', cursor: 'pointer', background: 'none', border: 'none', fontWeight: 500, padding: 0 }}
                            >提示词</button>
                            <button className="nodrag" onClick={() => handleDeleteFrame(idx)}
                              style={{ fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                            >x</button>
                          </div>
                          {/* Row 2: description textarea */}
                          <div style={{ display: 'flex', padding: '6px 8px', gap: '8px', minHeight: '60px' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <textarea className="nodrag" value={frame.sceneDescription || ""}
                                onChange={(e) => handleCellChange(idx, "sceneDescription", e.target.value)}
                                placeholder="分镜描述..."
                                style={{
                                  width: '100%', minHeight: '40px', maxHeight: '120px',
                                  fontSize: '11px', lineHeight: 1.5, resize: 'vertical',
                                  backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)',
                                  borderRadius: '6px', padding: '6px 8px', color: 'var(--text-primary)',
                                  outline: 'none',
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Add frame button */}
                  <button className="nodrag"
                    onClick={() => {
                      const newFrames = [...frames, {
                        shotNumber: frames.length + 1, duration: 5,
                        sceneDescription: "", shotType: "", cameraAngle: "",
                        cameraMovement: "", characterAction: "", emotion: "",
                        dialogue: "", lighting: "", sceneTag: "", sound: "",
                        character: "", characterDesc: "",
                      }];
                      updateNodeData(id, { frames: newFrames, displayName: `分镜脚本(${newFrames.length}镜)` });
                    }}
                    style={{
                      marginTop: '8px', padding: '4px 12px', borderRadius: '6px',
                      backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)',
                      color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px', width: 'fit-content',
                    }}
                  >+ 添加帧</button>
                  <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    总时长: {totalDuration}s ({frames.length}帧)
                  </div>
                </div>
              )}

              {/* Step 2: 准备资产 — character/scene cards with click-to-edit */}
              {currentStep === 2 && (
                <div>
                  {/* Characters section */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '8px' }}>
                      角色 ({characters.length})
                    </div>
                    {characters.length === 0 ? (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>
                        未检测到角色引用（在画面描述中使用 @角色名 来标记角色）
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px' }}>
                        {characters.map((char) => (
                          <div key={char.name} onClick={() => setEditingCharacter(char.name)}
                            className="nodrag"
                            style={{
                              borderRadius: '8px', border: '1px solid var(--border)',
                              backgroundColor: 'var(--bg-surface)', padding: '8px',
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                              cursor: 'pointer', transition: 'border-color 0.2s',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                          >
                            <div style={{
                              width: '48px', height: '48px', borderRadius: '50%',
                              backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              overflow: 'hidden',
                            }}>
                              {char.avatar ? (
                                <img src={char.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
                              ) : (
                                <span style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-muted)' }}>{char.name[0]}</span>
                              )}
                            </div>
                            <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)' }}>@{char.name}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>镜头 {char.shotNumbers.join(", ")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Scenes section */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '8px' }}>
                      场景 ({scenes.length})
                    </div>
                    {scenes.length === 0 ? (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>
                        未检测到场景标签（在帧的"场景"字段中填入场景名）
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px' }}>
                        {scenes.map((scene) => (
                          <div key={scene.name} onClick={() => setEditingScene(scene.name)}
                            className="nodrag"
                            style={{
                              borderRadius: '8px', border: '1px solid var(--border)',
                              backgroundColor: 'var(--bg-surface)', padding: '8px',
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                              cursor: 'pointer', transition: 'border-color 0.2s',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                          >
                            <div style={{
                              width: '48px', height: '48px', borderRadius: '6px',
                              backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              overflow: 'hidden',
                            }}>
                              {scene.referenceImage ? (
                                <img src={scene.referenceImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
                              ) : (
                                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>场景</span>
                              )}
                            </div>
                            <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-primary)' }}>{scene.name}</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>镜头 {scene.shotNumbers.join(", ")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: 合成提示词 — inline editable table */}
              {currentStep === 3 && (
                <div>
                  {frames.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                      暂无分镜数据
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', tableLayout: 'fixed' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: 'var(--bg-secondary)' }}>
                        <tr>
                          <th style={thStyle(36)}>#</th>
                          <th style={thStyle(48)}>时长</th>
                          <th style={thStyle(undefined)}>画面描述</th>
                          <th style={thStyle(56)}>景别</th>
                          <th style={thStyle(56)}>机位</th>
                          <th style={thStyle(56)}>运动</th>
                          <th style={thStyle(56)}>光线</th>
                          <th style={thStyle(64)}>对白</th>
                          <th style={thStyle(56)}>音效</th>
                          <th style={thStyle(56)}>提示词</th>
                        </tr>
                      </thead>
                      <tbody>
                        {frames.map((frame, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border)', backgroundColor: idx % 2 === 0 ? 'transparent' : 'var(--bg-hover)' }}>
                            <td style={tdStyle("center")}>{frame.shotNumber ?? idx + 1}</td>
                            <td style={tdStyle()}>
                              <select className="nodrag" value={frame.duration ?? 5}
                                onChange={(e) => handleCellChange(idx, "duration", Number(e.target.value))}
                                style={{ fontSize: '11px', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg-surface)', color: 'var(--text-primary)', padding: '2px 4px', cursor: 'pointer', width: '100%' }}
                              >
                                {DURATION_OPTIONS.map(s => <option key={s} value={s}>{s}s</option>)}
                              </select>
                            </td>
                            <td style={tdStyle()}>
                              <InlineTextarea value={frame.sceneDescription} onChange={(v) => handleCellChange(idx, "sceneDescription", v)} placeholder="画面描述..." />
                            </td>
                            <td style={tdStyle()}>
                              <InlineSelect value={frame.shotType} options={SHOT_TYPE_OPTIONS} onChange={(v) => handleCellChange(idx, "shotType", v)} placeholder="景别" />
                            </td>
                            <td style={tdStyle()}>
                              <InlineSelect value={frame.cameraAngle} options={CAMERA_ANGLE_OPTIONS} onChange={(v) => handleCellChange(idx, "cameraAngle", v)} placeholder="机位" />
                            </td>
                            <td style={tdStyle()}>
                              <InlineSelect value={frame.cameraMovement} options={CAMERA_MOVEMENT_OPTIONS} onChange={(v) => handleCellChange(idx, "cameraMovement", v)} placeholder="运动" />
                            </td>
                            <td style={tdStyle()}>
                              <InlineSelect value={frame.lighting} options={LIGHTING_OPTIONS} onChange={(v) => handleCellChange(idx, "lighting", v)} placeholder="光线" />
                            </td>
                            <td style={tdStyle()}>
                              <InlineInput value={frame.dialogue} onChange={(v) => handleCellChange(idx, "dialogue", v)} placeholder="对白" />
                            </td>
                            <td style={tdStyle()}>
                              <InlineInput value={frame.sound} onChange={(v) => handleCellChange(idx, "sound", v)} placeholder="音效" />
                            </td>
                            <td style={tdStyle("center")}>
                              <button className="nodrag" onClick={() => setPreviewingFrame(idx)}
                                style={{ fontSize: '10px', color: 'var(--accent)', cursor: 'pointer', background: 'none', border: 'none', fontWeight: 500, padding: 0 }}
                              >查看</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {/* 一键合并全部提示词 + 推送到分镜 */}
                  <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button className="nodrag"
                      onClick={() => {
                        const allPrompts = frames.map((f, i) =>
                          `镜头${f.shotNumber ?? i + 1}: ${buildCompositePrompt(f)}`
                        ).join("\n\n");
                        navigator.clipboard.writeText(allPrompts).then(() => addToast("success", "提示词已复制到剪贴板"));
                      }}
                      style={{
                        padding: '6px 14px', borderRadius: '8px',
                        backgroundColor: 'var(--accent)', color: '#fff', fontSize: '11px',
                        border: 'none', cursor: 'pointer', fontWeight: 500,
                      }}
                    >一键合并提示词</button>
                    <button className="nodrag" onClick={handlePushToStoryboard}
                      disabled={frames.length === 0}
                      style={{
                        padding: '6px 14px', borderRadius: '8px',
                        backgroundColor: frames.length > 0 ? 'var(--accent-btn)' : 'var(--bg-hover)',
                        color: frames.length > 0 ? '#fff' : 'var(--text-muted)',
                        fontSize: '11px', border: 'none', cursor: frames.length > 0 ? 'pointer' : 'not-allowed',
                        fontWeight: 500,
                      }}
                    >推送到分镜</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Bottom bar: prompt preview (table mode) ── */}
          {viewMode === "table" && frames.length > 0 && (
            <div style={{
              padding: "8px 16px", borderTop: "1px solid var(--border)", fontSize: "11px",
              color: "var(--text-muted)", backgroundColor: "var(--bg-secondary)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              分镜提示词预览：
              <span style={{ color: "var(--text-secondary)" }}>
                {buildCompositePrompt(frames[0]).slice(0, 80)}...
              </span>
            </div>
          )}
        </div>

        <Handle type="target" position={Position.Left} style={{ background: "var(--accent)" }} />
        <Handle type="source" position={Position.Right} style={{ background: "var(--accent)" }} />
        <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize}
          minWidth={480} minHeight={200} maxWidth={1200} maxHeight={800}
        />
      </div>
    </>
  );
});

/** Table header cell style helper */
function Th({ children, w }: { children: React.ReactNode; w?: number }) {
  return (
    <th style={{
      padding: "6px 8px", textAlign: "left", fontSize: "10px", fontWeight: 600,
      color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.3px",
      borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
      width: w ? `${w}px` : undefined,
    }}>{children}</th>
  );
}

/** Table data cell style helper */
function Td({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <td style={{
      padding: "6px 8px", fontSize: "11px", color: "var(--text-primary)",
      borderBottom: "1px solid var(--border)", textAlign: center ? "center" : "left", verticalAlign: "top",
    }}>{children}</td>
  );
}

/** Editable cell for table mode (click-to-edit, receives onChange from parent) */
function EditableCell({ frameIdx, field, value, onChange }: {
  frameIdx: number; field: keyof ScriptFrame; value: string | number; onChange: (idx: number, field: keyof ScriptFrame, value: string | number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(String(value || ""));

  // Sync local value when prop value changes externally
  useMemo(() => { setLocalValue(String(value || "")); }, [value]);

  if (isEditing) {
    return (
      <input autoFocus value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => { onChange(frameIdx, field, localValue); setIsEditing(false); }}
        onKeyDown={(e) => { if (e.key === "Enter") { onChange(frameIdx, field, localValue); setIsEditing(false); } }}
        className="nodrag"
        style={{
          width: "100%", backgroundColor: "var(--bg-node)",
          border: "1px solid var(--accent-btn)", borderRadius: "4px",
          padding: "2px 4px", fontSize: "11px", color: "var(--text-primary)", outline: "none",
        }}
      />
    );
  }
  return (
    <div onClick={() => setIsEditing(true)}
      style={{ cursor: "pointer", minHeight: "18px", wordBreak: "break-word" }}
      title="点击编辑"
    >
      {String(value || "") || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>-</span>}
    </div>
  );
}

/** Reusable th style for LibTV Step3 table */
function thStyle(w?: number): React.CSSProperties {
  return {
    padding: '6px 8px', textAlign: 'left', fontSize: '10px', fontWeight: 600,
    color: 'var(--text-muted)', borderBottom: '1px solid var(--border)',
    width: w ? `${w}px` : undefined,
  };
}

/** Reusable td style for LibTV Step3 table */
function tdStyle(align?: "center" | "left"): React.CSSProperties {
  return {
    padding: '4px 6px', fontSize: '11px', borderBottom: '1px solid var(--border)',
    textAlign: align || 'left', verticalAlign: 'top',
  };
}



