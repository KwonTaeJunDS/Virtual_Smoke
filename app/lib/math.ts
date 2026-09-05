import type { Point3 } from "./types";

export const ZERO_POINT: Point3 = { x: 0, y: 0, z: 0 };

export function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}

export function lerpPoint(a: Point3, b: Point3, amount: number): Point3 {
  return {
    x: lerp(a.x, b.x, amount),
    y: lerp(a.y, b.y, amount),
    z: lerp(a.z, b.z, amount),
  };
}

export function expSmoothing(dt: number, response = 18) {
  return 1 - Math.exp(-Math.max(0, dt) * response);
}

export function distance(a: Point3, b: Point3, verticalScale = 9 / 16) {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) * verticalScale;
  return Math.sqrt(dx * dx + dy * dy);
}

export function midpoint(a: Point3, b: Point3): Point3 {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 };
}

export function normalize(point: Point3): Point3 {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return { x: point.x / length, y: point.y / length, z: point.z / length };
}

export function subtract(a: Point3, b: Point3): Point3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function addScaled(point: Point3, direction: Point3, amount: number): Point3 {
  return {
    x: point.x + direction.x * amount,
    y: point.y + direction.y * amount,
    z: point.z + direction.z * amount,
  };
}

export function mirrorPoint(point: Point3): Point3 {
  return { x: 1 - point.x, y: point.y, z: point.z };
}
