import { Vector3 } from '@manycore/aholo-viewer';
import type { Observation, Vec3Record } from './types';

export function record(v: Vector3): Vec3Record {
    return { x: v.x, y: v.y, z: v.z };
}

export function vector(v: Vec3Record): Vector3 {
    return new Vector3(v.x, v.y, v.z);
}

export function aholoToNav(v: Vector3): [number, number, number] {
    return [v.x, v.z, -v.y];
}

export function voxelHitToAholo(hit: Vec3Record, verticalOffset: number): Vector3 {
    return new Vector3(hit.x, verticalOffset - hit.y, hit.z);
}

export function screenRay(
    pixelX: number,
    pixelY: number,
    width: number,
    height: number,
    verticalFovDeg: number,
    origin: Vector3,
    forward: Vector3,
    right: Vector3,
    imageUp: Vector3,
) {
    const tanHalfFov = Math.tan(verticalFovDeg * Math.PI / 360);
    const aspect = width / height;
    const sx = ((pixelX / width) * 2 - 1) * aspect * tanHalfFov;
    const sy = (1 - (pixelY / height) * 2) * tanHalfFov;
    const direction = forward.clone()
        .addScaledVector(right, sx)
        .addScaledVector(imageUp, sy)
        .normalize();
    return { origin: origin.clone(), direction };
}

function closestRayPair(a: Observation, b: Observation) {
    const p1 = vector(a.rayOrigin);
    const p2 = vector(b.rayOrigin);
    const d1 = vector(a.rayDirection).normalize();
    const d2 = vector(b.rayDirection).normalize();
    const w0 = p1.clone().sub(p2);
    const aa = d1.dot(d1);
    const bb = d1.dot(d2);
    const cc = d2.dot(d2);
    const dd = d1.dot(w0);
    const ee = d2.dot(w0);
    const denom = aa * cc - bb * bb;
    if (Math.abs(denom) < 1e-8) return null;
    const t1 = (bb * ee - cc * dd) / denom;
    const t2 = (aa * ee - bb * dd) / denom;
    if (t1 < 0 || t2 < 0) return null;
    const q1 = p1.addScaledVector(d1, t1);
    const q2 = p2.addScaledVector(d2, t2);
    return {
        midpoint: q1.clone().add(q2).multiplyScalar(0.5),
        residual: q1.clone().sub(q2).length(),
    };
}

export function solveObservations(observations: Observation[]) {
    const pairs: { midpoint: Vector3; residual: number }[] = [];
    for (let i = 0; i < observations.length; i++) {
        for (let j = i + 1; j < observations.length; j++) {
            const pair = closestRayPair(observations[i], observations[j]);
            if (pair) pairs.push(pair);
        }
    }
    if (pairs.length > 0) {
        const point = pairs.reduce(
            (sum, pair) => sum.add(pair.midpoint),
            new Vector3(),
        ).multiplyScalar(1 / pairs.length);
        const residual = pairs.reduce((sum, pair) => sum + pair.residual, 0) / pairs.length;
        return { point, residual, method: 'ray_triangulation' as const };
    }
    const point = observations.reduce(
        (sum, observation) => sum.add(vector(observation.surfacePoint)),
        new Vector3(),
    ).multiplyScalar(1 / observations.length);
    return { point, residual: null, method: 'surface_mean' as const };
}

export function projectPoint(
    point: Vector3,
    origin: Vector3,
    forward: Vector3,
    right: Vector3,
    imageUp: Vector3,
    width: number,
    height: number,
    verticalFovDeg: number,
) {
    const delta = point.clone().sub(origin);
    const depth = delta.dot(forward);
    if (depth <= 1e-5) return null;
    const tanHalfFov = Math.tan(verticalFovDeg * Math.PI / 360);
    const aspect = width / height;
    const ndcX = delta.dot(right) / (depth * tanHalfFov * aspect);
    const ndcY = delta.dot(imageUp) / (depth * tanHalfFov);
    if (Math.abs(ndcX) > 1 || Math.abs(ndcY) > 1) return null;
    return {
        x: (ndcX + 1) * 0.5 * width,
        y: (1 - ndcY) * 0.5 * height,
        depth,
    };
}
