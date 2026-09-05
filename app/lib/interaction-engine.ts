import { addScaled, clamp, distance, expSmoothing, lerp, lerpPoint, normalize } from "./math";
import { useInteractionStore } from "./store";
import type { CigaretteState, FaceAnalysis, HandAnalysis, InteractionSnapshot, Point3, SmokeEmission } from "./types";

const INITIAL_POSITION: Point3 = { x: 0.5, y: 0.7, z: 0 };
const CIGARETTE_FACE_SCALE = 0.275;
const CIGARETTE_MIN_LENGTH = 0.0475;
const CIGARETTE_MAX_LENGTH = 0.1025;
const MIN_LENGTH_RATIO = 0.28;
const FULL_BURN_SECONDS = 7 * 1.4;
const MIN_INHALE_SECONDS = 0.25;
const NOSE_EXHALE_DELAY_MS = 3000;
const EFFECT_LABEL_MS = 900;

function isMouthState(state: CigaretteState) {
  return state === "MOUTH_LEFT" || state === "MOUTH_CENTER" || state === "MOUTH_RIGHT";
}

export class InteractionEngine {
  private snapshot: InteractionSnapshot = {
    cigaretteState: "IDLE",
    mouthState: "CLOSED",
    smokingState: "IDLE",
    handState: "NONE",
    cigarettePosition: { ...INITIAL_POSITION },
    cigaretteRotation: -0.12,
    cigaretteBaseLength: 0.07,
    cigaretteLength: 0.07,
    cigaretteBurn: 0,
    cigaretteMouthSide: null,
    inhaleSeconds: 0,
    smokeReady: false,
    pinchDistance: 0,
    faceVisible: false,
    handVisible: false,
    delegate: "GPU",
  };

  private anchoredToFace = true;
  private activeHandId: string | null = null;
  private releaseStartedAt = 0;
  private handLostAt = 0;
  private offscreenStartedAt = 0;
  private inhaleActive = false;
  private inhaleSeconds = 0;
  private smokeReadyAt = 0;
  private pendingSmokeStrength = 0;
  private effectUntil = 0;
  private fallStartedAt = 0;
  private fallVelocity: Point3 = { x: 0, y: 0, z: 0 };
  private mouthBurstCount = 0;
  private noseBurstCount = 0;
  private lastDebugUpdate = 0;

  constructor(private emit: (emission: SmokeEmission) => void) {}

  update(face: FaceAnalysis, hands: HandAnalysis[], now: number, dt: number, delegate: "GPU" | "CPU") {
    const safeDt = Math.min(0.05, Math.max(0, dt));
    this.snapshot.delegate = delegate;
    this.snapshot.faceVisible = face.visible;
    this.snapshot.handVisible = hands.length > 0;
    this.snapshot.mouthState = face.mouthState;
    this.snapshot.handState = hands.find((hand) => hand.state !== "NONE")?.state ?? "NONE";
    this.snapshot.pinchDistance = hands.length ? Math.min(...hands.map((hand) => hand.pinchDistance)) : 0;

    if (this.snapshot.cigaretteState !== "FALLING") {
      const targetBaseLength = clamp(
        face.faceWidth * CIGARETTE_FACE_SCALE,
        CIGARETTE_MIN_LENGTH,
        CIGARETTE_MAX_LENGTH,
      );
      this.snapshot.cigaretteBaseLength = lerp(
        this.snapshot.cigaretteBaseLength,
        targetBaseLength,
        expSmoothing(safeDt, 18),
      );
      this.updateVisibleLength();
    }

    this.updateCigarette(face, hands, now, safeDt);
    this.updateSmoking(face, now, safeDt);
    if (this.snapshot.cigaretteState !== "FALLING") this.handleOffscreen(face, now);
    this.updateStore(face, now);
    return this.snapshot;
  }

  getSnapshot() {
    return this.snapshot;
  }

  private updateVisibleLength() {
    const remainingRatio = lerp(1, MIN_LENGTH_RATIO, this.snapshot.cigaretteBurn);
    this.snapshot.cigaretteLength = this.snapshot.cigaretteBaseLength * remainingRatio;
  }

