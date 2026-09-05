import assert from "node:assert/strict";
import { build } from "esbuild";
import { access, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function loadInteractionEngine() {
  const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
  const result = await build({
    absWorkingDir: projectDirectory,
    entryPoints: ["app/lib/interaction-engine.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    minify: true,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function sampleFace(overrides = {}) {
  return {
    visible: true,
    inGracePeriod: false,
    landmarks: [],
    center: { x: 0.5, y: 0.42, z: 0 },
    forehead: { x: 0.5, y: 0.25, z: 0 },
    chin: { x: 0.5, y: 0.58, z: 0 },
    mouthCenter: { x: 0.5, y: 0.5, z: 0 },
    mouthLeft: { x: 0.46, y: 0.5, z: 0 },
    mouthRight: { x: 0.54, y: 0.5, z: 0 },
    noseLeft: { x: 0.488, y: 0.45, z: 0 },
    noseRight: { x: 0.512, y: 0.45, z: 0 },
    faceWidth: 0.24,
    faceHeight: 0.22,
    mouthWidth: 0.08,
    mouthWidthRatio: 0.333,
    mouthOpenRatio: 0.03,
    mouthPursed: false,
    mouthState: "CLOSED",
    yaw: 0,
    roll: 0,
    ...overrides,
  };
}

function sampleHand(state, point) {
  const landmarks = Array.from({ length: 21 }, () => ({ ...point }));
  landmarks[8] = { ...point };
  landmarks[12] = { x: point.x, y: point.y + 0.02, z: 0 };
  return {
    id: "test-hand",
    visible: true,
    landmarks,
    state,
    pinchDistance: state === "PINCH" ? 0.1 : 1,
    palmSize: 0.1,
    gripPoint: { ...point },
    indexTip: { ...point },
    middleTip: { x: point.x, y: point.y + 0.02, z: 0 },
  };
}

function attachCigarette(engine, face, startTime = 100) {
  let now = startTime;
  const restPoint = { x: 0.5, y: 0.7, z: 0 };
  engine.update(face, [sampleHand("PINCH", restPoint)], now, 0.05, "GPU");
  for (let frame = 0; frame < 16; frame += 1) {
    now += 50;
    engine.update(face, [sampleHand("PINCH", face.mouthCenter)], now, 0.05, "GPU");
  }
  now += 50;
  engine.update(face, [sampleHand("NONE", face.mouthCenter)], now, 0.05, "GPU");
  now += 120;
  engine.update(face, [sampleHand("NONE", face.mouthCenter)], now, 0.05, "GPU");
  assert.match(engine.getSnapshot().cigaretteState, /^MOUTH_/);
  return now;
}

test("renders the local AR experience shell and production metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Virtual Cigarette<\/title>/i);
  assert.match(html, /class="experience"/i);
  assert.match(html, /class="camera"/i);
  assert.match(html, /class="render-canvas"/i);
  assert.match(html, /og\.png/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps every runtime model and Wasm dependency inside the project", async () => {
  const requiredAssets = [
    "../public/mediapipe/models/face_landmarker.task",
    "../public/mediapipe/models/hand_landmarker.task",
    "../public/mediapipe/wasm/vision_wasm_internal.wasm",
    "../public/mediapipe/wasm/vision_wasm_module_internal.wasm",
    "../public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
    "../public/og.png",
  ];
  for (const relativePath of requiredAssets) {
    const url = new URL(relativePath, import.meta.url);
    await access(url);
    assert.ok((await stat(url)).size > 0, `${relativePath} must not be empty`);
  }

  const tracker = await readFile(new URL("../app/lib/vision-tracker.ts", import.meta.url), "utf8");
  const experience = await readFile(new URL("../app/smoking-experience.tsx", import.meta.url), "utf8");
  assert.match(tracker, /delegate:\s*"GPU"/);
  assert.match(tracker, /processLatest\(video: HTMLVideoElement, sourceTimestamp: number\)/);
  assert.match(tracker, /if \(this\.inferenceInFlight\) return null/);
  assert.match(tracker, /this\.scheduleIndex === 2 \? "FACE" : "HAND"/);
  assert.match(tracker, /numHands:\s*1/);
  assert.match(tracker, /this\.hands\.detectForVideo\(video, inferenceTimestamp\)/);
  assert.match(tracker, /this\.face\.detectForVideo\(video, inferenceTimestamp\)/);
  assert.doesNotMatch(tracker, /inferenceIntervalMs|inputCanvas|drawImage\(video/);
  assert.match(tracker, /outputFaceBlendshapes:\s*false/);
  assert.match(tracker, /faceContext:\s*this\.contextKind/);
  assert.match(tracker, /handContext:\s*this\.contextKind/);
  assert.match(tracker, /\/mediapipe\/models\/face_landmarker\.task/);
  assert.match(tracker, /\/mediapipe\/models\/hand_landmarker\.task/);
  assert.doesNotMatch(tracker, /https?:\/\//);
  assert.match(experience, /requestVideoFrameCallback/);
  assert.match(experience, /scheduleTracking\(\)/);
  assert.match(experience, /trackingSchedule = "LATEST_FRAME"/);
  assert.match(experience, /dataset\.worstFrameMs/);
  assert.match(experience, /dataset\.inputLatencyMs/);
});

test("uses the burn, one-shot mouth and nose smoke, and falling flow", async () => {
  const [engine, analyzer, renderer, experience, types, store, packageJson] = await Promise.all([
    readFile(new URL("../app/lib/interaction-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/analyzers.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/smoke-renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/smoking-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(engine, /CIGARETTE_FACE_SCALE = 0\.275/);
  assert.match(engine, /CIGARETTE_MIN_LENGTH = 0\.0475/);
  assert.match(engine, /heldNearMouth/);
  assert.match(engine, /face\.mouthWidth \* 1\.25/);
  assert.match(engine, /FULL_BURN_SECONDS = 7 \* 1\.4/);
  assert.match(engine, /NOSE_EXHALE_DELAY_MS = 3000/);
  assert.match(engine, /EFFECT_LABEL_MS = 900/);
  assert.doesNotMatch(engine, /MOUTH_EXHALE_DURATION_MS|NOSE_EXHALE_DURATION_MS|SMOKE_PULSE_INTERVAL_MS|updateActiveExhale/);
  assert.match(engine, /face\.mouthPursed/);
  assert.match(engine, /cigaretteBurn \+ dt \/ FULL_BURN_SECONDS/);
  assert.match(engine, /type: "MOUTH_BURST"/);
  assert.match(engine, /type: "NOSE_BURST"/);
  assert.doesNotMatch(`${engine}\n${renderer}\n${types}\n${store}`, /STAR_BURST|starBurst|cheekLeft|cheekRight/);
  assert.match(engine, /cigaretteState = "FALLING"/);
  assert.match(engine, /fallVelocity\.y \+= 0\.72 \* dt/);
  assert.match(analyzer, /mouthWidthRatio <= 0\.31/);
  assert.match(analyzer, /aspect >= threshold/);
  assert.doesNotMatch(`${engine}\n${types}\n${store}`, /MOUTH_ARM_THRESHOLD|MOUTH_RELEASE_DROP|LIP_CONTRACTION|mouthOpenPeak|mouthGesturePhase|smokePulseCount|\bEXHALE_DURATION_MS\b/);
  assert.match(renderer, /powerPreference:\s*"high-performance"/);
  assert.match(renderer, /material\.side\s*=\s*THREE\.DoubleSide/);
  assert.match(renderer, /mappedBaseLength \* \(this\.width \/ this\.height\) \* 1\.15/);
  assert.match(renderer, /hardwareAccelerated/);
  assert.match(renderer, /ShaderMaterial/);
  assert.match(renderer, /Points/);
  assert.match(renderer, /MAX_PARTICLES = 8000/);
  assert.match(renderer, /SMOKE_VOLUME_MULTIPLIER = 5/);
  assert.match(renderer, /float fbm\(vec2 point\)/);
  assert.match(renderer, /premultipliedAlpha:\s*false/);
  assert.match(renderer, /vec3 color = vec3\(0\.4117647\)/);
  assert.match(renderer, /setAttribute\("position", new THREE\.BufferAttribute\(new Float32Array\(MAX_PARTICLES \* 3\), 3\)\)/);
  assert.match(renderer, /setDrawRange\(0, MAX_PARTICLES\)/);
  assert.match(renderer, /depthTest:\s*false/);
  assert.match(renderer, /mouthParticleCount/);
  assert.match(renderer, /burning \? this\.baseSmokeAccumulator \+ dt \* 60 \* this\.qualityFactor\(\) : 0/);
  assert.match(renderer, /emitMouthBurst/);
  assert.match(renderer, /emitNoseBurst/);
  assert.match(renderer, /markParticlesDirty/);
  assert.match(renderer, /Math\.round\(\(280 \+ emission\.strength \* 120\) \* SMOKE_VOLUME_MULTIPLIER \* factor\)/);
  assert.match(renderer, /Math\.round\(\(70 \+ emission\.strength \* 24\) \* SMOKE_VOLUME_MULTIPLIER \* factor\)/);
  assert.match(renderer, /particleDrawCount/);
  assert.doesNotMatch(experience, /smokePreview/);
  assert.match(experience, /const snapshot = engine\.update\(face, hands, now, dt, delegate\)/);
  assert.match(packageJson, /"dev":\s*"vinext dev"/);
});

test("emits one mouth or nose batch and burns down", async () => {
  const { InteractionEngine } = await loadInteractionEngine();
  const face = sampleFace();
  const pursed = sampleFace({ mouthWidth: 0.068, mouthWidthRatio: 0.283, mouthPursed: true });

  const heldEngine = new InteractionEngine(() => {});
  let heldNow = 100;
  heldEngine.update(face, [sampleHand("PINCH", { x: 0.5, y: 0.7, z: 0 })], heldNow, 0.05, "GPU");
  for (let frame = 0; frame < 8; frame += 1) {
    heldNow += 50;
    heldEngine.update(pursed, [sampleHand("PINCH", pursed.mouthCenter)], heldNow, 0.05, "GPU");
  }
  assert.equal(heldEngine.getSnapshot().cigaretteState, "HAND_HELD");
  assert.equal(heldEngine.getSnapshot().smokingState, "INHALING");
  assert.ok(heldEngine.getSnapshot().cigaretteBurn > 0);

  const emissions = [];
  const engine = new InteractionEngine((emission) => emissions.push(emission));
  let now = attachCigarette(engine, face);

  for (let frame = 0; frame < 28; frame += 1) {
    now += 50;
    engine.update(pursed, [], now, 0.05, "GPU");
  }
  assert.equal(engine.getSnapshot().smokingState, "INHALING");
  assert.ok(engine.getSnapshot().cigaretteBurn > 0.13 && engine.getSnapshot().cigaretteBurn < 0.16);

  const open = sampleFace({ mouthOpenRatio: 0.13, mouthState: "OPEN" });
  now += 50;
  engine.update(open, [], now, 0.05, "GPU");
  assert.equal(emissions.filter((emission) => emission.type === "MOUTH_BURST").length, 1);
  for (let frame = 0; frame < 29; frame += 1) {
    now += 60;
    engine.update(open, [], now, 0.05, "GPU");
  }
  assert.equal(
    emissions.filter((emission) => emission.type === "MOUTH_BURST").length,
    1,
    "holding the mouth open must not repeat the one-shot smoke batch",
  );

  for (let frame = 0; frame < 10; frame += 1) {
    now += 50;
    engine.update(pursed, [], now, 0.05, "GPU");
  }
  now += 50;
  engine.update(face, [], now, 0.05, "GPU");
  now += 3050;
  engine.update(face, [], now, 0.05, "GPU");
  assert.equal(emissions.filter((emission) => emission.type === "NOSE_BURST").length, 1);
  for (let frame = 0; frame < 36; frame += 1) {
    now += 60;
    engine.update(face, [], now, 0.05, "GPU");
  }
  assert.equal(
    emissions.filter((emission) => emission.type === "NOSE_BURST").length,
    1,
    "nose smoke must also be emitted as one batch",
  );

  while (engine.getSnapshot().cigaretteState !== "FALLING") {
    now += 50;
    engine.update(pursed, [], now, 0.05, "GPU");
    assert.ok(now < 30000, "cigarette must burn out in bounded time");
  }
  assert.equal(engine.getSnapshot().cigaretteBurn, 1);
  assert.ok(engine.getSnapshot().cigaretteLength <= engine.getSnapshot().cigaretteBaseLength * 0.29);
});
