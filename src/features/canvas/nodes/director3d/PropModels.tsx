import { useMemo, type ReactElement } from "react";
import * as THREE from "three";

// ─── Prop Category & Preset Definitions ───

export interface PropPreset {
  key: string;
  label: string;
  category: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultDepth: number;
  defaultColor: string;
  icon: string;
}

export const PROP_CATEGORIES = [
  { key: "furniture", label: "家具" },
  { key: "vehicle", label: "交通" },
  { key: "environment", label: "环境" },
  { key: "film", label: "影视" },
  { key: "basic", label: "基础" },
] as const;

export const PROP_PRESETS: PropPreset[] = [
  // 家具
  { key: "chair", label: "椅子", category: "furniture", defaultWidth: 0.45, defaultHeight: 0.88, defaultDepth: 0.45, defaultColor: "#92400e", icon: "🪑" },
  { key: "table", label: "桌子", category: "furniture", defaultWidth: 1.2, defaultHeight: 0.76, defaultDepth: 0.6, defaultColor: "#92400e", icon: "🪵" },
  { key: "sofa", label: "沙发", category: "furniture", defaultWidth: 1.6, defaultHeight: 0.8, defaultDepth: 0.6, defaultColor: "#374151", icon: "🛋️" },
  { key: "bed", label: "床", category: "furniture", defaultWidth: 2.0, defaultHeight: 0.5, defaultDepth: 1.4, defaultColor: "#6b7280", icon: "🛏️" },
  { key: "stool", label: "凳子", category: "furniture", defaultWidth: 0.4, defaultHeight: 0.54, defaultDepth: 0.4, defaultColor: "#92400e", icon: "🪑" },
  { key: "bookshelf", label: "书架", category: "furniture", defaultWidth: 0.8, defaultHeight: 1.8, defaultDepth: 0.28, defaultColor: "#7c2d12", icon: "📚" },
  // 交通
  { key: "car", label: "轿车", category: "vehicle", defaultWidth: 4.2, defaultHeight: 1.1, defaultDepth: 1.7, defaultColor: "#374151", icon: "🚗" },
  { key: "suv", label: "SUV", category: "vehicle", defaultWidth: 4.5, defaultHeight: 1.3, defaultDepth: 1.9, defaultColor: "#1e3a5f", icon: "🚙" },
  { key: "motorcycle", label: "摩托车", category: "vehicle", defaultWidth: 1.6, defaultHeight: 0.8, defaultDepth: 0.4, defaultColor: "#374151", icon: "🏍️" },
  // 环境
  { key: "tree", label: "树", category: "environment", defaultWidth: 1.2, defaultHeight: 2.6, defaultDepth: 1.2, defaultColor: "#065f46", icon: "🌳" },
  { key: "streetlight", label: "路灯", category: "environment", defaultWidth: 0.5, defaultHeight: 3.5, defaultDepth: 0.5, defaultColor: "#6b7280", icon: "🔦" },
  { key: "wall", label: "墙壁", category: "environment", defaultWidth: 3.0, defaultHeight: 1.5, defaultDepth: 0.15, defaultColor: "#d4d4d8", icon: "🧱" },
  { key: "fence", label: "栅栏", category: "environment", defaultWidth: 1.8, defaultHeight: 1.0, defaultDepth: 0.03, defaultColor: "#7c2d12", icon: "🏗️" },
  { key: "building", label: "建筑", category: "environment", defaultWidth: 4.0, defaultHeight: 8.0, defaultDepth: 4.0, defaultColor: "#6b7280", icon: "🏢" },
  // 影视
  { key: "camera_tripod", label: "摄影脚架", category: "film", defaultWidth: 0.5, defaultHeight: 1.5, defaultDepth: 0.5, defaultColor: "#374151", icon: "📷" },
  { key: "light_stand", label: "灯架", category: "film", defaultWidth: 0.5, defaultHeight: 2.0, defaultDepth: 0.5, defaultColor: "#374151", icon: "💡" },
  { key: "boom_mic", label: "挑杆话筒", category: "film", defaultWidth: 0.06, defaultHeight: 2.5, defaultDepth: 0.06, defaultColor: "#6b7280", icon: "🎙️" },
  { key: "monitor", label: "监视器", category: "film", defaultWidth: 0.5, defaultHeight: 0.65, defaultDepth: 0.15, defaultColor: "#374151", icon: "📺" },
  // 基础
  { key: "box", label: "方块", category: "basic", defaultWidth: 1.0, defaultHeight: 1.0, defaultDepth: 1.0, defaultColor: "#6b7280", icon: "📦" },
  { key: "cylinder", label: "圆柱", category: "basic", defaultWidth: 0.5, defaultHeight: 1.0, defaultDepth: 0.5, defaultColor: "#6b7280", icon: "🪈" },
  { key: "sphere", label: "球体", category: "basic", defaultWidth: 0.5, defaultHeight: 0.5, defaultDepth: 0.5, defaultColor: "#6b7280", icon: "🔵" },
  { key: "plane", label: "平面", category: "basic", defaultWidth: 2.0, defaultHeight: 0.02, defaultDepth: 2.0, defaultColor: "#d4d4d8", icon: "⬜" },
];

