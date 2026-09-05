# Virtual Cigarette AR

A real-time browser experiment that overlays an interactive virtual cigarette and procedural smoke on a webcam feed. It tracks one hand and the user's face locally, then turns pinching, lip movement, and mouth opening into a compact smoking interaction.

> This is a creative-coding experiment, not a smoking product or health application.


## Features

- Pinch the cigarette with your thumb and index finger, or hold it between your index and middle fingers.
- Bring it close to your mouth while holding it, or release it to attach it to your lips.
- Purse your lips to inhale. The ember glows and the cigarette becomes shorter in proportion to the inhale duration.
- Open your mouth after inhaling to release a large burst of procedural gray smoke.
- If you do not open your mouth within three seconds, smoke is released through both nostrils.
- After roughly seven full inhales, the finished cigarette spins and falls out of frame.
- Press `D` to display tracking, rendering, and latency diagnostics.

## Tech Stack

| Area | Technology |
| --- | --- |
| Application and interaction logic | TypeScript |
| UI | React, TSX, CSS |
| Face and hand tracking | MediaPipe Tasks Vision |
| Cigarette and particle rendering | Three.js, WebGL |
| Procedural smoke texture | GLSL vertex and fragment shaders |
| Runtime state | Zustand |
| Development and build | Vinext, Vite, Node.js |

## Requirements

- Node.js `22.13.0` or newer
- npm
- A webcam
- A modern desktop browser with camera and WebGL support

Chrome or Edge is recommended. Hardware-accelerated WebGL provides the best experience. MediaPipe attempts to use the GPU and automatically falls back to the CPU if GPU initialization fails.

## Quick Start

```bash
git clone https://github.com/KwonTaeJunDS/Virtual_Smoke.git
cd Virtual_Smoke
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), allow camera access, and wait for the face and hand models to initialize.

No API key or `.env` file is required for local development. The MediaPipe WASM files and model assets used at runtime are included under `public/mediapipe`, so the tracker does not need to fetch models from an external server after installation.

## How to Use

1. Keep your face and one hand clearly visible to the camera.
2. Pinch or hold the cigarette and bring it close to your lips.
3. Purse your lips while the cigarette is near your mouth to inhale.
4. Open your mouth to exhale. If you wait for three seconds instead, the smoke exits through your nose.
5. Repeat until the cigarette burns down and falls.

Tracking is affected by lighting, camera quality, occlusion, and the distance between your face, hand, and camera.

## Project Structure

```text
virtual-cigarette-ar/
├─ app/
│  ├─ page.tsx                  # Main route
│  ├─ smoking-experience.tsx    # Camera, tracking, and render loops
│  ├─ debug-overlay.tsx         # Optional diagnostics overlay
│  ├─ globals.css               # Full-screen camera and UI styling
│  └─ lib/
│     ├─ vision-tracker.ts      # MediaPipe setup and latest-frame inference
│     ├─ analyzers.ts           # Face, mouth, and hand gesture analysis
│     ├─ interaction-engine.ts  # Cigarette and smoking state machine
│     ├─ smoke-renderer.ts      # Three.js objects and GLSL smoke particles
│     ├─ math.ts                # Geometry and smoothing helpers
│     ├─ store.ts               # Zustand runtime/debug state
│     └─ types.ts               # Shared TypeScript types
├─ public/
│  └─ mediapipe/
│     ├─ models/                # Face and hand landmark models
│     └─ wasm/                  # MediaPipe vision runtime
├─ tests/                       # Rendered-page smoke tests
├─ worker/                      # Hosted runtime entry point
├─ package.json                 # Scripts and dependencies
└─ prd.md                       # Original product requirements
```

## Runtime Architecture

The camera and interaction pipeline is intentionally optimized for input latency:

1. `requestVideoFrameCallback` exposes the newest available camera frame.
2. `VisionTracker` runs only one inference at a time and does not build a frame queue.
3. Hand inference is scheduled more frequently than face inference because hand movement is the critical interaction path.
4. `FaceAnalyzer` and `HandAnalyzer` convert landmarks into stable interaction signals.
5. `InteractionEngine` updates the cigarette state and creates smoke-emission events.
6. `SmokeRenderer` renders the cigarette and GPU-backed smoke independently from vision inference.

When debug mode is enabled with `D`, the overlay reports average FPS, worst and p95 frame time, input latency, inference time, and the active CPU/GPU delegate.

## Available Commands

```bash
npm run dev      # Start the local development server
npm run build    # Create a production build
npm start        # Serve the production build
npm test         # Build and run the rendered-page tests
npm run lint     # Run ESLint
```

Before publishing changes, run:

```bash
npm run lint
npm test
```

## Privacy

Camera frames and detected landmarks are processed locally in the browser. The application does not intentionally upload, record, or store webcam video. Browser camera permission is still required, and production deployments must use HTTPS for camera access.

## Troubleshooting

### The camera does not start

- Allow camera access in the browser's site settings.
- Close other applications that may be using the webcam.
- Use `localhost` during development or HTTPS in production.
- Reload the page after changing camera permissions.

### Tracking feels slow

- Enable browser hardware acceleration.
- Use a well-lit environment and keep the active hand visible.
- Close GPU-heavy tabs and applications.
- Press `D` and check whether MediaPipe is using the `GPU` or `CPU` delegate.

### The cigarette does not react

- Hold it closer to your lips before pursing them.
- Avoid covering your mouth landmarks with your fingers.
- Make the pinch or two-finger hold clearly visible to the camera.

## Contributing

Issues and pull requests are welcome. For behavior changes, keep camera-frame processing queue-free, preserve the hand-first interaction path, and run the lint and test commands before opening a pull request.

## License

This project is available under the [MIT License](LICENSE).
