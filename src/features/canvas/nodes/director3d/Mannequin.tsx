import { useRef, forwardRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Director3DCharacter } from "../../domain/canvasNodes";

interface MannequinProps {
  character: Director3DCharacter;
  isSelected: boolean;
  onSelect: (id: number) => void;
}

// Pose definition: each joint has [x, y, z] Euler rotation in radians
interface PoseDef {
  bodyTilt: number;   // torso lean forward/back
  torsoY: number;     // torso vertical offset (for sitting)
  hipY: number;       // hip vertical offset
  headX: number;      // head nod
  headZ: number;      // head tilt
  shoulderLZ: number;  // left shoulder raise (Z rotation)
  elbowLX: number;    // left elbow bend
  shoulderRZ: number;  // right shoulder raise
  elbowRX: number;    // right elbow bend
  hipLX: number;      // left hip flex
  kneeLX: number;     // left knee bend
  hipRX: number;      // right hip flex
  kneeRX: number;     // right knee bend
}

const POSE_DEFS: Record<string, PoseDef> = {
  "站立": {
    bodyTilt: 0, torsoY: 0, hipY: 0,
    headX: 0, headZ: 0,
    shoulderLZ: 0, elbowLX: 0,
    shoulderRZ: 0, elbowRX: 0,
    hipLX: 0, kneeLX: 0,
    hipRX: 0, kneeRX: 0,
  },
  "行走": {
    bodyTilt: 0.05, torsoY: 0, hipY: 0,
    headX: 0, headZ: 0,
    shoulderLZ: 0.12, elbowLX: -0.25,
    shoulderRZ: -0.12, elbowRX: -0.25,
    hipLX: -0.35, kneeLX: 0.15,
    hipRX: 0.35, kneeRX: 0.15,
  },
  "奔跑": {
    bodyTilt: 0.30, torsoY: 0, hipY: 0,
    headX: 0, headZ: 0,
    // 手臂大幅度交替摆动，肘部明显弯曲（约80°）
    shoulderLZ: -0.70, elbowLX: -1.40,
    shoulderRZ: -0.70, elbowRX: -1.40,
    // 左腿大步跨出在前，右腿向后蹬地
    hipLX: 0.65, kneeLX: 0.90,
    hipRX: -0.55, kneeRX: 0.35,
  },
  "坐姿": {
    bodyTilt: 0.08, torsoY: 0, hipY: -0.40,
    headX: 0, headZ: 0,
    // 上臂自然下垂，前臂放在大腿上（肘部约 80° 弯曲）
    shoulderLZ: 0.10, elbowLX: -1.40,
    shoulderRZ: -0.10, elbowRX: -1.40,
    // 大腿水平，膝盖约 90°，小腿垂直向下
    hipLX: -1.55, kneeLX: 1.55,
    hipRX: -1.55, kneeRX: 1.55,
  },
  "躺姿": {
    bodyTilt: -Math.PI / 2, torsoY: 0, hipY: 0,
    headX: 0, headZ: 0,
    // Arms resting at sides
    shoulderLZ: 0.15, elbowLX: -0.1,
    shoulderRZ: -0.15, elbowRX: -0.1,
    // Legs slightly apart, relaxed
    hipLX: 0.1, kneeLX: 0.05,
    hipRX: -0.1, kneeRX: 0.05,
  },
  "挥手": {
    bodyTilt: 0, torsoY: 0, hipY: 0,
    headX: 0, headZ: 0.1,
    // Left arm: natural down
    shoulderLZ: 0.1, elbowLX: -0.2,
    // Right arm: raised and bent, hand forward (waving)
    shoulderRZ: -1.4, elbowRX: -1.8,
    hipLX: 0, kneeLX: 0,
    hipRX: 0, kneeRX: 0,
  },
  "蹲下": {
    bodyTilt: 0.25, torsoY: 0, hipY: -0.35,
    headX: 0, headZ: 0,
    shoulderLZ: 0.2, elbowLX: -0.3,
    shoulderRZ: -0.2, elbowRX: -0.3,
    hipLX: -1.4, kneeLX: 2.0,
    hipRX: -1.4, kneeRX: 2.0,
  },
  "单膝跪": {
    bodyTilt: 0.05, torsoY: 0, hipY: -0.30,
    headX: 0, headZ: 0,
    shoulderLZ: 0.10, elbowLX: -0.3,
    shoulderRZ: -0.15, elbowRX: -0.4,
    // 左腿弓步撑地：大腿前伸约 50°，膝盖弯曲让小腿垂直落地
    hipLX: -0.85, kneeLX: 1.35,
    // 右膝跪地：大腿垂直向下，小腿向后折叠
    hipRX: 0, kneeRX: 1.55,
  },
  "双膝跪": {
    bodyTilt: 0, torsoY: 0, hipY: -0.38,
    headX: 0, headZ: 0,
    shoulderLZ: 0.05, elbowLX: -0.3,
    shoulderRZ: -0.05, elbowRX: -0.3,
    // 大腿垂直向下，小腿向后折叠 90° 贴地
    hipLX: 0, kneeLX: 1.55,
    hipRX: 0, kneeRX: 1.55,
  },
  "倚靠": {
    bodyTilt: -0.08, torsoY: 0, hipY: 0,
    headX: 0, headZ: 0,
    shoulderLZ: 0, elbowLX: -0.2,
    shoulderRZ: -0.3, elbowRX: -0.3,
    hipLX: 0, kneeLX: 0,
    hipRX: 0.15, kneeRX: 0.3,
  },
  "鞠躬": {
    bodyTilt: 0.55, torsoY: 0, hipY: 0,
    headX: 0.15, headZ: 0,
    shoulderLZ: 0.1, elbowLX: -0.3,
    shoulderRZ: -0.1, elbowRX: -0.3,
    hipLX: 0, kneeLX: 0,
    hipRX: 0, kneeRX: 0,
  },
  "思考": {
    bodyTilt: 0.05, torsoY: 0, hipY: 0,
    headX: 0.15, headZ: 0.1,
    // Left arm: hand on hip
    shoulderLZ: -0.3, elbowLX: -1.2,
    // Right arm: hand touching face (chin/thinking pose)
    shoulderRZ: -1.3, elbowRX: -2.0,
    hipLX: 0, kneeLX: 0,
    hipRX: 0, kneeRX: 0,
  },
  "踢球": {
    bodyTilt: 0.15, torsoY: 0, hipY: 0,
    headX: 0.1, headZ: 0,
    // Arms spread for balance
    shoulderLZ: 0.8, elbowLX: -0.4,
    shoulderRZ: -0.8, elbowRX: -0.4,
    // Left leg: supporting, slightly bent
    hipLX: -0.2, kneeLX: 0.3,
    // Right leg: kicking forward
    hipRX: -0.3, kneeRX: -0.1,
  },
  "投掷": {
    bodyTilt: 0.3, torsoY: 0, hipY: 0,
    headX: 0, headZ: 0,
    shoulderLZ: 0.5, elbowLX: -0.6,
    shoulderRZ: -2.0, elbowRX: -0.3,
    hipLX: 0, kneeLX: 0,
    hipRX: 0, kneeRX: 0,
  },
  "推进": {
    bodyTilt: 0.35, torsoY: 0, hipY: 0,
    headX: 0, headZ: 0,
    shoulderLZ: -1.0, elbowLX: -0.6,
    shoulderRZ: -1.0, elbowRX: -0.6,
    hipLX: -0.3, kneeLX: 0.2,
    hipRX: -0.3, kneeRX: 0.2,
  },
  "伸手": {
    bodyTilt: 0.1, torsoY: 0, hipY: 0,
    headX: 0, headZ: 0,
    shoulderLZ: 0, elbowLX: 0,
    shoulderRZ: -1.3, elbowRX: -0.2,
    hipLX: 0, kneeLX: 0,
    hipRX: 0, kneeRX: 0,
  },
  "抱臂": {
    bodyTilt: 0, torsoY: 0, hipY: 0,
    headX: 0, headZ: 0,
    shoulderLZ: 0.5, elbowLX: -2.0,
    shoulderRZ: -0.5, elbowRX: -2.0,
    hipLX: 0, kneeLX: 0,
    hipRX: 0, kneeRX: 0,
  },
  "看手机": {
    bodyTilt: 0.15, torsoY: 0, hipY: 0,
    headX: 0.35, headZ: 0,
    shoulderLZ: 0.4, elbowLX: -1.6,
    shoulderRZ: -0.4, elbowRX: -1.6,
    hipLX: 0, kneeLX: 0,
    hipRX: 0, kneeRX: 0,
  },
};

