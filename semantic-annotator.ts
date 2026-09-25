import {
    BackgroundMode, Color, PerspectiveCamera, Scene3D, SplatLoader, SplatUtils,
    ToneMapping, Vector3, createViewer, setViewerConfig,
} from '@manycore/aholo-viewer';
import { VoxelCollision } from './VoxelCollision';
import { aholoToNav, projectPoint, record, screenRay, solveObservations, vector, voxelHitToAholo } from './annotation/geometry';
import { AnnotationStore } from './annotation/store';
import type { AnnotationShape, BoxInstance, NavPoint, Observation, SemanticInstance, VertexAnnotation } from './annotation/types';

const params = new URLSearchParams(location.search);
const environment = params.get('env') || 'env_gs_badminton_court';
const splatUrl = params.get('splat') || './resource/badminton_court.sog';
const voxelJsonUrl = params.get('voxelJson') || './resource/badminton_court.voxel.json';
const voxelBinUrl = params.get('voxelBin') || './resource/badminton_court.voxel.bin';
const voxelVerticalOffset = Number(params.get('voxelVerticalOffset') || 0.55);
const maxRayDistance = Number(params.get('maxRayDistance') || 100);
const maxTriangulationResidual = Number(params.get('maxTriangulationResidual') || 0.5);
const maxPlanarityError = Number(params.get('maxPlanarityError') || 0.25);

function el<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
const viewerElement = el<HTMLDivElement>('viewer');
const viewportElement = el<HTMLElement>('viewport');
const overlayElement = el<HTMLDivElement>('overlay');
const loadingElement = el<HTMLDivElement>('loading');
const statusElement = el<HTMLDivElement>('status');
const idInput = el<HTMLInputElement>('object-id');
const typeInput = el<HTMLInputElement>('object-type');
const colorInput = el<HTMLInputElement>('object-color');
const sizeInput = el<HTMLSelectElement>('object-size');
const shapeInput = el<HTMLSelectElement>('shape-type');
const boxOptions = el<HTMLDivElement>('box-options');
const boxHeightInput = el<HTMLInputElement>('box-height');
const positionModeInput = el<HTMLSelectElement>('position-mode');
const pendingMetric = el<HTMLDivElement>('pending-metric');
const instanceList = el<HTMLDivElement>('instance-list');
const importFile = el<HTMLInputElement>('import-file');
const saveButton = el<HTMLButtonElement>('save-instance');

const store = new AnnotationStore(environment);
const pending: Observation[] = [];
const vertices: VertexAnnotation[] = [];
el<HTMLDivElement>('project-name').textContent = environment;

