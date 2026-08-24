import { useState, useCallback, useEffect, useRef, useMemo, memo } from "react";
import { type NodeProps, Handle, Position } from "@xyflow/react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useCanvasStore } from "@/features/canvas/stores/canvasStore";
import {
  CAMERA_ANGLE_PRESETS,
  NEGATIVE_HINT_OPTIONS,
  type AssetGenNodeData,
  type AssetGenHistoryEntry,
  type PoseLibraryEntry,
} from "../domain/canvasNodes";
import { useErrorStore } from "@/features/canvas/compat/ErrorDialog";
import { NodeDeleteButton } from "./NodeDeleteButton";
import { ImageEditorDialog } from "../ui/ImageEditorDialog";
import { tauriAiGateway } from "../infrastructure/tauriAiGateway";
import { extractDisplayName } from "../application/imageData";
import { getAllModels, DEFAULT_MODEL_ID, resolveModelId, createFallbackModelDefinition } from "../models/registry";
import { useChannelModelSelector, type ModelOption } from "../hooks/useChannelModelSelector";
import { ChannelModelSelector } from "../ui/ChannelModelSelector";
import { IMAGE_CREDIT_PRICES } from "../application/creditPricing";
import type { ImageSize } from "../models/image/types";
import { NodeResizeHandle } from "../ui/NodeResizeHandle";
import { useSettingsStore } from "@/features/canvas/stores/settingsStore";
import type { ImageModelDefinition } from "../models/image/types";
import { persistImageSource } from "@/features/canvas/compat/commands";
import { invoke } from "@/features/canvas/compat/tauriCore";
import { useToastStore } from "@/features/canvas/compat/Toast";

// ─── Constants ────────────────────────────────────────────────────────────

const POLL_INTERVAL = 2000;
const MAX_POLL_TIME = 15 * 60 * 1000;
const DEFAULT_NODE_WIDTH = 480;
const DEFAULT_NODE_HEIGHT = 680;
const MIN_NODE_WIDTH = 400;
const MAX_NODE_WIDTH = 800;
const MIN_NODE_HEIGHT = 500;
const MAX_NODE_HEIGHT = 1200;

const SIZE_OPTIONS = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const ASPECT_RATIOS = [
  { value: "1:1", label: "1:1" },
  { value: "3:4", label: "3:4" },
  { value: "4:3", label: "4:3" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
];

// Built-in pose library (placeholder — will be replaced by API)
const BUILTIN_POSE_LIBRARY: PoseLibraryEntry[] = [
  { id: "stand-front", name: "站立正面", category: "站立", thumbnailUrl: "", description: "正面站立姿势" },
  { id: "stand-side", name: "站立侧面", category: "站立", thumbnailUrl: "", description: "侧面站立姿势" },
  { id: "stand-back", name: "站立背面", category: "站立", thumbnailUrl: "", description: "背面站立姿势" },
  { id: "walk-front", name: "行走正面", category: "行走", thumbnailUrl: "", description: "正面行走姿势" },
  { id: "walk-side", name: "行走侧面", category: "行走", thumbnailUrl: "", description: "侧面行走姿势" },
  { id: "run-front", name: "奔跑正面", category: "奔跑", thumbnailUrl: "", description: "正面奔跑姿势" },
  { id: "run-side", name: "奔跑侧面", category: "奔跑", thumbnailUrl: "", description: "侧面奔跑姿势" },
  { id: "sit-front", name: "坐姿正面", category: "坐姿", thumbnailUrl: "", description: "正面坐姿" },
  { id: "sit-side", name: "坐姿侧面", category: "坐姿", thumbnailUrl: "", description: "侧面坐姿" },
  { id: "jump", name: "跳跃", category: "动作", thumbnailUrl: "", description: "跳跃姿势" },
  { id: "fight-1", name: "格斗1", category: "动作", thumbnailUrl: "", description: "出拳姿势" },
  { id: "fight-2", name: "格斗2", category: "动作", thumbnailUrl: "", description: "踢腿姿势" },
  { id: "hand-wave", name: "挥手", category: "动作", thumbnailUrl: "", description: "挥手致意" },
  { id: "arm-cross", name: "双手交叉", category: "站立", thumbnailUrl: "", description: "双手交叉胸前" },
  { id: "lean", name: "倚靠", category: "站立", thumbnailUrl: "", description: "倚靠姿势" },
];

// ─── Helper: read file as data URL ────────────────────────────────────────

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── 3D Camera Orbit Visualization (qwenmultiangle style) ─────────────────
// Reference: ComfyUI-qwenmultiangle by jtydhr88
// Also aligned with E:/插件/com.storyboard.ai2dpanel/client/js/app.js implementation
// Pink Ring → Azimuth (yaw, 0-360°), Cyan Arc → Elevation (pitch, -30~90°), Gold Line → Distance (1-10)

// ─── Camera presets (matching ComfyUI-qwenmultiangle) ──────────────────────

const AZIMUTH_PRESETS = [
  { value: 0, label: '正面' },
  { value: 45, label: '右前45°' },
  { value: 90, label: '右侧' },
  { value: 135, label: '右后45°' },
  { value: 180, label: '背面' },
  { value: 225, label: '左后45°' },
  { value: 270, label: '左侧' },
  { value: 315, label: '左前45°' },
];

const ELEVATION_PRESETS = [
  { value: -30, label: '仰拍' },
  { value: 0, label: '平视' },
  { value: 30, label: '俯拍' },
  { value: 60, label: '高俯' },
];

const ZOOM_PRESETS = [
  { value: 1, label: '远景' },
  { value: 4, label: '中景' },
  { value: 8, label: '特写' },
];

// ─── Camera3DPreview: Real 3D Three.js Visualization ───────────────────────
// Pink Ring → Azimuth (yaw, 0-360°), Cyan Arc → Elevation (pitch, -30~90°), Gold Line → Zoom (distance, 1-10)

const PINK = '#E93D82';
const CYAN = '#00FFD0';
const GOLD = '#FFB800';
const PINK_HEX = 0xE93D82;
const CYAN_HEX = 0x00FFD0;
const GOLD_HEX = 0xFFB800;

// Grid texture for card back face
const gridTexture: THREE.Texture = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = PINK;
  ctx.lineWidth = 0.8;
  ctx.globalAlpha = 0.25;
  const step = 16;
  for (let i = 0; i <= 256; i += step) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

// Convert azimuth 0-360 to -180..180 for display compatibility with plugin
// function normAz(az: number): number { return ((az + 180) % 360 + 360) % 360 - 180; }

// Camera world position — aligned with plugin's getCamWorldPos()
// az in degrees (0-360), el in degrees (-30..90), dist in (1..10)
function getCamWorldPos(az: number, el: number, dist: number): THREE.Vector3 {
  const azRad = az * Math.PI / 180;
  const elRad = el * Math.PI / 180;
  const r = 0.5 + dist * 0.25; // maps 1-10 → 0.75-3.0
  const x = r * Math.cos(elRad) * Math.sin(azRad);
  const y = r * Math.sin(elRad);
  const z = r * Math.cos(elRad) * Math.cos(azRad);
  return new THREE.Vector3(x, y, z);
}

// Make text sprite for labels
function makeTextSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = `rgba(167,139,250,0.8)`;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 16);
  const texture = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
  return new THREE.Sprite(mat);
}

// ── Inner 3D Scene (strictly aligned with plugin's initCamCanvas + updateCamScene) ──