const GENDER_SCALE: Record<string, number> = { male: 1.0, female: 0.92, child: 0.67 };

// ─── Dimension constants (proportional to ~1.8m figure) ───
const HEAD_R = 0.095;
const NECK_R = 0.035;
const NECK_H = 0.06;
const CHEST_R = 0.13;    // torso cross-section radius
const CHEST_H = 0.30;
const WAIST_R = 0.095;
const WAIST_H = 0.06;
const PELVIS_R = 0.115;
const PELVIS_H = 0.12;
const SHOULDER_OFF = 0.175;  // shoulder offset from center
const UPPER_ARM_R = 0.04;
const UPPER_ARM_H = 0.26;
const FOREARM_R = 0.035;
const FOREARM_H = 0.24;
const HAND_R = 0.04;
const HAND_H = 0.08;
const HIP_OFF = 0.065;     // hip offset from center
const THIGH_R = 0.055;
const THIGH_H = 0.38;
const SHIN_R = 0.045;
const SHIN_H = 0.36;
const FOOT_W = 0.06;
const FOOT_H = 0.04;
const FOOT_D = 0.14;
const JOINT_R = 0.048;     // joint sphere radius

// Offset so feet touch ground (y=0) when character.y = 0 in standing pose
const GROUND_OFFSET =
  CHEST_H / 2 +
  WAIST_H +
  THIGH_H +
  SHIN_H +
  JOINT_R * 0.6 +
  FOOT_H / 2 +
  FOOT_W / 2; // ≈ 1.029

