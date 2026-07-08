import {
    createViewer,
    setViewerConfig,
    PerspectiveCamera,
    Scene3D,
    BackgroundMode,
    Vector3,
    Color,
    SplatLoader,
    SplatUtils,
} from '@manycore/aholo-viewer';

const SPLAT_URL = 'https://holo-cos.aholo3d.cn/aholo-opensource/gs_file/bear/bear.3d71a266.sog';

// 直接拿 HTML 里已有的元素
const container = document.getElementById('container') as HTMLDivElement;
const loadingEl = document.getElementById('loading') as HTMLDivElement;

async function createScene() {
    const viewer = createViewer('example-viewer', container, {});

    const scene = new Scene3D();
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new PerspectiveCamera(60, aspect, 0.1, 2000);
    viewer.setScene(scene);
    viewer.setCamera(camera);

    setViewerConfig(viewer, {
        pipeline: {
            Background: {
                background: {
                    active: BackgroundMode.BasicBackground,
                    basic: { color: new Color(0, 0, 0) },
                },
                ground: { enabled: false },
            },
            Splatting: { enabled: true },
            TAA: { enabled: false },
        },
    });

    viewer.resume();
    viewer.resize();

    camera.up.set(0, -1, 0);
    camera.position.set(-1.5, -0.5, 0);
    camera.lookAt(new Vector3(0, 0, 0));

    const resp = await fetch(SPLAT_URL);
    const buffer = await resp.arrayBuffer();
    const data = await SplatLoader.parseSplatData(
        SplatLoader.SplatFileType.SOG,
        new Uint8Array(buffer),
        SplatLoader.SplatPackType.Compressed,
    );
    const splat = await SplatUtils.createSplat(data);
    scene.add(splat);

    loadingEl.style.display = 'none';

    // 键盘控制
    const keys: Record<string, boolean> = {};
    window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
    window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
    const SPEED = 0.02;

    // 鼠标视角
    let dragging = false;

    let target = new Vector3(0, 0, 0);

    let radius = 1.58;

    let theta = -Math.PI / 2;
    let phi = Math.PI / 2;
    function updateOrbitCamera() {

        phi = Math.max(
            0.05,
            Math.min(Math.PI - 0.05, phi)
        );

        const offset = new Vector3();

        offset.setFromSphericalCoords(
            radius,
            phi,
            theta
        );

        camera.position.copy(target).add(offset);

        camera.lookAt(target);

        scene.notifySceneChange();
    }
    updateOrbitCamera();
    container.addEventListener('mousedown', () => {
        dragging = true;
    });

    window.addEventListener('mouseup', () => {
        dragging = false;
    });

    window.addEventListener('mousemove', e => {

        if (!dragging) return;

        theta += e.movementX * 0.005;

        phi += e.movementY * 0.005;

        updateOrbitCamera();
    });
    container.addEventListener('wheel', e => {

        radius *= e.deltaY > 0 ? 1.1 : 0.9;

        radius = Math.max(0.2, Math.min(20, radius));

        updateOrbitCamera();

        e.preventDefault();
    });

    function tick() {
        requestAnimationFrame(tick);

        const forward = new Vector3();
        camera.getWorldDirection(forward);
        const right = new Vector3();
        right.crossVectors(forward, camera.up).normalize();

        if (keys['w']) camera.position.addScaledVector(forward, SPEED);
        if (keys['s']) camera.position.addScaledVector(forward, -SPEED);
        if (keys['a']) camera.position.addScaledVector(right, -SPEED);
        if (keys['d']) camera.position.addScaledVector(right, SPEED);

        scene.notifySceneChange();
        viewer.render();
    }
    tick();
}

createScene().catch(console.error);