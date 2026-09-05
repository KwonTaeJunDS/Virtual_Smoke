"use client";

import { useInteractionStore } from "./lib/store";
import type { FaceAnalysis, HandAnalysis, Point3 } from "./lib/types";

function metric(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

export function DebugOverlay() {
  const state = useInteractionStore();
  if (!state.debugMode) return null;

  return (
    <aside className="debug-panel" aria-label="Tracking debug information">
      <div className="debug-heading">
        <span>TRACKING LAB</span>
        <b>{Math.round(state.fps)} FPS</b>
      </div>
      <dl>
        <dt>TRACKING</dt><dd>{state.delegate} / {state.trackingStatus}</dd>
        <dt>FACE / HAND GPU</dt><dd>{state.faceGpuContext} / {state.handGpuContext}</dd>
        <dt>WEBGL</dt><dd>{state.webglVersion} / {state.gpuAccelerated ? "HW" : "SW"}</dd>
        <dt>GPU</dt><dd className="debug-gpu-name">{state.gpuRenderer}</dd>
        <dt>WORST / P95 FRAME</dt><dd>{metric(state.worstFrameMs, 1)} / {metric(state.p95FrameMs, 1)}ms</dd>
        <dt>INPUT LATENCY</dt><dd>{metric(state.inputLatencyMs, 1)}ms</dd>
        <dt>HAND / FACE AI</dt><dd>{metric(state.handInferenceMs, 1)} / {metric(state.faceInferenceMs, 1)}ms</dd>
        <dt>FACE / HAND</dt><dd>{state.faceVisible ? "ON" : "LOST"} / {state.handVisible ? "ON" : "LOST"}</dd>
        <dt>HAND STATE</dt><dd>{state.handState}</dd>
        <dt>MOUTH STATE</dt><dd>{state.mouthState}</dd>
        <dt>CIGARETTE</dt><dd>{state.cigaretteState}</dd>
        <dt>SMOKING</dt><dd>{state.smokingState}</dd>
        <dt>MOUTH OPEN</dt><dd>{metric(state.mouthOpenRatio)}</dd>
        <dt>MOUTH WIDTH</dt><dd>{metric(state.mouthWidthRatio)}</dd>
        <dt>PUCKER</dt><dd>{state.mouthPursed ? "ON" : "OFF"}</dd>
        <dt>BURN</dt><dd>{Math.round(state.cigaretteBurn * 100)}%</dd>
        <dt>INHALE</dt><dd>{metric(state.inhaleSeconds, 1)}s</dd>
        <dt>SMOKE READY</dt><dd>{state.smokeReady ? `${metric(state.smokeReadySeconds, 1)}s` : "NO"}</dd>
        <dt>BURSTS M/N</dt><dd>{state.mouthBurstCount} / {state.noseBurstCount}</dd>
        <dt>TIP SMOKE</dt><dd>{state.baseSmokeParticles}</dd>
        <dt>GPU POINTS</dt><dd>{state.particleDrawCount}</dd>
        <dt>PINCH</dt><dd>{metric(state.pinchDistance)}</dd>
        <dt>PARTICLES</dt><dd>{state.particleQuality}</dd>
      </dl>
      <p>Press D to close</p>
    </aside>
  );
}

function createMapper(width: number, height: number, videoWidth: number, videoHeight: number) {
  const videoAspect = videoWidth / videoHeight;
  const viewportAspect = width / height;
  let displayedWidth: number;
  let displayedHeight: number;
  let cropX = 0;
  let cropY = 0;
  if (viewportAspect > videoAspect) {
    displayedWidth = width;
    displayedHeight = width / videoAspect;
    cropY = (displayedHeight - height) * 0.5;
  } else {
    displayedHeight = height;
    displayedWidth = height * videoAspect;
    cropX = (displayedWidth - width) * 0.5;
  }
  return (point: Point3) => ({ x: point.x * displayedWidth - cropX, y: point.y * displayedHeight - cropY });
}

export function drawTrackingDebug(
  canvas: HTMLCanvasElement,
  face: FaceAnalysis,
  hands: HandAnalysis[],
  videoWidth: number,
  videoHeight: number,
  enabled: boolean,
) {
  if (!enabled) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  const map = createMapper(width, height, Math.max(1, videoWidth), Math.max(1, videoHeight));

  if (face.visible) {
    context.fillStyle = "rgba(255, 133, 57, .48)";
    for (let index = 0; index < face.landmarks.length; index += 2) {
      const point = map(face.landmarks[index]);
      context.fillRect(point.x - 0.8, point.y - 0.8, 1.6, 1.6);
    }
  }

  context.strokeStyle = "rgba(127, 238, 255, .72)";
  context.lineWidth = 1.2;
  for (const hand of hands) {
    context.beginPath();
    for (const landmark of hand.landmarks) {
      const point = map(landmark);
      context.moveTo(point.x + 2.3, point.y);
      context.arc(point.x, point.y, 2.3, 0, Math.PI * 2);
    }
    context.stroke();
  }
}