// Colors
const BODY_COLOR = "#c8a87c";
const JOINT_COLOR = "#a08060";

export const Mannequin = forwardRef<THREE.Group, MannequinProps>(
  function Mannequin({ character, isSelected, onSelect }, forwardedRef) {
    const localRef = useRef<THREE.Group>(null);
    const groupRef = forwardedRef || localRef;

    const genderScale = GENDER_SCALE[character.gender] ?? 1.0;
    const userScale = character.scale ?? 1;
    const totalScale = genderScale * userScale;
    const pose = POSE_DEFS[character.pose] ?? POSE_DEFS["站立"];

    const bodyColor = character.color || BODY_COLOR;

    useFrame(() => {
      if (!isSelected) return;
      const ref = (groupRef as React.RefObject<THREE.Group>).current;
      if (ref) {
        const t = Date.now() * 0.002;
        const s = 1 + Math.sin(t) * 0.004;
        ref.scale.set(totalScale * s, totalScale * s, totalScale * s);
      }
    });

    const handlePointerDown = (e: THREE.Event) => {
      (e as unknown as { stopPropagation: () => void }).stopPropagation();
      onSelect(character.id);
    };

    // ─── Sub-components ───

    // Joint sphere
    const Joint = ({ position }: { position: [number, number, number] }) => (
      <mesh position={position}>
        <sphereGeometry args={[JOINT_R, 16, 12]} />
        <meshStandardMaterial color={JOINT_COLOR} roughness={0.5} />
      </mesh>
    );

    // ─── Full body build (hierarchical transforms) ───
    // Lying pose needs smaller offset (body thickness ≈ CHEST_R*2) instead of full height
    const isLying = Math.abs(pose.bodyTilt) > 1.0;
    const groundOffset = isLying ? CHEST_R + PELVIS_R * 0.2 : GROUND_OFFSET;
    // hipY moves the whole body down (so pelvis and legs stay connected)
    const torsoBottom = -CHEST_H / 2 - WAIST_H - PELVIS_H / 2 + pose.torsoY + groundOffset + pose.hipY;

    const hipY = torsoBottom + PELVIS_H / 2;

    return (
      <group
        ref={groupRef as React.Ref<THREE.Group>}
        position={[character.x, character.y, character.z]}
        rotation={[0, (character.rotationY * Math.PI) / 180, 0]}
        scale={[totalScale, totalScale, totalScale]}
        onPointerDown={handlePointerDown}
      >
        {/* Selection ring */}
        {isSelected && (
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.45, 0.55, 32]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.6} side={THREE.DoubleSide} />
          </mesh>
        )}

          {/* ─── FULL BODY ROTATION (for lying pose, whole body tilts together) ─── */}
          <group rotation={isLying ? [pose.bodyTilt, 0, 0] : [0, 0, 0]}>
            {/* ─── LOWER BODY (Pelvis + Legs) — stays upright unless lying ─── */}
            <group>
              {/* Pelvis */}
              <mesh position={[0, torsoBottom + PELVIS_H / 2, 0]}>
                <capsuleGeometry args={[PELVIS_R, PELVIS_H, 8, 16]} />
                <meshStandardMaterial color={bodyColor} roughness={0.5} />
              </mesh>
              {/* Pelvis side spheres (hip width) */}
              <mesh position={[-HIP_OFF, torsoBottom + PELVIS_H * 0.4, 0]}>
                <sphereGeometry args={[0.055, 12, 10]} />
                <meshStandardMaterial color={JOINT_COLOR} roughness={0.5} />
              </mesh>
              <mesh position={[HIP_OFF, torsoBottom + PELVIS_H * 0.4, 0]}>
                <sphereGeometry args={[0.055, 12, 10]} />
                <meshStandardMaterial color={JOINT_COLOR} roughness={0.5} />
              </mesh>

              {/* ─── LEFT LEG ─── */}
              <group position={[-HIP_OFF, hipY, 0]} rotation={[pose.hipLX, 0, 0]}>
                {/* Thigh */}
                <mesh position={[0, -THIGH_H / 2 - JOINT_R * 0.3, 0]}>
                  <capsuleGeometry args={[THIGH_R, THIGH_H, 8, 16]} />
                  <meshStandardMaterial color={bodyColor} roughness={0.5} />
                </mesh>
                {/* Knee joint */}
                <group position={[0, -THIGH_H - JOINT_R * 0.3, 0]} rotation={[pose.kneeLX, 0, 0]}>
                  <Joint position={[0, 0, 0]} />
                  {/* Shin */}
                  <mesh position={[0, -SHIN_H / 2 - JOINT_R * 0.3, 0]}>
                    <capsuleGeometry args={[SHIN_R, SHIN_H, 8, 16]} />
                    <meshStandardMaterial color={bodyColor} roughness={0.5} />
                  </mesh>
                  {/* Ankle + foot */}
                  <group position={[0, -SHIN_H - JOINT_R * 0.3, 0]}>
                    <Joint position={[0, 0, 0]} />
                    <mesh position={[0, -FOOT_H / 2, FOOT_D * 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
                      <capsuleGeometry args={[FOOT_W / 2, FOOT_D * 0.6, 6, 10]} />
                      <meshStandardMaterial color={JOINT_COLOR} roughness={0.5} />
                    </mesh>
                  </group>
                </group>
              </group>

              {/* ─── RIGHT LEG ─── */}
              <group position={[HIP_OFF, hipY, 0]} rotation={[pose.hipRX, 0, 0]}>
                <mesh position={[0, -THIGH_H / 2 - JOINT_R * 0.3, 0]}>
                  <capsuleGeometry args={[THIGH_R, THIGH_H, 8, 16]} />
                  <meshStandardMaterial color={bodyColor} roughness={0.5} />
                </mesh>
                <group position={[0, -THIGH_H - JOINT_R * 0.3, 0]} rotation={[pose.kneeRX, 0, 0]}>
                  <Joint position={[0, 0, 0]} />
                  <mesh position={[0, -SHIN_H / 2 - JOINT_R * 0.3, 0]}>
                    <capsuleGeometry args={[SHIN_R, SHIN_H, 8, 16]} />
                    <meshStandardMaterial color={bodyColor} roughness={0.5} />
                  </mesh>
                  <group position={[0, -SHIN_H - JOINT_R * 0.3, 0]}>
                    <Joint position={[0, 0, 0]} />
                    <mesh position={[0, -FOOT_H / 2, FOOT_D * 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
                      <capsuleGeometry args={[FOOT_W / 2, FOOT_D * 0.6, 6, 10]} />
                      <meshStandardMaterial color={JOINT_COLOR} roughness={0.5} />
                    </mesh>
                  </group>
                </group>
              </group>
            </group>

            {/* ─── UPPER BODY (Waist + Chest + Head + Arms) — tilts at hip for non-lying poses ─── */}
            <group position={[0, hipY, 0]} rotation={isLying ? [0, 0, 0] : [pose.bodyTilt, 0, 0]}>
            {/* Waist */}
            <mesh position={[0, PELVIS_H / 2 + WAIST_H / 2, 0]}>
              <capsuleGeometry args={[WAIST_R, WAIST_H, 6, 14]} />
              <meshStandardMaterial color={bodyColor} roughness={0.5} />
            </mesh>

            {/* Chest */}
            <mesh position={[0, PELVIS_H / 2 + WAIST_H + CHEST_H / 2, 0]}>
              <capsuleGeometry args={[CHEST_R, CHEST_H, 10, 18]} />
              <meshStandardMaterial color={bodyColor} roughness={0.5} />
            </mesh>

            {/* Shoulder spheres (deltoid) */}
            <mesh position={[-SHOULDER_OFF, PELVIS_H / 2 + WAIST_H + CHEST_H, 0]}>
              <sphereGeometry args={[0.048, 12, 10]} />
              <meshStandardMaterial color={JOINT_COLOR} roughness={0.5} />
            </mesh>
            <mesh position={[SHOULDER_OFF, PELVIS_H / 2 + WAIST_H + CHEST_H, 0]}>
              <sphereGeometry args={[0.048, 12, 10]} />
              <meshStandardMaterial color={JOINT_COLOR} roughness={0.5} />
            </mesh>

            {/* ─── NECK + HEAD ─── */}
            <group position={[0, PELVIS_H / 2 + WAIST_H + CHEST_H, 0]}>
              {/* Neck */}
              <mesh position={[0, NECK_H / 2 + 0.02, 0]}>
                <cylinderGeometry args={[NECK_R, NECK_R * 1.1, NECK_H, 12]} />
                <meshStandardMaterial color={bodyColor} roughness={0.5} />
              </mesh>
              {/* Head */}
              <group position={[0, NECK_H + HEAD_R + 0.02, 0]} rotation={[pose.headX, 0, pose.headZ]}>
                <mesh>
                  <sphereGeometry args={[HEAD_R, 20, 16]} />
                  <meshStandardMaterial color={bodyColor} roughness={0.5} />
                </mesh>
                {/* Face hint - slight forward protrusion */}
                <mesh position={[0, -HEAD_R * 0.1, HEAD_R * 0.75]}>
                  <sphereGeometry args={[HEAD_R * 0.3, 10, 8]} />
                  <meshStandardMaterial color={bodyColor} roughness={0.5} />
                </mesh>
              </group>
            </group>

            {/* ─── LEFT ARM ─── */}
            <group position={[-SHOULDER_OFF, PELVIS_H / 2 + WAIST_H + CHEST_H, 0]} rotation={[0, 0, pose.shoulderLZ]}>
              {/* Upper arm */}
              <mesh position={[0, -UPPER_ARM_H / 2 - JOINT_R * 0.3, 0]}>
                <capsuleGeometry args={[UPPER_ARM_R, UPPER_ARM_H, 8, 14]} />
                <meshStandardMaterial color={bodyColor} roughness={0.5} />
              </mesh>
              {/* Elbow joint */}
              <group position={[0, -UPPER_ARM_H - JOINT_R * 0.3, 0]} rotation={[pose.elbowLX, 0, 0]}>
                <Joint position={[0, 0, 0]} />
                {/* Forearm */}
                <mesh position={[0, -FOREARM_H / 2 - JOINT_R * 0.3, 0]}>
                  <capsuleGeometry args={[FOREARM_R, FOREARM_H, 8, 14]} />
                  <meshStandardMaterial color={bodyColor} roughness={0.5} />
                </mesh>
                {/* Wrist + hand */}
                <group position={[0, -FOREARM_H - JOINT_R * 0.3, 0]}>
                  <Joint position={[0, 0, 0]} />
                  <mesh position={[0, -HAND_H / 2 - 0.01, 0]}>
                    <capsuleGeometry args={[HAND_R, HAND_H, 6, 10]} />
                    <meshStandardMaterial color={bodyColor} roughness={0.5} />
                  </mesh>
                </group>
              </group>
            </group>

            {/* ─── RIGHT ARM ─── */}
            <group position={[SHOULDER_OFF, PELVIS_H / 2 + WAIST_H + CHEST_H, 0]} rotation={[0, 0, pose.shoulderRZ]}>
              <mesh position={[0, -UPPER_ARM_H / 2 - JOINT_R * 0.3, 0]}>
                <capsuleGeometry args={[UPPER_ARM_R, UPPER_ARM_H, 8, 14]} />
                <meshStandardMaterial color={bodyColor} roughness={0.5} />
              </mesh>
              <group position={[0, -UPPER_ARM_H - JOINT_R * 0.3, 0]} rotation={[pose.elbowRX, 0, 0]}>
                <Joint position={[0, 0, 0]} />
                <mesh position={[0, -FOREARM_H / 2 - JOINT_R * 0.3, 0]}>
                  <capsuleGeometry args={[FOREARM_R, FOREARM_H, 8, 14]} />
                  <meshStandardMaterial color={bodyColor} roughness={0.5} />
                </mesh>
                <group position={[0, -FOREARM_H - JOINT_R * 0.3, 0]}>
                  <Joint position={[0, 0, 0]} />
                  <mesh position={[0, -HAND_H / 2 - 0.01, 0]}>
                    <capsuleGeometry args={[HAND_R, HAND_H, 6, 10]} />
                    <meshStandardMaterial color={bodyColor} roughness={0.5} />
                  </mesh>
                </group>
              </group>
            </group>
          </group>
          </group>

        {/* Ground shadow */}
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.3, 20]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.18} />
        </mesh>
      </group>
    );
  }
);



