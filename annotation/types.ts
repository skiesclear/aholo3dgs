export type Vec3Record = { x: number; y: number; z: number };
export type NavPoint = [number, number, number];
export type CameraPose = { position: Vec3Record; yaw: number; pitch: number; roll: number };
export type Observation = {
    id: string; viewId: string; pixel: { x: number; y: number }; camera: CameraPose;
    rayOrigin: Vec3Record; rayDirection: Vec3Record;
    positionMode: 'multiview_ray' | 'surface_snap'; surfacePoint: Vec3Record | null;
    navSurfacePoint: NavPoint | null; createdAt: string;
};
export type VertexAnnotation = { role: string; point: NavPoint; observations: Observation[]; rayResidual: number | null };
type CommonInstance = {
    id: string; type: string; color: string; label_size: string; feature_prefix: string;
    annotation: { source: 'aholo_multiview_manual'; vertices: VertexAnnotation[]; confidence: number; createdAt: string; updatedAt: string };
};
export type PointInstance = CommonInstance & { shape: 'point'; point: NavPoint; landmark_policy: 'point_center' };
export type RectangleInstance = CommonInstance & { shape: 'rectangle'; corners: [NavPoint, NavPoint, NavPoint, NavPoint]; landmark_policy: 'rectangle_keypoints' };
export type PolygonInstance = CommonInstance & { shape: 'polygon'; points: NavPoint[]; landmark_policy: 'polygon_keypoints' };
export type BoxInstance = CommonInstance & {
    shape: 'box'; center: NavPoint; size: [number, number, number]; yaw: number;
    corners: [NavPoint, NavPoint, NavPoint, NavPoint, NavPoint, NavPoint, NavPoint, NavPoint]; landmark_policy: 'box_keypoints';
};
export type SemanticInstance = PointInstance | RectangleInstance | PolygonInstance | BoxInstance;
export type AnnotationShape = SemanticInstance['shape'];
export type AnnotationProject = { schemaVersion: 1; environment: string; coordinateFrame: 'openfly_nav'; objects: SemanticInstance[] };
