import {
    BackgroundMode,
    Color,
    PerspectiveCamera,
    Scene3D,
    SplatLoader,
    SplatUtils,
    ToneMapping,
    Vector3,
    createViewer,
    setViewerConfig,
} from '@manycore/aholo-viewer';
import { VoxelCollision } from './VoxelCollision';
import { aholoToNav, projectPoint, record, screenRay, solveObservations, vector, voxelHitToAholo } from './annotation/geometry';
import { AnnotationStore } from './annotation/store';
import type { Observation, SemanticInstance } from './annotation/types';

const params = new URLSearchParams(location.search);
const environment = params.get('env') || 'env_gs_badminton_court';
const splatUrl = params.get('splat') || './resource/badminton_court.sog';
const voxelJsonUrl = params.get('voxelJson') || './resource/badminton_court.voxel.json';
const voxelBinUrl = params.get('voxelBin') || './resource/badminton_court.voxel.bin';
const voxelVerticalOffset = Number(params.get('voxelVerticalOffset') || 0.55);
const maxRayDistance = Number(params.get('maxRayDistance') || 100);

const viewerElement = document.getElementById('viewer') as HTMLDivElement;
const viewportElement = document.getElementById('viewport') as HTMLElement;
const overlayElement = document.getElementById('overlay') as HTMLDivElement;
const loadingElement = document.getElementById('loading') as HTMLDivElement;
const statusElement = document.getElementById('status') as HTMLDivElement;
const projectNameElement = document.getElementById('project-name') as HTMLDivElement;
const idInput = document.getElementById('object-id') as HTMLInputElement;
const typeInput = document.getElementById('object-type') as HTMLInputElement;
const colorInput = document.getElementById('object-color') as HTMLInputElement;
const sizeInput = document.getElementById('object-size') as HTMLSelectElement;
const pendingMetric = document.getElementById('pending-metric') as HTMLDivElement;
const instanceList = document.getElementById('instance-list') as HTMLDivElement;
const importFile = document.getElementById('import-file') as HTMLInputElement;

const store = new AnnotationStore(environment);
const pending: Observation[] = [];
projectNameElement.textContent = environment;

function escapeHtml(value: string) {
    const replacements: Record<string, string> = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    };
    return value.replace(/[&<>'"]/g, character => replacements[character] || character);
}

async function loadCollision() {
    const metadata = await fetch(voxelJsonUrl).then(response => response.json());
    const buffer = await fetch(voxelBinUrl).then(response => response.arrayBuffer());
    const all = new Uint32Array(buffer);
    const nodeCount = metadata.nodeCount >>> 0;
    return new VoxelCollision(
        metadata,
        all.slice(0, nodeCount),
        all.slice(nodeCount, nodeCount + (metadata.leafDataCount >>> 0)),
    );
}

function basis(yaw: number, pitch: number) {
    const cp = Math.cos(pitch);
    const forward = new Vector3(cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw)).normalize();
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();
    const imageUp = right.clone().cross(forward).normalize();
    return { forward, right, imageUp };
}

function confidence(observationCount: number, residual: number | null) {
    if (observationCount < 2) return 0.55;
    if (residual === null) return 0.65;
    return Math.max(0.1, Math.min(0.99, 0.95 - residual * 0.25));
}

function renderPendingMetric() {
    if (pending.length === 0) {
        pendingMetric.textContent = 'No observations yet.';
        return;
    }
    const solution = solveObservations(pending);
    const nav = aholoToNav(solution.point);
    pendingMetric.textContent = [
        `observations: ${pending.length}`,
        `solution: ${solution.method}`,
        `nav xyz: ${nav.map(value => value.toFixed(3)).join(', ')}`,
        `ray residual: ${solution.residual === null ? 'n/a' : solution.residual.toFixed(3) + ' m'}`,
    ].join('\n');
}

function renderInstanceList() {
    instanceList.innerHTML = '';
    for (const object of store.project.objects) {
        const element = document.createElement('div');
        element.className = 'instance';
        element.innerHTML = `<strong>${escapeHtml(object.id)}</strong>
            <small>${escapeHtml(object.type)} � ${object.point.map(value => value.toFixed(2)).join(', ')}</small>
            <button class="danger" data-delete="${escapeHtml(object.id)}">Delete</button>`;
        element.querySelector('button')?.addEventListener('click', () => {
            store.project.objects = store.project.objects.filter(item => item.id !== object.id);
            store.save();
            renderInstanceList();
        });
        instanceList.appendChild(element);
    }
}

