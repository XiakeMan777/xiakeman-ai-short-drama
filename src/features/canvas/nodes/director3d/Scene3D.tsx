import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls, Grid, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import type { Director3DCharacter, Director3DProp } from "../../domain/canvasNodes";
import { Mannequin } from "./Mannequin";
import { PropModel } from "./PropModels";

interface Scene3DProps {
  characters: Director3DCharacter[];
  selectedCharacterId: number | null;
  onSelectCharacter: (id: number | null) => void;
  onCharacterDragEnd: (id: number, x: number, y: number, z: number) => void;
  onCharacterRotateEnd?: (id: number, rotationY: number) => void;
  panoramaImage: string | null;
  skyColor: string;
  groundVisible: boolean;
  gridVisible: boolean;
  interactive: boolean;
  // Props
  props: Director3DProp[];
  selectedPropId: number | null;
  onSelectProp: (id: number | null) => void;
  onPropDragEnd: (id: number, x: number, y: number, z: number) => void;
  onPropRotateEnd: (id: number, rotationY: number) => void;
}

export function Scene3D({
  characters,
  selectedCharacterId,
  onSelectCharacter,
  onCharacterDragEnd,
  onCharacterRotateEnd,
  panoramaImage,
  skyColor,
  groundVisible,
  gridVisible,
  interactive,
  transformMode = "translate",
  props,
  selectedPropId,
  onSelectProp,
  onPropDragEnd,
  onPropRotateEnd,
}: Scene3DProps & { transformMode?: "translate" | "rotate" }) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const [transformDragging, setTransformDragging] = useState(false);

  // Ref map for each character's group (using React.RefObject)
  const charRefMap = useRef<Map<number, React.RefObject<THREE.Group>>>(new Map());

  // Ref map for each prop's group (using React.RefObject)
  const propRefMap = useRef<Map<number, React.RefObject<THREE.Group>>>(new Map());

  // Ensure each character has a ref
  characters.forEach((char) => {
    if (!charRefMap.current.has(char.id)) {
      charRefMap.current.set(char.id, { current: null } as unknown as React.RefObject<THREE.Group>);
    }
  });

  // Ensure each prop has a ref
  props.forEach((prop) => {
    if (!propRefMap.current.has(prop.id)) {
      propRefMap.current.set(prop.id, { current: null } as unknown as React.RefObject<THREE.Group>);
    }
  });

  // Listen for camera preset events
  useEffect(() => {
    const handler = (e: Event) => {
      const preset = (e as CustomEvent).detail;
      if (!camera || !controlsRef.current) return;
      camera.position.set(preset.px, preset.py, preset.pz);
      if (preset.fov && "fov" in camera) {
        (camera as THREE.PerspectiveCamera).fov = preset.fov;
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }
      controlsRef.current.target.set(preset.tx, preset.ty, preset.tz);
      controlsRef.current.update();
    };
    window.addEventListener("director3d-set-camera", handler);
    return () => window.removeEventListener("director3d-set-camera", handler);
  }, [camera]);

  const panoramaTexture = useMemo(() => {
    if (!panoramaImage) return null;
    const loader = new THREE.TextureLoader();
    const tex = loader.load(panoramaImage);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [panoramaImage]);

  const handleGroundClick = useCallback((e: THREE.Event) => {
    // Deselect when clicking empty ground
    const event = e as unknown as { stopPropagation: () => void; object: { name: string } };
    if (event.object.name === "ground") {
      onSelectCharacter(null);
      onSelectProp(null);
    }
  }, [onSelectCharacter, onSelectProp]);

  // Get selected character and its ref
  const selectedChar = characters.find((c) => c.id === selectedCharacterId);
  const selectedCharRefObj = selectedChar ? charRefMap.current.get(selectedChar.id) : null;

  // Get selected prop and its ref
  const selectedProp = props.find((p) => p.id === selectedPropId);
  const selectedPropRefObj = selectedProp ? propRefMap.current.get(selectedProp.id) : null;

  // Determine which entity gets TransformControls (character takes priority, then prop)
  const activeRefObj = selectedCharRefObj?.current ? selectedCharRefObj : selectedPropRefObj?.current ? selectedPropRefObj : null;
  const activeEntityType = selectedCharRefObj?.current ? "character" : selectedPropRefObj?.current ? "prop" : null;

  const handleTransformChange = useCallback(() => {
    if (!activeRefObj?.current || !activeEntityType) return;
    if (transformMode === "translate") {
      const pos = activeRefObj.current.position;
      if (activeEntityType === "character" && selectedChar) {
        onCharacterDragEnd(selectedChar.id, pos.x, pos.y, pos.z);
      } else if (activeEntityType === "prop" && selectedProp) {
        onPropDragEnd(selectedProp.id, pos.x, pos.y, pos.z);
      }
    }
  }, [activeRefObj, activeEntityType, selectedChar, selectedProp, transformMode, onCharacterDragEnd, onPropDragEnd]);

  const handleTransformEnd = useCallback(() => {
    if (!activeRefObj?.current || !activeEntityType) return;
    if (transformMode === "translate") {
      const pos = activeRefObj.current.position;
      if (activeEntityType === "character" && selectedChar) {
        onCharacterDragEnd(selectedChar.id, pos.x, pos.y, pos.z);
      } else if (activeEntityType === "prop" && selectedProp) {
        onPropDragEnd(selectedProp.id, pos.x, pos.y, pos.z);
      }
    } else {
      // Rotation mode
      const euler = new THREE.Euler().setFromQuaternion(activeRefObj.current.quaternion, "YXZ");
      let deg = (euler.y * 180) / Math.PI;
      deg = ((deg % 360) + 360) % 360;
      if (activeEntityType === "character" && selectedChar) {
        onCharacterRotateEnd?.(selectedChar.id, deg);
      } else if (activeEntityType === "prop" && selectedProp) {
        onPropRotateEnd(selectedProp.id, deg);
      }
    }
  }, [activeRefObj, activeEntityType, selectedChar, selectedProp, transformMode, onCharacterDragEnd, onPropDragEnd, onCharacterRotateEnd, onPropRotateEnd]);

  return (
    <>
      {/* Sky */}
      <color attach="background" args={[panoramaTexture ? "#000000" : skyColor]} />

      {/* Panorama sphere */}
      {panoramaTexture && (
        <mesh scale={[-1, 1, 1]}>
          <sphereGeometry args={[50, 64, 32]} />
          <meshBasicMaterial map={panoramaTexture} side={THREE.BackSide} />
        </mesh>
      )}

      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} castShadow />
      <directionalLight position={[-3, 5, -5]} intensity={0.3} />

      {/* Ground */}
      {groundVisible && (
        <mesh
          name="ground"
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, 0]}
          onPointerDown={handleGroundClick}
        >
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#1a1a1a" transparent opacity={0.35} />
        </mesh>
      )}

      {/* Grid */}
      {gridVisible && (
        <Grid
          position={[0, 0.005, 0]}
          args={[40, 40]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#333333"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#444444"
          fadeDistance={30}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid
        />
      )}

      {/* Characters */}
      {characters.map((char) => (
        <Mannequin
          key={char.id}
          ref={charRefMap.current.get(char.id)}
          character={char}
          isSelected={selectedCharacterId === char.id}
          onSelect={onSelectCharacter}
        />
      ))}

      {/* Props */}
      {props.map((prop) => (
        <group
          key={prop.id}
          ref={propRefMap.current.get(prop.id)}
          position={[prop.x, prop.y, prop.z]}
          rotation={[0, (prop.rotationY * Math.PI) / 180, 0]}
          scale={[prop.scale ?? 1, prop.scale ?? 1, prop.scale ?? 1]}
          onPointerDown={(e) => {
            (e as unknown as { stopPropagation: () => void }).stopPropagation();
            onSelectProp(prop.id);
          }}
        >
          <PropModel
            type={prop.type}
            color={prop.color}
            customWidth={prop.customWidth}
            customHeight={prop.customHeight}
            customDepth={prop.customDepth}
          />
          {/* Selection ring for selected prop */}
          {selectedPropId === prop.id && (
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.5, 0.6, 32]} />
              <meshBasicMaterial color="#fbbf24" transparent opacity={0.6} side={THREE.DoubleSide} />
            </mesh>
          )}
        </group>
      ))}

      {/* Transform Controls for selected character or prop */}
      {activeRefObj?.current && (
        <TransformControls
          object={activeRefObj.current!}
          mode={transformMode}
          space="world"
          size={0.8}
          onMouseDown={() => setTransformDragging(true)}
          onMouseUp={() => {
            setTransformDragging(false);
            handleTransformEnd();
          }}
          onObjectChange={handleTransformChange}
        />
      )}


      {/* Origin marker */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.12, 32]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.6} />
      </mesh>

      {/* Axis indicators */}
      <mesh position={[0.15, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.3, 0.03]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, 0.01, 0.15]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.03, 0.3]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.7} />
      </mesh>

      {/* Camera controls */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={1}
        maxDistance={30}
        maxPolarAngle={Math.PI / 2 + 0.1}
        target={[0, 0.8, 0]}
        enabled={interactive && !transformDragging}
      />
    </>
  );
}



