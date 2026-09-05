"use client";

import { useEffect, useRef, useState } from "react";
import { DebugOverlay, drawTrackingDebug } from "./debug-overlay";
import { FaceAnalyzer, HandAnalyzer } from "./lib/analyzers";
import { InteractionEngine } from "./lib/interaction-engine";
import { SmokeRenderer } from "./lib/smoke-renderer";
import { useInteractionStore } from "./lib/store";
import type { FaceAnalysis, HandAnalysis, TrackingFrame } from "./lib/types";
import { VisionTracker } from "./lib/vision-tracker";

export function SmokingExperience() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const renderCanvasRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraState, setCameraState] = useState<"loading" | "ready" | "denied">("loading");

  useEffect(() => {
    const video = videoRef.current;
    const renderCanvas = renderCanvasRef.current;
    const debugCanvas = debugCanvasRef.current;
    if (!video || !renderCanvas || !debugCanvas) return;

    let stream: MediaStream | undefined;
    let tracker: VisionTracker | undefined;
    let visual: SmokeRenderer | undefined;
    let engine: InteractionEngine | undefined;
    let animationFrame = 0;
    let videoFrameCallback = 0;
    let trackingFallbackFrame = 0;
    let running = true;
    let delegate: "GPU" | "CPU" = "GPU";
    const faceAnalyzer = new FaceAnalyzer();
    const handAnalyzer = new HandAnalyzer();
    let face: FaceAnalysis = faceAnalyzer.analyze(undefined, performance.now(), 0);
    let hands: HandAnalysis[] = [];
    let latestTracking: TrackingFrame | null = null;
    let appliedTracking: TrackingFrame | null = null;
    let appliedHandRevision = 0;
    let appliedFaceRevision = 0;
    let lastFaceTrackingAt = performance.now();
    let lastFrameAt = performance.now();
    let fpsWindowAt = lastFrameAt;
    let renderedFrames = 0;
    let fps = 60;
    let inputLatencyMs = 0;
    let handInferenceMs = 0;
    let faceInferenceMs = 0;
    const frameTimes: number[] = [];
    const handleKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "d" || event.repeat) return;
      const store = useInteractionStore.getState();
      const wasEnabled = store.debugMode;
      store.toggleDebug();
      if (wasEnabled) debugCanvas.getContext("2d")?.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    };

    const resize = () => visual?.resize(
      window.innerWidth,
      window.innerHeight,
      video.videoWidth || 1920,
      video.videoHeight || 1080,
    );

    const processLatestCameraFrame = (sourceTimestamp: number) => {
      if (!running || !tracker) return;
      const tracking = tracker.processLatest(video, sourceTimestamp);
      if (tracking) latestTracking = tracking;
    };

    const scheduleTracking = () => {
      if (!running || !tracker) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        videoFrameCallback = video.requestVideoFrameCallback((now, metadata) => {
          const timedMetadata = metadata as VideoFrameCallbackMetadata & { captureTime?: number };
          processLatestCameraFrame(timedMetadata.captureTime ?? metadata.presentationTime ?? now);
          scheduleTracking();
        });
      } else {
        trackingFallbackFrame = requestAnimationFrame((now) => {
          processLatestCameraFrame(now);
          scheduleTracking();
        });
      }
    };

    window.addEventListener("keydown", handleKey);
    window.addEventListener("resize", resize);

    try {
      // Start WebGL immediately. The cigarette remains visible while camera
      // permission and MediaPipe models initialize, or even if tracking fails.
      visual = new SmokeRenderer(renderCanvas);
      const rendererInfo = visual.getDiagnostics();
      renderCanvas.dataset.webglVersion = rendererInfo.webglVersion;
      renderCanvas.dataset.gpuRenderer = rendererInfo.renderer;
      renderCanvas.dataset.gpuVendor = rendererInfo.vendor;
      renderCanvas.dataset.gpuAccelerated = String(rendererInfo.hardwareAccelerated);
      renderCanvas.dataset.trackingSchedule = "LATEST_FRAME";
      delete renderCanvas.dataset.frameAlphaBounds;
      useInteractionStore.getState().updateRuntime({
        webglVersion: rendererInfo.webglVersion,
        gpuRenderer: rendererInfo.renderer,
        gpuVendor: rendererInfo.vendor,
        gpuAccelerated: rendererInfo.hardwareAccelerated,
      });
      engine = new InteractionEngine((emission) => visual?.emit(emission));
      resize();
    } catch (error) {
      useInteractionStore.getState().updateRuntime({
        webglVersion: "UNAVAILABLE",
        gpuRenderer: "WEBGL INITIALIZATION FAILED",
        gpuAccelerated: false,
        trackingStatus: "ERROR",
      });
      console.error("WebGL renderer initialization failed", error);
    }

    const loop = (now: number) => {
      if (!running || !visual || !engine) return;
      const frameTimeMs = Math.max(0.1, now - lastFrameAt);
      const dt = Math.min(0.05, Math.max(0.001, frameTimeMs / 1000));
      lastFrameAt = now;
      frameTimes.push(frameTimeMs);
      if (frameTimes.length > 240) frameTimes.shift();
      renderedFrames += 1;

      let appliedThisFrame: TrackingFrame | null = null;
      if (latestTracking && latestTracking !== appliedTracking) {
        const debugMode = useInteractionStore.getState().debugMode;
        if (latestTracking.handRevision !== appliedHandRevision) {
          hands = handAnalyzer.analyze(latestTracking.handLandmarks, latestTracking.handedness, debugMode);
          appliedHandRevision = latestTracking.handRevision;
          if (latestTracking.handInferenceMs > 0) handInferenceMs = latestTracking.handInferenceMs;
        }
        if (latestTracking.faceRevision !== appliedFaceRevision) {
          const trackingDt = Math.min(0.08, Math.max(0.001, (latestTracking.completedAt - lastFaceTrackingAt) / 1000));
          face = faceAnalyzer.analyze(latestTracking.faceLandmarks[0], latestTracking.completedAt, trackingDt, debugMode);
          lastFaceTrackingAt = latestTracking.completedAt;
          appliedFaceRevision = latestTracking.faceRevision;
          if (latestTracking.faceInferenceMs > 0) faceInferenceMs = latestTracking.faceInferenceMs;
        }
        appliedTracking = latestTracking;
        if (latestTracking.updatedTask === "HAND") appliedThisFrame = latestTracking;
      }

      const snapshot = engine.update(face, hands, now, dt, delegate);
      visual.update(snapshot, face, now, dt, fps);
      if (appliedThisFrame) inputLatencyMs = Math.max(0, performance.now() - appliedThisFrame.sourceTimestamp);

      const debugMode = useInteractionStore.getState().debugMode;
      if (debugMode) {
        drawTrackingDebug(
          debugCanvas,
          face,
          hands,
          video.videoWidth || 1920,
          video.videoHeight || 1080,
          true,
        );
      }

      if (now - fpsWindowAt >= 500) {
        fps = renderedFrames * 1000 / (now - fpsWindowAt);
        const sortedFrameTimes = [...frameTimes].sort((a, b) => a - b);
        const worstFrameMs = sortedFrameTimes.at(-1) ?? 0;
        const p95FrameMs = sortedFrameTimes[Math.min(sortedFrameTimes.length - 1, Math.floor(sortedFrameTimes.length * 0.95))] ?? 0;
        renderedFrames = 0;
        fpsWindowAt = now;
        renderCanvas.dataset.fps = fps.toFixed(1);
        renderCanvas.dataset.worstFrameMs = worstFrameMs.toFixed(1);
        renderCanvas.dataset.p95FrameMs = p95FrameMs.toFixed(1);
        renderCanvas.dataset.inputLatencyMs = inputLatencyMs.toFixed(1);
        renderCanvas.dataset.handInferenceMs = handInferenceMs.toFixed(1);
        renderCanvas.dataset.faceInferenceMs = faceInferenceMs.toFixed(1);
        if (debugMode) {
          useInteractionStore.getState().updateRuntime({
            fps,
            worstFrameMs,
            p95FrameMs,
            inputLatencyMs,
            handInferenceMs,
            faceInferenceMs,
          });
        }
      }
      animationFrame = requestAnimationFrame(loop);
    };
    animationFrame = requestAnimationFrame(loop);

    const startCameraAndTracking = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 60, min: 30 },
            facingMode: "user",
          },
        });
        if (!running) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        setCameraState("ready");
        resize();
      } catch {
        if (running) setCameraState("denied");
        return;
      }

      tracker = new VisionTracker();
      try {
        delegate = await tracker.initialize();
        if (!running) {
          tracker.close();
          return;
        }
        const trackerInfo = tracker.getDiagnostics();
        renderCanvas.dataset.trackingDelegate = trackerInfo.delegate;
        renderCanvas.dataset.faceGpuContext = trackerInfo.faceContext;
        renderCanvas.dataset.handGpuContext = trackerInfo.handContext;
        renderCanvas.dataset.trackingSchedule = "LATEST_FRAME";
        useInteractionStore.getState().updateRuntime({
          delegate: trackerInfo.delegate,
          trackingStatus: "READY",
          faceGpuContext: trackerInfo.faceContext,
          handGpuContext: trackerInfo.handContext,
        });
        scheduleTracking();
      } catch (error) {
        useInteractionStore.getState().updateRuntime({ trackingStatus: "ERROR" });
        console.error("MediaPipe tracking initialization failed", error);
      }
    };
    void startCameraAndTracking();

    return () => {
      running = false;
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrame);
      if (videoFrameCallback) video.cancelVideoFrameCallback(videoFrameCallback);
      if (trackingFallbackFrame) cancelAnimationFrame(trackingFallbackFrame);
      tracker?.close();
      visual?.dispose();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <main className="experience" data-camera={cameraState}>
      <video ref={videoRef} className="camera" aria-label="Mirrored webcam view" autoPlay muted playsInline />
      <canvas ref={renderCanvasRef} className="render-canvas" aria-hidden="true" />
      <canvas ref={debugCanvasRef} className="debug-canvas" aria-hidden="true" />
      <p className="sr-only" aria-live="polite">
        {cameraState === "ready" ? "Virtual cigarette interaction is active." : cameraState === "denied" ? "Camera access is required." : "Preparing camera."}
      </p>
      <DebugOverlay />
    </main>
  );
}