  private updateCigarette(face: FaceAnalysis, hands: HandAnalysis[], now: number, dt: number) {
    const state = this.snapshot.cigaretteState;
    const smoothing = expSmoothing(dt, 32);

    if (state === "FALLING") {
      this.updateFalling(face, now, dt);
      return;
    }

    if (state === "IDLE") {
      if (this.anchoredToFace && (face.visible || face.inGracePeriod)) {
        const target = {
          x: face.center.x,
          y: clamp(face.chin.y + face.faceHeight * 0.48, 0.58, 0.84),
          z: 0,
        };
        this.snapshot.cigarettePosition = lerpPoint(this.snapshot.cigarettePosition, target, expSmoothing(dt, 7));
        this.snapshot.cigaretteRotation = lerp(this.snapshot.cigaretteRotation, face.roll - 0.1, expSmoothing(dt, 6));
      }

      const grabbable = hands
        .filter((hand) => hand.state !== "NONE")
        .sort((a, b) => distance(a.gripPoint, this.snapshot.cigarettePosition) - distance(b.gripPoint, this.snapshot.cigarettePosition))[0];
      const grabRadius = Math.max(0.035, this.snapshot.cigaretteBaseLength * 0.54);
      if (grabbable && distance(grabbable.gripPoint, this.snapshot.cigarettePosition) < grabRadius) {
        this.activeHandId = grabbable.id;
        this.anchoredToFace = false;
        this.snapshot.cigaretteState = grabbable.state === "PINCH" ? "HAND_HELD" : "FINGER_HELD";
      }
      return;
    }

    if (state === "HAND_HELD" || state === "FINGER_HELD") {
      const hand = hands.find((candidate) => candidate.id === this.activeHandId);
      if (!hand) {
        this.handLostAt ||= now;
        if (now - this.handLostAt > 180) this.releaseFromHand(face, false);
        return;
      }

      this.handLostAt = 0;
      this.snapshot.cigarettePosition = lerpPoint(this.snapshot.cigarettePosition, hand.gripPoint, smoothing);
      const rawRotation = Math.atan2(hand.middleTip.y - hand.indexTip.y, hand.middleTip.x - hand.indexTip.x) - Math.PI / 2;
      this.snapshot.cigaretteRotation = lerp(this.snapshot.cigaretteRotation, rawRotation, expSmoothing(dt, 24));

      if (hand.state === "NONE") {
        this.releaseStartedAt ||= now;
        if (now - this.releaseStartedAt >= 60) this.releaseFromHand(face, true);
      } else {
        this.releaseStartedAt = 0;
        this.snapshot.cigaretteState = hand.state === "PINCH" ? "HAND_HELD" : "FINGER_HELD";
      }
      return;
    }

    if (!isMouthState(state)) return;
    if (face.visible || face.inGracePeriod) {
      const side = state === "MOUTH_LEFT" ? "LEFT" : state === "MOUTH_RIGHT" ? "RIGHT" : "CENTER";
      const anchor = side === "LEFT" ? face.mouthLeft : side === "RIGHT" ? face.mouthRight : face.mouthCenter;
      const angle = face.roll + (side === "RIGHT" ? Math.PI : 0);
      const outward = { x: -Math.cos(angle), y: -Math.sin(angle), z: 0 };
      const target = addScaled(anchor, outward, this.snapshot.cigaretteLength * 0.48);
      this.snapshot.cigarettePosition = lerpPoint(this.snapshot.cigarettePosition, target, expSmoothing(dt, 28));
      this.snapshot.cigaretteRotation = lerp(this.snapshot.cigaretteRotation, angle, expSmoothing(dt, 26));
    }

    const grabber = hands
      .filter((hand) => hand.state !== "NONE")
      .find((hand) => distance(hand.gripPoint, this.snapshot.cigarettePosition) < Math.max(0.035, this.snapshot.cigaretteBaseLength * 0.6));
    if (grabber) {
      this.activeHandId = grabber.id;
      this.snapshot.cigaretteState = grabber.state === "PINCH" ? "HAND_HELD" : "FINGER_HELD";
      this.snapshot.cigaretteMouthSide = null;
    }
  }

