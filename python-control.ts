import {
    createViewer,
    setViewerConfig,
    PerspectiveCamera,
    Scene3D,
    BackgroundMode,
    Vector3,
    Color,
    ToneMapping,
    SplatLoader,
    SplatUtils,

    AmbientLight,
    DirectionalLight,

    GLTFLoader,
    downloadTexture,
    Object3D,
} from '@manycore/aholo-viewer';

import { VoxelCollision } from './VoxelCollision';

const SPLAT_URL = './resource/badminton_court.sog';
const VOXEL_JSON_URL = './resource/badminton_court.voxel.json';
const VOXEL_BIN_URL = './resource/badminton_court.voxel.bin';
const GLB_SCENE = './resource/badminton_court.collision.glb';
const DRONE_MODEL_URL = './resource/drone.glb';
const VOXEL_OFFSET_X = 0;
const VOXEL_OFFSET_Y = 0;
const VOXEL_OFFSET_Z = 0;
const SPEED = 0.08;
const COCKPIT_FORWARD_OFFSET = 0.17;
const COCKPIT_UP_OFFSET = 0.12;
const CAPTURE_SETTLE_FRAMES = 90;
const CAPTURE_SETTLE_MS = 1000;
const DEFAULT_DEPTH_MAX_DISTANCE = 100;
const DEPTH_16_UNIT_SCALE = 100;
const INITIAL_POSE: Pose6DoF = {
    x: -2.5,
    y: -3.2,
    z: 4.0,
    roll: 0,
    pitch: 0,
    yaw: 0,
};

const { loadGLTF } = GLTFLoader;

type Pose6DoF = {
    x: number;
    y: number;
    z: number;
    roll: number;
    pitch: number;
    yaw: number;
};

type CollisionInfo = {
    occurred: boolean;
    source: string;
    requestedPose: Pose6DoF;
    resolvedPose: Pose6DoF;
    push: { x: number; y: number; z: number };
    at: number;
};

type DroneState = {
    pose: Pose6DoF;
    radius: number;
    connected: boolean;
    moving: boolean;
    lastCollision: CollisionInfo | null;
    frame: number;
};

type ControllerCommand = {
    id?: string;
    method?: string;
    payload?: any;
    type?: string;
};

type DepthImageResult = {
    image: string;
    depth16: string;
    width: number;
    height: number;
    hitCount: number;
    minDepth: number | null;
    maxDepth: number | null;
    maxDistance: number;
    visualMaxDepth: number;
    depth16Unit: 'centimeter';
    depth16Scale: number;
};

const container = document.getElementById('container') as HTMLDivElement;
const loadingEl = document.getElementById('loading') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

function controllerBaseUrl() {
    const params = new URLSearchParams(window.location.search);
    return (params.get('controller') || 'http://127.0.0.1:8765').replace(/\/$/, '');
}

async function loadCollision(): Promise<VoxelCollision> {
    const metadata = await fetch(VOXEL_JSON_URL).then(r => r.json());
    const binBuffer = await fetch(VOXEL_BIN_URL).then(r => r.arrayBuffer());
    const allU32 = new Uint32Array(binBuffer);
    const nodeCount = metadata.nodeCount >>> 0;
    const leafDataCount = metadata.leafDataCount >>> 0;
    const nodes = allU32.slice(0, nodeCount);
    const leafData = allU32.slice(nodeCount, nodeCount + leafDataCount);
    return new VoxelCollision(metadata, nodes, leafData);
}

async function loadDroneModel() {
    const response = await fetch(DRONE_MODEL_URL);
    const buffer = await response.arrayBuffer();
    const result = await loadGLTF(buffer, { textureLoader: downloadTexture });
    return result.scene;
}

function clonePose(pose: Pose6DoF): Pose6DoF {
    return {
        x: pose.x,
        y: pose.y,
        z: pose.z,
        roll: pose.roll,
        pitch: pose.pitch,
        yaw: pose.yaw,
    };
}

function normalize(v: Vector3) {
    if (v.lengthSq() > 1e-12) {
        v.normalize();
    }
    return v;
}