async function main() {
    const scene = new Scene3D();
    const camera = new PerspectiveCamera(60, viewerElement.clientWidth / viewerElement.clientHeight, 0.1, 2000);
    const viewer = createViewer('semantic-annotator-viewer', viewerElement, {});
    viewer.setScene(scene);
    viewer.setCamera(camera);
    setViewerConfig(viewer, {
        pipeline: {
            Background: {
                up: new Vector3(0, -1, 0),
                background: {
                    active: BackgroundMode.BasicBackground,
                    gradient: {
                        skyColor: new Color(1, 0.975, 0.975),
                        groundColor: new Color(0.5, 0.4, 0.4),
                    },
                },
                ground: { enabled: false },
            },
            Splatting: {
                enabled: true,
                pack: { highPrecisionEnabled: true, precalculateEnabled: true },
                sort: { highPrecisionEnabled: true },
                composite: { enabled: true, highPrecisionEnabled: true },
                raster: {
                    normalizedFalloff: false,
                    preBlurAmount: 0.3,
                    blurAmount: 0,
                    focalAdjustment: 2,
                    detailCullingThreshold: 1,
                },
                toneMapping: { enabled: true, toneMapping: ToneMapping.Neutral, exposure: 1.25 },
            },
            TAA: { enabled: false },
        },
    });
    viewer.resume();
    viewer.resize();

    const [splatBuffer, collision] = await Promise.all([
        fetch(splatUrl).then(response => response.arrayBuffer()),
        loadCollision(),
    ]);
    const splatData = await SplatLoader.parseSplatData(
        SplatLoader.SplatFileType.SOG,
        new Uint8Array(splatBuffer),
        SplatLoader.SplatPackType.Sog,
    );
    scene.add(await SplatUtils.createSplat(splatData));

    const cameraPosition = new Vector3(
        Number(params.get('x') || -2.5),
        Number(params.get('y') || -3.2),
        Number(params.get('z') || 4.0),
    );
    let yaw = Number(params.get('yaw') || 0);
    let pitch = Number(params.get('pitch') || 0);
    const keys: Record<string, boolean> = {};
    let dragging = false;
    let dragDistance = 0;
    let viewCounter = 0;

    function updateCamera() {
        const current = basis(yaw, pitch);
        camera.position.copy(cameraPosition);
        camera.up.copy(current.imageUp);
        camera.lookAt(cameraPosition.clone().add(current.forward));
        return current;
    }

    function overlayMarker(point: Vector3, label: string, pendingMarker: boolean, current: ReturnType<typeof basis>) {
        const projected = projectPoint(
            point,
            cameraPosition,
            current.forward,
            current.right,
            current.imageUp,
            viewportElement.clientWidth,
            viewportElement.clientHeight,
            camera.fov,
        );
        if (!projected) return;
        const marker = document.createElement('div');
        marker.className = `marker${pendingMarker ? ' pending' : ''}`;
        marker.style.left = `${projected.x}px`;
        marker.style.top = `${projected.y}px`;
        marker.innerHTML = `<span>${escapeHtml(label)} � ${projected.depth.toFixed(1)}m</span>`;
        overlayElement.appendChild(marker);
    }

    function renderOverlays(current: ReturnType<typeof basis>) {
        overlayElement.innerHTML = '';
        for (const object of store.project.objects) {
            const nav = object.point;
            overlayMarker(new Vector3(nav[0], -nav[2], nav[1]), object.id, false, current);
        }
        for (let index = 0; index < pending.length; index++) {
            overlayMarker(vector(pending[index].surfacePoint), `observation ${index + 1}`, true, current);
        }
    }

    viewportElement.addEventListener('mousedown', event => {
        dragDistance = 0;
        if (event.shiftKey) return;
        dragging = true;
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', event => {
        if (!dragging) return;
        dragDistance += Math.abs(event.movementX) + Math.abs(event.movementY);
        yaw -= event.movementX * 0.002;
        pitch -= event.movementY * 0.002;
        const limit = Math.PI / 2 - 0.01;
        pitch = Math.max(-limit, Math.min(limit, pitch));
    });
    viewportElement.addEventListener('click', event => {
        if (!event.shiftKey || dragDistance > 3) return;
        const rect = viewportElement.getBoundingClientRect();
        const pixelX = event.clientX - rect.left;
        const pixelY = event.clientY - rect.top;
        const current = basis(yaw, pitch);
        const ray = screenRay(
            pixelX,
            pixelY,
            rect.width,
            rect.height,
            camera.fov,
            cameraPosition,
            current.forward,
            current.right,
            current.imageUp,
        );
        const hit = collision.queryRay(
            ray.origin.x,
            -(ray.origin.y - voxelVerticalOffset),
            ray.origin.z,
            ray.direction.x,
            -ray.direction.y,
            ray.direction.z,
            maxRayDistance,
        );
        if (!hit) {
            statusElement.textContent = 'No collision surface found along clicked ray';
            return;
        }
        const surfacePoint = voxelHitToAholo(hit, voxelVerticalOffset);
        pending.push({
            id: crypto.randomUUID(),
            viewId: `view_${String(++viewCounter).padStart(4, '0')}`,
            pixel: { x: pixelX, y: pixelY },
            camera: {
                position: record(cameraPosition),
                yaw,
                pitch,
                roll: 0,
            },
            rayOrigin: record(ray.origin),
            rayDirection: record(ray.direction),
            surfacePoint: record(surfacePoint),
            navSurfacePoint: aholoToNav(surfacePoint),
            createdAt: new Date().toISOString(),
        });
        statusElement.textContent = `Accepted observation ${pending.length}; move to another view and Shift+Click again`;
        renderPendingMetric();
    });

    window.addEventListener('keydown', event => { keys[event.key.toLowerCase()] = true; });
    window.addEventListener('keyup', event => { keys[event.key.toLowerCase()] = false; });

    document.getElementById('undo-observation')?.addEventListener('click', () => {
        pending.pop();
        renderPendingMetric();
    });
    document.getElementById('clear-observations')?.addEventListener('click', () => {
        pending.length = 0;
        renderPendingMetric();
    });
    document.getElementById('save-instance')?.addEventListener('click', () => {
        const id = idInput.value.trim();
        const type = typeInput.value.trim();
        if (!id || !type) {
            statusElement.textContent = 'Instance ID and semantic type are required';
            return;
        }
        if (pending.length === 0) {
            statusElement.textContent = 'Add at least one Shift+Click observation';
            return;
        }
        if (store.project.objects.some(object => object.id === id)) {
            statusElement.textContent = `Instance ID already exists: ${id}`;
            return;
        }
        const solution = solveObservations(pending);
        const now = new Date().toISOString();
        const object: SemanticInstance = {
            id,
            type,
            shape: 'point',
            point: aholoToNav(solution.point),
            color: colorInput.value.trim() || 'unknown',
            label_size: sizeInput.value,
            landmark_policy: 'point_center',
            feature_prefix: id,
            annotation: {
                source: 'aholo_multiview_manual',
                observations: pending.map(observation => ({ ...observation })),
                rayResidual: solution.residual,
                confidence: confidence(pending.length, solution.residual),
                createdAt: now,
                updatedAt: now,
            },
        };
        store.project.objects.push(object);
        store.save();
        pending.length = 0;
        idInput.value = '';
        renderPendingMetric();
        renderInstanceList();
        statusElement.textContent = `Saved ${id} in browser storage`;
    });
    document.getElementById('export-json')?.addEventListener('click', () => store.download());
    document.getElementById('import-json')?.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
        const file = importFile.files?.[0];
        if (!file) return;
        try {
            await store.importFile(file);
            renderInstanceList();
            statusElement.textContent = `Imported ${store.project.objects.length} objects`;
        } catch (error) {
            statusElement.textContent = error instanceof Error ? error.message : String(error);
        } finally {
            importFile.value = '';
        }
    });

    loadingElement.style.display = 'none';
    renderPendingMetric();
    renderInstanceList();

    let previous = performance.now();
    function tick(now: number) {
        requestAnimationFrame(tick);
        const dt = Math.min(0.05, (now - previous) / 1000);
        previous = now;
        const current = basis(yaw, pitch);
        const move = new Vector3();
        if (keys.w) move.add(current.forward);
        if (keys.s) move.addScaledVector(current.forward, -1);
        if (keys.a) move.addScaledVector(current.right, -1);
        if (keys.d) move.add(current.right);
        if (keys.q) move.y -= 1;
        if (keys.e) move.y += 1;
        if (move.lengthSq() > 0) cameraPosition.addScaledVector(move.normalize(), dt * 2.5);
        const updated = updateCamera();
        scene.notifySceneChange();
        viewer.render();
        renderOverlays(updated);
    }
    window.addEventListener('resize', () => {
        camera.aspect = viewportElement.clientWidth / viewportElement.clientHeight;
        viewer.resize();
    });
    updateCamera();
    requestAnimationFrame(tick);
}

main().catch(error => {
    console.error(error);
    loadingElement.textContent = error instanceof Error ? error.message : String(error);
    statusElement.textContent = 'Initialization failed';
});
