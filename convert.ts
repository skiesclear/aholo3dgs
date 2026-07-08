import {
    SplatLoader,
    SplatUtils,
} from '@manycore/aholo-viewer';

// ---- DOM refs ----
const fileInput = document.getElementById('ply-file') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const progressBar = document.getElementById('progress-bar') as HTMLDivElement;
const progressWrap = document.getElementById('progress') as HTMLDivElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const collisionBtn = document.getElementById('collision-btn') as HTMLButtonElement;
const fileLabel = document.getElementById('file-label') as HTMLLabelElement;

function setStatus(msg: string, type: 'info' | 'done' | 'error' = 'info') {
    statusEl.innerHTML = msg;
    if (type === 'done') statusEl.style.color = '#22c55e';
    else if (type === 'error') statusEl.style.color = '#ff5555';
    else statusEl.style.color = '#aaa';
}

function setProgress(pct: number) {
    progressWrap.style.display = 'block';
    progressBar.style.width = `${pct}%`;
    if (pct >= 100) {
        setTimeout(() => { progressWrap.style.display = 'none'; }, 600);
    }
}

// ---- Read a ReadableStream into a Blob ----
async function streamToBlob(stream: ReadableStream<Uint8Array>): Promise<Blob> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    return new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
}

// ---- Main conversion ----
fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    fileLabel.textContent = file.name;
    fileLabel.style.background = '#333';
    downloadBtn.style.display = 'none';
    collisionBtn.style.display = 'none';
    setProgress(5);
    setStatus('Step 1/3: Parsing PLY file...');

    try {
        // Step 1: Parse PLY → RawSplatData
        setProgress(15);
        const rawData = await SplatLoader.parseSplatData(
            SplatLoader.SplatFileType.PLY,
            file,
            SplatLoader.SplatPackType.Raw,
        );
        setProgress(35);

        // Step 2: Convert to SPZ format → ReadableStream<Uint8Array>
        // transformSplatFile supports: PLY, SPZ, SPLAT (NOT SOG)
        setStatus('Step 2/3: Converting to SPZ format...');
        const spzStream = SplatUtils.transformSplatFile(rawData, SplatLoader.SplatFileType.SPZ);
        setProgress(55);

        // Step 3: Save stream to Blob for download
        const blob = await streamToBlob(spzStream);
        setProgress(80);

        // ---- Re-parse SPZ stream to create Splat + compute collision ----
        // SPZ parses to CompressedSplatData, which createSplat() supports.
        const buffer = await blob.arrayBuffer();
        const compressedData = await SplatLoader.parseSplatData(
            SplatLoader.SplatFileType.SPZ,
            new Uint8Array(buffer),
            SplatLoader.SplatPackType.Compressed,
        );

        // Create splat from CompressedSplatData
        const splat = await SplatUtils.createSplat(compressedData);
        const operator = new SplatUtils.SplatOperator(splat, compressedData);
        const denseResult = SplatUtils.computeDenseBox(operator, 1.0);
        const boxCount = denseResult.boxMin.length / 3;

        setProgress(100);

        // ---- Download SPZ file ----
        const baseName = file.name.replace(/\.ply$/i, '');
        const spzUrl = URL.createObjectURL(blob);

        downloadBtn.style.display = 'inline-block';
        downloadBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = spzUrl;
            a.download = baseName + '.spz';
            a.click();
        };

        // ---- Download collision JSON ----
        const collisionJson = JSON.stringify({
            boxMin: denseResult.boxMin,
            boxMax: denseResult.boxMax,
            boxCount,
        });
        const collisionBlob = new Blob([collisionJson], { type: 'application/json' });
        const collisionUrl = URL.createObjectURL(collisionBlob);

        collisionBtn.style.display = 'inline-block';
        collisionBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = collisionUrl;
            a.download = baseName + '.collision.json';
            a.click();
        };

        setStatus(
            `Done! ${baseName}.spz (${(blob.size / 1024 / 1024).toFixed(1)} MB, ${boxCount} collision cells)`,
            'done',
        );
        fileLabel.style.background = '#4a4aff';
    } catch (err: any) {
        setStatus(`Error: ${err.message || err}`, 'error');
        fileLabel.style.background = '#4a4aff';
        downloadBtn.style.display = 'none';
        collisionBtn.style.display = 'none';
        console.error(err);
    }
});

setStatus('Choose a .ply file to begin conversion');