function getBasis(pose: Pose6DoF) {
    const cosPitch = Math.cos(pose.pitch);
    const forward = normalize(new Vector3(
        cosPitch * Math.sin(pose.yaw),
        Math.sin(pose.pitch),
        cosPitch * Math.cos(pose.yaw),
    ));

    const right = normalize(new Vector3(
        Math.cos(pose.yaw),
        0,
        -Math.sin(pose.yaw),
    ));

    const imageUp = normalize(right.clone().cross(forward));
    const rollCos = Math.cos(pose.roll);
    const rollSin = Math.sin(pose.roll);

    const rolledRight = normalize(right.clone().multiplyScalar(rollCos).addScaledVector(imageUp, rollSin));
    const rolledUp = normalize(right.clone().multiplyScalar(-rollSin).addScaledVector(imageUp, rollCos));

    return {
        forward,
        back: forward.clone().multiplyScalar(-1),
        right: rolledRight,
        left: rolledRight.clone().multiplyScalar(-1),
        imageUp: rolledUp,
        down: rolledUp.clone().multiplyScalar(-1),
    };
}

function poseToVector(pose: Pose6DoF) {
    return new Vector3(pose.x, pose.y, pose.z);
}

function getCockpitPosition(pose: Pose6DoF, basis = getBasis(pose)) {
    return poseToVector(pose)
        .addScaledVector(basis.forward, COCKPIT_FORWARD_OFFSET)
        .addScaledVector(basis.imageUp, COCKPIT_UP_OFFSET);
}

function rgbaToDataUrl(data: Uint8Array, width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('2D canvas context is unavailable.');
    }

    const image = ctx.createImageData(width, height);
    const stride = width * 4;
    for (let y = 0; y < height; y++) {
        const sourceStart = (height - 1 - y) * stride;
        const targetStart = y * stride;
        image.data.set(data.subarray(sourceStart, sourceStart + stride), targetStart);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
}

function imageDataToDataUrl(data: Uint8ClampedArray, width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('2D canvas context is unavailable.');
    }

    const image = ctx.createImageData(width, height);
    image.data.set(data);
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
}

function encodeDepthImages(
    depths: Float32Array,
    width: number,
    height: number,
    maxDistance: number,
    requestedVisualMaxDepth?: number,
): DepthImageResult {
    let hitCount = 0;
    let minDepth = Infinity;
    let maxDepth = 0;

    for (const depth of depths) {
        if (depth > 0 && Number.isFinite(depth)) {
            hitCount++;
            minDepth = Math.min(minDepth, depth);
            maxDepth = Math.max(maxDepth, depth);
        }
    }

    const visualMaxDepth = Math.max(
        1e-6,
        requestedVisualMaxDepth || maxDepth || maxDistance,
    );
    const visual = new Uint8ClampedArray(width * height * 4);
    const packed16 = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < depths.length; i++) {
        const depth = depths[i];
        const offset = i * 4;
        if (depth > 0 && Number.isFinite(depth)) {
            const shade = Math.max(0, Math.min(255, Math.round((depth / visualMaxDepth) * 255)));
            const depth16 = Math.max(
                1,
                Math.min(65535, Math.round(depth * DEPTH_16_UNIT_SCALE)),
            );

            visual[offset] = shade;
            visual[offset + 1] = shade;
            visual[offset + 2] = shade;
            visual[offset + 3] = 255;

            packed16[offset] = (depth16 >>> 8) & 0xff;
            packed16[offset + 1] = depth16 & 0xff;
            packed16[offset + 2] = 0;
            packed16[offset + 3] = 255;
        }
    }

    return {
        image: imageDataToDataUrl(visual, width, height),
        depth16: imageDataToDataUrl(packed16, width, height),
        width,
        height,
        hitCount,
        minDepth: hitCount > 0 ? minDepth : null,
        maxDepth: hitCount > 0 ? maxDepth : null,
        maxDistance,
        visualMaxDepth,
        depth16Unit: 'centimeter',
        depth16Scale: DEPTH_16_UNIT_SCALE,
    };
}