  private releaseFromHand(face: FaceAnalysis, allowMouthAttach: boolean) {
    const nearMouth = distance(this.snapshot.cigarettePosition, face.mouthCenter)
      < Math.max(face.mouthWidth * 0.9, this.snapshot.cigaretteBaseLength * 0.72);
    if (allowMouthAttach && face.visible && nearMouth) {
      const offset = this.snapshot.cigarettePosition.x - face.mouthCenter.x;
      const side = offset < -face.mouthWidth * 0.14 ? "LEFT" : offset > face.mouthWidth * 0.14 ? "RIGHT" : "CENTER";
      this.snapshot.cigaretteMouthSide = side;
      this.snapshot.cigaretteState = `MOUTH_${side}` as CigaretteState;
    } else {
      this.snapshot.cigaretteState = "IDLE";
      this.snapshot.cigaretteMouthSide = null;
    }
    this.activeHandId = null;
    this.releaseStartedAt = 0;
    this.handLostAt = 0;
  }

  private updateSmoking(face: FaceAnalysis, now: number, dt: number) {
    const heldNearMouth = (this.snapshot.cigaretteState === "HAND_HELD" || this.snapshot.cigaretteState === "FINGER_HELD")
      && distance(this.snapshot.cigarettePosition, face.mouthCenter)
        <= Math.max(face.mouthWidth * 1.25, this.snapshot.cigaretteBaseLength * 0.9);
    const shouldInhale = face.visible
      && (isMouthState(this.snapshot.cigaretteState) || heldNearMouth)
      && face.mouthPursed
      && this.snapshot.cigaretteBurn < 1;

    if (shouldInhale) {
      if (!this.inhaleActive) {
        this.inhaleActive = true;
        this.inhaleSeconds = 0;
        this.snapshot.smokeReady = false;
        this.smokeReadyAt = 0;
      }
      this.inhaleSeconds += dt;
      this.snapshot.inhaleSeconds = this.inhaleSeconds;
      this.snapshot.cigaretteBurn = clamp(this.snapshot.cigaretteBurn + dt / FULL_BURN_SECONDS);
      this.updateVisibleLength();
      this.snapshot.smokingState = "INHALING";
      if (this.snapshot.cigaretteBurn >= 1) this.startFalling(now);
    } else if (this.inhaleActive) {
      this.finishInhale(now);
    }

    if (this.snapshot.smokeReady && face.visible && face.mouthState === "OPEN") {
      this.emitMouthBurst(face, now);
      return;
    } else if (
      this.snapshot.smokeReady
      && face.visible
      && this.smokeReadyAt > 0
      && now - this.smokeReadyAt >= NOSE_EXHALE_DELAY_MS
    ) {
      this.emitNoseBurst(face, now);
      return;
    }

    if (now >= this.effectUntil && !shouldInhale) this.setRestingSmokingState();
  }

  private finishInhale(now: number) {
    this.inhaleActive = false;
    this.snapshot.inhaleSeconds = this.inhaleSeconds;
    if (this.inhaleSeconds >= MIN_INHALE_SECONDS) {
      this.snapshot.smokeReady = true;
      this.smokeReadyAt = now;
      this.pendingSmokeStrength = clamp(this.inhaleSeconds / 1.4, 0.45, 1.35);
    }
  }

  private emitMouthBurst(face: FaceAnalysis, now: number) {
    this.emit({
      type: "MOUTH_BURST",
      origin: face.mouthCenter,
      direction: normalize({ x: Math.sin(face.yaw * Math.PI / 180) * 0.4, y: -0.25, z: 1 }),
      strength: this.pendingSmokeStrength,
    });
    this.mouthBurstCount += 1;
    this.consumePendingSmoke();
    this.snapshot.smokingState = "MOUTH_BURST";
    this.effectUntil = now + EFFECT_LABEL_MS;
  }

  private emitNoseBurst(face: FaceAnalysis, now: number) {
    this.emit({
      type: "NOSE_BURST",
      origin: face.noseLeft,
      secondaryOrigin: face.noseRight,
      direction: { x: 0, y: -1, z: 0 },
      strength: this.pendingSmokeStrength,
    });
    this.noseBurstCount += 1;
    this.consumePendingSmoke();
    this.snapshot.smokingState = "NOSE_BURST";
    this.effectUntil = now + EFFECT_LABEL_MS;
  }

  private consumePendingSmoke() {
    this.snapshot.smokeReady = false;
    this.smokeReadyAt = 0;
  }

