# Aholo semantic instance annotator

This is an isolated browser entry point for instance-aware geometric annotation.
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
2. For thin or non-solid objects, keep the default Multiview ray mode.
3. Choose Point, Oriented 3D box, Planar quadrilateral, or Polygon area.
4. Hold Shift and click one exact vertex. Move the camera to another position
   and Shift+Click that exact vertex again.
5. Confirm the vertex and repeat for the remaining vertices.
6. Use Voxel surface snap only for solid surfaces represented by collision voxels.
7. Enter a stable instance id and semantic type, then save and export.

The exported records use OpenFly-compatible `point`, `box`, `rectangle`,
and `polygon` shapes and OpenFly navigation coordinates, so they
can be consumed by `build_landmarks_from_objects.py`. Additional
`annotation` metadata records every camera ray, clicked surface point,
triangulation residual, and confidence for later auditing.

Multiview ray mode deliberately ignores the first collision surface. This
prevents thin objects such as nets, wires, signs, and rails from being snapped
to the floor or a wall when they are absent from the coarse collision voxels.
The default maximum accepted ray residual is 0.5 meters and can be changed with
the `maxTriangulationResidual` URL parameter.
Quadrilateral and polygon vertices must be coplanar within 0.25 meters. Change
this tolerance with the `maxPlanarityError` URL parameter when appropriate.

Annotations are autosaved in browser local storage. Import/export is explicit
so existing project files are never overwritten by the browser.

## Current scope

An oriented box uses a base center, a length-direction edge point, a
width-direction edge point, and a numeric height. The direction points specify
half-extents, and yaw comes from the length direction in the OpenFly XY plane.
A quadrilateral requires four ordered corners. A polygon accepts at least three
ordered vertices. Plane vertices remain fully three-dimensional instead of
being flattened onto the navigation ground.
