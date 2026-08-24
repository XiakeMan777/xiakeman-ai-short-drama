import { useState, useCallback, useEffect, useRef, memo } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import { useChannelModelSelector } from "../hooks/useChannelModelSelector";
import { ChannelModelSelector } from "../ui/ChannelModelSelector";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { useToastStore } from "@/features/canvas/compat/Toast";
import { CANVAS_NODE_TYPES, type ScriptNodeData, type ScriptFrame, type CharacterItem, type SceneItem, type PropItem } from "../domain/canvasNodes";
import { nodeRegistry } from "../domain/nodeRegistry";
import { chatCompletionStream } from "@/features/canvas/compat/commands";
import { getRandomGrsaiKey, GRSAI_BUILTIN_CHAT_BASE_URL } from "@/features/canvas/shared/grsaiKeys";

// ─── Constants ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一位资深分镜导演和AI图像生成专家。请根据用户提供的剧本/小说片段，生成详细的分镜脚本。

要求：
1. 每镜详细描述画面内容，包含构图、角色位置、动作、表情、光影
2. 为每镜编写一句高质量的「AI生图提示词」（sceneDescription字段），中文，适合直接用于AI图像生成
3. 景别和机位要有变化，避免全部同一景别
4. characterDesc字段必须极其详细地描述角色外观，严格按以下维度逐一描述，每个维度不可省略：
   - 发型：长度、发型（直/卷/扎起）、发色、刘海样式
   - 五官：脸型、眉形、眼型及瞳色、鼻型、唇色唇形
   - 肤色与身材：肤色、身高体型（高挑/娇小/健壮等）
   - 上装：款式、材质、颜色、图案/花纹、领口样式
   - 下装：款式、长度、颜色、材质
   - 鞋履：款式、颜色、跟高/鞋底
   - 配饰：头饰、耳饰、项链、手饰、腰带、包等
   - 特征标记：疤痕、纹身、胎记等显著特征
   确保同一角色在不同镜头中的外貌描述完全一致，以便AI生图保持角色一致性

请严格按照以下JSON格式输出，不要添加任何其他说明文字：

