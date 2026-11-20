"use client";

import React, { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  EXECUTIVES,
  ExecutiveProfile,
  ROOM_ZONES,
  RoomZoneId,
} from "@/lib/executives";

import { accentOf, type Executive, type ExecutiveId } from "@/lib/roster";

export type CameraPreset =
  | "ceo-pov"
  | "boardroom-overview"
  | "follow-huddle"
  | `focus-${ExecutiveId}`;

export interface ActiveChoreography {
  speaker: ExecutiveId | null;
  listener: ExecutiveId | 'CEO' | null;
  roomZone: RoomZoneId;
  interactionMode:
    | "idle"
    | "walk_and_talk"
    | "executive_consensus"
    | "ceo_response";
  speechText: string | null;
  stageLabel: string;
  isEnriching: boolean;
  latestInsightTopic?: string | null;
}

interface VirtualOfficeCanvasProps {
  speaker?: Executive;
  listener?: Executive;
  choreography: ActiveChoreography;
  cameraPreset: CameraPreset;
  selectedExecutive: ExecutiveId | null;
  onSelectExecutive: (role: ExecutiveId) => void;
}

interface ArticulatedAvatar {
  root: THREE.Group;
  pelvis: THREE.Group;
  torso: THREE.Group;
  headGroup: THREE.Group;
  mouth: THREE.Mesh;
  leftShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightShoulder: THREE.Group;
  rightElbow: THREE.Group;
  leftHip: THREE.Group;
  leftKnee: THREE.Group;
  rightHip: THREE.Group;
  rightKnee: THREE.Group;
  floorRing: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  lookTarget: THREE.Vector3;
  currentYaw: number;
  walkPhase: number;
  isWalking: boolean;
  heightScale: number;
}

const TABLE_OBSTACLE = {
  minX: -1.38,
  maxX: 1.38,
  minZ: -1.55,
  maxZ: -0.15,
};

function computeNextSteerPoint(
  current: THREE.Vector3,
  goal: THREE.Vector3
): THREE.Vector3 {
  const dx = goal.x - current.x;
  const dz = goal.z - current.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.08) return goal;

  // Check if path crosses the central glass strategy table
  const midX = (current.x + goal.x) * 0.5;
  const midZ = (current.z + goal.z) * 0.5;
  const crossesTable =
    (Math.abs(midX) < TABLE_OBSTACLE.maxX &&
      midZ > TABLE_OBSTACLE.minZ &&
      midZ < TABLE_OBSTACLE.maxZ) ||
    (current.z < TABLE_OBSTACLE.minZ &&
      goal.z > TABLE_OBSTACLE.maxZ &&
      Math.abs(midX) < TABLE_OBSTACLE.maxX) ||
    (current.z > TABLE_OBSTACLE.maxZ &&
      goal.z < TABLE_OBSTACLE.minZ &&
      Math.abs(midX) < TABLE_OBSTACLE.maxX);

  if (crossesTable) {
    const sideX = current.x + goal.x >= 0 ? 1.82 : -1.82;
    const cornerZ = goal.z > current.z ? 0.15 : -1.85;
    return new THREE.Vector3(sideX, 0, cornerZ);
  }

  return goal;
}

function createTravertineFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#F4F1EA";
  ctx.fillRect(0, 0, 512, 512);

  // Subtle stone veining
  for (let i = 0; i < 65; i++) {
    ctx.strokeStyle =
      i % 2 === 0 ? "rgba(214, 206, 194, 0.32)" : "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1 + (i % 3);
    ctx.beginPath();
    const y = (i * 47) % 512;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      170,
      y + ((i % 5) - 2) * 8,
      340,
      y - ((i % 4) - 2) * 8,
      512,
      y + ((i % 3) - 1) * 6
    );
    ctx.stroke();
  }

  // Architectural tile seams
  ctx.strokeStyle = "rgba(185, 177, 165, 0.38)";
  ctx.lineWidth = 2;
  for (let p = 0; p <= 512; p += 128) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 512);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(512, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWalnutTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#5B402D";
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 90; i++) {
    ctx.fillStyle =
      i % 2 === 0 ? "rgba(62, 41, 26, 0.35)" : "rgba(116, 84, 58, 0.25)";
    ctx.fillRect(0, (i * 11) % 256, 256, 2 + (i % 3));
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createHoloScreenTexture(
  title: string,
  subtitle: string,
  accentHex: string,
  bars: number[]
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, 640, 360);
  grad.addColorStop(0, "#0F172A");
  grad.addColorStop(1, "#1E293B");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 640, 360);

  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, 612, 332);

  ctx.fillStyle = "#F8FAFC";
  ctx.font = "bold 26px system-ui, sans-serif";
  ctx.fillText(title, 38, 62);

  ctx.fillStyle = "#94A3B8";
  ctx.font = "17px system-ui, sans-serif";
  ctx.fillText(subtitle, 38, 92);

  // Subtle grid lines
  ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
  ctx.lineWidth = 1;
  for (let y = 130; y <= 300; y += 40) {
    ctx.beginPath();
    ctx.moveTo(38, y);
    ctx.lineTo(600, y);
    ctx.stroke();
  }

  // Telemetry bars
  const barW = 54;
  const gap = 26;
  bars.forEach((val, idx) => {
    const h = Math.round(val * 165);
    const x = 52 + idx * (barW + gap);
    const y = 305 - h;
    ctx.fillStyle = accentHex;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, barW, h);
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#E2E8F0";
    ctx.font = "bold 14px monospace";
    ctx.fillText(`${Math.round(val * 100)}%`, x + 8, y - 8);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildExecutiveAvatar(
  profile: ExecutiveProfile,
  heightScale: number
): ArticulatedAvatar {
  const root = new THREE.Group();


  const suitMat = new THREE.MeshStandardMaterial({
    color: profile.suitColorHex,
    roughness: 0.58,
    metalness: 0.08,
  });
  const trouserMat = new THREE.MeshStandardMaterial({
    color: profile.role === "COO" ? "#27272A" : profile.suitColorHex,
    roughness: 0.65,
    metalness: 0.05,
  });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: profile.shirtColorHex,
    roughness: 0.45,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: profile.tieOrTrimHex,
    roughness: 0.35,
    metalness: 0.15,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: profile.skinToneHex,
    roughness: 0.52,
    metalness: 0.02,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: profile.hairColorHex,
    roughness: 0.72,
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: "#18181B",
    roughness: 0.28,
    metalness: 0.2,
  });

  const bodyScale = new THREE.Group();
  bodyScale.scale.setScalar(heightScale);
  root.add(bodyScale);

  // Floor presence halo ring
  const ringGeo = new THREE.RingGeometry(0.32, 0.42, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: profile.accentHex,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
  });
  const floorRing = new THREE.Mesh(ringGeo, ringMaterial);
  floorRing.position.y = 0.012;
  root.add(floorRing);

  // Pelvis
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.92;
  bodyScale.add(pelvis);

  const hipBlock = new THREE.Mesh(
    new THREE.CylinderGeometry(0.145, 0.135, 0.15, 16),
    trouserMat
  );
  hipBlock.castShadow = true;
  pelvis.add(hipBlock);

  // Legs helper
  const buildLeg = (side: -1 | 1) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.088, -0.04, 0);
    pelvis.add(hip);

    const thigh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.056, 0.43, 14),
      trouserMat
    );
    thigh.position.y = -0.215;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);

    const shin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.045, 0.41, 14),
      trouserMat
    );
    shin.position.y = -0.205;
    shin.castShadow = true;
    knee.add(shin);

    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(0.095, 0.065, 0.21),
      shoeMat
    );
    shoe.position.set(0, -0.42, 0.045);
    shoe.castShadow = true;
    knee.add(shoe);

    return { hip, knee };
  };

  const leftLeg = buildLeg(-1);
  const rightLeg = buildLeg(1);

  // Torso
  const torso = new THREE.Group();
  torso.position.y = 0.06;
  pelvis.add(torso);

  const blazerMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.175, 0.145, 0.48, 18),
    suitMat
  );
  blazerMesh.scale.set(1.08, 1, 0.74);
  blazerMesh.position.y = 0.24;
  blazerMesh.castShadow = true;
  torso.add(blazerMesh);

  // Shirt V-front
  const shirtFront = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.26, 0.03),
    shirtMat
  );
  shirtFront.position.set(0, 0.32, 0.118);
  torso.add(shirtFront);

  // Tie or executive lapel trim
  if (profile.role === "CFO") {
    const tie = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.24, 0.036),
      accentMat
    );
    tie.position.set(0, 0.29, 0.125);
    torso.add(tie);
  } else {
    const lapelPin = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.015, 0.02),
      accentMat
    );
    lapelPin.position.set(-0.085, 0.37, 0.125);
    torso.add(lapelPin);

    const trimScarf = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.045, 0.034),
      accentMat
    );
    trimScarf.position.set(0, 0.42, 0.122);
    torso.add(trimScarf);
  }

  // Arms
  const buildArm = (side: -1 | 1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.215, 0.44, 0);
    torso.add(shoulder);

    const shoulderCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.062, 12, 12),
      suitMat
    );
    shoulder.add(shoulderCap);

    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.054, 0.046, 0.27, 12),
      suitMat
    );
    upperArm.position.y = -0.135;
    upperArm.castShadow = true;
    shoulder.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    shoulder.add(elbow);

    const forearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.038, 0.24, 12),
      suitMat
    );
    forearm.position.y = -0.12;
    forearm.castShadow = true;
    elbow.add(forearm);

    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.039, 0.025, 12),
      shirtMat
    );
    cuff.position.y = -0.24;
    elbow.add(cuff);

    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(0.038, 12, 12),
      skinMat
    );
    hand.scale.set(0.85, 1.15, 0.65);
    hand.position.y = -0.28;
    elbow.add(hand);

    return { shoulder, elbow };
  };

  const leftArm = buildArm(-1);
  const rightArm = buildArm(1);

  // Neck & Realistic Sculpted Head
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.058, 0.09, 14),
    skinMat
  );
  neck.position.y = 0.51;
  torso.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.y = 0.61;
  torso.add(headGroup);

  const cranium = new THREE.Mesh(
    new THREE.SphereGeometry(0.112, 24, 24),
    skinMat
  );
  cranium.scale.set(0.92, 1.12, 0.98);
  cranium.castShadow = true;
  headGroup.add(cranium);

  // Nose
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.016, 0.042, 8),
    skinMat
  );
  nose.rotation.x = Math.PI * 0.42;
  nose.position.set(0, -0.005, 0.114);
  headGroup.add(nose);

  // Eyes (sclera + pupil)
  const scleraMat = new THREE.MeshBasicMaterial({ color: "#FFFFFF" });
  const pupilMat = new THREE.MeshBasicMaterial({ color: "#0F172A" });
  [-1, 1].forEach((side) => {
    const eyeWhite = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 10, 10),
      scleraMat
    );
    eyeWhite.scale.set(1.15, 0.8, 0.6);
    eyeWhite.position.set(side * 0.038, 0.022, 0.1);
    headGroup.add(eyeWhite);

    const pupil = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 8, 8),
      pupilMat
    );
    pupil.position.set(side * 0.038, 0.022, 0.109);
    headGroup.add(pupil);

    const brow = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.006, 0.01),
      hairMat
    );
    brow.position.set(side * 0.038, 0.043, 0.104);
    headGroup.add(brow);
  });

  // Articulated speaking mouth
  const mouthMat = new THREE.MeshStandardMaterial({
    color: "#883939",
    roughness: 0.5,
  });
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.038, 0.01, 0.016),
    mouthMat
  );
  mouth.position.set(0, -0.045, 0.101);
  headGroup.add(mouth);

  // Distinct hairstyles & executive accessories
  if (profile.role === "CTO") {
    // Sleek bob hairstyle + modern glasses
    const hairTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.118, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.62),
      hairMat
    );
    hairTop.scale.set(0.96, 1.12, 1.02);
    hairTop.position.y = 0.012;
    headGroup.add(hairTop);

    [-1, 1].forEach((side) => {
      const sideLock = new THREE.Mesh(
        new THREE.BoxGeometry(0.032, 0.14, 0.12),
        hairMat
      );
      sideLock.position.set(side * 0.098, -0.015, -0.005);
      headGroup.add(sideLock);
    });

    // Rimless executive glasses
    const frameMat = new THREE.MeshStandardMaterial({
      color: "#2563EB",
      metalness: 0.8,
      roughness: 0.2,
    });
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.095, 0.005, 0.006),
      frameMat
    );
    bridge.position.set(0, 0.026, 0.114);
    headGroup.add(bridge);
  } else if (profile.role === "CFO") {
    // Structured executive cropped hair
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.116, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hairMat
    );
    hairCap.scale.set(0.95, 1.12, 1.01);
    hairCap.position.y = 0.016;
    headGroup.add(hairCap);
  } else {
    // COO tailored crown + low chignon bun
    const hairCrown = new THREE.Mesh(
      new THREE.SphereGeometry(0.117, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.56),
      hairMat
    );
    hairCrown.scale.set(0.95, 1.12, 1.01);
    hairCrown.position.y = 0.014;
    headGroup.add(hairCrown);

    const bun = new THREE.Mesh(
      new THREE.SphereGeometry(0.048, 14, 14),
      hairMat
    );
    bun.position.set(0, 0.01, -0.115);
    headGroup.add(bun);
  }

  const initialPos = new THREE.Vector3(...profile.homePosition);
  root.position.copy(initialPos);

  return {
    root,
    pelvis,
    torso,
    headGroup,
    mouth,
    leftShoulder: leftArm.shoulder,
    leftElbow: leftArm.elbow,
    rightShoulder: rightArm.shoulder,
    rightElbow: rightArm.elbow,
    leftHip: leftLeg.hip,
    leftKnee: leftLeg.knee,
    rightHip: rightLeg.hip,
    rightKnee: rightLeg.knee,
    floorRing,
    ringMaterial,
    currentPos: initialPos.clone(),
    targetPos: initialPos.clone(),
    lookTarget: new THREE.Vector3(...profile.homeLookAt),
    currentYaw: 0,
    walkPhase: Math.random() * Math.PI * 2,
    isWalking: false,
    heightScale,
  };
}