function Camera3DScene({
  azimuth, elevation, zoom,
  onAzimuthChange, onElevationChange, onZoomChange,
}: {
  azimuth: number; elevation: number; zoom: number;
  onAzimuthChange: (v: number) => void;
  onElevationChange: (v: number) => void;
  onZoomChange: (v: number) => void;
}) {
  const markerRef = useRef<THREE.Mesh>(null);
  const coneRef = useRef<THREE.Mesh>(null);
  const ringMarkerRef = useRef<THREE.Mesh>(null);
  const arcMarkerRef = useRef<THREE.Mesh>(null);
  const lineEndRef = useRef<THREE.Mesh>(null);

  // Drag state
  const dragTarget = useRef<string | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Derived positions
  const azRad = (azimuth * Math.PI) / 180;
  const elRad = (elevation * Math.PI) / 180;
  const ringR = 1.5;
  const arcR = 1.5;
  const camPos = getCamWorldPos(azimuth, elevation, zoom);

  // Project a 3D world position to 2D screen coordinates using the fixed camera
  // Camera at (4, 3.5, 4), looking at (0, 0, 0), fov=40, canvas size 280x280
  const SIZE = 280;
  const FOV = 40;
  const projToScreen = useCallback((worldPos: THREE.Vector3): { x: number; y: number } => {
    // Camera local coords: z-axis points from camera to look-target (backwards)
    const camPosV = new THREE.Vector3(4, 3.5, 4);
    const lookTarget = new THREE.Vector3(0, 0, 0);
    const forward = lookTarget.clone().sub(camPosV).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
    const camUp = new THREE.Vector3().crossVectors(right, forward).normalize();

    const rel = worldPos.clone().sub(camPosV);
    const z = -rel.dot(forward); // depth into screen
    if (z <= 0) return { x: -999, y: -999 };
    const x = rel.dot(right);
    const y = rel.dot(camUp);

    const fovRad = (FOV * Math.PI) / 180;
    const h = 2 * Math.tan(fovRad / 2) * z;
    const w = h; // square canvas
    const screenX = (x / (w / 2)) * (SIZE / 2) + SIZE / 2;
    const screenY = -(y / (h / 2)) * (SIZE / 2) + SIZE / 2;
    return { x: screenX, y: screenY };
  }, []);

  // Native pointerdown on canvas — do hit detection in screen space
  useEffect(() => {
    const canvas = document.querySelector('.camera3d-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      // Project all handles to screen space
      const ringPos = new THREE.Vector3(Math.sin(azRad) * ringR, 0.35, Math.cos(azRad) * ringR);
      const arcPos = new THREE.Vector3(0, Math.sin(elRad) * arcR, Math.cos(elRad) * arcR);
      const distPos = camPos.clone();

      const ringScreen = projToScreen(ringPos);
      const arcScreen = projToScreen(arcPos);
      const distScreen = projToScreen(distPos);

      const clickRadius = 25; // pixels — clickable radius around each handle
      let closest: string | null = null;
      let closestDist = Infinity;

      const check = (label: string, pos: { x: number; y: number }) => {
        const d = Math.hypot(sx - pos.x, sy - pos.y);
        if (d < clickRadius && d < closestDist) { closest = label; closestDist = d; }
      };

      check('azimuth', ringScreen);
      check('elevation', arcScreen);
      check('distance', distScreen);

      if (closest) {
        e.preventDefault();
        e.stopPropagation();
        dragTarget.current = closest;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    return () => canvas.removeEventListener('pointerdown', onPointerDown);
  }, [azimuth, elevation, zoom, projToScreen]);

  // Drag handling via window-level pointer events
  useEffect(() => {
    if (!dragTarget.current) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!dragTarget.current) return;
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };

      if (dragTarget.current === 'azimuth') {
        onAzimuthChange(((azimuth - dx * 0.8) % 360 + 360) % 360);
      } else if (dragTarget.current === 'elevation') {
        const newVal = elevation + dy * 0.5;
        onElevationChange(Math.max(-30, Math.min(90, newVal)));
      } else if (dragTarget.current === 'distance') {
        const newVal = zoom - dy * 0.03;
        onZoomChange(Math.max(1, Math.min(10, newVal)));
      }
    };

    const onPointerUp = (e: PointerEvent) => { e.preventDefault(); dragTarget.current = null; };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [azimuth, elevation, zoom, onAzimuthChange, onElevationChange, onZoomChange]);

  // Scroll zoom (always active in the viewport)
  useEffect(() => {
    const canvas = document.querySelector('.camera3d-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onZoomChange(Math.max(1, Math.min(10, zoom + (e.deltaY > 0 ? 0.5 : -0.5))));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, onZoomChange]);

  // Build static arc geometry once (in YZ plane at x=0, from -30° to 90°)
  const arcMesh = useMemo(() => {
    const arcPoints: THREE.Vector3[] = [];
    for (let i = -30; i <= 90; i += 2) {
      const rad = i * Math.PI / 180;
      arcPoints.push(new THREE.Vector3(0, Math.sin(rad) * arcR, Math.cos(rad) * arcR));
    }
    const curve = new THREE.CatmullRomCurve3(arcPoints);
    const geo = new THREE.TubeGeometry(curve, 48, 0.025, 8, false);
    return geo;
  }, []);

  // Build preset dots
  const presetDots = useMemo(() => {
    const dots: THREE.Vector3Tuple[] = [];
    [0, 45, 90, 135, 180, 225, 270, 315].forEach((az) => {
      const rad = az * Math.PI / 180;
      dots.push([Math.sin(rad) * ringR, 0, Math.cos(rad) * ringR]);
    });
    return dots;
  }, []);

  // Direction labels
  const dirLabels = useMemo(() => {
    const labels = [
      { az: 0, text: '正' }, { az: 90, text: '右' },
      { az: 180, text: '背' }, { az: 270, text: '左' },
    ];
    return labels.map((d) => {
      const rad = d.az * Math.PI / 180;
      return { pos: [Math.sin(rad) * 1.85, 0, Math.cos(rad) * 1.85] as THREE.Vector3Tuple, text: d.text };
    });
  }, []);

  return (
    <>
      {/* Lights */}
      <ambientLight intensity={1} />

      {/* Ground plane — lowered to avoid visual overlap */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]}>
        <planeGeometry args={[6, 6]} />
        <meshBasicMaterial color={0x0a0a16} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* ── Pink Ring: Azimuth Orbit (Y=0 plane, horizontal) ── */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[ringR, 0.025, 8, 64]} />
        <meshBasicMaterial color={PINK_HEX} transparent opacity={0.6} />
      </mesh>

      {/* Pink ring marker (current azimuth position on the ring) — draggable */}
      <mesh
        ref={ringMarkerRef}
        position={[Math.sin(azRad) * ringR, 0.35, Math.cos(azRad) * ringR]}
      >
        <sphereGeometry args={[0.22, 24, 24]} />
        <meshBasicMaterial color={PINK_HEX} />
      </mesh>

      {/* ── Cyan Arc: Elevation (YZ plane at x=0) ── */}
      <mesh geometry={arcMesh}>
        <meshBasicMaterial color={CYAN_HEX} transparent opacity={0.6} />
      </mesh>

      {/* Cyan arc marker (current elevation on the arc) — draggable */}
      <mesh
        ref={arcMarkerRef}
        position={[0, Math.sin(elRad) * arcR, Math.cos(elRad) * arcR]}
      >
        <sphereGeometry args={[0.2, 24, 24]} />
        <meshBasicMaterial color={CYAN_HEX} />
      </mesh>

      {/* ── Gold Line: Distance from origin to camera position ── */}
      <primitive object={useMemo(() => {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), camPos.clone()]);
        const mat = new THREE.LineBasicMaterial({ color: GOLD_HEX, linewidth: 3, transparent: true, opacity: 0.8 });
        const line = new THREE.Line(geo, mat);
        return line;
      }, [camPos])} />

      {/* Gold end ball — draggable for distance */}
      <mesh ref={lineEndRef} position={camPos}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color={GOLD_HEX} />
      </mesh>

      {/* ── Preset dots on ring ── */}
      {presetDots.map((pos, i) => (
        <mesh key={`dot${i}`} position={pos}>
          <sphereGeometry args={[0.025, 6, 6]} />
          <meshBasicMaterial color={PINK_HEX} transparent opacity={0.3} />
        </mesh>
      ))}

      {/* ── Camera Marker (yellow ball) — draggable for distance ── */}
      <mesh ref={markerRef} position={camPos}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={0xf59e0b} />
        {/* Glow */}
        <mesh>
          <sphereGeometry args={[0.13, 16, 16]} />
          <meshBasicMaterial color={0xf59e0b} transparent opacity={0.15} />
        </mesh>
      </mesh>

      {/* ── Camera cone (view cone) ── */}
      <mesh ref={coneRef} position={camPos} rotation={[0, 0, 0]}>
        <coneGeometry args={[0.12, 0.25, 12, 1, true]} />
        <meshBasicMaterial color={0xf59e0b} transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>

      {/* ── Image Card (center) ── */}
      <group>
        {/* Card front */}
        <mesh>
          <planeGeometry args={[1.2, 1.6]} />
          <meshBasicMaterial map={gridTexture} side={THREE.FrontSide} transparent opacity={0.85} />
        </mesh>
        {/* Card back (grid pattern) */}
        <mesh rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[1.2, 1.6]} />
          <meshBasicMaterial map={gridTexture} side={THREE.FrontSide} transparent opacity={0.85} />
        </mesh>
        {/* Card border */}
        <lineSegments geometry={new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.2, 1.6))}>
          <lineBasicMaterial color={0xa78bfa} transparent opacity={0.6} />
        </lineSegments>
      </group>

      {/* ── Direction labels (sprites) ── */}
      {dirLabels.map((d, i) => (
        <sprite key={`dl${i}`} position={d.pos} scale={[0.35, 0.17, 1]}>
          <spriteMaterial map={useMemo(() => makeTextSprite(d.text).material.map, [d.text])} transparent />
        </sprite>
      ))}

      {/* ── Camera pointer line ── */}
      <primitive object={useMemo(() => {
        const geo = new THREE.BufferGeometry().setFromPoints([camPos.clone(), new THREE.Vector3(0, 0, 0)]);
        const mat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.25 });
        return new THREE.Line(geo, mat);
      }, [camPos])} />

      {/* Fixed camera for the preview viewport */}
      <OrbitControls enableZoom={false} enableRotate={false} enablePan={false} />
    </>
  );
}

// ── Outer wrapper: Canvas container + overlays ───────────────────────────────

