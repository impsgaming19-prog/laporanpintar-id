import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Text3D, Environment, MeshDistortMaterial } from "@react-three/drei";
import type { Mesh } from "three";

function FloatingCoin({ position, color, size = 1 }: { position: [number, number, number]; color: string; size?: number }) {
  const meshRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5 + position[0]) * 0.3;
      meshRef.current.rotation.y += 0.02;
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={1.5}>
      <mesh ref={meshRef} position={position} scale={size}>
        <cylinderGeometry args={[1, 1, 0.2, 32]} />
        <MeshDistortMaterial
          color={color}
          roughness={0.3}
          metalness={0.8}
          distort={0.1}
          speed={2}
        />
      </mesh>
    </Float>
  );
}

function FloatingSphere({ position, color, size = 0.5 }: { position: [number, number, number]; color: string; size?: number }) {
  const meshRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y =
        position[1] + Math.sin(state.clock.elapsedTime * 0.8 + position[0] * 2) * 0.3;
    }
  });

  return (
    <Float speed={1.5} rotationIntensity={0.3} floatIntensity={1}>
      <mesh ref={meshRef} position={position} scale={size}>
        <sphereGeometry args={[1, 32, 32]} />
        <MeshDistortMaterial
          color={color}
          roughness={0.4}
          metalness={0.6}
          distort={0.15}
          speed={1.5}
        />
      </mesh>
    </Float>
  );
}

function BarChart3D() {
  const bars = useMemo(
    () => [
      { height: 2, position: [-3, 0, 0] as [number, number, number], color: "#10b981" },
      { height: 3, position: [-1.5, 0, 0] as [number, number, number], color: "#34d399" },
      { height: 1.5, position: [0, 0, 0] as [number, number, number], color: "#6ee7b7" },
      { height: 4, position: [1.5, 0, 0] as [number, number, number], color: "#10b981" },
      { height: 2.5, position: [3, 0, 0] as [number, number, number], color: "#34d399" },
    ],
    []
  );

  return (
    <group position={[0, -2, 0]}>
      {bars.map((bar, i) => (
        <Float key={i} speed={1 + i * 0.3} rotationIntensity={0} floatIntensity={0.5}>
          <mesh position={bar.position}>
            <boxGeometry args={[0.8, bar.height, 0.8]} />
            <MeshDistortMaterial
              color={bar.color}
              roughness={0.3}
              metalness={0.7}
              distort={0.05}
              speed={2}
            />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

function Particles() {
  const particles = useMemo(() => {
    return Array.from({ length: 50 }, (_, i) => ({
      position: [
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      ] as [number, number, number],
      size: Math.random() * 0.05 + 0.02,
    }));
  }, []);

  return (
    <>
      {particles.map((p, i) => (
        <mesh key={i} position={p.position}>
          <sphereGeometry args={[p.size, 8, 8]} />
          <meshBasicMaterial color="#10b981" transparent opacity={0.4} />
        </mesh>
      ))}
    </>
  );
}

export default function Scene3D({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Canvas camera={{ position: [0, 0, 8], fov: 50 }}>
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <pointLight position={[-5, 5, 5]} intensity={0.5} color="#10b981" />
        <pointLight position={[5, -5, 5]} intensity={0.3} color="#34d399" />

        <FloatingCoin position={[-3, 2, -2]} color="#fbbf24" size={0.8} />
        <FloatingCoin position={[3.5, -1, -1]} color="#f59e0b" size={0.6} />
        <FloatingCoin position={[-1.5, -2, -3]} color="#eab308" size={0.7} />

        <FloatingSphere position={[2, 2.5, -1]} color="#10b981" size={0.4} />
        <FloatingSphere position={[-4, 0, -2]} color="#34d399" size={0.3} />
        <FloatingSphere position={[4, 1.5, -3]} color="#6ee7b7" size={0.35} />

        <BarChart3D />
        <Particles />

        <Environment preset="night" />
      </Canvas>
    </div>
  );
}