{
  "frames": [
    {
      "shotNumber": 1,
      "duration": 3.5,
      "sceneDescription": "画面描述，适合AI生图的中文提示词...",
      "shotType": "中景",
      "cameraAngle": "平视",
      "cameraMovement": "静止",
      "characterAction": "角色动作描述",
      "emotion": "情绪描述",
      "dialogue": "对白内容",
      "lighting": "光影氛围描述",
      "sceneTag": "室内/室外/日/夜",
      "sound": "音效描述",
      "character": "主要角色名",
      "characterDesc": "黑色齐肩直发，空气刘海，杏仁眼琥珀色瞳孔，柳叶眉，高鼻梁，樱桃小嘴淡粉色，白皙皮肤，高挑纤细身材，白色丝绸衬衫V领配金色暗纹，黑色高腰A字长裙，黑色尖头细跟高跟鞋，珍珠耳坠+金色细链项链+腕表，左耳后一颗小黑痣"
    }
  ]
}`;

/** Parse AI response JSON into ScriptFrame array */
function parseScriptJson(text: string): ScriptFrame[] {
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const frames: unknown[] = Array.isArray(parsed) ? parsed : (parsed.frames || []);
    return frames.map((raw: unknown, idx: number) => {
      const f = (raw || {}) as Record<string, unknown>;
      return {
        shotNumber: (f.shotNumber as number) || (f.shot_number as number) || (idx + 1),
        duration: (f.duration as number) || 0,
        sceneDescription: String(f.sceneDescription || f.scene_description || f.description || ""),
        shotType: String(f.shotType || f.shot_type || ""),
        cameraAngle: String(f.cameraAngle || f.camera_angle || ""),
        cameraMovement: String(f.cameraMovement || f.camera_movement || ""),
        characterAction: String(f.characterAction || f.character_action || f.action || ""),
        emotion: String(f.emotion || ""),
        dialogue: String(f.dialogue || ""),
        lighting: String(f.lighting || ""),
        sceneTag: String(f.sceneTag || f.scene_tag || ""),
        sound: String(f.sound || ""),
        character: String(f.character || ""),
        characterDesc: String(f.characterDesc || f.character_desc || ""),
      };
    });
  } catch {
    console.error("[ScriptNode] Failed to parse JSON:", jsonStr.slice(0, 200));
    return [];
  }
}

/** Build a composite AI image prompt from structured frame data */
/**
 * Try incremental parse: given a partial JSON stream, extract
 * complete frame objects that have been fully received so far.
 * Returns { frames, isPartial } — isPartial means more data is expected.
 */
function tryParsePartialFrames(text: string): { frames: ScriptFrame[]; isPartial: boolean } {
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3);
  }
  jsonStr = jsonStr.trim();

  // Try full parse first
  try {
    const parsed = JSON.parse(jsonStr);
    const frames: unknown[] = Array.isArray(parsed) ? parsed : (parsed.frames || []);
    return { frames: frames.map((raw, idx) => {
      const f = (raw || {}) as Record<string, unknown>;
      return {
        shotNumber: (f.shotNumber as number) || (f.shot_number as number) || (idx + 1),
        duration: (f.duration as number) || 0,
        sceneDescription: String(f.sceneDescription || f.scene_description || f.description || ""),
        shotType: String(f.shotType || f.shot_type || ""),
        cameraAngle: String(f.cameraAngle || f.camera_angle || ""),
        cameraMovement: String(f.cameraMovement || f.camera_movement || ""),
        characterAction: String(f.characterAction || f.character_action || f.action || ""),
        emotion: String(f.emotion || ""),
        dialogue: String(f.dialogue || ""),
        lighting: String(f.lighting || ""),
        sceneTag: String(f.sceneTag || f.scene_tag || ""),
        sound: String(f.sound || ""),
        character: String(f.character || ""),
        characterDesc: String(f.characterDesc || f.character_desc || ""),
      };
    }), isPartial: false };
  } catch {
    // Not complete JSON yet — try to extract partial frames
  }

  // Find "frames": [ and extract individual complete {…} objects
  const framesStart = jsonStr.indexOf('"frames"');
  if (framesStart === -1) return { frames: [], isPartial: true };

  const bracketStart = jsonStr.indexOf("[", framesStart);
  if (bracketStart === -1) return { frames: [], isPartial: true };

  const arrayContent = jsonStr.slice(bracketStart + 1);

  // Match complete JSON objects using brace counting
  const extractedFrames: ScriptFrame[] = [];
  let depth = 0;
  let objStart = -1;

  for (let i = 0; i < arrayContent.length; i++) {
    const ch = arrayContent[i];
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        const objStr = arrayContent.slice(objStart, i + 1);
        try {
          const f = JSON.parse(objStr) as Record<string, unknown>;
          const idx = extractedFrames.length;
          extractedFrames.push({
            shotNumber: (f.shotNumber as number) || (f.shot_number as number) || (idx + 1),
            duration: (f.duration as number) || 0,
            sceneDescription: String(f.sceneDescription || f.scene_description || f.description || ""),
            shotType: String(f.shotType || f.shot_type || ""),
            cameraAngle: String(f.cameraAngle || f.camera_angle || ""),
            cameraMovement: String(f.cameraMovement || f.camera_movement || ""),
            characterAction: String(f.characterAction || f.character_action || f.action || ""),
            emotion: String(f.emotion || ""),
            dialogue: String(f.dialogue || ""),
            lighting: String(f.lighting || ""),
            sceneTag: String(f.sceneTag || f.scene_tag || ""),
            sound: String(f.sound || ""),
            character: String(f.character || ""),
            characterDesc: String(f.characterDesc || f.character_desc || ""),
          });
        } catch {
          // Incomplete object, skip
        }
        objStart = -1;
      }
    }
  }

  return { frames: extractedFrames, isPartial: true };
}

/** Build a composite AI image prompt from structured frame data */
// ─── Component ────────────────────────────────────────────────────────────

/** System prompt for extracting characters/scenes/props from a script */
const EXTRACT_SYSTEM_PROMPT = `你是一位资深影视美术指导。请从用户提供的剧本/小说片段中，提取所有角色、场景和道具。

