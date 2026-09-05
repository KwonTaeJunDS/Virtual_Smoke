import { create } from "zustand";
import type { CigaretteState, HandState, MouthState, SmokingState } from "./types";

export interface RuntimeDebugState {
  debugMode: boolean;
  fps: number;
  faceVisible: boolean;
  handVisible: boolean;
  handState: HandState;
  mouthState: MouthState;
  cigaretteState: CigaretteState;
  smokingState: SmokingState;
  mouthOpenRatio: number;
  mouthWidthRatio: number;
  mouthPursed: boolean;
  cigaretteBurn: number;
  inhaleSeconds: number;
  smokeReady: boolean;
  smokeReadySeconds: number;
  mouthBurstCount: number;
  noseBurstCount: number;
  baseSmokeParticles: number;
  particleDrawCount: number;
  pinchDistance: number;
  worstFrameMs: number;
  p95FrameMs: number;
  inputLatencyMs: number;
  handInferenceMs: number;
  faceInferenceMs: number;
  delegate: "GPU" | "CPU";
  trackingStatus: "INITIALIZING" | "READY" | "ERROR";
  faceGpuContext: string;
  handGpuContext: string;
  webglVersion: "WEBGL2" | "WEBGL1" | "UNAVAILABLE";
  gpuRenderer: string;
  gpuVendor: string;
  gpuAccelerated: boolean;
  particleQuality: "HIGH" | "MEDIUM" | "LOW";
  toggleDebug: () => void;
  updateRuntime: (patch: Partial<Omit<RuntimeDebugState, "toggleDebug" | "updateRuntime">>) => void;
}

export const useInteractionStore = create<RuntimeDebugState>((set) => ({
  debugMode: false,
  fps: 0,
  faceVisible: false,
  handVisible: false,
  handState: "NONE",
  mouthState: "CLOSED",
  cigaretteState: "IDLE",
  smokingState: "IDLE",
  mouthOpenRatio: 0,
  mouthWidthRatio: 0,
  mouthPursed: false,
  cigaretteBurn: 0,
  inhaleSeconds: 0,
  smokeReady: false,
  smokeReadySeconds: 0,
  mouthBurstCount: 0,
  noseBurstCount: 0,
  baseSmokeParticles: 0,
  particleDrawCount: 0,
  pinchDistance: 0,
  worstFrameMs: 0,
  p95FrameMs: 0,
  inputLatencyMs: 0,
  handInferenceMs: 0,
  faceInferenceMs: 0,
  delegate: "GPU",
  trackingStatus: "INITIALIZING",
  faceGpuContext: "PENDING",
  handGpuContext: "PENDING",
  webglVersion: "UNAVAILABLE",
  gpuRenderer: "INITIALIZING",
  gpuVendor: "UNKNOWN",
  gpuAccelerated: false,
  particleQuality: "HIGH",
  toggleDebug: () => set((state) => ({ debugMode: !state.debugMode })),
  updateRuntime: (patch) => set(patch),
}));