const rules: Record<AnnotationShape, { roles: string[]; minimum: number; label: string }> = {
    point: { roles: ['point'], minimum: 1, label: 'point' },
    box: { roles: ['base center', 'length direction edge', 'width direction edge'], minimum: 3, label: 'oriented box' },
    rectangle: { roles: ['corner 1', 'corner 2', 'corner 3', 'corner 4'], minimum: 4, label: 'quadrilateral' },
    polygon: { roles: [], minimum: 3, label: 'polygon' },
};
function shape() { return shapeInput.value as AnnotationShape; }
function nextRole() { return shape() === 'polygon' ? `vertex ${vertices.length + 1}` : rules[shape()].roles[vertices.length] || 'complete'; }
function escapeHtml(value: string) {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
    return value.replace(/[&<>'"]/g, c => map[c] || c);
}
function navToAholo(p: NavPoint) { return new Vector3(p[0], -p[2], p[1]); }
function distanceXY(a: NavPoint, b: NavPoint) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function planarityError(points: NavPoint[]) {
    if (points.length < 4) return 0;
    const a = new Vector3(...points[0]), ab = new Vector3(...points[1]).sub(a);
    let normal: Vector3 | null = null;
    for (let i = 2; i < points.length && !normal; i++) {
        const candidate = ab.clone().cross(new Vector3(...points[i]).sub(a));
        if (candidate.length() > 1e-4) normal = candidate.normalize();
    }
    if (!normal) return Number.POSITIVE_INFINITY;
    return Math.max(...points.map(point => Math.abs(new Vector3(...point).sub(a).dot(normal!))));
}
function confidence() {
    const rs = vertices.map(v => v.rayResidual).filter((v): v is number => v !== null);
    if (!rs.length) return 0.65;
    return Math.max(0.1, Math.min(0.99, 0.95 - rs.reduce((a, b) => a + b, 0) / rs.length * 0.25));
}
function boxGeometry(): Pick<BoxInstance, 'center' | 'size' | 'yaw' | 'corners'> | null {
    if (vertices.length < 3) return null;
    const base = vertices[0].point, lp = vertices[1].point, wp = vertices[2].point;
    const length = 2 * distanceXY(base, lp), width = 2 * distanceXY(base, wp), height = Number(boxHeightInput.value);
    if (!(length > 0.01 && width > 0.01 && height > 0.01)) return null;
    const yaw = Math.atan2(lp[1] - base[1], lp[0] - base[0]);
    const ux: NavPoint = [Math.cos(yaw), Math.sin(yaw), 0], uy: NavPoint = [-Math.sin(yaw), Math.cos(yaw), 0];
    const layer = (z: number) => ([[1, 1], [1, -1], [-1, -1], [-1, 1]] as const).map(([sx, sy]) =>
        [base[0] + sx * ux[0] * length / 2 + sy * uy[0] * width / 2,
         base[1] + sx * ux[1] * length / 2 + sy * uy[1] * width / 2, z] as NavPoint);
    return {
        center: [base[0], base[1], base[2] + height / 2], size: [length, width, height], yaw,
        corners: [...layer(base[2]), ...layer(base[2] + height)] as BoxInstance['corners'],
    };
}
async function loadCollision() {
    const metadata = await fetch(voxelJsonUrl).then(r => r.json());
    const buffer = await fetch(voxelBinUrl).then(r => r.arrayBuffer()) as ArrayBuffer;
    const all = new Uint32Array(buffer);
    const count = metadata.nodeCount >>> 0;
    return new VoxelCollision(metadata, all.slice(0, count), all.slice(count, count + (metadata.leafDataCount >>> 0)));
}
function basis(yaw: number, pitch: number) {
    const cp = Math.cos(pitch);
    const forward = new Vector3(cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw)).normalize();
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();
    return { forward, right, imageUp: right.clone().cross(forward).normalize() };
}
function renderMetric() {
    const current = shape(), solution = pending.length ? solveObservations(pending) : null;
    const lines = [`shape: ${rules[current].label}`, `confirmed vertices: ${vertices.length}`, `next: ${nextRole()}`, `current observations: ${pending.length}`];
    if (solution) {
        lines.push(`candidate nav xyz: ${aholoToNav(solution.point).map(v => v.toFixed(3)).join(', ')}`);
        lines.push(`ray residual: ${solution.residual === null ? 'n/a' : solution.residual.toFixed(3) + ' m'}`);
    }
    if (current === 'box' && vertices.length >= 3) {
        const box = boxGeometry();
        lines.push(box ? `box L/W/H: ${box.size.map(v => v.toFixed(2)).join(' / ')} m | yaw: ${(box.yaw * 180 / Math.PI).toFixed(1)} deg` : 'box dimensions are invalid');
    }
    pendingMetric.textContent = lines.join('\n');
    boxOptions.hidden = current !== 'box';
    saveButton.textContent = `Save ${rules[current].label} (${vertices.length}/${current === 'polygon' ? '3+' : rules[current].minimum})`;
}
function centerOf(object: SemanticInstance): NavPoint {
    if (object.shape === 'point') return object.point;
    if (object.shape === 'box') return object.center;
    const points = object.shape === 'rectangle' ? object.corners : object.points;
    return points.reduce<NavPoint>((s, p) => [s[0] + p[0] / points.length, s[1] + p[1] / points.length, s[2] + p[2] / points.length], [0, 0, 0]);
}
function renderList() {
    instanceList.innerHTML = '';
    for (const object of store.project.objects) {
        const center = centerOf(object), item = document.createElement('div');
        item.className = 'instance';
        item.innerHTML = `<strong>${escapeHtml(object.id)}</strong><small>${escapeHtml(object.type)} | ${object.shape} | ${center.map(v => v.toFixed(2)).join(', ')}</small><button class="danger">Delete</button>`;
        item.querySelector('button')?.addEventListener('click', () => {
            store.project.objects = store.project.objects.filter(v => v.id !== object.id); store.save(); renderList();
        });
        instanceList.appendChild(item);
    }
}

async function main() {
    const scene = new Scene3D();
    const camera = new PerspectiveCamera(60, viewerElement.clientWidth / viewerElement.clientHeight, 0.1, 2000);
    const viewer = createViewer('semantic-annotator-viewer', viewerElement, {});
    viewer.setScene(scene); viewer.setCamera(camera);
    setViewerConfig(viewer, { pipeline: {
        Background: { up: new Vector3(0, -1, 0), background: { active: BackgroundMode.BasicBackground, gradient: { skyColor: new Color(1, .975, .975), groundColor: new Color(.5, .4, .4) } }, ground: { enabled: false } },
        Splatting: { enabled: true, pack: { highPrecisionEnabled: true, precalculateEnabled: true }, sort: { highPrecisionEnabled: true }, composite: { enabled: true, highPrecisionEnabled: true }, raster: { normalizedFalloff: false, preBlurAmount: .3, blurAmount: 0, focalAdjustment: 2, detailCullingThreshold: 1 }, toneMapping: { enabled: true, toneMapping: ToneMapping.Neutral, exposure: 1.25 } },
        TAA: { enabled: false },
    }});
    viewer.resume(); viewer.resize();
    const [buffer, collision] = await Promise.all([fetch(splatUrl).then(r => r.arrayBuffer()), loadCollision()]);
    const data = await SplatLoader.parseSplatData(SplatLoader.SplatFileType.SOG, new Uint8Array(buffer), SplatLoader.SplatPackType.Sog);
    scene.add(await SplatUtils.createSplat(data));

    const cameraPosition = new Vector3(Number(params.get('x') || -2.5), Number(params.get('y') || -3.2), Number(params.get('z') || 4));
    let yaw = Number(params.get('yaw') || 0), pitch = Number(params.get('pitch') || 0), dragging = false, dragDistance = 0, viewCounter = 0;
    const keys: Record<string, boolean> = {};
    function updateCamera() { const b = basis(yaw, pitch); camera.position.copy(cameraPosition); camera.up.copy(b.imageUp); camera.lookAt(cameraPosition.clone().add(b.forward)); return b; }
    function marker(point: Vector3, label: string, kind: 'saved' | 'pending' | 'vertex', b: ReturnType<typeof basis>) {
        const p = projectPoint(point, cameraPosition, b.forward, b.right, b.imageUp, viewportElement.clientWidth, viewportElement.clientHeight, camera.fov);
        if (!p) return;
        const node = document.createElement('div'); node.className = `marker${kind === 'saved' ? '' : ' ' + kind}`;
        node.style.left = `${p.x}px`; node.style.top = `${p.y}px`; node.innerHTML = `<span>${escapeHtml(label)} | ${p.depth.toFixed(1)}m</span>`; overlayElement.appendChild(node);
    }
    function edge(a: NavPoint, c: NavPoint, b: ReturnType<typeof basis>) {
        const pa = projectPoint(navToAholo(a), cameraPosition, b.forward, b.right, b.imageUp, viewportElement.clientWidth, viewportElement.clientHeight, camera.fov);
        const pc = projectPoint(navToAholo(c), cameraPosition, b.forward, b.right, b.imageUp, viewportElement.clientWidth, viewportElement.clientHeight, camera.fov);
        if (!pa || !pc) return;
        const dx = pc.x - pa.x, dy = pc.y - pa.y, node = document.createElement('div');
        node.className = 'edge'; node.style.left = `${pa.x}px`; node.style.top = `${pa.y}px`;
        node.style.width = `${Math.hypot(dx, dy)}px`; node.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        overlayElement.appendChild(node);
    }
    function renderOverlays(b: ReturnType<typeof basis>) {
        overlayElement.innerHTML = '';
        for (const object of store.project.objects) marker(navToAholo(centerOf(object)), `${object.id} (${object.shape})`, 'saved', b);
        if (shape() === 'rectangle' || shape() === 'polygon') {
            for (let i = 1; i < vertices.length; i++) edge(vertices[i - 1].point, vertices[i].point, b);
            if (vertices.length >= rules[shape()].minimum) edge(vertices[vertices.length - 1].point, vertices[0].point, b);
        } else if (shape() === 'box') {
            const box = boxGeometry();
            if (box) {
                const links = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
                links.forEach(([i, j]) => edge(box.corners[i], box.corners[j], b));
            }
        }
        vertices.forEach((v, i) => marker(navToAholo(v.point), `${i + 1}: ${v.role}`, 'vertex', b));
        const solution = pending.length ? solveObservations(pending) : null;
        if (solution) marker(solution.point, `pending ${nextRole()}`, 'pending', b);
        else pending.forEach((o, i) => { if (o.surfacePoint) marker(vector(o.surfacePoint), `surface ${i + 1}`, 'pending', b); });
    }

    viewportElement.addEventListener('mousedown', e => { dragDistance = 0; if (!e.shiftKey) dragging = true; });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', e => {
        if (!dragging) return; dragDistance += Math.abs(e.movementX) + Math.abs(e.movementY);
        yaw -= e.movementX * .002; pitch = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, pitch - e.movementY * .002));
    });
    viewportElement.addEventListener('click', e => {
        if (!e.shiftKey || dragDistance > 3 || (shape() !== 'polygon' && vertices.length >= rules[shape()].minimum)) return;
        const rect = viewportElement.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top, b = basis(yaw, pitch);
        const ray = screenRay(x, y, rect.width, rect.height, camera.fov, cameraPosition, b.forward, b.right, b.imageUp);
        const mode = positionModeInput.value as Observation['positionMode']; let surface: Vector3 | null = null;
        if (mode === 'surface_snap') {
            const hit = collision.queryRay(ray.origin.x, -(ray.origin.y - voxelVerticalOffset), ray.origin.z, ray.direction.x, -ray.direction.y, ray.direction.z, maxRayDistance);
            if (!hit) { statusElement.textContent = 'No collision surface found along clicked ray'; return; }
            surface = voxelHitToAholo(hit, voxelVerticalOffset);
        }
        pending.push({
            id: crypto.randomUUID(), viewId: `view_${String(++viewCounter).padStart(4, '0')}`, pixel: { x, y },
            camera: { position: record(cameraPosition), yaw, pitch, roll: 0 }, rayOrigin: record(ray.origin), rayDirection: record(ray.direction),
            positionMode: mode, surfacePoint: surface ? record(surface) : null, navSurfacePoint: surface ? aholoToNav(surface) : null, createdAt: new Date().toISOString(),
        });
        statusElement.textContent = `Accepted observation ${pending.length} for ${nextRole()}`; renderMetric();
    });
    window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
    window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
    el<HTMLButtonElement>('undo-observation').onclick = () => { pending.pop(); renderMetric(); };
    el<HTMLButtonElement>('clear-observations').onclick = () => { pending.length = 0; renderMetric(); };
    el<HTMLButtonElement>('undo-vertex').onclick = () => { if (!pending.length) vertices.pop(); pending.length = 0; renderMetric(); };
    el<HTMLButtonElement>('commit-vertex').onclick = () => {
        if (!pending.length) { statusElement.textContent = 'Add observations for this vertex first'; return; }
        if (pending[0].positionMode === 'multiview_ray' && pending.length < 2) { statusElement.textContent = 'Multiview mode requires two camera positions'; return; }
        const solution = solveObservations(pending);
        if (!solution) { statusElement.textContent = 'Cannot triangulate; move the camera and click the same vertex'; return; }
        if (solution.residual !== null && solution.residual > maxTriangulationResidual) { statusElement.textContent = `Residual ${solution.residual.toFixed(3)}m is too high`; return; }
        vertices.push({ role: nextRole(), point: aholoToNav(solution.point), observations: pending.map(o => ({ ...o })), rayResidual: solution.residual });
        pending.length = 0; statusElement.textContent = `Confirmed ${vertices[vertices.length - 1].role}`; renderMetric();
    };
    function clearGeometry(message: string) { pending.length = 0; vertices.length = 0; renderMetric(); statusElement.textContent = message; }
    shapeInput.onchange = () => clearGeometry('Geometry changed; pending work cleared');
    positionModeInput.onchange = () => clearGeometry('Position method changed; pending work cleared');
    boxHeightInput.oninput = renderMetric;

    saveButton.onclick = () => {
        const id = idInput.value.trim(), type = typeInput.value.trim(), current = shape(), rule = rules[current];
        if (!id || !type) { statusElement.textContent = 'Instance ID and semantic type are required'; return; }
        if (pending.length) { statusElement.textContent = 'Confirm or clear current observations first'; return; }
        if (vertices.length < rule.minimum || (current !== 'polygon' && vertices.length !== rule.minimum)) { statusElement.textContent = `${rule.label} requires ${current === 'polygon' ? 'at least ' : ''}${rule.minimum} vertices`; return; }
        if ((current === 'rectangle' || current === 'polygon') && planarityError(vertices.map(v => v.point)) > maxPlanarityError) {
            statusElement.textContent = `Vertices are not planar within ${maxPlanarityError.toFixed(2)}m; undo and recheck the inaccurate vertex`; return;
        }
        if (store.project.objects.some(o => o.id === id)) { statusElement.textContent = `Instance ID already exists: ${id}`; return; }
        const now = new Date().toISOString();
        const common = { id, type, color: colorInput.value.trim() || 'unknown', label_size: sizeInput.value, feature_prefix: id,
            annotation: { source: 'aholo_multiview_manual' as const, vertices: vertices.map(v => ({ ...v, observations: v.observations.map(o => ({ ...o })) })), confidence: confidence(), createdAt: now, updatedAt: now } };
        let object: SemanticInstance;
        if (current === 'point') object = { ...common, shape: current, point: vertices[0].point, landmark_policy: 'point_center' };
        else if (current === 'rectangle') object = { ...common, shape: current, corners: vertices.map(v => v.point) as [NavPoint, NavPoint, NavPoint, NavPoint], landmark_policy: 'rectangle_keypoints' };
        else if (current === 'polygon') object = { ...common, shape: current, points: vertices.map(v => v.point), landmark_policy: 'polygon_keypoints' };
        else {
            const geometry = boxGeometry(); if (!geometry) { statusElement.textContent = 'Box dimensions are invalid'; return; }
            object = { ...common, shape: current, ...geometry, landmark_policy: 'box_keypoints' };
        }
        store.project.objects.push(object); store.save(); vertices.length = 0; pending.length = 0; idInput.value = '';
        renderMetric(); renderList(); statusElement.textContent = `Saved ${id} (${current}) in browser storage`;
    };
    el<HTMLButtonElement>('export-json').onclick = () => store.download();
    el<HTMLButtonElement>('import-json').onclick = () => importFile.click();
    importFile.onchange = async () => {
        const file = importFile.files?.[0]; if (!file) return;
        try { await store.importFile(file); renderList(); statusElement.textContent = `Imported ${store.project.objects.length} objects`; }
        catch (error) { statusElement.textContent = error instanceof Error ? error.message : String(error); }
        finally { importFile.value = ''; }
    };

    loadingElement.style.display = 'none'; renderMetric(); renderList();
    let previous = performance.now();
    function tick(now: number) {
        requestAnimationFrame(tick); const dt = Math.min(.05, (now - previous) / 1000); previous = now; const b = basis(yaw, pitch), move = new Vector3();
        if (keys.w) move.add(b.forward); if (keys.s) move.addScaledVector(b.forward, -1); if (keys.a) move.addScaledVector(b.right, -1); if (keys.d) move.add(b.right);
        if (keys.q) move.y -= 1; if (keys.e) move.y += 1; if (move.lengthSq()) cameraPosition.addScaledVector(move.normalize(), dt * 2.5);
        const updated = updateCamera(); scene.notifySceneChange(); viewer.render(); renderOverlays(updated);
    }
    window.addEventListener('resize', () => { camera.aspect = viewportElement.clientWidth / viewportElement.clientHeight; viewer.resize(); });
    updateCamera(); requestAnimationFrame(tick);
}
main().catch(error => { console.error(error); loadingElement.textContent = error instanceof Error ? error.message : String(error); statusElement.textContent = 'Initialization failed'; });