  private startFalling(now: number) {
    this.finishInhale(now);
    this.snapshot.cigaretteState = "FALLING";
    this.snapshot.cigaretteMouthSide = null;
    this.snapshot.smokingState = "CIGARETTE_FALLING";
    this.fallStartedAt = now;
    this.fallVelocity = { x: (Math.random() - 0.5) * 0.08, y: -0.12, z: 0 };
    this.activeHandId = null;
    this.anchoredToFace = false;
  }

  private updateFalling(face: FaceAnalysis, now: number, dt: number) {
    this.fallVelocity.y += 0.72 * dt;
    this.snapshot.cigarettePosition = addScaled(this.snapshot.cigarettePosition, this.fallVelocity, dt);
    this.snapshot.cigaretteRotation += dt * 5.2;
    if (this.snapshot.cigarettePosition.y > 1.16 || now - this.fallStartedAt > 1900) this.resetCigarette(face);
  }

  private resetCigarette(face: FaceAnalysis) {
    this.snapshot.cigaretteState = "IDLE";
    this.snapshot.cigaretteMouthSide = null;
    this.snapshot.cigaretteBurn = 0;
    this.updateVisibleLength();
    this.snapshot.cigarettePosition = face.visible
      ? { x: face.center.x, y: clamp(face.chin.y + face.faceHeight * 0.48, 0.58, 0.84), z: 0 }
      : { ...INITIAL_POSITION };
    this.snapshot.cigaretteRotation = face.visible ? face.roll - 0.1 : -0.12;
    this.fallStartedAt = 0;
    this.fallVelocity = { x: 0, y: 0, z: 0 };
    this.anchoredToFace = true;
  }

  private setRestingSmokingState() {
    if (this.snapshot.cigaretteState === "FALLING") {
      this.snapshot.smokingState = "CIGARETTE_FALLING";
    } else if (this.snapshot.smokeReady) {
      this.snapshot.smokingState = "SMOKE_READY";
    } else if (this.snapshot.cigaretteState === "HAND_HELD" || this.snapshot.cigaretteState === "FINGER_HELD") {
      this.snapshot.smokingState = "HOLDING_CIGARETTE";
    } else if (isMouthState(this.snapshot.cigaretteState)) {
      this.snapshot.smokingState = "CIGARETTE_IN_MOUTH";
    } else {
      this.snapshot.smokingState = "IDLE";
    }
  }

  private handleOffscreen(face: FaceAnalysis, now: number) {
    const { x, y } = this.snapshot.cigarettePosition;
    const outside = x < -0.08 || x > 1.08 || y < -0.08 || y > 1.08;
    if (!outside) {
      this.offscreenStartedAt = 0;
      return;
    }
    this.offscreenStartedAt ||= now;
    if (now - this.offscreenStartedAt < 1500) return;
    this.resetCigarette(face);
    this.offscreenStartedAt = 0;
  }

  private updateStore(face: FaceAnalysis, now: number) {
    if (!useInteractionStore.getState().debugMode) return;
    if (now - this.lastDebugUpdate < 80) return;
    this.lastDebugUpdate = now;
    useInteractionStore.getState().updateRuntime({
      faceVisible: this.snapshot.faceVisible,
      handVisible: this.snapshot.handVisible,
      handState: this.snapshot.handState,
      mouthState: face.mouthState,
      mouthPursed: face.mouthPursed,
      cigaretteState: this.snapshot.cigaretteState,
      smokingState: this.snapshot.smokingState,
      mouthOpenRatio: face.mouthOpenRatio,
      mouthWidthRatio: face.mouthWidthRatio,
      cigaretteBurn: this.snapshot.cigaretteBurn,
      inhaleSeconds: this.snapshot.inhaleSeconds,
      smokeReady: this.snapshot.smokeReady,
      smokeReadySeconds: this.snapshot.smokeReady && this.smokeReadyAt > 0 ? Math.max(0, (now - this.smokeReadyAt) / 1000) : 0,
      mouthBurstCount: this.mouthBurstCount,
      noseBurstCount: this.noseBurstCount,
      pinchDistance: this.snapshot.pinchDistance,
      delegate: this.snapshot.delegate,
    });
  }
}
