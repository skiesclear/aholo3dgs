# Aholo semantic instance annotator

This is an isolated browser entry point for instance-aware point annotation.
It does not modify or replace `index.html` or `python-control.html`.

## Open

Start the existing Vite server, then open:

```text
http://127.0.0.1:5173/semantic-annotator.html
```

The default resources are the badminton-court SOG and voxel files. Other
scenes can be selected without changing source code:

```text
semantic-annotator.html?env=env_gs_room&splat=./resource/room.sog&voxelJson=./resource/room.voxel.json&voxelBin=./resource/room.voxel.bin
```

Optional initial camera parameters are `x`, `y`, `z`, `yaw`, and
`pitch`. `voxelVerticalOffset` and `maxRayDistance` are also configurable.

## Workflow

1. Drag to rotate the camera and use W/A/S/D/Q/E to move.
2. Hold Shift and click a visible semantic point.
3. Move to another viewpoint and Shift+Click the same point again.
4. Enter a stable instance id and semantic type, then save.
5. Export `object_anchors_<env>.json`.

The exported `objects` records use `shape: point`,
`landmark_policy: point_center`, and OpenFly navigation coordinates, so they
can be consumed by `build_landmarks_from_objects.py`. Additional
`annotation` metadata records every camera ray, clicked surface point,
triangulation residual, and confidence for later auditing.

Annotations are autosaved in browser local storage. Import/export is explicit
so existing project files are never overwritten by the browser.

## Current scope

This first version supports point instances. It provides the shared foundation
for later oriented boxes, planes, image masks, and multi-view instance
segmentation without coupling those features to the drone controller.