function Camera3DPreview({
  azimuth, elevation, zoom,
  onAzimuthChange, onElevationChange, onZoomChange,
}: {
  azimuth: number; elevation: number; zoom: number;
  onAzimuthChange?: (v: number) => void;
  onElevationChange?: (v: number) => void;
  onZoomChange?: (v: number) => void;
}) {
  // Internal state for interactive mode (if no external onChange provided)
  const [localAz, setLocalAz] = useState(azimuth);
  const [localEl, setLocalEl] = useState(elevation);
  const [localZm, setLocalZm] = useState(zoom);

  // Sync props -> local state
  useEffect(() => { setLocalAz(azimuth); }, [azimuth]);
  useEffect(() => { setLocalEl(elevation); }, [elevation]);
  useEffect(() => { setLocalZm(zoom); }, [zoom]);

  const handleAz = useCallback((v: number) => { setLocalAz(v); onAzimuthChange?.(v); }, [onAzimuthChange]);
  const handleEl = useCallback((v: number) => { setLocalEl(v); onElevationChange?.(v); }, [onElevationChange]);
  const handleZm = useCallback((v: number) => { setLocalZm(v); onZoomChange?.(v); }, [onZoomChange]);

  // Generated prompt text
  const hAngle = ((localAz % 360) + 360) % 360;
  const dirLabel = (hAngle < 22.5 || hAngle >= 337.5) ? 'front view' :
    (hAngle >= 22.5 && hAngle < 67.5) ? 'front-right quarter view' :
    (hAngle >= 67.5 && hAngle < 112.5) ? 'right side view' :
    (hAngle >= 112.5 && hAngle < 157.5) ? 'back-right quarter view' :
    (hAngle >= 157.5 && hAngle < 202.5) ? 'back view' :
    (hAngle >= 202.5 && hAngle < 247.5) ? 'back-left quarter view' :
    (hAngle >= 247.5 && hAngle < 292.5) ? 'left side view' :
    'front-left quarter view';
  const elevLabel = localEl < -15 ? 'low-angle shot' :
    localEl < 15 ? 'eye-level shot' :
    localEl < 45 ? 'elevated shot' : 'high-angle shot';
  const distLabel = localZm < 2 ? 'wide shot' :
    localZm < 6 ? 'medium shot' : 'close-up';
  const generatedPrompt = `<sks> ${dirLabel} ${elevLabel} ${distLabel}`;

  const size = 280;

  return (
    <div
      className="nodrag"
      style={{ position: 'relative', width: size, margin: '0 auto', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(233,61,130,0.2)' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Canvas
        className="camera3d-canvas"
        camera={{ position: [4, 3.5, 4], fov: 40, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: size, height: size, background: '#0a0a0f' }}
        onCreated={({ gl }) => { gl.setSize(size, size); }}
      >
        <color attach="background" args={['#0a0a0f']} />
        <Camera3DScene
          azimuth={localAz} elevation={localEl} zoom={localZm}
          onAzimuthChange={handleAz} onElevationChange={handleEl} onZoomChange={handleZm}
        />
      </Canvas>

      {/* Prompt overlay (top-left) */}
      <div style={{
        position: 'absolute', top: 6, left: 6,
        background: 'rgba(10,10,15,0.88)',
        border: `1px solid rgba(233,61,130,0.3)`,
        borderRadius: 4, padding: '3px 7px',
        fontSize: 9, color: PINK,
        fontFamily: 'Consolas, Monaco, monospace',
        lineHeight: 1.35, maxWidth: size - 12,
        pointerEvents: 'none',
      }}>
        {generatedPrompt}
      </div>

      {/* Bottom values bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'rgba(10,10,15,0.88)',
        borderTop: `1px solid rgba(233,61,130,0.25)`,
        padding: '5px 10px',
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
        fontSize: 11,
        pointerEvents: 'none',
      }}>
        <span style={{ color: PINK, fontWeight: 600 }}>{Math.round(localAz)}°</span>
        <span style={{ color: CYAN, fontWeight: 600 }}>{Math.round(localEl)}°</span>
        <span style={{ color: GOLD, fontWeight: 600 }}>{localZm.toFixed(1)}</span>
      </div>
    </div>
  );
}

// ─── Slider component ─────────────────────────────────────────────────────

function SliderControl({ label, value, min, max, step, unit, color, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; color?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const accentColor = color || 'var(--accent-btn)';
  const trackFill = color || 'var(--text-secondary)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
      <span style={{ fontSize: '11px', color: accentColor, whiteSpace: 'nowrap', width: '32px', fontWeight: 500 }}>{label}</span>
      <div style={{ flex: 1, position: 'relative', height: '12px', display: 'flex', alignItems: 'center' }}>
        <input
          type="range" className="nodrag nowheel assetgen-slider"
          min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            flex: 1,
            height: '3px',
            accentColor: accentColor,
            background: `linear-gradient(to right, ${trackFill} ${pct}%, var(--border) ${pct}%)`,
            borderRadius: '2px',
            appearance: 'none' as const,
            WebkitAppearance: 'none' as const,
            outline: 'none',
            cursor: 'pointer',
          }}
        />
      </div>
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', width: '40px', textAlign: 'right', fontFamily: 'monospace' }}>
        {value}{unit || ''}
      </span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────

export const AssetGenNode = memo(function AssetGenNode({ data, id, selected }: NodeProps) {
  const nodeData = data as unknown as AssetGenNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const showError = useErrorStore((s) => s.showError);
  const addToast = useToastStore((s) => s.addToast);

  const [prompt, setPrompt] = useState(nodeData.prompt || "");
  const [inputText, setInputText] = useState(nodeData.prompt || "");
  const [selectedModelId, setSelectedModelId] = useState(nodeData.model || DEFAULT_MODEL_ID);
  const [selectedSize, setSelectedSize] = useState<string>(nodeData.size || "1K");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<string>(nodeData.aspectRatio || "1:1");
  const [cameraAngle, setCameraAngle] = useState(nodeData.cameraAngle || "front");
  const [cameraAzimuth, setCameraAzimuth] = useState(nodeData.cameraAzimuth ?? 0);
  const [cameraElevation, setCameraElevation] = useState(nodeData.cameraElevation ?? 0);
  const [cameraZoom, setCameraZoom] = useState(nodeData.cameraZoom ?? 5);
  const [removeBg, setRemoveBg] = useState(nodeData.removeBg || false);
  const [removeBgFeather, setRemoveBgFeather] = useState(nodeData.removeBgFeather ?? 0);
  const [removeBgGreenScreen, setRemoveBgGreenScreen] = useState(nodeData.removeBgGreenScreen ?? 0);
  const [removeBgEdgeShrink, setRemoveBgEdgeShrink] = useState(nodeData.removeBgEdgeShrink ?? 0);
  const [negativeHints, setNegativeHints] = useState<string[]>(nodeData.negativeHints || []);
  const [selectedProviderId, setSelectedProviderId] = useState(nodeData.providerId || "");

  const [isGenerating, setIsGeneratingRaw] = useState(nodeData.isGenerating || false);
  const isGeneratingRef = useRef(nodeData.isGenerating || false);
  const setIsGenerating = useCallback((val: boolean) => {
    isGeneratingRef.current = val;
    setIsGeneratingRaw(val);
  }, []);
  const [isRemovingBg, setIsRemovingBg] = useState(nodeData.isRemovingBg || false);
  const [showCameraDropdown, setShowCameraDropdown] = useState(false);
  const [showCameraSliders, setShowCameraSliders] = useState(true);
  const [showParamsPanel, setShowParamsPanel] = useState(false);
  const [showRemoveBgPanel, setShowRemoveBgPanel] = useState(false);
  const [showPoseLibrary, setShowPoseLibrary] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [poseSearch, setPoseSearch] = useState("");
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(nodeData.generatedImageUrl || null);
  const [removedBgUrl, setRemovedBgUrl] = useState<string | null>(nodeData.removedBgUrl || null);
  const [history, setHistory] = useState<AssetGenHistoryEntry[]>(nodeData.history || []);
  const [showImageEditor, setShowImageEditor] = useState(false);

  // Reference image states
  const [characterRef, setCharacterRef] = useState<string | null>(nodeData.characterRef || null);
  const [poseRef, setPoseRef] = useState<string | null>(nodeData.poseRef || null);
  const [sceneRef, setSceneRef] = useState<string | null>(nodeData.sceneRef || null);

  const characterInputRef = useRef<HTMLInputElement>(null);
  const poseInputRef = useRef<HTMLInputElement>(null);
  const sceneInputRef = useRef<HTMLInputElement>(null);

  const activeJobsRef = useRef<Map<string, { timer: ReturnType<typeof setInterval>; pollStart: number; shouldUseCredits: boolean }>>(new Map());

  // ── Settings / grsai ──────────────────────────────────────────────────
  const settingsProviders = useSettingsStore((s) => s.providers);
  const imageTabProvider = settingsProviders.find((p) => p.id === "image-model");
  const imageChannelId = imageTabProvider?.channel || "";
  const isGrsaiChannel = imageTabProvider?.channel === "grsai";
  const grsaiModelName = isGrsaiChannel ? imageTabProvider?.modelName : undefined;
  const isCustomProvider = selectedProviderId && selectedProviderId !== "grsai" && selectedProviderId !== "vjimeng";

  const extraImageModels = useMemo<ModelOption[]>(() => {
    if (!grsaiModelName || !isGrsaiChannel) return [];
    return [{ id: `grsai/${grsaiModelName}`, label: grsaiModelName, providerId: "grsai" }];
  }, [grsaiModelName, isGrsaiChannel]);

  const { availableProviders, availableModels, getDefaultModel } = useChannelModelSelector(
    "image", selectedProviderId, extraImageModels
  );

  // Auto-sync provider from settings
  useEffect(() => {
    if (!imageChannelId) return;
    const savedProviderId = nodeData.providerId;
    if (!savedProviderId || savedProviderId === "openai-compatible" || savedProviderId === "") {
      setSelectedProviderId(imageChannelId);
      updateNodeData(id, { providerId: imageChannelId });
    }
  }, [imageChannelId, nodeData.providerId, id, updateNodeData]);

  const allModels = useMemo(() => {
    const builtIn = getAllModels();
    if (grsaiModelName && isGrsaiChannel) {
      const customModelId = `grsai/${grsaiModelName}`;
      if (!builtIn.some((m) => m.id === customModelId)) {
        const customModel: ImageModelDefinition = {
          id: customModelId,
          displayName: grsaiModelName,
          providerId: "grsai",
          supportedSizes: ["1K", "2K", "4K"],
          defaultSize: "1K",
          supportedAspectRatios: [
            { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
            { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
            { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
            { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
            { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
          ],
          defaultAspectRatio: "1:1",
          supportsImageToImage: true,
          maxReferenceImages: 5,
          extraParamsSchema: [],
          expectedDurationMs: 90000,
          resolveRequest: () => ({ requestModel: grsaiModelName, modeLabel: "素材生成" }),
        };
        return [...builtIn, customModel];
      }
    }
    // ── Custom provider fallback ──
    if (isCustomProvider && nodeData.model) {
      const rawModelName = nodeData.model.replace(/^[^/]+\//, "");
      const exists = builtIn.some((m) => m.id === nodeData.model || m.id === rawModelName);
      if (!exists) {
        const fallbackModel: ImageModelDefinition = {
          id: nodeData.model,
          displayName: rawModelName,
          providerId: selectedProviderId,
          supportedSizes: ["1K", "2K", "4K"],
          defaultSize: "1K",
          supportedAspectRatios: [
            { label: "1:1", value: "1:1", widthRatio: 1, heightRatio: 1 },
            { label: "16:9", value: "16:9", widthRatio: 16, heightRatio: 9 },
            { label: "9:16", value: "9:16", widthRatio: 9, heightRatio: 16 },
            { label: "4:3", value: "4:3", widthRatio: 4, heightRatio: 3 },
            { label: "3:4", value: "3:4", widthRatio: 3, heightRatio: 4 },
          ],
          defaultAspectRatio: "1:1",
          supportsImageToImage: true,
          maxReferenceImages: 5,
          extraParamsSchema: [],
          expectedDurationMs: 90000,
          resolveRequest: () => ({ requestModel: rawModelName, modeLabel: "素材生成" }),
        };
        return [...builtIn, fallbackModel];
      }
    }
    return builtIn;
  }, [grsaiModelName, isGrsaiChannel, isCustomProvider, nodeData.model, selectedProviderId]);

  // Sync states from store
  useEffect(() => {
    if (nodeData.prompt !== undefined && nodeData.prompt !== prompt) {
      setPrompt(nodeData.prompt);
      setInputText(nodeData.prompt);
    }
  }, [nodeData.prompt]);

  useEffect(() => {
    if (nodeData.isGenerating !== isGenerating) setIsGenerating(nodeData.isGenerating);
  }, [nodeData.isGenerating]);

  useEffect(() => {
    if (nodeData.generatedImageUrl !== generatedImageUrl) setGeneratedImageUrl(nodeData.generatedImageUrl);
  }, [nodeData.generatedImageUrl]);

  useEffect(() => {
    if (nodeData.removedBgUrl !== removedBgUrl) setRemovedBgUrl(nodeData.removedBgUrl);
  }, [nodeData.removedBgUrl]);

  const handlePromptChange = useCallback(
    (value: string) => { setPrompt(value); updateNodeData(id, { prompt: value }); },
    [id, updateNodeData]
  );

  const handleModelChange = useCallback(
    (newModelId: string) => {
      setSelectedModelId(newModelId);
      updateNodeData(id, { model: newModelId, providerId: selectedProviderId });
    },
    [id, updateNodeData, selectedProviderId]
  );

  const handleProviderChange = useCallback(
    (providerId: string) => {
      setSelectedProviderId(providerId);
      updateNodeData(id, { providerId });
      const defaultModel = getDefaultModel(providerId);
      if (defaultModel) { setSelectedModelId(defaultModel); updateNodeData(id, { model: defaultModel, providerId }); }
    },
    [id, updateNodeData, getDefaultModel]
  );

  // ── Reference image upload ────────────────────────────────────────────
  const handleRefUpload = useCallback(
    async (type: "character" | "pose" | "scene", file: File) => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const field = type === "character" ? "characterRef" : type === "pose" ? "poseRef" : "sceneRef";
        const setter = type === "character" ? setCharacterRef : type === "pose" ? setPoseRef : setSceneRef;
        setter(dataUrl);
        updateNodeData(id, { [field]: dataUrl });
      } catch (e) {
        showError(`上传参考图失败: ${e}`);
      }
    },
    [id, updateNodeData, showError]
  );

  const handleRefDrop = useCallback(
    async (type: "character" | "pose" | "scene", e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        await handleRefUpload(type, file);
      }
    },
    [handleRefUpload]
  );

  // ── Build combined prompt with camera angle, camera params, and negative hints ────────
  const buildFullPrompt = useCallback((basePrompt: string) => {
    const parts: string[] = [];
    // Camera angle preset
    const anglePreset = CAMERA_ANGLE_PRESETS.find((a) => a.value === cameraAngle);
    if (anglePreset) parts.push(anglePreset.prompt);
    // Camera sliders — generate <sks> prompt matching ComfyUI-qwenmultiangle
    if (cameraAzimuth !== 0 || cameraElevation !== 0 || cameraZoom !== 5) {
      const hAngle = ((cameraAzimuth % 360) + 360) % 360;
      const hDirection = (hAngle < 22.5 || hAngle >= 337.5) ? 'front view' :
        (hAngle < 67.5) ? 'front-right quarter view' :
        (hAngle < 112.5) ? 'right side view' :
        (hAngle < 157.5) ? 'back-right quarter view' :
        (hAngle < 202.5) ? 'back view' :
        (hAngle < 247.5) ? 'back-left quarter view' :
        (hAngle < 292.5) ? 'left side view' :
        'front-left quarter view';
      const vDirection = cameraElevation < -15 ? 'low-angle shot' :
        cameraElevation < 15 ? 'eye-level shot' :
        cameraElevation < 45 ? 'elevated shot' : 'high-angle shot';
      const distStr = cameraZoom < 2 ? 'wide shot' :
        cameraZoom < 6 ? 'medium shot' : 'close-up';
      parts.push(`<sks> ${hDirection} ${vDirection} ${distStr}`);
    }
    // Negative hints
    const hintPrompts = negativeHints
      .map((h) => NEGATIVE_HINT_OPTIONS.find((o) => o.value === h)?.prompt)
      .filter(Boolean);
    if (hintPrompts.length > 0) parts.push(hintPrompts.join(", "));
    // Base prompt
    parts.push(basePrompt);
    return parts.join(", ");
  }, [cameraAngle, cameraAzimuth, cameraElevation, cameraZoom, negativeHints]);

  // ── Collect reference images ──────────────────────────────────────────
  const collectReferenceImages = useCallback((): string[] | undefined => {
    const refs: string[] = [];
    if (characterRef) refs.push(characterRef);
    if (poseRef) refs.push(poseRef);
    if (sceneRef) refs.push(sceneRef);
    return refs.length > 0 ? refs : undefined;
  }, [characterRef, poseRef, sceneRef]);

  // ── Add to history ─────────────────────────────────────────────────
  const addToHistory = useCallback((entry: AssetGenHistoryEntry) => {
    const newHistory = [entry, ...history].slice(0, 50); // max 50 entries
    setHistory(newHistory);
    updateNodeData(id, { history: newHistory });
  }, [history, id, updateNodeData]);

  // ── Poll job status (Promise-based) ────────────────────────────────────
  const pollJobUntilDone = useCallback(
    (jobId: string, expectedDurationMs: number = 90000): Promise<void> => {
      return new Promise<void>((resolve) => {
        const pollStart = Date.now();
        const pollErrorCount = { value: 0 };
        const shouldUseCredits = useSettingsStore.getState().creditsEnabled && !(selectedProviderId?.startsWith("custom-"));
        const forceTimeout = Math.max(expectedDurationMs * 3, 3 * 60 * 1000);
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let stopped = false;

        const poll = async () => {
          if (stopped) return;
          try {
            if (Date.now() - pollStart > forceTimeout) {
              stopped = true; activeJobsRef.current.delete(jobId);
              showError("素材生成超时，请重试"); updateNodeData(id, { isGenerating: false, generationError: "素材生成超时" }); setIsGenerating(false);
              if (shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, selectedProviderId); resolve(); return;
            }
            if (Date.now() - pollStart > MAX_POLL_TIME) {
              stopped = true; activeJobsRef.current.delete(jobId);
              showError("素材生成超时（15分钟），请重试"); updateNodeData(id, { isGenerating: false, generationError: "素材生成超时（15分钟）" }); setIsGenerating(false);
              if (shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, selectedProviderId); resolve(); return;
            }

            const status = await tauriAiGateway.getGenerateImageJob(jobId);
            pollErrorCount.value = 0;
            if (status.progress !== undefined && status.progress >= 0) updateNodeData(id, { progressPercent: Math.round(status.progress) });

            if (status.result) {
              stopped = true; activeJobsRef.current.delete(jobId);
              const resultFileName = extractDisplayName(status.result, "asset"); const rawUrl = status.result;
              setGeneratedImageUrl(rawUrl); updateNodeData(id, { generatedImageUrl: rawUrl, isGenerating: false, displayName: resultFileName, generationError: undefined }); setIsGenerating(false);
              (async () => { let p = rawUrl; try { if (rawUrl.startsWith("data:") || rawUrl.startsWith("http")) { try { const lp = await persistImageSource(rawUrl) as string; if (lp && lp !== rawUrl) { p = lp; setGeneratedImageUrl(lp); updateNodeData(id, { generatedImageUrl: lp }); } } catch (e) { console.error("[资产生成] 图片持久化失败:", e); } } addToHistory({ id: `h_${Date.now()}`, timestamp: Date.now(), prompt: prompt, cameraAngle, providerId: selectedProviderId, model: selectedModelId, generatedImageUrl: p, removedBgUrl: null }); if (removeBg) performRemoveBg(p); } catch (e) { console.error("[资产生成] 结果回调失败:", e); } })();
              resolve(); return;
            }

            if (status.status === "succeeded") {
              stopped = true; activeJobsRef.current.delete(jobId);
              showError("素材生成失败: 后端返回空结果"); updateNodeData(id, { isGenerating: false, generationError: "后端返回空结果" }); setIsGenerating(false);
              if (shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, selectedProviderId); resolve();
            } else if (status.status === "failed" || (status.error && !status.result)) {
              stopped = true; activeJobsRef.current.delete(jobId);
              const errorMsg = status.error || "未知错误"; showError(`素材生成失败: ${errorMsg}`); updateNodeData(id, { isGenerating: false, generationError: errorMsg }); setIsGenerating(false);
              if (shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, selectedProviderId); resolve();
            } else {
              if (!stopped) timeoutId = setTimeout(poll, POLL_INTERVAL);
            }
          } catch (e) {
            pollErrorCount.value++;
            if (pollErrorCount.value >= 5) {
              stopped = true; activeJobsRef.current.delete(jobId);
              const errMsg = e instanceof Error ? e.message : String(e); updateNodeData(id, { isGenerating: false, generationError: errMsg || "轮询出错过多，已停止" }); setIsGenerating(false);
              if (shouldUseCredits) tauriAiGateway.refundImageCredits(jobId, selectedProviderId); resolve();
            } else {
              if (!stopped) timeoutId = setTimeout(poll, POLL_INTERVAL);
            }
          }
        };
        timeoutId = setTimeout(poll, 0);
        activeJobsRef.current.set(jobId, { timer: timeoutId as any, pollStart, shouldUseCredits });
      });
    },
    [id, updateNodeData, showError, removeBg, prompt, cameraAngle, selectedProviderId, selectedModelId, addToHistory]
  );

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { activeJobsRef.current.forEach((job) => clearInterval(job.timer)); activeJobsRef.current.clear(); };
  }, []);

  // ── Listen for real-time progress events from Rust (bypasses DB latency) ──
  useEffect(() => {
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;
    import("@/features/canvas/compat/event").then(({ listen }) => {
      // 1) grsai/credits API progress (via DB + atomic)
      listen<{ jobId: string; progress: number }>("generation-progress", (event) => {
        const { jobId, progress } = event.payload;
        if (activeJobsRef.current.has(jobId) && progress >= 0) {
          updateNodeData(id, { progressPercent: Math.round(progress) });
        }
      }).then((fn) => { unlisten1 = fn; });

      // 2) jimeng browser automation progress (Playwright stdout line-by-line)
      listen<{ percent: number; stage: string; message: string }>("jimeng-browser-progress", (event) => {
        const { percent } = event.payload;
        if (isGeneratingRef.current && percent >= 0) {
          updateNodeData(id, { progressPercent: Math.round(percent) });
        }
      }).then((fn) => { unlisten2 = fn; });
    });
    return () => { unlisten1?.(); unlisten2?.(); };
  }, [id, updateNodeData]);

  // ── Remove background ─────────────────────────────────────────────────
  const performRemoveBg = useCallback(async (imageUrl: string) => {
    setIsRemovingBg(true);
    updateNodeData(id, { isRemovingBg: true });
    try {
      const result = await invoke("remove_bg", {
        imagePath: imageUrl,
        feather: removeBgFeather,
        greenScreen: removeBgGreenScreen,
        edgeShrink: removeBgEdgeShrink,
      });
      const resultPath = result as string;
      setRemovedBgUrl(resultPath);
      updateNodeData(id, { removedBgUrl: resultPath, isRemovingBg: false });
      addToast("success", "抠图完成");
    } catch (e) {
      console.warn("Remove BG failed:", e);
      addToast("warning", "抠图功能暂未实现，请等待后续更新");
      updateNodeData(id, { isRemovingBg: false });
    } finally {
      setIsRemovingBg(false);
    }
  }, [id, updateNodeData, addToast, removeBgFeather, removeBgGreenScreen, removeBgEdgeShrink]);

  // ── Handle generate ────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (isGeneratingRef.current) return; // Prevent re-entry via ref guard
    const textToUse = inputText.trim() || prompt.trim();
    if (!textToUse) return;

    const effectiveModelId = nodeData.model || DEFAULT_MODEL_ID;
    const modelDef = allModels.find((m) => m.id === effectiveModelId)
      || resolveModelId(effectiveModelId)
      || (isCustomProvider ? createFallbackModelDefinition(effectiveModelId, selectedProviderId, "素材生成") : undefined);
    if (!modelDef) { showError("未找到模型配置: " + effectiveModelId); return; }

    if (inputText.trim()) handlePromptChange(inputText.trim());

    const fullPrompt = buildFullPrompt(textToUse);
    const referenceImages = collectReferenceImages();
    const { requestModel } = modelDef.resolveRequest({ referenceImageCount: referenceImages?.length || 0 });
    const effectiveProviderId = selectedProviderId || modelDef.providerId;

    updateNodeData(id, { prompt: textToUse, isGenerating: true });
    setIsGenerating(true);

    let jobId: string;
    try {
      jobId = await tauriAiGateway.submitGenerateImageJob({
        model: `${effectiveProviderId}/${requestModel}`,
        prompt: fullPrompt,
        size: (selectedSize as ImageSize) || modelDef.defaultSize,
        aspectRatio: selectedAspectRatio,
        referenceImages,
        extraParams: {},
      });
    } catch (e) {
      showError(`素材生成提交失败: ${e}`);
      updateNodeData(id, { isGenerating: false });
      setIsGenerating(false);
      return;
    }

    await pollJobUntilDone(jobId, modelDef.expectedDurationMs || 90000);
  }, [inputText, prompt, nodeData, id, allModels, selectedProviderId, selectedSize, selectedAspectRatio, pollJobUntilDone, showError, handlePromptChange, buildFullPrompt, collectReferenceImages]);

  // ── Export to Adobe Animate ────────────────────────────────────────────
  const handleExportToAnimate = useCallback(async () => {
    const imageUrl = removedBgUrl || generatedImageUrl;
    if (!imageUrl) {
      addToast("warning", "没有可导出的图片");
      return;
    }

    try {
      await invoke("export_to_animate", { imagePath: imageUrl });
      addToast("success", "已导出到 Adobe Animate");
    } catch (e) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": fetch(imageUrl).then((r) => r.blob()),
          }),
        ]);
        addToast("success", "已复制到剪贴板，请在 Animate 中 Ctrl+V 粘贴");
      } catch {
        addToast("error", "导出到 Animate 失败，请检查 Animate 是否正在运行");
      }
    }
  }, [removedBgUrl, generatedImageUrl, addToast]);

  // ── Restore from history ────────────────────────────────────────────
  const handleRestoreFromHistory = useCallback((entry: AssetGenHistoryEntry) => {
    setGeneratedImageUrl(entry.generatedImageUrl);
    setRemovedBgUrl(entry.removedBgUrl);
    setPrompt(entry.prompt);
    setInputText(entry.prompt);
    setCameraAngle(entry.cameraAngle);
    updateNodeData(id, {
      generatedImageUrl: entry.generatedImageUrl,
      removedBgUrl: entry.removedBgUrl,
      prompt: entry.prompt,
      cameraAngle: entry.cameraAngle,
    });
    setShowHistory(false);
    addToast("success", "已恢复历史记录");
  }, [id, updateNodeData, addToast]);

  // ── Delete history entry ────────────────────────────────────────────
  const handleDeleteHistory = useCallback((entryId: string) => {
    const newHistory = history.filter((h) => h.id !== entryId);
    setHistory(newHistory);
    updateNodeData(id, { history: newHistory });
  }, [history, id, updateNodeData]);

  // ── Pose library filtering ──────────────────────────────────────────
  const filteredPoses = useMemo(() => {
    if (!poseSearch.trim()) return BUILTIN_POSE_LIBRARY;
    return BUILTIN_POSE_LIBRARY.filter((p) =>
      p.name.includes(poseSearch) || p.category.includes(poseSearch) || p.description.includes(poseSearch)
    );
  }, [poseSearch]);

  const poseCategories = useMemo(() => {
    const cats = new Set(BUILTIN_POSE_LIBRARY.map((p) => p.category));
    return Array.from(cats);
  }, []);

  // ── Node dimensions ──────────────────────────────────────────────────
  const nodeWidth = nodeData.width || DEFAULT_NODE_WIDTH;
  const nodeHeight = nodeData.height || DEFAULT_NODE_HEIGHT;
  const handleResize = useCallback(
    (result: { width: number; height: number }) => {
      updateNodeData(id, { width: result.width, height: result.height });
    },
    [id, updateNodeData]
  );

  // ── Display image ─────────────────────────────────────────────────────
  const displayImageUrl = removedBgUrl || generatedImageUrl;

  // ── Shared styles ────────────────────────────────────────────────────
  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    padding: '10px',
    zIndex: 50,
  };

  const sectionLabel: React.CSSProperties = {
    fontSize: '10px', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '4px',
  };

  return (
    <>
      <style>{`
        @keyframes assetPulse{0%,100%{opacity:1}50%{opacity:0.3}}
        .assetgen-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--text-primary, #f0f0f5);
          cursor: pointer;
          border: 2px solid var(--bg-surface, #25252a);
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          margin-top: -4px;
        }
        .assetgen-slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--text-primary, #f0f0f5);
          cursor: pointer;
          border: 2px solid var(--bg-surface, #25252a);
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .assetgen-slider::-webkit-slider-runnable-track {
          height: 3px;
          border-radius: 2px;
          border: none;
        }
        .assetgen-slider::-moz-range-track {
          height: 3px;
          border-radius: 2px;
          border: none;
        }
      `}</style>
      <NodeDeleteButton id={id} selected={selected ?? false}>
        {displayImageUrl && (
          <button
            className="nodrag"
            onClick={() => setShowImageEditor(true)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "6px 14px", borderRadius: "10px",
              backgroundColor: "var(--bg-node)", border: "1px solid var(--border)",
              color: "var(--text-primary)", fontSize: "12px", fontWeight: 500,
              cursor: "pointer", backdropFilter: "blur(8px)",
              transition: "all 0.2s ease", boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
            }}
            title="编辑图片"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <span>编辑</span>
          </button>
        )}
      </NodeDeleteButton>
      {/* Image editor dialog */}
      {showImageEditor && displayImageUrl && (
        <ImageEditorDialog
          imageUrl={displayImageUrl}
          onSave={async (editedUrl) => {
            if (editedUrl) {
              try {
                const persistedPath = (await persistImageSource(editedUrl)) as string;
                if (removedBgUrl) {
                  setRemovedBgUrl(persistedPath);
                  updateNodeData(id, { removedBgUrl: persistedPath });
                } else {
                  setGeneratedImageUrl(persistedPath);
                  updateNodeData(id, { generatedImageUrl: persistedPath });
                }
              } catch (e) {
                console.error("[资产生成] 编辑后图片保存失败:", e);
                if (removedBgUrl) {
                  setRemovedBgUrl(editedUrl);
                  updateNodeData(id, { removedBgUrl: editedUrl });
                } else {
                  setGeneratedImageUrl(editedUrl);
                  updateNodeData(id, { generatedImageUrl: editedUrl });
                }
              }
            }
            setShowImageEditor(false);
          }}
          onClose={() => setShowImageEditor(false)}
        />
      )}
      <div style={{ position: 'relative' }}>
        <div
          className="node-inner"
          style={{
            backgroundColor: 'var(--bg-node)',
            border: '1px solid var(--border)',
            boxShadow: '0 2px 12px rgba(0,0,0,.3)',
            borderRadius: 'var(--node-radius)',
            width: nodeWidth,
            height: nodeHeight,
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span style={{ fontSize: '14px' }}>🎭</span>
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }} title={nodeData.displayName || "素材生成"}>
                {nodeData.displayName || "素材生成"}
              </span>
              {isGenerating && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--accent)', backgroundColor: 'var(--bg-hover)', borderRadius: '9999px', padding: '2px 8px', marginLeft: '4px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--accent-btn)', animation: 'assetPulse 1.5s ease-in-out infinite', display: 'inline-block' }} />
                  {nodeData.progressPercent > 0 ? `${nodeData.progressPercent}%` : '生成中'}
                </span>
              )}
              {isRemovingBg && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#4ade80', backgroundColor: 'var(--bg-hover)', borderRadius: '9999px', padding: '2px 8px', marginLeft: '4px' }}>
                  抠图中...
                </span>
              )}
            </div>
            {/* History button */}
            <button
              className="nodrag"
              onClick={() => setShowHistory(!showHistory)}
              style={{
                padding: '2px 6px', borderRadius: '4px', fontSize: '10px',
                border: '1px solid var(--border)', backgroundColor: 'transparent',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
              title="历史记录"
            >
              📋 {history.length}
            </button>
          </div>

          {/* Generated image preview */}
          {displayImageUrl && (
            <div style={{ padding: '8px 14px', flexShrink: 0 }}>
              <div style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)', backgroundColor: '#1a1a1e' }}>
                <img
                  src={displayImageUrl}
                  alt="generated"
                  style={{ width: '100%', maxHeight: '160px', objectFit: 'contain', display: 'block' }}
                />
                <button
                  className="nodrag"
                  onClick={handleExportToAnimate}
                  style={{
                    position: 'absolute', bottom: '8px', right: '8px',
                    padding: '4px 10px', borderRadius: '6px',
                    backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff',
                    fontSize: '11px', fontWeight: 500, border: '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  导入 An
                </button>
                {removedBgUrl && (
                  <button
                    className="nodrag"
                    onClick={() => { setRemovedBgUrl(null); updateNodeData(id, { removedBgUrl: null }); }}
                    style={{
                      position: 'absolute', top: '8px', right: '8px',
                      padding: '2px 6px', borderRadius: '4px',
                      backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff',
                      fontSize: '10px', border: 'none', cursor: 'pointer',
                    }}
                    title="还原原图"
                  >
                    还原原图
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Prompt input */}
          <div style={{ padding: '8px 14px 0', flexShrink: 0 }}>
            <textarea
              className="nodrag nowheel"
              value={inputText}
              onChange={(e) => { setInputText(e.target.value); handlePromptChange(e.target.value); }}
              placeholder="描述素材，如：一个持剑的少年战士..."
              style={{
                width: '100%', minHeight: '50px', maxHeight: '80px',
                padding: '8px 10px', borderRadius: '8px',
                backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: '12px', lineHeight: '1.5',
                resize: 'none', outline: 'none',
              }}
            />
          </div>

          {/* Camera angle selector + sliders */}
          <div style={{ padding: '6px 14px', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>📷 镜头</span>
              <div style={{ position: 'relative', flex: 1 }}>
                <button
                  className="nodrag"
                  onClick={() => setShowCameraDropdown(!showCameraDropdown)}
                  style={{
                    width: '100%', padding: '4px 8px', borderRadius: '6px',
                    backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontSize: '11px', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <span>{CAMERA_ANGLE_PRESETS.find((a) => a.value === cameraAngle)?.label || "正面"}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {showCameraDropdown && (
                  <div className="nodrag" style={{
                    ...panelStyle, top: '100%', left: 0, right: 0, marginTop: '2px',
                    maxHeight: '200px', overflowY: 'auto', padding: '4px',
                  }}>
                    {CAMERA_ANGLE_PRESETS.map((angle) => (
                      <button
                        key={angle.value}
                        onClick={() => {
                          setCameraAngle(angle.value);
                          updateNodeData(id, { cameraAngle: angle.value });
                          setShowCameraDropdown(false);
                        }}
                        style={{
                          display: 'block', width: '100%', padding: '5px 8px',
                          border: 'none', borderRadius: '4px',
                          backgroundColor: cameraAngle === angle.value ? 'var(--bg-hover)' : 'transparent',
                          color: cameraAngle === angle.value ? 'var(--accent)' : 'var(--text-secondary)',
                          fontSize: '11px', cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        {angle.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Toggle camera sliders */}
              <button
                className="nodrag"
                onClick={() => setShowCameraSliders(!showCameraSliders)}
                style={{
                  padding: '4px 6px', borderRadius: '6px', fontSize: '10px',
                  border: showCameraSliders ? '1px solid var(--accent)' : '1px solid var(--border)',
                  backgroundColor: showCameraSliders ? 'var(--bg-hover)' : 'transparent',
                  color: showCameraSliders ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
                title="场景相机参数"
              >
                ⚙️
              </button>
            </div>
            {/* Camera sliders + 3D preview */}
            {showCameraSliders && (
              <div style={{ marginTop: '8px', padding: '10px 12px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ ...sectionLabel, marginBottom: '8px', fontSize: '12px' }}>场景相机</div>
                {/* 3D orbit preview */}
                <Camera3DPreview
                  azimuth={cameraAzimuth} elevation={cameraElevation} zoom={cameraZoom}
                  onAzimuthChange={(v) => { setCameraAzimuth(v); updateNodeData(id, { cameraAzimuth: v }); }}
                  onElevationChange={(v) => { setCameraElevation(v); updateNodeData(id, { cameraElevation: v }); }}
                  onZoomChange={(v) => { setCameraZoom(v); updateNodeData(id, { cameraZoom: v }); }}
                />
                {/* Preset dropdowns + sliders (matching reference ControlPanel) */}
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                  {/* Azimuth preset + slider */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '9px', color: '#E93D82', textTransform: 'uppercase', letterSpacing: '0.5px' }}>方位</span>
                      <select
                        className="nodrag"
                        value={AZIMUTH_PRESETS.reduce((prev, curr) =>
                          Math.abs(curr.value - cameraAzimuth) < Math.abs(prev.value - cameraAzimuth) ? curr : prev
                        ).value}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setCameraAzimuth(v);
                          updateNodeData(id, { cameraAzimuth: v });
                        }}
                        style={{
                          flex: 1, fontSize: '9px', color: '#e0e0e0', background: 'rgba(10,10,15,0.9)',
                          border: '1px solid rgba(100,100,120,0.4)', borderRadius: 3, padding: '1px 3px',
                          outline: 'none', cursor: 'pointer',
                        }}
                      >
                        {AZIMUTH_PRESETS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <input type="range" className="nodrag nowheel assetgen-slider"
                      min={0} max={360} step={5} value={cameraAzimuth}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setCameraAzimuth(v);
                        updateNodeData(id, { cameraAzimuth: v });
                      }}
                      style={{ width: '100%', height: '3px', accentColor: '#E93D82' }}
                    />
                  </div>

                  {/* Elevation preset + slider */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '9px', color: '#00FFD0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>仰角</span>
                      <select
                        className="nodrag"
                        value={ELEVATION_PRESETS.reduce((prev, curr) =>
                          Math.abs(curr.value - cameraElevation) < Math.abs(prev.value - cameraElevation) ? curr : prev
                        ).value}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setCameraElevation(v);
                          updateNodeData(id, { cameraElevation: v });
                        }}
                        style={{
                          flex: 1, fontSize: '9px', color: '#e0e0e0', background: 'rgba(10,10,15,0.9)',
                          border: '1px solid rgba(100,100,120,0.4)', borderRadius: 3, padding: '1px 3px',
                          outline: 'none', cursor: 'pointer',
                        }}
                      >
                        {ELEVATION_PRESETS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <input type="range" className="nodrag nowheel assetgen-slider"
                      min={-30} max={60} step={5} value={cameraElevation}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setCameraElevation(v);
                        updateNodeData(id, { cameraElevation: v });
                      }}
                      style={{ width: '100%', height: '3px', accentColor: '#00FFD0' }}
                    />
                  </div>

                  {/* Zoom preset + slider */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '9px', color: '#FFB800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>缩放</span>
                      <select
                        className="nodrag"
                        value={cameraZoom < 2 ? 1 : cameraZoom < 6 ? 4 : 8}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setCameraZoom(v);
                          updateNodeData(id, { cameraZoom: v });
                        }}
                        style={{
                          flex: 1, fontSize: '9px', color: '#e0e0e0', background: 'rgba(10,10,15,0.9)',
                          border: '1px solid rgba(100,100,120,0.4)', borderRadius: 3, padding: '1px 3px',
                          outline: 'none', cursor: 'pointer',
                        }}
                      >
                        {ZOOM_PRESETS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <input type="range" className="nodrag nowheel assetgen-slider"
                      min={0} max={10} step={0.5} value={cameraZoom}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setCameraZoom(v);
                        updateNodeData(id, { cameraZoom: v });
                      }}
                      style={{ width: '100%', height: '3px', accentColor: '#FFB800' }}
                    />
                  </div>
                </div>
                <button className="nodrag" onClick={() => {
                  setCameraAzimuth(0); setCameraElevation(0); setCameraZoom(5);
                  updateNodeData(id, { cameraAzimuth: 0, cameraElevation: 0, cameraZoom: 5 });
                }} style={{ fontSize: '11px', color: 'var(--text-muted)', border: 'none', background: 'none', cursor: 'pointer', padding: '4px 0', marginTop: '2px' }}>
                  重置
                </button>
              </div>
            )}
          </div>

          {/* Reference images section */}
          <div style={{ padding: '4px 14px', display: 'flex', gap: '6px', flexShrink: 0 }}>
            {([
              { type: "character" as const, label: "👤角色", ref: characterRef, inputRef: characterInputRef },
              { type: "pose" as const, label: "🏃姿势", ref: poseRef, inputRef: poseInputRef },
              { type: "scene" as const, label: "🏞️场景", ref: sceneRef, inputRef: sceneInputRef },
            ]).map(({ type, label, ref, inputRef }) => (
              <div key={type} style={{ flex: 1 }}>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleRefUpload(type, file);
                  }}
                />
                <div
                  className="nodrag"
                  onClick={() => inputRef.current?.click()}
                  onDrop={(e) => handleRefDrop(type, e)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{
                    position: 'relative',
                    height: '48px', borderRadius: '6px',
                    backgroundColor: 'var(--bg-surface)', border: '1px dashed var(--border)',
                    cursor: 'pointer', overflow: 'hidden',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {ref ? (
                    <>
                      <img src={ref} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <button
                        className="nodrag"
                        onClick={(e) => {
                          e.stopPropagation();
                          const field = type === "character" ? "characterRef" : type === "pose" ? "poseRef" : "sceneRef";
                          const setter = type === "character" ? setCharacterRef : type === "pose" ? setPoseRef : setSceneRef;
                          setter(null);
                          updateNodeData(id, { [field]: null });
                        }}
                        style={{
                          position: 'absolute', top: '2px', right: '2px',
                          width: '16px', height: '16px', borderRadius: '50%',
                          backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff',
                          border: 'none', cursor: 'pointer', fontSize: '10px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{label}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pose library button */}
          <div style={{ padding: '2px 14px', flexShrink: 0 }}>
            <button
              className="nodrag"
              onClick={() => setShowPoseLibrary(!showPoseLibrary)}
              style={{
                width: '100%', padding: '4px 8px', borderRadius: '6px',
                backgroundColor: showPoseLibrary ? 'var(--bg-hover)' : 'var(--bg-surface)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)', fontSize: '10px', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span>🧍 姿势库</span>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{showPoseLibrary ? '收起 ▲' : '展开 ▼'}</span>
            </button>
          </div>

          {/* Pose library panel */}
          {showPoseLibrary && (
            <div style={{ padding: '4px 14px', flexShrink: 0 }}>
              <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '6px', border: '1px solid var(--border)', padding: '6px', maxHeight: '120px', overflowY: 'auto' }}>
                {/* Search */}
                <input
                  className="nodrag nowheel"
                  value={poseSearch}
                  onChange={(e) => setPoseSearch(e.target.value)}
                  placeholder="搜索姿势..."
                  style={{
                    width: '100%', padding: '3px 8px', borderRadius: '4px', marginBottom: '4px',
                    backgroundColor: 'var(--bg-node)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontSize: '10px', outline: 'none',
                  }}
                />
                {/* Categories */}
                <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  {poseCategories.map((cat) => (
                    <button key={cat} className="nodrag" onClick={() => setPoseSearch(cat)} style={{
                      padding: '1px 5px', borderRadius: '3px', fontSize: '9px',
                      border: '1px solid var(--border)', backgroundColor: poseSearch === cat ? 'var(--bg-hover)' : 'transparent',
                      color: poseSearch === cat ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer',
                    }}>{cat}</button>
                  ))}
                  <button className="nodrag" onClick={() => setPoseSearch("")} style={{
                    padding: '1px 5px', borderRadius: '3px', fontSize: '9px',
                    border: '1px solid var(--border)', backgroundColor: 'transparent',
                    color: 'var(--text-muted)', cursor: 'pointer',
                  }}>全部</button>
                </div>
                {/* Pose list */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px' }}>
                  {filteredPoses.map((pose) => (
                    <button
                      key={pose.id}
                      className="nodrag"
                      onClick={() => {
                        // Inject pose description into prompt and persist selection
                        const poseDesc = pose.description;
                        const currentText = inputText || prompt || "";
                        const newText = currentText.trim()
                          ? `${poseDesc}，${currentText}`
                          : poseDesc;
                        setInputText(newText);
                        handlePromptChange(newText);
                        updateNodeData(id, { selectedPoseId: pose.id });
                        addToast("success", `已选择姿势: ${pose.name}，已注入描述到提示词`);
                        setShowPoseLibrary(false);
                      }}
                      style={{
                        padding: '4px', borderRadius: '4px', fontSize: '9px',
                        border: nodeData.selectedPoseId === pose.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                        backgroundColor: nodeData.selectedPoseId === pose.id ? 'var(--bg-hover)' : 'transparent',
                        color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'center',
                      }}
                      title={pose.description}
                    >
                      {pose.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Negative hints */}
          <div style={{ padding: '4px 14px', display: 'flex', gap: '3px', flexWrap: 'wrap', flexShrink: 0 }}>
            {NEGATIVE_HINT_OPTIONS.map((hint) => {
              const active = negativeHints.includes(hint.value);
              return (
                <button
                  key={hint.value}
                  className="nodrag"
                  onClick={() => {
                    const next = active
                      ? negativeHints.filter((h) => h !== hint.value)
                      : [...negativeHints, hint.value];
                    setNegativeHints(next);
                    updateNodeData(id, { negativeHints: next });
                  }}
                  style={{
                    padding: '2px 5px', borderRadius: '4px', fontSize: '9px',
                    border: active ? '1px solid var(--accent-btn)' : '1px solid var(--border)',
                    backgroundColor: active ? 'var(--bg-hover)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {hint.label}
                </button>
              );
            })}
          </div>

          {/* Bottom toolbar */}
          <div style={{ padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, justifyContent: 'flex-end' }}>
            {/* Settings row */}
            <div className="flex items-center justify-between">
              <ChannelModelSelector
                selectedProviderId={selectedProviderId}
                selectedModelId={selectedModelId}
                availableProviders={availableProviders}
                availableModels={availableModels.map((m) => ({ id: m.id, label: m.label || m.id, providerId: m.providerId }))}
                onProviderChange={handleProviderChange}
                onModelChange={handleModelChange}
              />
              {/* ── 云智通道价格标签 ── */}
              {selectedProviderId === "yunzhi" && (() => {
                const modelShort = selectedModelId.includes("/") ? selectedModelId.split("/")[1] : selectedModelId;
                const pricePerImage = IMAGE_CREDIT_PRICES[modelShort] || 30;
                const priceYuan = (pricePerImage / 100).toFixed(1);
                return <span className="nodrag" style={{ fontSize: '11px', color: '#7ab4f0', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap' }}>{priceYuan}元/张</span>;
              })()}
              <div className="flex items-center gap-2">
                {/* Remove BG toggle */}
                <button
                  className="nodrag"
                  onClick={() => {
                    const next = !removeBg;
                    setRemoveBg(next);
                    updateNodeData(id, { removeBg: next });
                    if (next) setShowRemoveBgPanel(true);
                  }}
                  style={{
                    padding: '3px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 500,
                    border: removeBg ? '1px solid #4ade80' : '1px solid var(--border)',
                    backgroundColor: removeBg ? 'rgba(74,222,128,0.15)' : 'transparent',
                    color: removeBg ? '#4ade80' : 'var(--text-muted)',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  ✂️ 抠图
                </button>
                {/* Params */}
                <div className="nodrag" style={{ color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }} onClick={() => setShowParamsPanel(!showParamsPanel)}>
                  {selectedAspectRatio} · {selectedSize}
                </div>
                {/* Generate button */}
                <button
                  className="nodrag"
                  onClick={handleGenerate}
                  disabled={!inputText.trim()}
                  style={{
                    padding: '4px 14px', borderRadius: '8px',
                    backgroundColor: inputText.trim() ? 'var(--accent-btn)' : 'var(--bg-hover)',
                    color: inputText.trim() ? '#fff' : 'var(--text-muted)',
                    border: 'none', cursor: inputText.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '12px', fontWeight: 500, transition: 'all 0.2s',
                  }}
                >
                  {isGenerating ? (nodeData.progressPercent > 0 ? `${nodeData.progressPercent}%` : "生成中...") : "生成素材"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Params panel */}
        {showParamsPanel && (
          <div
            className="nodrag"
            style={{ ...panelStyle, bottom: 52, right: 14, width: '240px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '4px' }}>分辨率</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {SIZE_OPTIONS.map((s) => (
                  <button key={s.value} onClick={() => { setSelectedSize(s.value); updateNodeData(id, { size: s.value }); }} style={{ flex: 1, padding: '4px 6px', borderRadius: '6px', border: selectedSize === s.value ? '1.5px solid var(--accent)' : '1px solid var(--border)', backgroundColor: selectedSize === s.value ? 'var(--bg-hover)' : 'transparent', color: selectedSize === s.value ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>{s.label}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-primary)', fontWeight: 500, marginBottom: '4px' }}>比例</div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {ASPECT_RATIOS.map((r) => (
                  <button key={r.value} onClick={() => { setSelectedAspectRatio(r.value); updateNodeData(id, { aspectRatio: r.value }); }} style={{ padding: '4px 8px', borderRadius: '6px', border: selectedAspectRatio === r.value ? '1.5px solid var(--accent)' : '1px solid var(--border)', backgroundColor: selectedAspectRatio === r.value ? 'var(--bg-hover)' : 'transparent', color: selectedAspectRatio === r.value ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}>{r.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Remove BG params panel */}
        {showRemoveBgPanel && removeBg && (
          <div
            className="nodrag"
            style={{ ...panelStyle, bottom: 52, left: 14, width: '200px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-primary)', fontWeight: 500 }}>抠图设置</span>
              <button onClick={() => setShowRemoveBgPanel(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>✕</button>
            </div>
            <SliderControl label="去毛边" value={removeBgFeather} min={0} max={20} step={1} unit="px"
              onChange={(v) => { setRemoveBgFeather(v); updateNodeData(id, { removeBgFeather: v }); }} />
            <SliderControl label="去绿" value={removeBgGreenScreen} min={0} max={100} step={5} unit="%"
              onChange={(v) => { setRemoveBgGreenScreen(v); updateNodeData(id, { removeBgGreenScreen: v }); }} />
            <SliderControl label="边缘收缩" value={removeBgEdgeShrink} min={0} max={20} step={1} unit="px"
              onChange={(v) => { setRemoveBgEdgeShrink(v); updateNodeData(id, { removeBgEdgeShrink: v }); }} />
          </div>
        )}

        {/* History panel */}
        {showHistory && (
          <div
            className="nodrag"
            style={{ ...panelStyle, top: 40, right: 14, width: '260px', maxHeight: '320px', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-primary)', fontWeight: 500 }}>历史记录</span>
              <button onClick={() => setShowHistory(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px' }}>✕</button>
            </div>
            {history.length === 0 ? (
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>暂无历史记录</div>
            ) : (
              history.map((entry) => (
                <div key={entry.id} style={{
                  display: 'flex', gap: '6px', padding: '6px', borderRadius: '6px',
                  border: '1px solid var(--border)', marginBottom: '4px',
                  backgroundColor: 'var(--bg-node)',
                }}>
                  {entry.generatedImageUrl && (
                    <img src={entry.generatedImageUrl} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '10px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {entry.prompt}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {new Date(entry.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                    <button onClick={() => handleRestoreFromHistory(entry)} style={{ fontSize: '9px', padding: '2px 4px', borderRadius: '3px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>
                      恢复
                    </button>
                    <button onClick={() => handleDeleteHistory(entry.id)} style={{ fontSize: '9px', padding: '2px 4px', borderRadius: '3px', border: '1px solid var(--border)', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}>
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <NodeResizeHandle width={nodeWidth} height={nodeHeight} onResize={handleResize} minWidth={MIN_NODE_WIDTH} maxWidth={MAX_NODE_WIDTH} minHeight={MIN_NODE_HEIGHT} maxHeight={MAX_NODE_HEIGHT} />
      </div>
      <Handle type="target" position={Position.Left} className="!bg-[var(--accent-secondary)] !w-5 !h-5 !border-2 !border-[var(--bg-node)]" id="target" />
      <Handle type="source" position={Position.Right} className="!bg-[var(--accent-secondary)] !w-5 !h-5 !border-2 !border-[var(--bg-node)]" id="source" />
    </>
  );
});



