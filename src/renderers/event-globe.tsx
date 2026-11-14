"use client";

/**
 * 3D globe for backend events (React Three Fiber).
 *
 * - Procedural sphere + latitude/longitude graticule only. No Earth texture:
 *   the approved NASA resources contain no verified equirectangular basemap,
 *   and third-party/sample Earth textures are not allowed.
 * - Markers are placed ONLY from the latitude/longitude supplied by the
 *   backend payload (WGS84 degrees assumed, as is standard for such feeds);
 *   nothing is generated or interpolated.
 * - Wildfires / Severe Storms / other differ by shape AND colour.
 */
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { EarthEvent } from "@/contracts/events";
import { styleFor } from "@/renderers/event-style";

const D2R = Math.PI / 180;

export function latLonToVector3(lat: number, lon: number, r = 1): THREE.Vector3 {
  const phi = (90 - lat) * D2R;
  const theta = (lon + 180) * D2R;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** Yaw/pitch that bring a lat/lon to face a camera on the +z axis (Euler order XYZ). */
export function orientationFacing(lat: number, lon: number): { yaw: number; pitch: number } {
  const v = latLonToVector3(lat, lon);
  return { yaw: -Math.atan2(v.x, v.z), pitch: lat * D2R };
}

function Graticule() {
  const { minor, major } = useMemo(() => {
    const minorPts: number[] = [];
    const majorPts: number[] = [];
    const r = 1.001;
    const push = (arr: number[], a: THREE.Vector3, b: THREE.Vector3) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (let lat = -60; lat <= 60; lat += 30) {
      const arr = lat === 0 ? majorPts : minorPts;
      for (let lon = -180; lon < 180; lon += 3) push(arr, latLonToVector3(lat, lon, r), latLonToVector3(lat, lon + 3, r));
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const arr = lon === 0 ? majorPts : minorPts;
      for (let lat = -90; lat < 90; lat += 3) push(arr, latLonToVector3(lat, lon, r), latLonToVector3(lat + 3, lon, r));
    }
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute("position", new THREE.Float32BufferAttribute(minorPts, 3));
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute("position", new THREE.Float32BufferAttribute(majorPts, 3));
    return { minor: g1, major: g2 };
  }, []);
  useEffect(
    () => () => {
      minor.dispose();
      major.dispose();
    },
    [minor, major],
  );
  return (
    <>
      <lineSegments geometry={minor}>
        <lineBasicMaterial color="#5b6b8c" transparent opacity={0.35} />
      </lineSegments>
      <lineSegments geometry={major}>
        <lineBasicMaterial color="#7dd3fc" transparent opacity={0.7} />
      </lineSegments>
    </>
  );
}

function Marker({ event, selected, onSelect }: { event: EarthEvent; selected: boolean; onSelect: (id: string) => void }) {
  const style = styleFor(event.category);
  const pos = useMemo(() => latLonToVector3(event.latitude, event.longitude, 1.03), [event.latitude, event.longitude]);
  const ref = useRef<THREE.Mesh>(null);
  useEffect(() => {
    ref.current?.lookAt(0, 0, 0);
  }, [pos]);
  const s = selected ? 1.6 : 1;
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(event.id);
  };
  return (
    <mesh ref={ref} position={pos} scale={s} onClick={onClick}>
      {style.shape === "octahedron" ? <octahedronGeometry args={[0.035]} /> : style.shape === "torus" ? <torusGeometry args={[0.032, 0.011, 8, 24]} /> : <sphereGeometry args={[0.028, 16, 16]} />}
      <meshStandardMaterial color={style.color} emissive={style.color} emissiveIntensity={selected ? 0.9 : 0.45} />
    </mesh>
  );
}

/** Mutable camera state for the globe; mutated only through its methods (outside React render). */
export class GlobeCamera {
  yaw = 0;
  pitch = 0.35;
  zoom = 3.1;
  private targetYaw = 0;
  private targetPitch = 0.35;
  private interacting = false;

