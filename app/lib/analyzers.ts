import { clamp, distance, expSmoothing, lerp, lerpPoint, midpoint, mirrorPoint } from "./math";
import type { FaceAnalysis, HandAnalysis, MouthState, Point3 } from "./types";

const FACE = {
  forehead: 10,
  chin: 152,
  leftEdge: 234,
  rightEdge: 454,
  mouthLeft: 61,
  mouthRight: 291,
  lipUpper: 13,
  lipLower: 14,
  nostrilA: 98,
  nostrilB: 327,
};

const HAND = {
  wrist: 0,
  thumbTip: 4,
  indexMcp: 5,
  indexPip: 6,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleTip: 12,
  pinkyMcp: 17,
};

function pointAt(points: Point3[], index: number, fallback: Point3 = { x: 0.5, y: 0.5, z: 0 }) {
  return points[index] ?? fallback;
}

function emptyFace(): FaceAnalysis {
  const center = { x: 0.5, y: 0.42, z: 0 };
  return {
    visible: false,
    inGracePeriod: false,
    landmarks: [],
    center,
    forehead: { x: 0.5, y: 0.25, z: 0 },
    chin: { x: 0.5, y: 0.62, z: 0 },
    mouthCenter: { x: 0.5, y: 0.51, z: 0 },
    mouthLeft: { x: 0.46, y: 0.51, z: 0 },
    mouthRight: { x: 0.54, y: 0.51, z: 0 },
    noseLeft: { x: 0.49, y: 0.45, z: 0 },
    noseRight: { x: 0.51, y: 0.45, z: 0 },
    faceWidth: 0.24,
    faceHeight: 0.22,
    mouthWidth: 0.08,
    mouthWidthRatio: 0.333,
    mouthOpenRatio: 0,
    mouthPursed: false,
    mouthState: "CLOSED",
    yaw: 0,
    roll: 0,
  };
}

export class FaceAnalyzer {
  private last = emptyFace();
  private lastSeenAt = -Infinity;

  analyze(rawLandmarks: Point3[] | undefined, now: number, dt: number, includeDebugLandmarks = false) {
    if (!rawLandmarks || rawLandmarks.length < 468) {
      const elapsed = now - this.lastSeenAt;
      return {
        ...this.last,
        visible: false,
        inGracePeriod: elapsed <= 1000,
        landmarks: elapsed <= 1000 ? this.last.landmarks : [],
      };
    }

    const mirroredAt = (index: number) => mirrorPoint(pointAt(rawLandmarks, index));
    const landmarks = includeDebugLandmarks ? rawLandmarks.map(mirrorPoint) : [];
    const forehead = mirroredAt(FACE.forehead);
    const chin = mirroredAt(FACE.chin);
    const faceLeft = mirroredAt(FACE.rightEdge);
    const faceRight = mirroredAt(FACE.leftEdge);
    const mouthLeft = mirroredAt(FACE.mouthRight);
    const mouthRight = mirroredAt(FACE.mouthLeft);
    const upperLip = mirroredAt(FACE.lipUpper);
    const lowerLip = mirroredAt(FACE.lipLower);
    const nostrilPoints = [mirroredAt(FACE.nostrilA), mirroredAt(FACE.nostrilB)].sort((a, b) => a.x - b.x);
    const mouthCenter = midpoint(upperLip, lowerLip);
    const center = midpoint(forehead, chin);
    const faceWidth = Math.max(0.001, distance(faceLeft, faceRight));
    const faceHeight = Math.max(0.001, distance(forehead, chin));
    const mouthWidthRaw = Math.max(0.001, distance(mouthLeft, mouthRight));
    const mouthHeightRaw = distance(upperLip, lowerLip);
    const aspectRaw = mouthHeightRaw / mouthWidthRaw;
    const mouthWidthRatioRaw = mouthWidthRaw / faceWidth;
    const smoothing = expSmoothing(dt, 30);
    const mouthWidth = lerp(this.last.mouthWidth, mouthWidthRaw, smoothing);
    const mouthWidthRatio = lerp(this.last.mouthWidthRatio, mouthWidthRatioRaw, smoothing);
    const mouthOpenRatio = lerp(this.last.mouthOpenRatio, aspectRaw, smoothing);
    const mouthPursed = mouthWidthRatio <= 0.31;
    const yaw = clamp((mouthCenter.x - center.x) / faceWidth * 135, -60, 60);
    const roll = Math.atan2(mouthRight.y - mouthLeft.y, mouthRight.x - mouthLeft.x);
    const mouthState = this.classifyMouth(mouthOpenRatio, mouthPursed);

    this.lastSeenAt = now;
    this.last = {
      visible: true,
      inGracePeriod: false,
      landmarks,
      center: lerpPoint(this.last.center, center, smoothing),
      forehead: lerpPoint(this.last.forehead, forehead, smoothing),
      chin: lerpPoint(this.last.chin, chin, smoothing),
      mouthCenter: lerpPoint(this.last.mouthCenter, mouthCenter, smoothing),
      mouthLeft: lerpPoint(this.last.mouthLeft, mouthLeft, smoothing),
      mouthRight: lerpPoint(this.last.mouthRight, mouthRight, smoothing),
      noseLeft: lerpPoint(this.last.noseLeft, nostrilPoints[0], smoothing),
      noseRight: lerpPoint(this.last.noseRight, nostrilPoints[1], smoothing),
      faceWidth: lerp(this.last.faceWidth, faceWidth, smoothing),
      faceHeight: lerp(this.last.faceHeight, faceHeight, smoothing),
      mouthWidth,
      mouthWidthRatio,
      mouthOpenRatio,
      mouthPursed,
      mouthState,
      yaw,
      roll,
    };
    return this.last;
  }