export default function VirtualOfficeCanvas({
  speaker, listener,
  choreography,
  cameraPreset,
  selectedExecutive,
  onSelectExecutive,
}: VirtualOfficeCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const badgeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const statusTextRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const sparkRef = useRef<HTMLDivElement | null>(null);
  const local = { choreography, cameraPreset, selectedExecutive, onSelectExecutive, speaker, listener };
  const live = useRef(local);
  useLayoutEffect(() => { live.current = { choreography, cameraPreset, selectedExecutive, onSelectExecutive, speaker, listener }; },
    [choreography, cameraPreset, selectedExecutive, onSelectExecutive, speaker, listener]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#EAF0F7");
    scene.fog = new THREE.Fog("#EAF0F7", 14, 34);

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 80);
    camera.position.set(0, 2.15, 4.95);

    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    } catch {
      container.textContent = "3D view unavailable. The roster, transcript and CEO controls remain available.";
      return;
    }
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Physically based architectural environment reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envRT = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envRT.texture;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.1;
    controls.maxDistance = 10.5;
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.minPolarAngle = Math.PI * 0.14;
    controls.target.set(0, 1.25, -0.95);

    // Lighting
    const hemiLight = new THREE.HemisphereLight("#FFFFFF", "#CBD5E1", 0.95);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight("#FFFDF8", 1.85);
    sunLight.position.set(-5.5, 8.2, 4.5);
    sunLight.castShadow = true;
    const shadowSize = window.innerWidth <= 600 ? 1024 : 2048;
    sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 24;
    sunLight.shadow.camera.left = -6.5;
    sunLight.shadow.camera.right = 6.5;
    sunLight.shadow.camera.top = 6.5;
    sunLight.shadow.camera.bottom = -6.5;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight("#DBEAFE", 0.65);
    fillLight.position.set(5, 4, 3);
    scene.add(fillLight);

    // --- Architectural Virtual Office Room ---
    const floorTex = createTravertineFloorTexture();
    const walnutTex = createWalnutTexture();

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(11.6, 10.2),
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: 0.34,
        metalness: 0.06,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -0.6);
    floor.receiveShadow = true;
    scene.add(floor);

    // Woven executive area rug under strategy table
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 3.1),
      new THREE.MeshStandardMaterial({
        color: "#E2E8F0",
        roughness: 0.92,
      })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.005, -0.85);
    rug.receiveShadow = true;
    scene.add(rug);

    // Ceiling coffer frame & linear architectural LEDs
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(11.6, 10.2),
      new THREE.MeshStandardMaterial({ color: "#F8FAFC", roughness: 0.85 })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 3.85, -0.6);
    scene.add(ceiling);

    [-2.1, 0, 2.1].forEach((lx) => {
      const ledBar = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.04, 6.2),
        new THREE.MeshBasicMaterial({ color: "#FFFFFF" })
      );
      ledBar.position.set(lx, 3.82, -0.8);
      scene.add(ledBar);
    });

    // Panoramic back curtain wall mullions (-Z = -4.5) + city skyline outside
    const mullionMat = new THREE.MeshStandardMaterial({
      color: "#334155",
      metalness: 0.75,
      roughness: 0.25,
    });
    const glassWallMat = new THREE.MeshPhysicalMaterial({
      color: "#E0F2FE",
      transparent: true,
      opacity: 0.22,
      roughness: 0.08,
      transmission: 0.65,
    });

    const backGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(11.4, 3.85),
      glassWallMat
    );
    backGlass.position.set(0, 1.925, -4.45);
    scene.add(backGlass);

    for (let mx = -5.5; mx <= 5.5; mx += 1.83) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.065, 3.85, 0.09),
        mullionMat
      );
      post.position.set(mx, 1.925, -4.43);
      scene.add(post);
    }
    [0.05, 1.35, 3.8].forEach((my) => {
      const transom = new THREE.Mesh(
        new THREE.BoxGeometry(11.4, 0.055, 0.09),
        mullionMat
      );
      transom.position.set(0, my, -4.43);
      scene.add(transom);
    });

    // Exterior 3D architectural skyline towers beyond the panoramic glass
    const skylineMat = new THREE.MeshStandardMaterial({
      color: "#CBD5E1",
      roughness: 0.6,
      metalness: 0.2,
    });
    const skylineBuildings: Array<[number, number, number, number, number]> = [
      [-6.8, 3.4, -10.5, 1.5, 8.5],
      [-4.6, 2.2, -9.2, 1.3, 6.4],
      [-2.3, 4.1, -11.8, 1.7, 10.2],
      [0.2, 2.9, -10.0, 1.4, 7.8],
      [2.6, 4.5, -12.4, 1.8, 11.0],
      [4.9, 2.6, -9.5, 1.4, 7.0],
      [7.1, 3.6, -11.0, 1.6, 9.0],
    ];
    skylineBuildings.forEach(([bx, by, bz, bw, bh]) => {
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, bw),
        skylineMat
      );
      tower.position.set(bx, by - 1.5, bz);
      scene.add(tower);
    });

    // Left & Right Architectural Walls with warm Walnut Acoustic Slats
    const wallMat = new THREE.MeshStandardMaterial({
      color: "#F8FAFC",
      roughness: 0.8,
    });
    const leftWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 3.85, 9.6),
      wallMat
    );
    leftWall.position.set(-4.85, 1.925, -0.4);
    leftWall.receiveShadow = true;
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 3.85, 9.6),
      wallMat
    );
    rightWall.position.set(4.85, 1.925, -0.4);
    rightWall.receiveShadow = true;
    scene.add(rightWall);

    const walnutMat = new THREE.MeshStandardMaterial({
      map: walnutTex,
      roughness: 0.48,
      metalness: 0.05,
    });

    // Vertical walnut slats accent panels on both walls
    for (let sz = -3.8; sz <= 2.2; sz += 0.22) {
      const slatR = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 3.6, 0.1),
        walnutMat
      );
      slatR.position.set(4.74, 1.85, sz);
      scene.add(slatR);

      if (sz < -2.6 || sz > 0.3) {
        const slatL = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 3.6, 0.1),
          walnutMat
        );
        slatL.position.set(-4.74, 1.85, sz);
        scene.add(slatL);
      }
    }

    // --- Station 1: Central Glass Strategy Table (-0.85 Z) ---
    const tableGroup = new THREE.Group();
    tableGroup.position.set(0, 0, -0.85);
    scene.add(tableGroup);

    [-0.72, 0.72].forEach((px) => {
      const pedestal = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.72, 0.56),
        walnutMat
      );
      pedestal.position.set(px, 0.36, 0);
      pedestal.castShadow = true;
      pedestal.receiveShadow = true;
      tableGroup.add(pedestal);
    });

    const tableTopGlass = new THREE.Mesh(
      new THREE.BoxGeometry(2.25, 0.045, 1.05),
      new THREE.MeshPhysicalMaterial({
        color: "#E2E8F0",
        transparent: true,
        opacity: 0.62,
        roughness: 0.08,
        metalness: 0.1,
      })
    );
    tableTopGlass.position.y = 0.74;
    tableTopGlass.castShadow = true;
    tableGroup.add(tableTopGlass);

    // Embedded glowing holographic strategy pad on table center
    const tableHolo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 0.55),
      new THREE.MeshBasicMaterial({
        color: "#2563EB",
        transparent: true,
        opacity: 0.22,
      })
    );
    tableHolo.rotation.x = -Math.PI / 2;
    tableHolo.position.y = 0.766;
    tableGroup.add(tableHolo);

    // --- Station 2: CTO AI Architecture Holo-Wall (Left Wall -X) ---
    const ctoScreenTex = createHoloScreenTexture(
      "OPENCODE AI ARCHITECTURE TOPOLOGY",
      "CTO Telemetry · Multi-Cluster Latency & Model Routing",
      "#2563EB",
      [0.88, 0.74, 0.93, 0.81, 0.95, 0.79]
    );
    const ctoBoard = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.28, 2.25),
      new THREE.MeshStandardMaterial({ color: "#0F172A", roughness: 0.3 })
    );
    ctoBoard.position.set(-4.7, 1.82, -1.35);
    scene.add(ctoBoard);

    const ctoScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(2.14, 1.18),
      new THREE.MeshBasicMaterial({ map: ctoScreenTex })
    );
    ctoScreen.rotation.y = Math.PI / 2;
    ctoScreen.position.set(-4.65, 1.82, -1.35);
    scene.add(ctoScreen);

    // --- Station 3: CFO Capital & Forecast Station (Right Wall +X) ---
    const cfoScreenTex = createHoloScreenTexture(
      "CAPITAL ALLOCATION & EBITDA MODEL",
      "CFO Telemetry · Tranche Payback, Gross Margin & ARR",
      "#0D9488",
      [0.76, 0.84, 0.91, 0.75, 0.89, 0.94]
    );
    const cfoCredenza = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.68, 2.1),
      walnutMat
    );
    cfoCredenza.position.set(4.42, 0.34, -1.35);
    cfoCredenza.castShadow = true;
    scene.add(cfoCredenza);

    const cfoScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(2.05, 1.14),
      new THREE.MeshBasicMaterial({ map: cfoScreenTex })
    );
    cfoScreen.rotation.y = -Math.PI / 2;
    cfoScreen.position.set(4.68, 1.82, -1.35);
    scene.add(cfoScreen);

    // --- Station 4: Skyline Walk-and-Talk Promenade Planters (-3.75 Z) ---
    [-3.65, 3.65].forEach((px) => {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.22, 0.52, 18),
        new THREE.MeshStandardMaterial({ color: "#E7E5E4", roughness: 0.7 })
      );
      pot.position.set(px, 0.26, -3.75);
      pot.castShadow = true;
      scene.add(pot);

      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.05, 0.75, 8),
        walnutMat
      );
      trunk.position.set(px, 0.82, -3.75);
      scene.add(trunk);

      const foliage = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 16, 16),
        new THREE.MeshStandardMaterial({ color: "#3F6212", roughness: 0.8 })
      );
      foliage.scale.set(1.1, 0.88, 1.1);
      foliage.position.set(px, 1.32, -3.75);
      foliage.castShadow = true;
      scene.add(foliage);
    });

    // --- Station 5: Subtle CEO Foreground Command Desk Rail (+Z = 3.05) ---
    const ceoRail = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.05, 0.42),
      walnutMat
    );
    ceoRail.position.set(0, 0.82, 3.25);
    scene.add(ceoRail);

    // Subtle zone indicator discs on floor
    const zoneDiscs: Record<RoomZoneId, THREE.Mesh> = {} as Record<
      RoomZoneId,
      THREE.Mesh
    >;
    (Object.keys(ROOM_ZONES) as RoomZoneId[]).forEach((zId) => {
      const zone = ROOM_ZONES[zId];
      const disc = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.62, 48),
        new THREE.MeshBasicMaterial({
          color: "#94A3B8",
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
        })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(zone.center[0], 0.008, zone.center[2]);
      scene.add(disc);
      zoneDiscs[zId] = disc;
    });

    // Two reusable physical rigs, independent of the number and identities of members.
    const actors = [buildExecutiveAvatar(EXECUTIVES.CTO, 0.98), buildExecutiveAvatar(EXECUTIVES.CFO, 1.03)];
    for (const actor of actors) { actor.root.visible = false; scene.add(actor.root); }
    let lastPreset = '';

    // Dynamic luminous dialogue arc between active speaker & listener
    const arcPoints = Array.from(
      { length: 28 },
      () => new THREE.Vector3(0, 0.03, 0)
    );
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arcMat = new THREE.LineBasicMaterial({
      color: "#2563EB",
      transparent: true,
      opacity: 0,
    });
    const dialogueArc = new THREE.Line(arcGeo, arcMat);
    scene.add(dialogueArc);

    // Pick only a visible rig, then resolve its current participant.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const handlePointerDown = (ev: PointerEvent) => {
      pointerDownPos = { x: ev.clientX, y: ev.clientY };
    };

    const handlePointerUp = (ev: PointerEvent) => {
      const moved = Math.hypot(
        ev.clientX - pointerDownPos.x,
        ev.clientY - pointerDownPos.y
      );
      if (moved > 6) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const [hit] = raycaster.intersectObjects(actors.filter(a => a.root.visible).map(a => a.root), true);
      if (!hit) return;
      let root: THREE.Object3D | null = hit.object;
      while (root && root.parent !== scene) root = root.parent;
      const picked = actors[0].root === root ? live.current.speaker : live.current.listener;
      if (picked) live.current.onSelectExecutive(picked.id);
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);

    const phone = window.matchMedia('(max-width: 600px)');
    const applyTier = () => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone.matches ? 1.25 : 2));
      backGlass.visible = !phone.matches; // no full-screen transmission pass on phones
      tableTopGlass.material.transparent = !phone.matches;
      tableTopGlass.material.opacity = phone.matches ? 1 : 0.62;
      tableHolo.visible = !phone.matches;
      actors.forEach(actor => { actor.floorRing.visible = !phone.matches; });
    };
    applyTier(); phone.addEventListener('change', applyTier);
    // Observe the room itself: opening the dock can resize it without a window resize.
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(handleResize); observer.observe(container);

    // Smooth camera preset target vectors
    const desiredCamPos = new THREE.Vector3(0, 2.15, 4.95);
    const desiredCamTarget = new THREE.Vector3(0, 1.25, -0.95);
    let cameraTransitionFrames = 0;

    const clock = new THREE.Clock();
    const tempVec = new THREE.Vector3();
    let animFrameId = 0;

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      const { choreography: choreo, speaker, listener, selectedExecutive, cameraPreset: activePreset } = live.current;

      // Highlight active collaboration zone ring
      (Object.keys(zoneDiscs) as RoomZoneId[]).forEach((zId) => {
        zoneDiscs[zId].visible = !phone.matches || (!!speaker && choreo.roomZone === zId && choreo.interactionMode !== "idle");
        const mat = zoneDiscs[zId].material as THREE.MeshBasicMaterial;
        if (choreo.interactionMode !== "idle" && choreo.roomZone === zId) {
          mat.color.set(
            choreo.speaker
              ? accentOf(choreo.speaker)
              : "#2563EB"
          );
          mat.opacity = 0.55 + Math.sin(elapsed * 4) * 0.15;
        } else {
          mat.color.set("#94A3B8");
          mat.opacity = 0.18;
        }
      });

      const zone = ROOM_ZONES[choreo.roomZone];
      actors.forEach((av, index) => {
        const member = index === 0 ? speaker : listener;
        av.root.visible = !!member;
        if (!member) return;
        const role = member.id;
        av.targetPos.set(...(index === 0 ? zone.speakerSlot : zone.listenerSlot));
        if (listener) av.lookTarget.copy(actors[1-index].currentPos);
        else av.lookTarget.set(0, 1.55, 4.8); // the human CEO
        av.lookTarget.y = 1.55;
        const steerGoal = computeNextSteerPoint(av.currentPos, av.targetPos);
        const dx = steerGoal.x - av.currentPos.x;
        const dz = steerGoal.z - av.currentPos.z;
        const distToSteer = Math.hypot(dx, dz);
        const totalDist = av.currentPos.distanceTo(av.targetPos);

        const isSpeaking =
          choreo.speaker === role && Boolean(choreo.speechText);
        const isListening =
          choreo.listener === role && Boolean(choreo.speechText);

        if (totalDist > 0.06 && distToSteer > 0.03) {
          av.isWalking = true;
          const walkSpeed = 1.62;
          const step = Math.min(distToSteer, walkSpeed * dt);
          av.currentPos.x += (dx / distToSteer) * step;
          av.currentPos.z += (dz / distToSteer) * step;
          av.walkPhase += dt * 7.8;

          // Face walking direction smoothly
          const walkYaw = Math.atan2(dx, dz);
          let diff = walkYaw - av.currentYaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          av.currentYaw += diff * Math.min(1, dt * 8);

          // Realistic bipedal gait animation
          const s = Math.sin(av.walkPhase);
          const c = Math.cos(av.walkPhase);
          av.leftHip.rotation.x = s * 0.44;
          av.rightHip.rotation.x = -s * 0.44;
          av.leftKnee.rotation.x = Math.max(0, -c * 0.52);
          av.rightKnee.rotation.x = Math.max(0, c * 0.52);

          av.leftShoulder.rotation.x = -s * 0.32;
          av.rightShoulder.rotation.x = s * 0.32;
          av.leftElbow.rotation.x = -0.22;
          av.rightElbow.rotation.x = -0.22;

          av.pelvis.position.y = 0.92 + Math.abs(s) * 0.022;
          av.torso.rotation.y = s * 0.06;
          av.headGroup.rotation.y *= 0.85;
          av.headGroup.rotation.x = 0;
        } else {
          av.isWalking = false;
          // Face conversational partner or CEO
          const lookDx = av.lookTarget.x - av.currentPos.x;
          const lookDz = av.lookTarget.z - av.currentPos.z;
          const desiredYaw = Math.atan2(lookDx, lookDz);
          let diff = desiredYaw - av.currentYaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          av.currentYaw += diff * Math.min(1, dt * 6.5);

          // Relax legs & add subtle breathing
          av.leftHip.rotation.x *= 0.84;
          av.rightHip.rotation.x *= 0.84;
          av.leftKnee.rotation.x *= 0.84;
          av.rightKnee.rotation.x *= 0.84;
          av.pelvis.position.y =
            0.92 + Math.sin(elapsed * 1.9 + av.walkPhase) * 0.006;

          if (isSpeaking) {
            // Expressive C-suite hand gestures while speaking
            av.leftShoulder.rotation.x =
              -0.38 + Math.sin(elapsed * 4.2) * 0.16;
            av.rightShoulder.rotation.x =
              -0.44 + Math.cos(elapsed * 3.7) * 0.18;
            av.leftShoulder.rotation.z =
              0.12 + Math.sin(elapsed * 2.8) * 0.06;
            av.rightShoulder.rotation.z =
              -0.12 - Math.cos(elapsed * 3.1) * 0.06;
            av.leftElbow.rotation.x = -0.68 + Math.sin(elapsed * 4.5) * 0.15;
            av.rightElbow.rotation.x = -0.74 + Math.cos(elapsed * 4.1) * 0.15;

            av.torso.rotation.y = Math.sin(elapsed * 1.8) * 0.05;
            av.headGroup.rotation.y = Math.sin(elapsed * 2.1) * 0.09;
            av.headGroup.rotation.x = Math.sin(elapsed * 3.4) * 0.04;
          } else if (isListening) {
            // Attentive executive posture & periodic affirmative nod
            av.leftShoulder.rotation.x *= 0.88;
            av.rightShoulder.rotation.x = -0.18;
            av.leftElbow.rotation.x = -0.18;
            av.rightElbow.rotation.x = -0.45;
            av.leftShoulder.rotation.z *= 0.88;
            av.rightShoulder.rotation.z *= 0.88;
            av.headGroup.rotation.x = Math.sin(elapsed * 2.7) * 0.055;
            av.headGroup.rotation.y = Math.sin(elapsed * 1.1) * 0.04;
          } else {
            av.leftShoulder.rotation.x *= 0.88;
            av.rightShoulder.rotation.x *= 0.88;
            av.leftShoulder.rotation.z *= 0.88;
            av.rightShoulder.rotation.z *= 0.88;
            av.leftElbow.rotation.x = -0.12;
            av.rightElbow.rotation.x = -0.12;
            av.torso.rotation.y *= 0.9;
            av.headGroup.rotation.y =
              Math.sin(elapsed * 0.8 + av.walkPhase) * 0.05;
            av.headGroup.rotation.x *= 0.9;
          }
        }

        // Articulated mouth lip-sync envelope when speaking
        if (isSpeaking) {
          const syllable =
            0.8 +
            Math.abs(Math.sin(elapsed * 13.5)) * 1.5 +
            Math.abs(Math.cos(elapsed * 8.3)) * 0.9;
          av.mouth.scale.y = syllable;
          av.ringMaterial.opacity = 0.72 + Math.sin(elapsed * 6) * 0.2;
          av.floorRing.scale.setScalar(1.08 + Math.sin(elapsed * 5) * 0.06);
        } else {
          av.mouth.scale.y = 1;
          const isSelected = selectedExecutive === role;
          av.ringMaterial.opacity = isSelected
            ? 0.65
            : av.isWalking
            ? 0.48
            : 0.28;
          av.floorRing.scale.setScalar(isSelected ? 1.08 : 1.0);
        }

        av.root.position.copy(av.currentPos);
        av.root.rotation.y = av.currentYaw;
      });

      // Update floor connection arc between active speaker & listener
      dialogueArc.visible = !phone.matches && !!speaker && !!listener;
      if (dialogueArc.visible && speaker && listener) {
        const spPos = actors[0].currentPos;
        const liPos = actors[1].currentPos;
        const posAttr = dialogueArc.geometry.attributes
          .position as THREE.BufferAttribute;
        for (let i = 0; i < 28; i++) {
          const t = i / 27;
          const x = THREE.MathUtils.lerp(spPos.x, liPos.x, t);
          const z = THREE.MathUtils.lerp(spPos.z, liPos.z, t);
          const archY = 0.04 + Math.sin(t * Math.PI) * 0.22;
          posAttr.setXYZ(i, x, archY, z);
        }
        posAttr.needsUpdate = true;
        arcMat.color.set(accentOf(speaker.id));
        arcMat.opacity = 0.65;
      } else {
        arcMat.opacity = 0;
      }

      // Camera Preset Transitions
      const presetKey = `${activePreset}-${choreo.roomZone}-${choreo.speaker || "none"}`;
      if (presetKey !== lastPreset) {
        lastPreset = presetKey;
        cameraTransitionFrames = 55;
      }


      if (activePreset === "ceo-pov") {
        desiredCamPos.set(0, 2.05, 4.85);
        desiredCamTarget.set(0, 1.3, -0.95);
      } else if (activePreset === "boardroom-overview") {
        desiredCamPos.set(3.85, 3.35, 5.15);
        desiredCamTarget.set(0, 1.05, -1.15);
      } else if (activePreset === "follow-huddle") {
        const zCenter = ROOM_ZONES[choreo.roomZone]?.center || [0, 0, -0.85];
        desiredCamPos.set(zCenter[0] * 0.55, 2.15, zCenter[2] + 3.85);
        desiredCamTarget.set(zCenter[0], 1.32, zCenter[2]);
      } else if (activePreset.startsWith("focus-")) {
        const focusId = activePreset.slice('focus-'.length);
        const focusAv = focusId === speaker?.id ? actors[0] : focusId === listener?.id ? actors[1] : null;
        if (focusAv) {
        desiredCamPos.set(
          focusAv.currentPos.x * 0.75,
          1.92,
          focusAv.currentPos.z + 2.85
        );
        desiredCamTarget.set(
          focusAv.currentPos.x,
          1.38,
          focusAv.currentPos.z
        );
        } else { desiredCamPos.set(3.85, 3.35, 5.15); desiredCamTarget.set(0, 1.05, -1.15); }
      }

      if (
        cameraTransitionFrames > 0 ||
        activePreset === "follow-huddle" ||
        activePreset.startsWith("focus-")
      ) {
        const factor = cameraTransitionFrames > 0 ? 0.065 : 0.03;
        camera.position.lerp(desiredCamPos, factor);
        controls.target.lerp(desiredCamTarget, factor);
        if (cameraTransitionFrames > 0) cameraTransitionFrames--;
      }

      controls.update();
      renderer.render(scene, camera);

      // --- Project 3D Executive Head Anchors to 2D Screen Overlay ---
      const cw = container.clientWidth || width;
      const ch = container.clientHeight || height;

      actors.forEach((av, index) => {
        const role = (index === 0 ? speaker : listener)?.id;
        if (!role) return;
        const badgeEl = badgeRefs.current[index];
        const statusEl = statusTextRefs.current[index];
        if (badgeEl) {
          tempVec.set(
            av.currentPos.x,
            1.88 * av.heightScale,
            av.currentPos.z
          );
          tempVec.project(camera);
          const x = (tempVec.x * 0.5 + 0.5) * cw;
          const y = (-tempVec.y * 0.5 + 0.5) * ch;
          const visible = tempVec.z < 1 && x > -80 && x < cw + 80;
          badgeEl.style.visibility = visible ? "visible" : "hidden";
          badgeEl.style.transform = `translate3d(${Math.round(
            x
          )}px, ${Math.round(y)}px, 0) translate(-50%, -100%)`;
        }

        if (statusEl) {
          if (av.isWalking) {
            statusEl.textContent = `Walking · ${zone.label}`;
          } else if (choreo.speaker === role && choreo.speechText) {
            statusEl.textContent =
              choreo.listener === "CEO"
                ? "Briefing CEO"
                : `Talking to ${listener?.roleName}`;
          } else if (choreo.listener === role && choreo.speechText) {
            statusEl.textContent = `Listening to ${speaker?.roleName}`;
          } else {
            statusEl.textContent = "Standing Ready";
          }
        }
      });

      // Project live speech bubble above active speaker
      const bubbleEl = bubbleRef.current;
      if (bubbleEl) {
        if (speaker && choreo.speechText) {
          const spAv = actors[0];
          tempVec.set(
            spAv.currentPos.x,
            2.18 * spAv.heightScale,
            spAv.currentPos.z
          );
          tempVec.project(camera);
          const bx = Math.min(
            cw - 190,
            Math.max(190, (tempVec.x * 0.5 + 0.5) * cw)
          );
          const by = Math.max(88, (-tempVec.y * 0.5 + 0.5) * ch - 34);
          bubbleEl.style.opacity = tempVec.z < 1 ? "1" : "0";
          bubbleEl.style.transform = `translate3d(${Math.round(
            bx
          )}px, ${Math.round(by)}px, 0) translate(-50%, -100%)`;
        } else {
          bubbleEl.style.opacity = "0";
        }
      }

      // Project floating knowledge enrichment indicator
      const sparkEl = sparkRef.current;
      if (sparkEl) {
        if (speaker && choreo.latestInsightTopic) {
          const spAv = actors[0];
          tempVec.set(spAv.currentPos.x, 1.25, spAv.currentPos.z);
          tempVec.project(camera);
          const sx = Math.min(
            cw - 160,
            Math.max(160, (tempVec.x * 0.5 + 0.5) * cw)
          );
          const sy = Math.min(ch - 140, (-tempVec.y * 0.5 + 0.5) * ch + 28);
          sparkEl.style.transform = `translate3d(${Math.round(
            sx
          )}px, ${Math.round(sy)}px, 0) translate(-50%, 0)`;
        }
      }
    };

    animate();

    return () => {
      cancelAnimationFrame(animFrameId);
      observer.disconnect(); phone.removeEventListener('change', applyTier);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      controls.dispose();
      envRT.dispose();
      roomEnv.dispose();
      pmrem.dispose();
      floorTex.dispose();
      walnutTex.dispose();
      ctoScreenTex.dispose();
      cfoScreenTex.dispose();
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          geometries.add(obj.geometry);
          for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(m);
        }
      });
      geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose());
      sunLight.shadow.dispose(); renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden select-none">
      {/* 3D WebGL Mount */}
      <div ref={mountRef} className="h-full w-full cursor-grab active:cursor-grabbing" />

      {/* Projected 3D Executive Nameplates */}
      {[speaker, listener].map((member, index) => {
        if (!member) return null;
        const role = member.id, isSelected = selectedExecutive === role;
        const isSpeaking = index === 0 && !!choreography.speechText;
        const shortModel = member.model.replace(/^opencode\//i, '').slice(0, 22);
        return (
          <button type="button" aria-label={`View ${member.displayName}, ${member.job} (${member.roleName})`}
            data-onstage={role} key={role} ref={el => { badgeRefs.current[index] = el; }} onClick={() => onSelectExecutive(role)}
            style={{ willChange: "transform, opacity", left: 0, top: 0 }}
            className={`pointer-events-auto absolute z-10 cursor-pointer rounded-xl border px-2.5 py-1.5 backdrop-blur-md transition-shadow duration-200 ${
              isSpeaking
                ? "bg-white/95 shadow-lg ring-2"
                : isSelected
                ? "bg-white/95 shadow-md"
                : "bg-white/82 shadow-sm hover:bg-white/95"
            }`}
          >
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: accentOf(role) }}
              />
              <span
                className="max-w-32 truncate text-[11px] font-bold tracking-wide uppercase"
                style={{ color: accentOf(role) }}
              >
                {member.roleName}
              </span>
              <span className="max-w-36 truncate text-xs font-semibold text-slate-900">
                {member.displayName}
              </span>
            </span>
            <span className="block max-w-48 truncate text-left text-[10px] text-slate-600">{member.job}</span>
            <span className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-slate-500">
              <span
                ref={(el) => {
                  statusTextRefs.current[index] = el;
                }}
                className="font-medium text-slate-600"
              >
                Standing Ready
              </span>
              <span className="rounded bg-slate-100 px-1 py-0.2 font-mono text-[9px] text-slate-500">
                {shortModel}
              </span>
            </span>
          </button>
        );
      })}

      {/* Projected 3D Live Speech Bubble */}
      <div
        ref={bubbleRef}
        style={{
          willChange: "transform, opacity",
          left: 0,
          top: 0,
          opacity: 0,
          borderColor: speaker ? accentOf(speaker.id) : "#CBD5E1",
        }}
        className="pointer-events-none absolute z-20 w-[340px] max-w-[86vw] rounded-2xl border-2 bg-white/95 p-3.5 shadow-xl backdrop-blur-md transition-opacity duration-200"
      >
        {speaker && choreography.speechText && (
          <>
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
                  style={{ backgroundColor: accentOf(speaker.id) }}
                >
                  {speaker.roleName} → {listener?.roleName || "CEO"}
                </span>
                <span className="max-w-32 truncate text-xs font-semibold text-slate-800">
                  {speaker.displayName}
                </span>
              </div>
              <span className="text-[10px] font-medium text-slate-400">
                {ROOM_ZONES[choreography.roomZone]?.label}
              </span>
            </div>
            <p className="line-clamp-4 text-xs leading-relaxed text-slate-700">
              “{choreography.speechText}”
            </p>
          </>
        )}
      </div>

      {/* Projected Knowledge Enrichment Pill */}
      <div
        ref={sparkRef}
        style={{
          willChange: "transform",
          left: 0,
          top: 0,
        }}
        className={`pointer-events-none absolute z-20 transition-opacity duration-300 ${
          speaker && choreography.latestInsightTopic ? "opacity-100" : "opacity-0"
        }`}
      >
        {speaker && choreography.latestInsightTopic && (
          <div className="flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-950/90 px-3 py-1 text-[11px] font-medium text-blue-50 shadow-lg backdrop-blur">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            <span>DB Enriched:</span>
            <span className="max-w-[210px] truncate font-semibold text-white">
              {choreography.latestInsightTopic}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
