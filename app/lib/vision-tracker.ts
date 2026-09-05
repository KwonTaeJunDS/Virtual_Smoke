import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  type FaceLandmarkerResult,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { Point3, TrackingFrame } from "./types";

const WASM_PATH = "/mediapipe/wasm";
const FACE_MODEL = "/mediapipe/models/face_landmarker.task";
const HAND_MODEL = "/mediapipe/models/hand_landmarker.task";

export interface VisionDiagnostics {
  delegate: "GPU" | "CPU";
  faceContext: "WEBGL2" | "WEBGL1" | "NONE";
  handContext: "WEBGL2" | "WEBGL1" | "NONE";
}

export class VisionTracker {
  private face?: FaceLandmarker;
  private hands?: HandLandmarker;
  private lastVideoTime = -1;
  private inferenceInFlight = false;
  private scheduleIndex = 0;
  private latestFaceLandmarks: Point3[][] = [];
  private latestHandLandmarks: Point3[][] = [];
  private latestHandedness: string[] = [];
  private handRevision = 0;
  private faceRevision = 0;
  private delegate: "GPU" | "CPU" = "GPU";
  private faceCanvas?: HTMLCanvasElement;
  private handCanvas?: HTMLCanvasElement;

  async initialize() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    try {
      await this.createTasks(fileset, "GPU");
      this.delegate = "GPU";
    } catch {
      this.face?.close();
      this.hands?.close();
      await this.createTasks(fileset, "CPU");
      this.delegate = "CPU";
    }
    return this.delegate;
  }

  private async createTasks(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: "GPU" | "CPU") {
    const faceCanvas = document.createElement("canvas");
    const handCanvas = document.createElement("canvas");
    [faceCanvas, handCanvas].forEach((canvas) => {
      canvas.width = 640;
      canvas.height = 360;
    });

    const gpuFaceOptions = delegate === "GPU" ? { canvas: faceCanvas } : {};
    const gpuHandOptions = delegate === "GPU" ? { canvas: handCanvas } : {};
    [this.face, this.hands] = await Promise.all([
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.58,
        minFacePresenceConfidence: 0.58,
        minTrackingConfidence: 0.55,
        // Both optional heads add work we do not consume. Mouth expression and
        // head pose are derived from landmarks, keeping the active model path on
        // the GPU delegate and avoiding the blendshape XNNPACK CPU subgraph.
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
        ...gpuFaceOptions,
      }),
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate },
        runningMode: "VIDEO",
        // One cigarette only needs the closest active hand. The removed cheek
        // gesture was the sole reason to keep a second hand in the model.
        numHands: 1,
        minHandDetectionConfidence: 0.52,
        minHandPresenceConfidence: 0.52,
        minTrackingConfidence: 0.5,
        ...gpuHandOptions,
      }),
    ]);
    this.faceCanvas = delegate === "GPU" ? faceCanvas : undefined;
    this.handCanvas = delegate === "GPU" ? handCanvas : undefined;
  }

  getDiagnostics(): VisionDiagnostics {
    return {
      delegate: this.delegate,
      faceContext: this.contextKind(this.faceCanvas),
      handContext: this.contextKind(this.handCanvas),
    };
  }

  private contextKind(canvas?: HTMLCanvasElement): "WEBGL2" | "WEBGL1" | "NONE" {
    if (!canvas) return "NONE";
    if (canvas.getContext("webgl2")) return "WEBGL2";
    if (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) return "WEBGL1";
    return "NONE";
  }

  processLatest(video: HTMLVideoElement, sourceTimestamp: number): TrackingFrame | null {
    if (!this.face || !this.hands || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    if (this.inferenceInFlight) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    this.inferenceInFlight = true;

    try {
      // Only one model runs for each newest camera frame. A HAND, HAND, FACE
      // schedule keeps hand input on the critical path without queuing frames.
      const inferenceTimestamp = performance.now();
      const updatedTask = this.scheduleIndex === 2 ? "FACE" : "HAND";
      this.scheduleIndex = (this.scheduleIndex + 1) % 3;
      let handInferenceMs = 0;
      let faceInferenceMs = 0;

      if (updatedTask === "HAND") {
        const startedAt = performance.now();
        const handResult: HandLandmarkerResult = this.hands.detectForVideo(video, inferenceTimestamp);
        handInferenceMs = performance.now() - startedAt;
        this.latestHandLandmarks = handResult.landmarks as Point3[][];
        this.latestHandedness = handResult.handedness.map((categories) => categories[0]?.categoryName ?? "Hand");
        this.handRevision += 1;
      } else {
        const startedAt = performance.now();
        const faceResult: FaceLandmarkerResult = this.face.detectForVideo(video, inferenceTimestamp);
        faceInferenceMs = performance.now() - startedAt;
        this.latestFaceLandmarks = faceResult.faceLandmarks as Point3[][];
        this.faceRevision += 1;
      }

      const completedAt = performance.now();
      const sourceAge = completedAt - sourceTimestamp;
      const safeSourceTimestamp = Number.isFinite(sourceTimestamp) && sourceAge >= 0 && sourceAge < 1000
        ? sourceTimestamp
        : inferenceTimestamp;

      return {
        faceLandmarks: this.latestFaceLandmarks,
        handLandmarks: this.latestHandLandmarks,
        handedness: this.latestHandedness,
        delegate: this.delegate,
        sourceTimestamp: safeSourceTimestamp,
        completedAt,
        handInferenceMs,
        faceInferenceMs,
        handRevision: this.handRevision,
        faceRevision: this.faceRevision,
        updatedTask,
      };
    } catch {
      return null;
    } finally {
      this.inferenceInFlight = false;
    }
  }

  close() {
    this.face?.close();
    this.hands?.close();
  }
}
