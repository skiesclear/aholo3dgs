import type { AnnotationProject } from './types';

export class AnnotationStore {
    private readonly key: string;
    project: AnnotationProject;

    constructor(environment: string) {
        this.key = `aholo-semantic-annotations:${environment}`;
        this.project = {
            schemaVersion: 1,
            environment,
            coordinateFrame: 'openfly_nav',
            objects: [],
        };
        this.load();
    }

    load() {
        const raw = localStorage.getItem(this.key);
        if (!raw) return;
        const parsed = JSON.parse(raw) as AnnotationProject;
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.objects)) {
            throw new Error('Unsupported annotation project schema');
        }
        this.project = parsed;
    }

    save() {
        localStorage.setItem(this.key, JSON.stringify(this.project));
    }

    download() {
        const payload = JSON.stringify({ objects: this.project.objects }, null, 2) + '\n';
        const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `object_anchors_${this.project.environment}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }

    async importFile(file: File) {
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed.objects)) {
            throw new Error('Imported JSON must contain an objects array');
        }
        this.project.objects = parsed.objects;
        this.save();
    }
}
