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

const SPLAT_URL = './new_badminton_court/badminton_court_new_axis.sog';
const VOXEL_JSON_URL = './new_badminton_court/badminton_court_new_axis.voxel.json';
const VOXEL_BIN_URL = './new_badminton_court/badminton_court_new_axis.voxel.bin';
const GLB_SCENE = './new_badminton_court/badminton_court_new_axis.collision.glb';
const DRONE_MODEL_URL = './resource/drone.glb';
const GLB_OFFSET_X = 0;
const GLB_OFFSET_Y = 0;
const GLB_OFFSET_Z = 0;
const VOXEL_OFFSET_X = 0;
const VOXEL_OFFSET_Y = 0;
const VOXEL_OFFSET_Z = 0;
const { loadGLTF } = GLTFLoader;
const container =
    document.getElementById('container') as HTMLDivElement;

const loadingEl =
    document.getElementById('loading') as HTMLDivElement;

loadingEl.textContent =
    'Loading splat data...';

interface DroneState {
    position: Vector3;
    yaw: number;
    pitch: number;
    radius: number;
}

async function fetchRequired(
    url: string
): Promise<Response> {

    const response =
        await fetch(url);

    if (!response.ok) {

        throw new Error(
            `Failed to load ${url}: ${response.status} ${response.statusText}`
        );
    }

    return response;
}

async function loadCollision(): Promise<VoxelCollision> {

    const metadata =
        await fetchRequired(VOXEL_JSON_URL).then(r => r.json());
    console.log(metadata);

    const binBuffer =
        await fetchRequired(VOXEL_BIN_URL).then(r => r.arrayBuffer());

    const allU32 =
        new Uint32Array(binBuffer);

    const nodeCount =
        metadata.nodeCount >>> 0;

    const leafDataCount =
        metadata.leafDataCount >>> 0;

    const nodes =
        allU32.slice(
            0,
            nodeCount
        );

    const leafData =
        allU32.slice(
            nodeCount,
            nodeCount + leafDataCount
        );

    return new VoxelCollision(
        metadata,
        nodes,
        leafData
    );
}

async function loadDroneModel() {

    const response =
        await fetchRequired(DRONE_MODEL_URL);


    const buffer =
        await response.arrayBuffer();

    const result =
        await loadGLTF(
            buffer,
            {
                textureLoader:
                    downloadTexture,
            }
        );



    return result.scene;
}