要求：
1. 角色描述必须极其详细，严格按以下维度逐一描述，每个维度不可省略：
   - name: 角色姓名
   - hair: 发型（长度、直/卷/扎起、发色、刘海样式）
   - face: 五官（脸型、眉形、眼型及瞳色、鼻型、唇色唇形）
   - body: 肤色与身材（肤色、身高体型）
   - upperClothing: 上装（款式、材质、颜色、图案、领口）
   - lowerClothing: 下装（款式、长度、颜色、材质）
   - shoes: 鞋履（款式、颜色、跟高）
   - accessories: 配饰（头饰、耳饰、项链、手饰等）
   如果原文未提及某维度，请根据角色设定合理推断

2. 场景描述要详细：
   - name: 场景名称
   - type: 类型（室内/室外、时代风格）
   - environment: 环境细节（建筑风格、物品陈设、自然景观）
   - lighting: 光影（光源方向、色温、明暗对比）
   - atmosphere: 氛围关键词（安静、紧张、温馨等）

3. 道具描述要详细：
   - name: 道具名称
   - appearance: 外观（形状、颜色、大小）
   - material: 材质（金属、木质、布料等）
   - details: 细节特征（纹饰、磨损、品牌标记等）

请严格按照以下JSON格式输出，不要添加任何其他说明文字：
{
  "characters": [
    {
      "name": "角色名",
      "hair": "...",
      "face": "...",
      "body": "...",
      "upperClothing": "...",
      "lowerClothing": "...",
      "shoes": "...",
      "accessories": "..."
    }
  ],
  "scenes": [
    {
      "name": "场景名",
      "type": "...",
      "environment": "...",
      "lighting": "...",
      "atmosphere": "..."
    }
  ],
  "props": [
    {
      "name": "道具名",
      "appearance": "...",
      "material": "...",
      "details": "..."
    }
  ]
}`;

interface ExtractResult {
  characters: CharacterItem[];
  scenes: SceneItem[];
  props: PropItem[];
}

function parseExtractJson(text: string): ExtractResult {
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
  else if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
  jsonStr = jsonStr.trim();

  try {
    const parsed = JSON.parse(jsonStr);

    const characters: CharacterItem[] = (parsed.characters || []).map((c: Record<string, unknown>) => ({
      id: crypto.randomUUID(),
      name: String(c.name || ""),
      hair: String(c.hair || ""),
      face: String(c.face || ""),
      body: String(c.body || ""),
      upperClothing: String(c.upperClothing || ""),
      lowerClothing: String(c.lowerClothing || ""),
      shoes: String(c.shoes || ""),
      accessories: String(c.accessories || ""),
      styleType: "2d-anime" as const,
      imageUrl: null,
      isGenerating: false,
    }));

    const scenes: SceneItem[] = (parsed.scenes || []).map((s: Record<string, unknown>) => ({
      id: crypto.randomUUID(),
      name: String(s.name || ""),
      type: String(s.type || ""),
      environment: String(s.environment || ""),
      lighting: String(s.lighting || ""),
      atmosphere: String(s.atmosphere || ""),
      viewAngle: "front" as const,
      styleType: "2d-anime" as const,
      imageUrl: null,
      isGenerating: false,
    }));

    const props: PropItem[] = (parsed.props || []).map((p: Record<string, unknown>) => ({
      id: crypto.randomUUID(),
      name: String(p.name || ""),
      appearance: String(p.appearance || ""),
      material: String(p.material || ""),
      details: String(p.details || ""),
      styleType: "2d-anime" as const,
      imageUrl: null,
      isGenerating: false,
    }));

    return { characters, scenes, props };
  } catch {
    console.error("[ScriptNode] Failed to parse extract JSON:", jsonStr.slice(0, 200));
    return { characters: [], scenes: [], props: [] };
  }
}

export const ScriptNode = memo(function ScriptNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as ScriptNodeData;
  const addToast = useToastStore((s) => s.addToast);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  // ── State ──────────────────────────────────────────────────────────────
  const [scriptText, setScriptText] = useState(nodeData.scriptText || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<string>("");
  const scriptTextRef = useRef(nodeData.scriptText || "");
  const abortRef = useRef<AbortController | null>(null);

  // ── Node dimensions (resizable) ──────────────────────────────────────
  const nodeWidth = nodeData.width || 480;
  const nodeHeight = nodeData.height || 360;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  // Provider & model selection
  const chatModelProvider = useSettingsStore((s) => s.providers.find((p) => p.id === "chat-model"));
  const chatChannelId = chatModelProvider?.channel || "";
  const [selectedProviderId, setSelectedProviderId] = useState(
    nodeData.providerId || chatChannelId || ""
  );
  const [selectedModel, setSelectedModel] = useState(
    nodeData.model || "glm-4-flash"
  );

  const { availableProviders, availableModels, getDefaultModel } = useChannelModelSelector(
    "chat", selectedProviderId
  );

  // ── Sync from store ────────────────────────────────────────────────────
  useEffect(() => {
    if (nodeData.scriptText !== scriptText && nodeData.scriptText !== undefined) {
      setScriptText(nodeData.scriptText);
      scriptTextRef.current = nodeData.scriptText;
    }
  }, [nodeData.scriptText]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleScriptChange = useCallback((value: string) => {
    setScriptText(value);
    scriptTextRef.current = value;
    updateNodeData(id, { scriptText: value });
  }, [id, updateNodeData]);

  const handleProviderChange = useCallback((providerId: string) => {
    setSelectedProviderId(providerId);
    updateNodeData(id, { providerId, provider: providerId });
    const defaultModel = getDefaultModel(providerId);
    if (defaultModel) {
      setSelectedModel(defaultModel);
      updateNodeData(id, { model: defaultModel, providerId, provider: providerId });
    }
  }, [id, updateNodeData, getDefaultModel]);

  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    updateNodeData(id, { model: modelId, providerId: selectedProviderId });
  }, [id, updateNodeData, selectedProviderId]);

  // ── Helper: find or create ScriptResultNode ──────────────────────────
  const findOrCreateResultNode = useCallback((initialFrames?: ScriptFrame[]) => {
    const store = useCanvasStore.getState();
    const { nodes, edges } = store;
    const entry = nodeRegistry[CANVAS_NODE_TYPES.scriptResult];

    // Check if already connected to a scriptResult node
    const existingEdge = edges.find(
      (e) => e.source === id && nodes.find((n) => n.id === e.target)?.type === entry.type
    );

    if (existingEdge) {
      const targetNode = nodes.find((n) => n.id === existingEdge.target);
      if (targetNode) {
        if (initialFrames) {
          store.updateNodeData(targetNode.id, {
            frames: initialFrames,
            isStreaming: true,
            displayName: `分镜脚本(生成中…)`,
          });
        }
        return targetNode.id;
      }
    }

    // Create new
    const currentNode = nodes.find((n) => n.id === id);
    const posX = currentNode?.position?.x ?? 0;
    const posY = currentNode?.position?.y ?? 0;

    const newNode = {
      id: `sr-${id}-${crypto.randomUUID()}`,
      type: entry.type,
      position: { x: posX + nodeWidth + 40, y: posY },
      data: {
        ...entry.createDefaultData(),
        frames: initialFrames || [],
        isStreaming: true,
        sourceScriptNodeId: id,
        displayName: `分镜脚本(生成中…)`,
      },
    };

    store.addNode(newNode);
    store.onConnect({
      source: id,
      target: newNode.id,
      sourceHandle: null,
      targetHandle: null,
    });
    return newNode.id;
  }, [id, nodeWidth]);

  // ── Generate (Streaming + Skeleton + Incremental parse) ───────────────
  const handleGenerate = useCallback(async () => {
    const textToUse = scriptText.trim();
    if (!textToUse) {
      addToast("warning", "请先输入剧本或小说内容");
      return;
    }

    // Look up provider by channel ID directly (e.g. "grsai"),
    // with fallback to chat-model for backward compatibility
    const settings1 = useSettingsStore.getState();
    const allProviders1 = settings1.providers;
    const effectiveProviderId1 = selectedProviderId || "grsai";
    let providerConfig1 = allProviders1.find((p) => p.id === effectiveProviderId1 && p.apiKey);
    if (!providerConfig1) {
      const chatModel1 = allProviders1.find((p) => p.id === "chat-model");
      if (chatModel1?.apiKey && (chatModel1.channel === effectiveProviderId1 || !chatModel1.channel)) {
        providerConfig1 = chatModel1;
      }
    }
    // Fallback: check custom providers
    if (!providerConfig1?.apiKey) {
      const cp1 = settings1.customProviders.find((p) => p.id === effectiveProviderId1);
      if (cp1?.apiKey) {
        providerConfig1 = { id: cp1.id, apiKey: cp1.apiKey, baseUrl: cp1.baseUrl, modelName: "" } as any;
      }
    }
    if (!providerConfig1) {
      providerConfig1 = allProviders1.find((p) => p.id === effectiveProviderId1);
    }
    if (!providerConfig1) {
      providerConfig1 = allProviders1.find((p) => p.id === "chat-model");
    }
    const creditsEnabled1 = settings1.creditsEnabled;
    if (!creditsEnabled1 && (!providerConfig1?.apiKey || !providerConfig1?.baseUrl)) {
      addToast("warning", "请先在设置中配置对话模型 API");
      return;
    }

    // ── Credits mode fallback: use random key from grsai key pool when user hasn't configured one ──
    let genApiKey = providerConfig1?.apiKey || "";
    let genBaseUrl = providerConfig1?.baseUrl || "";
    if (!genApiKey && creditsEnabled1) {
      genApiKey = getRandomGrsaiKey();
    }
    if (!genBaseUrl && creditsEnabled1) {
      genBaseUrl = GRSAI_BUILTIN_CHAT_BASE_URL;
    }

    setIsGenerating(true);
    setGenerateStatus("正在分析剧本…");

    // Step D: Immediately create ScriptResultNode with skeleton (empty frames + isStreaming flag)
    const resultNodeId = findOrCreateResultNode([]);

    // Cancel any previous request
    if (abortRef.current) abortRef.current.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

    let fullContent = "";

    try {
      // Step A: Use streaming API
      fullContent = await chatCompletionStream(
        {
          baseUrl: genBaseUrl,
          apiKey: genApiKey,
          model: selectedModel,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: textToUse },
          ],
          temperature: 0.7,
          maxTokens: 8192,
        },
        (delta) => {
          // Each chunk arrives — accumulate and try incremental parse
          fullContent += delta;

          const { frames, isPartial } = tryParsePartialFrames(fullContent);

          if (frames.length > 0) {
            // Update result node with partial frames
            const currentStore = useCanvasStore.getState();
            currentStore.updateNodeData(resultNodeId, {
              frames,
              isStreaming: isPartial,
              displayName: isPartial
                ? `分镜脚本(生成中 ${frames.length}镜…)`
                : `分镜脚本(${frames.length}镜)`,
            });

            // Update status text
            if (frames.length === 1) {
              setGenerateStatus("正在拆分镜头…");
            } else if (frames.length >= 3) {
              setGenerateStatus(`已生成 ${frames.length} 镜…`);
            }
          }
        },
        abortController.signal,
      );

      // Stream complete — final parse
      const parsedFrames = parseScriptJson(fullContent);

      if (parsedFrames.length === 0) {
        addToast("error", "AI 返回格式异常，请重试或更换模型");
        // Remove the empty result node or mark as error
        const currentStore = useCanvasStore.getState();
        currentStore.updateNodeData(resultNodeId, {
          isStreaming: false,
          frames: [],
          displayName: "分镜脚本(生成失败)",
        });
        return;
      }

      // Final update — mark as complete
      const currentStore = useCanvasStore.getState();
      currentStore.updateNodeData(resultNodeId, {
        frames: parsedFrames,
        isStreaming: false,
        displayName: `分镜脚本(${parsedFrames.length}镜)`,
      });

      // Also store frames on the script node itself (for "N镜" badge display)
      updateNodeData(id, { frames: parsedFrames, scriptText: textToUse });
      addToast("success", `已生成 ${parsedFrames.length} 镜分镜脚本`);
    } catch (err) {
      if (abortController.signal.aborted) return; // User cancelled
      console.error("[ScriptNode] Generate failed:", err);
      addToast("error", `生成失败: ${err instanceof Error ? err.message : String(err)}`);

      // Mark result node as failed
      const currentStore = useCanvasStore.getState();
      currentStore.updateNodeData(resultNodeId, {
        isStreaming: false,
        displayName: "分镜脚本(生成失败)",
      });
    } finally {
      setIsGenerating(false);
      setGenerateStatus("");
      abortRef.current = null;
    }
  }, [scriptText, selectedModel, id, updateNodeData, addToast, nodeWidth, findOrCreateResultNode]);

  // ── Cancel generation ─────────────────────────────────────────────────
  const handleCancelGenerate = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsGenerating(false);
    setGenerateStatus("");
  }, []);

  // ── Regenerate ─────────────────────────────────────────────────────────
  const handleRegenerate = useCallback(() => {
    const currentScript = scriptTextRef.current || scriptText;
    if (!currentScript.trim()) {
      addToast("warning", "没有可用的剧本内容");
      return;
    }
    handleGenerate();
  }, [scriptText, handleGenerate, addToast]);

  const hasGenerated = (nodeData.frames || []).length > 0;

  // ── Extract elements (角色/场景/道具) ──────────────────────────────────
  const handleExtractElements = useCallback(async () => {
    const textToUse = scriptText.trim();
    if (!textToUse) {
      addToast("warning", "请先输入剧本或小说内容");
      return;
    }

    // Look up provider by channel ID directly (e.g. "grsai"),
    // with fallback to chat-model for backward compatibility
    const settings2 = useSettingsStore.getState();
    const allProviders2 = settings2.providers;
    const effectiveProviderId2 = selectedProviderId || "grsai";
    let providerConfig2 = allProviders2.find((p) => p.id === effectiveProviderId2 && p.apiKey);
    if (!providerConfig2) {
      const chatModel2 = allProviders2.find((p) => p.id === "chat-model");
      if (chatModel2?.apiKey && (chatModel2.channel === effectiveProviderId2 || !chatModel2.channel)) {
        providerConfig2 = chatModel2;
      }
    }
    // Fallback: check custom providers
    if (!providerConfig2?.apiKey) {
      const cp2 = settings2.customProviders.find((p) => p.id === effectiveProviderId2);
      if (cp2?.apiKey) {
        providerConfig2 = { id: cp2.id, apiKey: cp2.apiKey, baseUrl: cp2.baseUrl, modelName: "" } as any;
      }
    }
    if (!providerConfig2) {
      providerConfig2 = allProviders2.find((p) => p.id === effectiveProviderId2);
    }
    if (!providerConfig2) {
      providerConfig2 = allProviders2.find((p) => p.id === "chat-model");
    }
    const creditsEnabled2 = settings2.creditsEnabled;
    if (!creditsEnabled2 && (!providerConfig2?.apiKey || !providerConfig2?.baseUrl)) {
      addToast("warning", "请先在设置中配置对话模型 API");
      return;
    }

    // ── Credits mode fallback: use random key from grsai key pool when user hasn't configured one ──
    let extractApiKey = providerConfig2?.apiKey || "";
    let extractBaseUrl = providerConfig2?.baseUrl || "";
    if (!extractApiKey && creditsEnabled2) {
      extractApiKey = getRandomGrsaiKey();
    }
    if (!extractBaseUrl && creditsEnabled2) {
      extractBaseUrl = GRSAI_BUILTIN_CHAT_BASE_URL;
    }

    setIsExtracting(true);

    try {
      const content = await chatCompletionStream(
        {
          baseUrl: extractBaseUrl,
          apiKey: extractApiKey,
          model: selectedModel,
          messages: [
            { role: "system", content: EXTRACT_SYSTEM_PROMPT },
            { role: "user", content: textToUse },
          ],
          temperature: 0.5,
          maxTokens: 8192,
        },
        () => {},
        undefined,
      );

      const { characters, scenes, props } = parseExtractJson(content);

      if (characters.length === 0 && scenes.length === 0 && props.length === 0) {
        addToast("error", "AI 未能提取到任何要素，请重试");
        return;
      }

      // Create element nodes on canvas
      const store = useCanvasStore.getState();
      const { nodes } = store;
      const currentNode = nodes.find((n) => n.id === id);
      const posX = currentNode?.position?.x ?? 0;
      const posY = currentNode?.position?.y ?? 0;

      // Character node
      if (characters.length > 0) {
        const charEntry = nodeRegistry[CANVAS_NODE_TYPES.character];
        const charNode = {
          id: `char-${id}-${Date.now()}`,
          type: charEntry.type,
          position: { x: posX + nodeWidth + 40, y: posY - 100 },
          data: {
            ...charEntry.createDefaultData(),
            items: characters,
            sourceScriptNodeId: id,
            displayName: `角色(${characters.length})`,
          },
        };
        store.addNode(charNode);
        store.onConnect({ source: id, target: charNode.id, sourceHandle: null, targetHandle: null });
      }

      // Scene node
      if (scenes.length > 0) {
        const sceneEntry = nodeRegistry[CANVAS_NODE_TYPES.scene];
        const sceneNode = {
          id: `scene-${id}-${Date.now()}`,
          type: sceneEntry.type,
          position: { x: posX + nodeWidth + 40, y: posY + 200 },
          data: {
            ...sceneEntry.createDefaultData(),
            items: scenes,
            sourceScriptNodeId: id,
            displayName: `场景(${scenes.length})`,
          },
        };
        store.addNode(sceneNode);
        store.onConnect({ source: id, target: sceneNode.id, sourceHandle: null, targetHandle: null });
      }

      // Prop node
      if (props.length > 0) {
        const propEntry = nodeRegistry[CANVAS_NODE_TYPES.prop];
        const propNode = {
          id: `prop-${id}-${Date.now()}`,
          type: propEntry.type,
          position: { x: posX + nodeWidth + 40, y: posY + 500 },
          data: {
            ...propEntry.createDefaultData(),
            items: props,
            sourceScriptNodeId: id,
            displayName: `道具(${props.length})`,
          },
        };
        store.addNode(propNode);
        store.onConnect({ source: id, target: propNode.id, sourceHandle: null, targetHandle: null });
      }

      addToast("success", `已提取: ${characters.length}角色, ${scenes.length}场景, ${props.length}道具`);
    } catch (err) {
      console.error("[ScriptNode] Extract failed:", err);
      addToast("error", `提取失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExtracting(false);
    }
  }, [scriptText, selectedModel, id, nodeWidth, addToast]);

  return (
    <>
      <NodeDeleteButton id={id} selected={selected ?? false} />
      <div style={{ position: 'relative' }}>
      <div
        className="node-inner"
        style={{
          backgroundColor: "var(--bg-node)",
          border: "1px solid var(--border)",
          borderRadius: "var(--node-radius)",
          width: nodeWidth,
          height: nodeHeight,
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          maxHeight: "75vh",
          boxShadow: "0 2px 12px rgba(0,0,0,.3)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px" }} title={nodeData.displayName || "剧本"}>
              {nodeData.displayName || "剧本"}
            </span>
            {hasGenerated && !isGenerating && (
              <span style={{ fontSize: "10px", color: "var(--text-muted)", background: "var(--bg-hover)", padding: "2px 6px", borderRadius: "4px" }}>
                {nodeData.frames.length}镜
              </span>
            )}
          </div>
        </div>

        {/* Content — just the textarea input */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "16px", overflow: "hidden", minHeight: 0, position: "relative" }}>
            <textarea
              value={scriptText}
              onChange={(e) => handleScriptChange(e.target.value)}
              placeholder="在此粘贴小说或剧本内容..."
              disabled={isGenerating}
              maxLength={5000}
              className="nodrag nowheel"
              style={{
                flex: 1,
                width: "100%",
                minHeight: 0,
                backgroundColor: "var(--bg-node)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "12px",
                color: "var(--text-primary)",
                fontSize: "13px",
                resize: "none",
                lineHeight: "1.6",
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.15s",
                opacity: isGenerating ? 0.6 : 1,
              }}
              onFocus={(e) => { if (!isGenerating) e.currentTarget.style.borderColor = "var(--accent-btn)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            />
            <span style={{
              position: "absolute",
              bottom: "22px",
              right: "22px",
              fontSize: "11px",
              fontFamily: "monospace",
              color: scriptText.length > 4500 ? "#ef4444" : "var(--text-muted)",
              letterSpacing: ".5px",
              pointerEvents: "none",
              lineHeight: 1,
            }}>
              {scriptText.length}/5000
            </span>
          </div>

          {/* Bottom toolbar */}
          <div
            className="flex items-center justify-between shrink-0"
            style={{
              padding: "10px 16px",
              borderTop: "1px solid var(--border)",
              gap: "8px",
            }}
          >
            {/* Left: Model selector */}
            <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <ChannelModelSelector
                availableProviders={availableProviders}
                availableModels={availableModels}
                selectedProviderId={selectedProviderId}
                selectedModelId={selectedModel}
                onProviderChange={handleProviderChange}
                onModelChange={handleModelChange}
              />
            </div>

            {/* Right: Action buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              {/* Extract elements button */}
              {scriptText.trim() && !isGenerating && (
                <button
                  onClick={handleExtractElements}
                  disabled={isExtracting}
                  className="flex items-center gap-1 nodrag"
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    cursor: isExtracting ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                    transition: "background-color 0.15s, border-color 0.15s",
                    opacity: isExtracting ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isExtracting) {
                      e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                      e.currentTarget.style.borderColor = "var(--border-hover)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                  title="提取角色/场景/道具"
                >
                  {isExtracting ? "提取中…" : "提取要素"}
                </button>
              )}

              {/* Regenerate button */}
              {hasGenerated && !isGenerating && (
                <button
                  onClick={handleRegenerate}
                  className="flex items-center gap-1 nodrag"
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                    fontSize: "12px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "background-color 0.15s, border-color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "var(--border-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--bg-secondary)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                  title="重新生成"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                </button>
              )}

              {/* Generate / Cancel button */}
              {isGenerating && generateStatus && (
                <span style={{ fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {generateStatus}
                </span>
              )}
              {isGenerating ? (
                <button
                  className="nodrag"
                  onClick={handleCancelGenerate}
                  style={{
                    width: '32px', height: '32px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(239,68,68,0.15)',
                    color: '#ef4444',
                    border: '1px solid rgba(239,68,68,0.3)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background-color 0.2s',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.25)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.15)'; }}
                  title="取消生成"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              ) : (
                <button
                  className="nodrag"
                  onClick={handleGenerate}
                  style={{
                    width: '32px', height: '32px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--accent-btn)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background-color 0.2s',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-btn-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent-btn)'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5"/>
                    <polyline points="5 12 12 5 19 12"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={360} maxWidth={680} minHeight={250} maxHeight={680} />
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!bg-[var(--accent-secondary)] !w-6 !h-6 !border-2 !border-[var(--bg-node)]"
      />
    </>
  );
});