/** Get a preset by key */
export function getPropPreset(key: string): PropPreset | undefined {
  return PROP_PRESETS.find((p) => p.key === key);
}

// ─── Reusable sub-mesh helpers ───

/** A standard box mesh with meshStandardMaterial */
function Box({
  width, height, depth, color, position, rotation, roughness = 0.6,
}: {
  width: number; height: number; depth: number; color: string;
  position?: [number, number, number]; rotation?: [number, number, number]; roughness?: number;
}) {
  return (
    <mesh position={position} rotation={rotation}>
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

/** A standard cylinder mesh */
function Cyl({
  radius, height, color, position, rotation, segments = 16, roughness = 0.6,
}: {
  radius: number; height: number; color: string;
  position?: [number, number, number]; rotation?: [number, number, number];
  segments?: number; roughness?: number;
}) {
  return (
    <mesh position={position} rotation={rotation}>
      <cylinderGeometry args={[radius, radius, height, segments]} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

/** A standard sphere mesh */
function Sph({
  radius, color, position, segments = 16, roughness = 0.6,
}: {
  radius: number; color: string;
  position?: [number, number, number]; segments?: number; roughness?: number;
}) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[radius, segments, segments]} />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

// ─── Individual Prop Renderers ───

function ChairModel({ color }: { color: string }) {
  // 座面 0.45×0.04×0.45, 4腿 r=0.02 h=0.44, 靠背 0.45×0.4×0.04
  const legH = 0.44;
  const seatH = 0.04;
  const seatW = 0.45;
  const seatD = 0.45;
  const backH = 0.4;
  const seatY = legH + seatH / 2;
  return (
    <group>
      {/* Seat */}
      <Box width={seatW} height={seatH} depth={seatD} color={color} position={[0, seatY, 0]} />
      {/* 4 legs */}
      <Cyl radius={0.02} height={legH} color={color} position={[-seatW / 2 + 0.03, legH / 2, -seatD / 2 + 0.03]} />
      <Cyl radius={0.02} height={legH} color={color} position={[seatW / 2 - 0.03, legH / 2, -seatD / 2 + 0.03]} />
      <Cyl radius={0.02} height={legH} color={color} position={[-seatW / 2 + 0.03, legH / 2, seatD / 2 - 0.03]} />
      <Cyl radius={0.02} height={legH} color={color} position={[seatW / 2 - 0.03, legH / 2, seatD / 2 - 0.03]} />
      {/* Backrest */}
      <Box width={seatW} height={backH} depth={0.04} color={color} position={[0, seatY + seatH / 2 + backH / 2, -seatD / 2 + 0.02]} />
    </group>
  );
}

function TableModel({ color }: { color: string }) {
  // 桌面 1.2×0.04×0.6, 4腿 r=0.025 h=0.72
  const topW = 1.2;
  const topD = 0.6;
  const topH = 0.04;
  const legH = 0.72;
  const topY = legH + topH / 2;
  return (
    <group>
      <Box width={topW} height={topH} depth={topD} color={color} position={[0, topY, 0]} />
      <Cyl radius={0.025} height={legH} color={color} position={[-topW / 2 + 0.04, legH / 2, -topD / 2 + 0.04]} />
      <Cyl radius={0.025} height={legH} color={color} position={[topW / 2 - 0.04, legH / 2, -topD / 2 + 0.04]} />
      <Cyl radius={0.025} height={legH} color={color} position={[-topW / 2 + 0.04, legH / 2, topD / 2 - 0.04]} />
      <Cyl radius={0.025} height={legH} color={color} position={[topW / 2 - 0.04, legH / 2, topD / 2 - 0.04]} />
    </group>
  );
}

function SofaModel({ color }: { color: string }) {
  // 座垫 1.6×0.15×0.6, 靠背 1.6×0.35×0.12, 2扶手 0.12×0.25×0.6
  const cushionH = 0.15;
  const cushionW = 1.6;
  const cushionD = 0.6;
  const baseY = 0.3;
  const cushionY = baseY + cushionH / 2;
  return (
    <group>
      {/* Base frame */}
      <Box width={cushionW} height={baseY} depth={cushionD} color={color} position={[0, baseY / 2, 0]} roughness={0.7} />
      {/* Seat cushion */}
      <Box width={cushionW} height={cushionH} depth={cushionD} color={color} position={[0, cushionY, 0]} roughness={0.7} />
      {/* Backrest */}
      <Box width={cushionW} height={0.35} depth={0.12} color={color} position={[0, cushionY + cushionH / 2 + 0.35 / 2, -cushionD / 2 + 0.06]} roughness={0.7} />
      {/* Left arm */}
      <Box width={0.12} height={0.25} depth={cushionD} color={color} position={[-cushionW / 2 + 0.06, cushionY + 0.25 / 2, 0]} roughness={0.7} />
      {/* Right arm */}
      <Box width={0.12} height={0.25} depth={cushionD} color={color} position={[cushionW / 2 - 0.06, cushionY + 0.25 / 2, 0]} roughness={0.7} />
    </group>
  );
}

function BedModel({ color }: { color: string }) {
  // 床垫 2.0×0.15×1.4, 床头板 0.06×0.6×1.4
  const mattressW = 2.0;
  const mattressH = 0.15;
  const mattressD = 1.4;
  const frameH = 0.3;
  return (
    <group>
      {/* Frame */}
      <Box width={mattressW} height={frameH} depth={mattressD} color={color} position={[0, frameH / 2, 0]} roughness={0.7} />
      {/* Mattress */}
      <Box width={mattressW} height={mattressH} depth={mattressD} color="#d4d4d8" position={[0, frameH + mattressH / 2, 0]} roughness={0.8} />
      {/* Headboard */}
      <Box width={0.06} height={0.6} depth={mattressD} color={color} position={[-mattressW / 2 - 0.03, frameH + 0.3, 0]} roughness={0.6} />
    </group>
  );
}

function StoolModel({ color }: { color: string }) {
  // 圆座 r=0.2 h=0.04, 3腿 r=0.015 h=0.5
  const legH = 0.5;
  const seatY = legH + 0.02;
  return (
    <group>
      {/* Round seat */}
      <Cyl radius={0.2} height={0.04} color={color} position={[0, seatY, 0]} segments={24} />
      {/* 3 legs at 120° intervals */}
      {[0, 120, 240].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const lx = Math.cos(rad) * 0.14;
        const lz = Math.sin(rad) * 0.14;
        return <Cyl key={deg} radius={0.015} height={legH} color={color} position={[lx, legH / 2, lz]} />;
      })}
    </group>
  );
}

function BookshelfModel({ color }: { color: string }) {
  // 框架: 左右侧板 0.04×1.8×0.28, 背板 0.8×1.8×0.04
  // 3层隔板 0.72×0.02×0.28
  const w = 0.8;
  const h = 1.8;
  const d = 0.28;
  return (
    <group>
      {/* Left side panel */}
      <Box width={0.04} height={h} depth={d} color={color} position={[-w / 2 + 0.02, h / 2, 0]} />
      {/* Right side panel */}
      <Box width={0.04} height={h} depth={d} color={color} position={[w / 2 - 0.02, h / 2, 0]} />
      {/* Back panel */}
      <Box width={w} height={h} depth={0.04} color={color} position={[0, h / 2, -d / 2 + 0.02]} />
      {/* Shelves (3) */}
      {[0.4, 0.9, 1.4].map((shelfY) => (
        <Box key={shelfY} width={w - 0.08} height={0.02} depth={d} color={color} position={[0, shelfY, 0]} />
      ))}
      {/* Top panel */}
      <Box width={w} height={0.03} depth={d} color={color} position={[0, h - 0.015, 0]} />
    </group>
  );
}

function CarModel({ color }: { color: string }) {
  // 车身 4.2×0.6×1.7, 车顶 2.0×0.5×1.5, 4轮 r=0.3 h=0.15
  const bodyW = 4.2;
  const bodyH = 0.6;
  const bodyD = 1.7;
  const bodyY = 0.3 + bodyH / 2;
  return (
    <group>
      {/* Body */}
      <Box width={bodyW} height={bodyH} depth={bodyD} color={color} position={[0, bodyY, 0]} roughness={0.4} />
      {/* Roof */}
      <Box width={2.0} height={0.5} depth={1.5} color={color} position={[0.2, bodyY + bodyH / 2 + 0.25, 0]} roughness={0.4} />
      {/* Wheels */}
      <Cyl radius={0.3} height={0.15} color="#1a1a1a" position={[-1.3, 0.3, bodyD / 2]} rotation={[Math.PI / 2, 0, 0]} />
      <Cyl radius={0.3} height={0.15} color="#1a1a1a" position={[-1.3, 0.3, -bodyD / 2]} rotation={[Math.PI / 2, 0, 0]} />
      <Cyl radius={0.3} height={0.15} color="#1a1a1a" position={[1.3, 0.3, bodyD / 2]} rotation={[Math.PI / 2, 0, 0]} />
      <Cyl radius={0.3} height={0.15} color="#1a1a1a" position={[1.3, 0.3, -bodyD / 2]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}

function SuvModel({ color }: { color: string }) {
  const bodyW = 4.5;
  const bodyH = 0.7;
  const bodyD = 1.9;
  const bodyY = 0.35 + bodyH / 2;
  return (
    <group>
      <Box width={bodyW} height={bodyH} depth={bodyD} color={color} position={[0, bodyY, 0]} roughness={0.4} />
      <Box width={2.5} height={0.6} depth={1.7} color={color} position={[0.1, bodyY + bodyH / 2 + 0.3, 0]} roughness={0.4} />
      <Cyl radius={0.35} height={0.18} color="#1a1a1a" position={[-1.4, 0.35, bodyD / 2]} rotation={[Math.PI / 2, 0, 0]} />
      <Cyl radius={0.35} height={0.18} color="#1a1a1a" position={[-1.4, 0.35, -bodyD / 2]} rotation={[Math.PI / 2, 0, 0]} />
      <Cyl radius={0.35} height={0.18} color="#1a1a1a" position={[1.4, 0.35, bodyD / 2]} rotation={[Math.PI / 2, 0, 0]} />
      <Cyl radius={0.35} height={0.18} color="#1a1a1a" position={[1.4, 0.35, -bodyD / 2]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}

function MotorcycleModel({ color }: { color: string }) {
  // 车身 1.6×0.3×0.4, 2轮 r=0.25 h=0.08, 车把 r=0.015 h=0.6
  return (
    <group>
      <Box width={1.6} height={0.3} depth={0.4} color={color} position={[0, 0.35, 0]} roughness={0.5} />
      {/* Front wheel */}
      <Cyl radius={0.25} height={0.08} color="#1a1a1a" position={[0.7, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]} />
      {/* Rear wheel */}
      <Cyl radius={0.25} height={0.08} color="#1a1a1a" position={[-0.7, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]} />
      {/* Handlebar */}
      <Cyl radius={0.015} height={0.6} color="#6b7280" position={[0.5, 0.65, 0]} rotation={[0, 0, Math.PI / 2]} />
      {/* Seat */}
      <Box width={0.6} height={0.06} depth={0.25} color="#374151" position={[-0.2, 0.53, 0]} roughness={0.7} />
    </group>
  );
}

function TreeModel({ color }: { color: string }) {
  // 树干 r=0.08 h=2.0, 树冠 r=0.6
  return (
    <group>
      <Cyl radius={0.08} height={2.0} color="#7c2d12" position={[0, 1.0, 0]} roughness={0.7} />
      <Sph radius={0.6} color={color} position={[0, 2.3, 0]} segments={12} roughness={0.8} />
    </group>
  );
}

function StreetlightModel({ color }: { color: string }) {
  // 柱子 r=0.03 h=3.5, 灯臂 r=0.02 h=0.5, 灯头 r=0.08
  return (
    <group>
      <Cyl radius={0.03} height={3.5} color={color} position={[0, 1.75, 0]} />
      {/* Arm */}
      <Cyl radius={0.02} height={0.5} color={color} position={[0.25, 3.4, 0]} rotation={[0, 0, -Math.PI / 4]} />
      {/* Light head */}
      <Sph radius={0.08} color="#fbbf24" position={[0.45, 3.5, 0]} roughness={0.3} />
    </group>
  );
}

function WallModel({ color }: { color: string }) {
  // Box 3.0×1.5×0.15
  return <Box width={3.0} height={1.5} depth={0.15} color={color} position={[0, 0.75, 0]} roughness={0.7} />;
}

function FenceModel({ color }: { color: string }) {
  // 多根竖条 0.03×1.0×0.03 间隔0.2, 2横条 1.8×0.05×0.03
  const postCount = 10;
  const spacing = 0.2;
  const totalW = (postCount - 1) * spacing;
  const posts: ReactElement[] = [];
  for (let i = 0; i < postCount; i++) {
    const x = -totalW / 2 + i * spacing;
    posts.push(<Box key={`post-${i}`} width={0.03} height={1.0} depth={0.03} color={color} position={[x, 0.5, 0]} />);
  }
  return (
    <group>
      {posts}
      {/* Horizontal rails */}
      <Box width={1.8} height={0.05} depth={0.03} color={color} position={[0, 0.3, 0]} />
      <Box width={1.8} height={0.05} depth={0.03} color={color} position={[0, 0.7, 0]} />
    </group>
  );
}

function BuildingModel({ color }: { color: string }) {
  // Box 4.0×8.0×4.0 + 窗户用小凹Box
  const w = 4.0;
  const h = 8.0;
  const d = 4.0;
  const windowColor = "#87ceeb";
  return (
    <group>
      <Box width={w} height={h} depth={d} color={color} position={[0, h / 2, 0]} roughness={0.8} />
      {/* Windows on front face (Z+) */}
      {[1.5, 3.0, 4.5, 6.0].map((wy) =>
        [-1.0, 0.0, 1.0].map((wx) => (
          <Box
            key={`wf-${wy}-${wx}`}
            width={0.6} height={0.8} depth={0.02}
            color={windowColor}
            position={[wx, wy, d / 2 + 0.01]}
            roughness={0.3}
          />
        ))
      )}
      {/* Windows on side face (X+) */}
      {[1.5, 3.0, 4.5, 6.0].map((wy) =>
        [-1.0, 0.0, 1.0].map((wz) => (
          <Box
            key={`ws-${wy}-${wz}`}
            width={0.02} height={0.8} depth={0.6}
            color={windowColor}
            position={[w / 2 + 0.01, wy, wz]}
            roughness={0.3}
          />
        ))
      )}
    </group>
  );
}

function CameraTripodModel({ color }: { color: string }) {
  // 3腿 + 中柱 + 机身 + 镜头
  const legH = 1.3;
  const centerH = 1.4;
  return (
    <group>
      {/* Center column */}
      <Cyl radius={0.015} height={centerH} color={color} position={[0, centerH / 2, 0]} />
      {/* 3 legs */}
      {[0, 120, 240].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const spread = 0.3;
        const lx = Math.cos(rad) * spread;
        const lz = Math.sin(rad) * spread;
        return (
          <Cyl
            key={deg}
            radius={0.012}
            height={legH}
            color={color}
            position={[lx / 2, legH / 2 - 0.05, lz / 2]}
            rotation={[Math.cos(rad) * 0.3, 0, -Math.sin(rad) * 0.3]}
          />
        );
      })}
      {/* Camera body */}
      <Box width={0.15} height={0.1} depth={0.1} color="#1a1a2e" position={[0, centerH + 0.05, 0]} roughness={0.4} />
      {/* Lens */}
      <Cyl radius={0.04} height={0.12} color="#374151" position={[0, centerH + 0.05, 0.11]} rotation={[Math.PI / 2, 0, 0]} roughness={0.3} />
    </group>
  );
}

function LightStandModel({ color }: { color: string }) {
  const poleH = 1.8;
  return (
    <group>
      {/* 3 legs */}
      {[0, 120, 240].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const spread = 0.25;
        const lx = Math.cos(rad) * spread;
        const lz = Math.sin(rad) * spread;
        return (
          <Cyl
            key={deg}
            radius={0.012}
            height={0.5}
            color={color}
            position={[lx / 2, 0.25, lz / 2]}
            rotation={[Math.cos(rad) * 0.3, 0, -Math.sin(rad) * 0.3]}
          />
        );
      })}
      {/* Pole */}
      <Cyl radius={0.02} height={poleH} color={color} position={[0, poleH / 2, 0]} />
      {/* Light head */}
      <Box width={0.2} height={0.15} depth={0.2} color="#fbbf24" position={[0, poleH + 0.075, 0]} roughness={0.3} />
    </group>
  );
}

function BoomMicModel({ color }: { color: string }) {
  // 长杆 r=0.01 h=2.5, 话筒 r=0.03 h=0.08
  return (
    <group>
      <Cyl radius={0.01} height={2.5} color={color} position={[0, 1.25, 0]} rotation={[0, 0, -0.15]} />
      {/* Mic head at end */}
      <Cyl radius={0.03} height={0.08} color="#6b7280" position={[-0.18, 2.45, 0]} roughness={0.4} />
    </group>
  );
}

function MonitorModel({ color }: { color: string }) {
  // 屏幕 0.5×0.35×0.03, 支架 r=0.015 h=0.3, 底座 r=0.1 h=0.01
  const screenH = 0.35;
  const standH = 0.3;
  const baseH = 0.01;
  const screenY = baseH + standH + screenH / 2;
  return (
    <group>
      {/* Screen */}
      <Box width={0.5} height={screenH} depth={0.03} color={color} position={[0, screenY, 0]} roughness={0.3} />
      {/* Screen face (dark) */}
      <Box width={0.46} height={0.31} depth={0.005} color="#1a1a2e" position={[0, screenY, 0.018]} roughness={0.2} />
      {/* Stand */}
      <Cyl radius={0.015} height={standH} color={color} position={[0, baseH + standH / 2, 0]} />
      {/* Base */}
      <Cyl radius={0.1} height={baseH} color={color} position={[0, baseH / 2, 0]} segments={24} />
    </group>
  );
}

function BoxBasicModel({ color, width, height, depth }: { color: string; width: number; height: number; depth: number }) {
  return <Box width={width} height={height} depth={depth} color={color} position={[0, height / 2, 0]} />;
}

function CylinderBasicModel({ color, width, height }: { color: string; width: number; height: number }) {
  const radius = Math.max(0.01, width);
  return <Cyl radius={radius} height={height} color={color} position={[0, height / 2, 0]} segments={24} />;
}

function SphereBasicModel({ color, width }: { color: string; width: number }) {
  const radius = Math.max(0.01, width);
  return <Sph radius={radius} color={color} position={[0, radius, 0]} segments={20} />;
}

function PlaneBasicModel({ color, width, depth }: { color: string; width: number; depth: number }) {
  return (
    <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial color={color} roughness={0.7} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─── Main PropModel Component ───

export interface PropModelProps {
  type: string;
  color: string;
  customWidth?: number;
  customHeight?: number;
  customDepth?: number;
}

/**
 * PropModel renders a 3D prop model based on type using primitive geometries.
 * Consistent with Mannequin style: meshStandardMaterial, roughness 0.5-0.7.
 */
export function PropModel({ type, color, customWidth, customHeight, customDepth }: PropModelProps) {
  const preset = useMemo(() => getPropPreset(type), [type]);
  const w = customWidth ?? preset?.defaultWidth ?? 1.0;
  const h = customHeight ?? preset?.defaultHeight ?? 1.0;
  const d = customDepth ?? preset?.defaultDepth ?? 1.0;

  switch (type) {
    case "chair":
      return <ChairModel color={color} />;
    case "table":
      return <TableModel color={color} />;
    case "sofa":
      return <SofaModel color={color} />;
    case "bed":
      return <BedModel color={color} />;
    case "stool":
      return <StoolModel color={color} />;
    case "bookshelf":
      return <BookshelfModel color={color} />;
    case "car":
      return <CarModel color={color} />;
    case "suv":
      return <SuvModel color={color} />;
    case "motorcycle":
      return <MotorcycleModel color={color} />;
    case "tree":
      return <TreeModel color={color} />;
    case "streetlight":
      return <StreetlightModel color={color} />;
    case "wall":
      return <WallModel color={color} />;
    case "fence":
      return <FenceModel color={color} />;
    case "building":
      return <BuildingModel color={color} />;
    case "camera_tripod":
      return <CameraTripodModel color={color} />;
    case "light_stand":
      return <LightStandModel color={color} />;
    case "boom_mic":
      return <BoomMicModel color={color} />;
    case "monitor":
      return <MonitorModel color={color} />;
    case "box":
      return <BoxBasicModel color={color} width={w} height={h} depth={d} />;
    case "cylinder":
      return <CylinderBasicModel color={color} width={w} height={h} />;
    case "sphere":
      return <SphereBasicModel color={color} width={w} />;
    case "plane":
      return <PlaneBasicModel color={color} width={w} depth={d} />;
    default:
      // Fallback: simple box
      return <BoxBasicModel color={color} width={w} height={h} depth={d} />;
  }
}



