export type Vec3Record = { x: number; y: number; z: number };

export type CameraPose = {
    position: Vec3Record;
    yaw: number;
    pitch: number;
    roll: number;
};

export type Observation = {
    id: string;
    viewId: string;
    pixel: { x: number; y: number };
    camera: CameraPose;
    rayOrigin: Vec3Record;
    rayDirection: Vec3Record;
    surfacePoint: Vec3Record;
    navSurfacePoint: [number, number, number];
    createdAt: string;
};

export type SemanticInstance = {
    id: string;
    type: string;
    shape: 'point';
    point: [number, number, number];
    color: string;
    label_size: string;
    landmark_policy: 'point_center';
    feature_prefix: string;
    annotation: {
        source: 'aholo_multiview_manual';
        observations: Observation[];
        rayResidual: number | null;
        confidence: number;
        createdAt: string;
        updatedAt: string;
    };
};

export type AnnotationProject = {
    schemaVersion: 1;
    environment: string;
    coordinateFrame: 'openfly_nav';
    objects: SemanticInstance[];
};