  private classifyMouth(aspect: number, pursed: boolean): MouthState {
    if (pursed) return "CLOSED";
    const threshold = this.last.mouthState === "OPEN" ? 0.06 : 0.075;
    return aspect >= threshold ? "OPEN" : "CLOSED";
  }
}

export class HandAnalyzer {
  analyze(rawHands: Point3[][], handedness: string[], includeDebugLandmarks = false): HandAnalysis[] {
    return rawHands.map((raw, index) => {
      const mirroredAt = (landmarkIndex: number) => mirrorPoint(pointAt(raw, landmarkIndex));
      const landmarks = includeDebugLandmarks ? raw.map(mirrorPoint) : [];
      const id = `${handedness[index] || "Hand"}-${index}`;
      const wrist = mirroredAt(HAND.wrist);
      const thumbTip = mirroredAt(HAND.thumbTip);
      const indexTip = mirroredAt(HAND.indexTip);
      const middleTip = mirroredAt(HAND.middleTip);
      const indexMcp = mirroredAt(HAND.indexMcp);
      const middleMcp = mirroredAt(HAND.middleMcp);
      const palmSize = Math.max(0.001, distance(wrist, middleMcp), distance(indexMcp, mirroredAt(HAND.pinkyMcp)));
      const pinchDistance = distance(thumbTip, indexTip) / palmSize;
      const indexExtended = distance(indexTip, wrist) > distance(mirroredAt(HAND.indexPip), wrist) * 1.12;
      const middleExtended = distance(middleTip, wrist) > distance(mirroredAt(HAND.middlePip), wrist) * 1.1;
      const fingerSeparation = distance(indexTip, middleTip) / palmSize;
      const fingerHold = indexExtended && middleExtended && fingerSeparation > 0.12 && fingerSeparation < 0.52;
      const state = pinchDistance < 0.29 ? "PINCH" : fingerHold ? "INDEX_MIDDLE_HOLD" : "NONE";
      const gripPoint = state === "INDEX_MIDDLE_HOLD" ? midpoint(indexTip, middleTip) : midpoint(thumbTip, indexTip);
      return {
        id,
        visible: true,
        landmarks,
        state,
        pinchDistance,
        palmSize,
        gripPoint,
        indexTip,
        middleTip,
      } satisfies HandAnalysis;
    });
  }
}