async function createScene() {

    const viewer =
        createViewer(
            'example-viewer',
            container,
            {}
        );

    const scene =
        new Scene3D();

    // const response =
    //     await fetch(GLB_SCENE);

    // const buffer_GLB_SCENE =
    //     await response.arrayBuffer();

    // const collisionMesh = await loadGLTF(buffer_GLB_SCENE, {
    //     textureLoader:
    //         downloadTexture,
    // })
    // collisionMesh.scene.scale.set(
    //     -1,
    //     -1,
    //     1
    // );
    // collisionMesh.scene.position.set(
    //     GLB_OFFSET_X,
    //     GLB_OFFSET_Y,
    //     GLB_OFFSET_Z
    // );
    // scene.add(collisionMesh.scene);




    const aspect =
        container.clientWidth /
        container.clientHeight;

    const camera =
        new PerspectiveCamera(
            60,
            aspect,
            0.1,
            2000
        );

    const lights = new Object3D();

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
                    active:
                        BackgroundMode.GradientBackground,
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
                ground: {
                    enabled: false,
                },
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
            TAA: {
                enabled: false,
            },
        },
    });

    viewer.resume();
    viewer.resize();

    camera.up.set(
        0,
        -1,
        0
    );

    //
    // 加载场景
    //
    const resp =
        await fetchRequired(SPLAT_URL);

    const buffer =
        await resp.arrayBuffer();

    const data =
        await SplatLoader.parseSplatData(
            SplatLoader.SplatFileType.SOG,
            new Uint8Array(buffer),
            SplatLoader.SplatPackType.Sog
        );

    const splat =
        await SplatUtils.createSplat(data);

    scene.add(splat);

    lights.visible = false;
    const ambient = new AmbientLight(0xffffff, 0.95);
    const key = new DirectionalLight(0xffffff, 1.35);
    key.position.set(0.4, 1.0, 0.35);
    const fill = new DirectionalLight(0xffffff, 0.55);
    lights.add(ambient);
    lights.add(key);
    lights.add(fill);
    lights.visible = true
    scene.add(lights)


    //
    // 加载无人机模型
    //
    const droneRoot =
        new Object3D();

    scene.add(droneRoot);

    const droneModel =
        await loadDroneModel();
    const rotorNames = [
        'Circle.002',
        'Circle.003',
        'Circle.004',
        'Circle.005',
    ];

    droneModel.visible = true

    const rotors: any[] = [];

    droneModel.traverse(node => {

        if (rotorNames.includes(node.name)) {

            rotors.push(node);

        }
    });

    droneRoot.add(droneModel);

    droneModel.scale.set(
        0.1,
        -0.1,
        0.1
    );

    //
    // 加载碰撞
    //
    const collision =
        await loadCollision();



    loadingEl.style.display =
        'none';

    //
    // 无人机状态
    //
    const drone: DroneState = {
        position:
            new Vector3(
                0,
                -1,
                0
            ),
        yaw: 0,
        pitch: 0,
        radius: 0.25,
    };

    //
    // 键盘
    //
    const keys:
        Record<string, boolean> = {};

    // window.addEventListener('keydown', e => {

    //     if (e.key === '1')
    //         collisionMesh.scene.position.x += 0.1;

    //     if (e.key === '2')
    //         collisionMesh.scene.position.x -= 0.1;

    //     if (e.key === '3')
    //         collisionMesh.scene.position.z += 0.1;

    //     if (e.key === '4')
    //         collisionMesh.scene.position.z -= 0.1;

    //     console.log(
    //         collisionMesh.scene.position
    //     );
    // });

    window.addEventListener(
        'keydown',
        e => {
            keys[
                e.key.toLowerCase()
            ] = true;
        }
    );

    window.addEventListener(
        'keyup',
        e => {
            keys[
                e.key.toLowerCase()
            ] = false;
        }
    );

    //
    // 鼠标
    //
    let dragging = false;

    container.addEventListener(
        'mousedown',
        () => {
            dragging = true;
        }
    );

    window.addEventListener(
        'mouseup',
        () => {
            dragging = false;
        }
    );

    window.addEventListener(
        'mousemove',
        e => {

            if (!dragging)
                return;

            drone.yaw -=
                e.movementX *
                0.002;

            drone.pitch -=
                e.movementY *
                0.002;

            const limit =
                Math.PI / 2 - 0.01;

            drone.pitch =
                Math.max(
                    -limit,
                    Math.min(
                        limit,
                        drone.pitch
                    )
                );
        }
    );

    function getForward() {

        return new Vector3(
            Math.cos(
                drone.pitch
            ) *
            Math.sin(
                drone.yaw
            ),

            Math.sin(
                drone.pitch
            ),

            Math.cos(
                drone.pitch
            ) *
            Math.cos(
                drone.yaw
            )
        ).normalize();
    }

    function updateDroneModel() {

        droneRoot.position.copy(
            drone.position
        );

        droneRoot.rotation.set(
            0,
            drone.yaw,
            0
        );
    }

    function updateCamera() {

        const forward =
            getForward();

        const cameraPos =
            drone.position.clone();

        cameraPos.addScaledVector(
            forward,
            -1.5
        );

        cameraPos.y -= 0.4;

        camera.position.copy(
            cameraPos
        );

        camera.lookAt(
            drone.position
        );
    }


    function tryMove(
        dx: number,
        dy: number,
        dz: number
    ) {

        const next =
            drone.position.clone();

        next.x += dx;
        next.y += dy;
        next.z += dz;

        const push = {
            x: 0,
            y: 0,
            z: 0,
        };

        const hit =
            collision.queryCapsule(
                -(next.x + VOXEL_OFFSET_X),
                -(next.y + VOXEL_OFFSET_Y),
                next.z + VOXEL_OFFSET_Z,
                0.1,
                0.2,
                push
            );

        if (hit) {

            next.x += push.x;
            next.y -= push.y;
            next.z += push.z;
        }

        drone.position.copy(
            next
        );
    }

    const SPEED = 0.08;

    function updateDrone() {

        const forward =
            getForward();

        const right =
            new Vector3(
                forward.z,
                0,
                -forward.x
            ).normalize();

        const move =
            new Vector3();

        if (keys['w'])
            move.add(
                forward
            );

        if (keys['s'])
            move.addScaledVector(
                forward,
                -1
            );

        if (keys['a'])
            move.addScaledVector(
                right,
                -1
            );

        if (keys['d'])
            move.add(
                right
            );

        if (keys['q'])
            move.y -= 1;

        if (keys['e'])
            move.y += 1;

        if (
            move.lengthSq() === 0
        ) {
            return;
        }

        move.normalize();

        tryMove(
            move.x * SPEED,
            move.y * SPEED,
            move.z * SPEED
        );
    }

    function tick() {

        requestAnimationFrame(
            tick
        );

        updateDrone();

        updateDroneModel();

        updateCamera();

        for (const rotor of rotors) {

            rotor.rotation.z += 0.5;
        }

        scene.notifySceneChange();

        viewer.render();
    }

    updateCamera();

    tick();
}

createScene().catch(
    error => {

        console.error(error);

        loadingEl.textContent =
            error instanceof Error ?
                error.message :
                String(error);
    }
);