function hasNonBlackPixels(data: Uint8Array) {
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) {
            return true;
        }
    }
    return false;
}

async function postJson(url: string, body: any) {
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

async function createScene() {
    const viewer = createViewer('python-control-viewer', container, {});
    const scene = new Scene3D();
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new PerspectiveCamera(60, aspect, 0.1, 2000);
    const lights = new Object3D();
    const droneRoot = new Object3D();

    viewer.setScene(scene);
    viewer.setCamera(camera);
    setViewerConfig(viewer, {
        pipeline: {
            Background: {
                up:
                    new Vector3(
                        0,
                        -1,
                        0
                    ),
                background: {
                    active: BackgroundMode.BasicBackground,
                    gradient: {
                        skyColor:
                            new Color(
                                1,
                                0.975,
                                0.975
                            ),
                        groundColor:
                            new Color(
                                0.5,
                                0.4,
                                0.4
                            ),
                    },
                },
                ground: { enabled: false },
            },
            Splatting: {
                enabled: true,
                pack: {
                    highPrecisionEnabled: true,
                    precalculateEnabled: true,
                },
                sort: {
                    highPrecisionEnabled: true,
                },
                composite: {
                    enabled: true,
                    highPrecisionEnabled: true,
                },
                raster: {
                    normalizedFalloff: false,
                    preBlurAmount: 0.3,
                    blurAmount: 0,
                    focalAdjustment: 2,
                    detailCullingThreshold: 1,
                },
                toneMapping: {
                    enabled: true,
                    toneMapping: ToneMapping.Neutral,
                    exposure: 1.25,
                },
             },
            TAA: { enabled: false },
        },
    });
    viewer.resume();
    viewer.resize();
    camera.up.set(0, -1, 0);

    const splatBuffer = await fetch(SPLAT_URL).then(r => r.arrayBuffer());
    const splatData = await SplatLoader.parseSplatData(
        SplatLoader.SplatFileType.SOG,
        new Uint8Array(splatBuffer),
        SplatLoader.SplatPackType.Sog,
    );
    scene.add(await SplatUtils.createSplat(splatData));

    lights.visible = false;
    const ambient = new AmbientLight(0xffffff, 0.95);
    const key = new DirectionalLight(0xffffff, 1.35);
    key.position.set(0.4, 1.0, 0.35);
    const fill = new DirectionalLight(0xffffff, 0.55);
    lights.add(ambient);
    lights.add(key);
    lights.add(fill);
    lights.visible = true;
    scene.add(lights);

    scene.add(droneRoot);
    const droneModel = await loadDroneModel();
    const rotors: any[] = [];
    for (const name of ['Circle.002', 'Circle.003', 'Circle.004', 'Circle.005']) {
        droneModel.traverse((node: any) => {
            if (node.name === name) {
                rotors.push(node);
            }
        });
    }
    droneRoot.add(droneModel);
    droneModel.visible = true;
    droneModel.scale.set(0.1, -0.1, 0.1);
    for (const rotor of rotors) {
        rotor.scale.set(0.3, 0.1, 0.1);
    }

    const collision = await loadCollision();
    loadingEl.style.display = 'none';

    const pose: Pose6DoF = clonePose(INITIAL_POSE);
    const keys: Record<string, boolean> = {};
    let connected = false;
    let moving = false;
    let frame = 0;
    let lastCollision: CollisionInfo | null = null;
    let captureInProgress = false;
    const baseUrl = controllerBaseUrl();
    const clientId = crypto.randomUUID();

    function getState(): DroneState {
        return {
            pose: clonePose(pose),
            radius: 0.25,
            connected,
            moving,
            lastCollision,
            frame,
        };
    }

    function renderPose(renderCamera = true) {
        droneRoot.position.set(pose.x, pose.y, pose.z);
        droneRoot.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
        droneRoot.visible = true;

        if (renderCamera) {
            const basis = getBasis(pose);
            const cameraPos = getCockpitPosition(pose, basis);
            camera.position.copy(cameraPos);
            camera.up.copy(basis.imageUp);
            camera.lookAt(cameraPos.clone().add(basis.forward));
        }
        scene.notifySceneChange();
    }

    function resolvePose(requested: Pose6DoF, source: string): CollisionInfo | null {
        const next = clonePose(requested);
        const push = { x: 0, y: 0, z: 0 };
        const hit = collision.queryCapsule(
            -(next.x + VOXEL_OFFSET_X),
            -(next.y + VOXEL_OFFSET_Y),
            next.z + VOXEL_OFFSET_Z,
            0.1,
            0.2,
            push,
        );

        if (!hit) {
            Object.assign(pose, next);
            return null;
        }

        next.x += push.x;
        next.y -= push.y;
        next.z += push.z;
        Object.assign(pose, next);
        const info: CollisionInfo = {
            occurred: true,
            source,
            requestedPose: clonePose(requested),
            resolvedPose: clonePose(next),
            push: { x: push.x, y: -push.y, z: push.z },
            at: Date.now() / 1000,
        };
        lastCollision = info;
        void postJson(`${baseUrl}/event`, { type: 'collision', clientId, event: info });
        return info;
    }

    function tryMove(dx: number, dy: number, dz: number) {
        const requested = clonePose(pose);
        requested.x += dx;
        requested.y += dy;
        requested.z += dz;
        return resolvePose(requested, 'keyboard');
    }

    function updateKeyboardMotion() {
        const basis = getBasis(pose);
        const move = new Vector3();
        if (keys['w']) move.add(basis.forward);
        if (keys['s']) move.addScaledVector(basis.forward, -1);
        if (keys['a']) move.addScaledVector(basis.right, -1);
        if (keys['d']) move.add(basis.right);
        if (keys['q']) move.y -= 1;
        if (keys['e']) move.y += 1;
        moving = move.lengthSq() > 0;
        if (!moving) {
            return;
        }
        move.normalize();
        tryMove(move.x * SPEED, move.y * SPEED, move.z * SPEED);
    }

    async function waitForCaptureSettle() {
        for (let i = 0; i < CAPTURE_SETTLE_FRAMES; i++) {
            viewer.render();
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        if (CAPTURE_SETTLE_MS > 0) {
            await new Promise(resolve => setTimeout(resolve, CAPTURE_SETTLE_MS));
        }
        viewer.render();
    }

    async function captureView(origin: Vector3, direction: Vector3, up: Vector3, width: number, height: number) {
        const previousVisibility = droneRoot.visible;
        droneRoot.visible = false;
        viewer.resize({ width, height });
        camera.aspect = width / height;
        camera.position.copy(origin);
        camera.up.copy(up);
        camera.lookAt(origin.clone().add(direction));
        scene.notifySceneChange();
        await waitForCaptureSettle();

        const pixels = new Uint8Array(width * height * 4);
        const result = viewer.readRenderResultAsync(pixels, { x: 0, y: 0, width, height });
        if (result) {
            await result;
        } else {
            viewer.readRenderResult(pixels, { x: 0, y: 0, width, height });
        }
        const dataUrl = hasNonBlackPixels(pixels)
            ? rgbaToDataUrl(pixels, width, height)
            : viewer.readRenderResultDataUrl('image/png');
        if (!hasNonBlackPixels(pixels)) {
            console.warn('Framebuffer readback was all black; used canvas data URL fallback.');
        }
        droneRoot.visible = previousVisibility;
        viewer.resize();
        camera.aspect = container.clientWidth / container.clientHeight;
        renderPose();
        return dataUrl;
    }

    function captureVoxelDepthView(
        origin: Vector3,
        direction: Vector3,
        up: Vector3,
        width: number,
        height: number,
        maxDistance: number,
        visualMaxDepth?: number,
    ): DepthImageResult {
        const forward = normalize(direction.clone());
        const right = normalize(forward.clone().cross(up));
        const imageUp = normalize(right.clone().cross(forward));
        const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
        const aspect = width / height;
        const depths = new Float32Array(width * height);

        const voxelOriginX = origin.x - VOXEL_OFFSET_X;
        const voxelOriginY = -(origin.y - 0.55);
        const voxelOriginZ = origin.z - VOXEL_OFFSET_Z;

        for (let y = 0; y < height; y++) {
            const screenY = (1 - ((y + 0.5) / height) * 2) * tanHalfFov;
            for (let x = 0; x < width; x++) {
                const screenX = (((x + 0.5) / width) * 2 - 1) * aspect * tanHalfFov;
                let rayX = forward.x + right.x * screenX + imageUp.x * screenY;
                let rayY = forward.y + right.y * screenX + imageUp.y * screenY;
                let rayZ = forward.z + right.z * screenX + imageUp.z * screenY;
                const rayLength = Math.hypot(rayX, rayY, rayZ);

                rayX /= rayLength;
                rayY /= rayLength;
                rayZ /= rayLength;

                const hit = collision.queryRay(
                    voxelOriginX,
                    voxelOriginY,
                    voxelOriginZ,
                    rayX,
                    -rayY,
                    rayZ,
                    maxDistance,
                );

                if (!hit) {
                    continue;
                }

                const rayDistance = Math.hypot(
                    hit.x - voxelOriginX,
                    hit.y - voxelOriginY,
                    hit.z - voxelOriginZ,
                );
                const viewDepth = rayDistance * (
                    rayX * forward.x +
                    rayY * forward.y +
                    rayZ * forward.z
                );

                depths[y * width + x] = viewDepth;
            }
        }

        return encodeDepthImages(depths, width, height, maxDistance, visualMaxDepth);
    }

    function captureFiveVoxelDepth(payload: any) {
        if (payload?.pose) {
            resolvePose(payload.pose, 'depth-capture');
            renderPose(false);
        }

        const width = Math.max(1, Math.floor(payload?.depthWidth || payload?.width || container.clientWidth || 960));
        const height = Math.max(1, Math.floor(payload?.depthHeight || payload?.height || container.clientHeight || 540));
        const maxDistance = Math.max(1e-6, Number(payload?.maxDistance || DEFAULT_DEPTH_MAX_DISTANCE));
        const visualMaxDepth = payload?.visualMaxDepth === undefined
            ? undefined
            : Math.max(1e-6, Number(payload.visualMaxDepth));
        const basis = getBasis(pose);
        const captureOrigin = poseToVector(pose);
        const up = basis.imageUp;
        const depths: Record<string, DepthImageResult> = {};

        depths.front = captureVoxelDepthView(captureOrigin, basis.forward, up, width, height, maxDistance, visualMaxDepth);
        depths.back = captureVoxelDepthView(captureOrigin, basis.back, up, width, height, maxDistance, visualMaxDepth);
        depths.left = captureVoxelDepthView(captureOrigin, basis.left, up, width, height, maxDistance, visualMaxDepth);
        depths.right = captureVoxelDepthView(captureOrigin, basis.right, up, width, height, maxDistance, visualMaxDepth);
        depths.down = captureVoxelDepthView(captureOrigin, basis.down, basis.forward, width, height, maxDistance, visualMaxDepth);

        return { pose: clonePose(pose), width, height, depths };
    }

    async function captureFive(payload: any) {
        captureInProgress = true;
        try {
            if (payload?.pose) {
                resolvePose(payload.pose, 'capture');
                renderPose(false);
            }
            const width = Math.max(1, Math.floor(payload?.width || container.clientWidth || 960));
            const height = Math.max(1, Math.floor(payload?.height || container.clientHeight || 540));
            const basis = getBasis(pose);
            const captureOrigin = poseToVector(pose);
            const up = basis.imageUp;
            const captures: Record<string, string> = {};
            captures.front = await captureView(captureOrigin, basis.forward, up, width, height);
            captures.back = await captureView(captureOrigin, basis.back, up, width, height);
            captures.left = await captureView(captureOrigin, basis.left, up, width, height);
            captures.right = await captureView(captureOrigin, basis.right, up, width, height);
            captures.down = await captureView(captureOrigin, basis.down, basis.forward, width, height);
            if (!payload?.includeDepth) {
                return { pose: clonePose(pose), width, height, images: captures };
            }

            const maxDistance = Math.max(1e-6, Number(payload?.maxDistance || DEFAULT_DEPTH_MAX_DISTANCE));
            const visualMaxDepth = payload?.visualMaxDepth === undefined
                ? undefined
                : Math.max(1e-6, Number(payload.visualMaxDepth));
            const depthWidth = Math.max(1, Math.floor(payload?.depthWidth || width));
            const depthHeight = Math.max(1, Math.floor(payload?.depthHeight || height));
            const depths: Record<string, DepthImageResult> = {};

            depths.front = captureVoxelDepthView(captureOrigin, basis.forward, up, depthWidth, depthHeight, maxDistance, visualMaxDepth);
            depths.back = captureVoxelDepthView(captureOrigin, basis.back, up, depthWidth, depthHeight, maxDistance, visualMaxDepth);
            depths.left = captureVoxelDepthView(captureOrigin, basis.left, up, depthWidth, depthHeight, maxDistance, visualMaxDepth);
            depths.right = captureVoxelDepthView(captureOrigin, basis.right, up, depthWidth, depthHeight, maxDistance, visualMaxDepth);
            depths.down = captureVoxelDepthView(captureOrigin, basis.down, basis.forward, depthWidth, depthHeight, maxDistance, visualMaxDepth);

            return {
                pose: clonePose(pose),
                width,
                height,
                images: captures,
                depthWidth,
                depthHeight,
                depths,
            };
        } finally {
            captureInProgress = false;
            renderPose();
        }
    }

    async function handleCommand(command: ControllerCommand) {
        switch (command.method) {
            case 'set_pose': {
                const collisionInfo = resolvePose(command.payload.pose, 'python');
                renderPose();
                return { state: getState(), collision: collisionInfo };
            }
            case 'get_state':
                return getState();
            case 'capture_five':
                return captureFive(command.payload || {});
            case 'capture_depth_five': {
                captureInProgress = true;
                try {
                    return captureFiveVoxelDepth(command.payload || {});
                } finally {
                    captureInProgress = false;
                    renderPose();
                }
            }
            case 'ping':
                return { pong: true, state: getState() };
            default:
                throw new Error(`Unknown command: ${command.method}`);
        }
    }

    async function registerController(baseUrl: string, clientId: string, getState: () => DroneState) {
        connected = false;
        while (true) {
            try {
                await postJson(`${baseUrl}/client-ready`, { clientId, state: getState() });
                connected = true;
                statusEl.textContent = `controller: connected ${baseUrl}`;
                return;
            } catch {
                statusEl.textContent = `controller: waiting ${baseUrl}`;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    async function controllerLoop() {
        while (true) {
            await registerController(baseUrl, clientId, getState);

            while (true) {
                try {
                    const response = await fetch(`${baseUrl}/poll?clientId=${encodeURIComponent(clientId)}`);
                    const command = await response.json() as ControllerCommand;
                    if (!command.id || command.type === 'noop') {
                        continue;
                    }
                    try {
                        const result = await handleCommand(command);
                        await postJson(`${baseUrl}/response`, { id: command.id, ok: true, result });
                    } catch (error) {
                        await postJson(`${baseUrl}/response`, {
                            id: command.id,
                            ok: false,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                } catch {
                    connected = false;
                    statusEl.textContent = `controller: reconnecting ${baseUrl}`;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    break;
                }
            }
        }
    }

    async function warmupRenderFrames(count: number) {
        for (let i = 0; i < count; i++) {
            renderPose();
            viewer.render();
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }

    window.addEventListener('keydown', e => {
        keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', e => {
        keys[e.key.toLowerCase()] = false;
    });

    function tick() {
        requestAnimationFrame(tick);
        if (captureInProgress) {
            return;
        }
        frame++;
        updateKeyboardMotion();
        renderPose();
        for (const rotor of rotors) {
            rotor.rotation.z += 0.5;
        }
        viewer.render();
    }

    renderPose();
    await warmupRenderFrames(30);
    tick();
    void controllerLoop();
}

createScene().catch(error => {
    console.error(error);
    loadingEl.textContent = error instanceof Error ? error.message : String(error);
});