  step(dt: number, autoRotate: boolean): void {
    if (autoRotate && !this.interacting) this.targetYaw += dt * 0.08;
    const k = 1 - Math.exp(-dt * 6);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
  }
  rotateBy(dYaw: number, dPitch: number): void {
    this.targetYaw += dYaw;
    this.targetPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.targetPitch + dPitch));
  }
  zoomBy(d: number): void {
    this.zoom = Math.min(5, Math.max(1.8, this.zoom + d));
  }
  setInteracting(v: boolean): void {
    this.interacting = v;
  }
  /** Rotate (the short way round) so that lat/lon faces the camera. */
  face(lat: number, lon: number): void {
    const o = orientationFacing(lat, lon);
    const twoPi = Math.PI * 2;
    let dy = (o.yaw - this.targetYaw) % twoPi;
    if (dy > Math.PI) dy -= twoPi;
    if (dy < -Math.PI) dy += twoPi;
    this.targetYaw += dy;
    this.targetPitch = o.pitch;
  }
  apply(group: THREE.Group, camera: THREE.Camera): void {
    group.rotation.set(this.pitch, this.yaw, 0);
    camera.position.set(0, 0, this.zoom);
    camera.lookAt(0, 0, 0);
  }
}

function Scene({
  events,
  selectedId,
  onSelect,
  camera,
  autoRotate,
}: {
  events: EarthEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  camera: GlobeCamera;
  autoRotate: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame((state, dt) => {
    if (!group.current) return;
    camera.step(Math.min(dt, 0.1), autoRotate && selectedId === null);
    camera.apply(group.current, state.camera);
  });
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 2, 4]} intensity={1.1} />
      <group ref={group}>
        <mesh>
          <sphereGeometry args={[1, 64, 48]} />
          <meshStandardMaterial color="#0f1b33" roughness={0.9} metalness={0.05} />
        </mesh>
        <Graticule />
        {events.map((e) => (
          <Marker key={e.id} event={e} selected={e.id === selectedId} onSelect={onSelect} />
        ))}
      </group>
    </>
  );
}

export default function EventGlobe({
  events,
  selectedId,
  onSelect,
  autoRotate,
  describedBy,
}: {
  events: EarthEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  autoRotate: boolean;
  describedBy: string;
}) {
  const [camera] = useState(() => new GlobeCamera());
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const ev = events.find((e) => e.id === selectedId);
    if (ev) camera.face(ev.latitude, ev.longitude);
  }, [selectedId, events, camera]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 15 * D2R;
    if (e.key === "ArrowLeft") camera.rotateBy(-step, 0);
    else if (e.key === "ArrowRight") camera.rotateBy(step, 0);
    else if (e.key === "ArrowUp") camera.rotateBy(0, step);
    else if (e.key === "ArrowDown") camera.rotateBy(0, -step);
    else if (e.key === "+" || e.key === "=") camera.zoomBy(-0.2);
    else if (e.key === "-") camera.zoomBy(0.2);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="relative h-full w-full touch-none rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
      tabIndex={0}
      role="application"
      aria-roledescription="3D globe"
      aria-label={`Globe showing ${events.length} backend events. Arrow keys rotate, plus and minus zoom.`}
      aria-describedby={describedBy}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
        camera.setInteracting(true);
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        camera.rotateBy((e.clientX - drag.current.x) * 0.006, (e.clientY - drag.current.y) * 0.006);
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => {
        drag.current = null;
        camera.setInteracting(false);
      }}
      onWheel={(e) => camera.zoomBy(Math.sign(e.deltaY) * 0.15)}
      data-testid="event-globe"
    >
      <Canvas camera={{ position: [0, 0, 3.1], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "low-power" }} aria-hidden="true">
        <Scene events={events} selectedId={selectedId} onSelect={onSelect} camera={camera} autoRotate={autoRotate} />
      </Canvas>
    </div>
  );
}
