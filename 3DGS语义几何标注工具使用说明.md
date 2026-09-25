# 3DGS 语义几何标注工具使用说明

本文档介绍 `aholo3dgs/semantic-annotator.html`。该页面用于直接在 3D Gaussian Splatting 场景中标注具有稳定三维坐标的语义实例，并导出 OpenFly 数据集工具链可读取的 `object_anchors_<environment>.json`。

标注器是独立页面，不替换也不修改原有的 `index.html`、`python-control.html` 飞行与截图工作流。

## 1. 功能概览

目前支持四种对象几何：

| 页面选项 | 导出 shape | 所需几何点 | 默认 landmark policy | 适合对象 |
| --- | --- | ---: | --- | --- |
| Point | `point` | 1 | `point_center` | 球网中心、门牌、按钮、单个目标点 |
| Oriented 3D box | `box` | 3 个控制点和高度 | `box_keypoints` | 椅子、桌子、柜子、设备等有体积实体 |
| Planar quadrilateral | `rectangle` | 4 | `rectangle_keypoints` | 门、窗、球网、屏幕、墙面局部 |
| Polygon area | `polygon` | 至少 3 | `polygon_keypoints` | 不规则地面、墙面区域、禁飞区域、复杂轮廓 |

所有最终坐标均采用 OpenFly 导航坐标系，标注结果可交给 `build_landmarks_from_objects.py`。

## 2. 启动方式

### 2.1 在服务器上启动

进入 `aholo3dgs`：

```bash
cd ~/workspace/VLN/aholo3dgs
npx vite --host 127.0.0.1 --port 5173
```

保持该终端运行。绑定 `127.0.0.1` 表示网页只对服务器本机开放，外部通过 SSH 隧道访问，通常比直接暴露端口安全。

如果服务器还没有 Node.js 或 `npx`，需要先安装项目原本使用的 Node.js 环境。

### 2.2 从自己的电脑建立 SSH 隧道

在自己的电脑上另开一个终端：

```bash
ssh -N -L 15173:127.0.0.1:5173 <用户名>@<服务器地址> -p <服务器SSH端口>
```

例如服务器 SSH 服务本身运行在 443：

```bash
ssh -N -L 15173:127.0.0.1:5173 yaojianhang_25@example.com -p 443
```

参数含义：

- `-N`：只建立隧道，不执行远程命令。
- `-L 15173:127.0.0.1:5173`：把本机 15173 转发到服务器的 5173。
- `-p`：服务器的 SSH 登录端口。这与网页的 5173 端口不同，也与 GitHub SSH 443 配置无关。
- 运行期间不要关闭这个 SSH 终端。

然后在自己电脑的浏览器打开：

```text
http://127.0.0.1:15173/semantic-annotator.html
```

标注操作，包括 `Shift+左键`，是在自己电脑的浏览器中完成的，不要求服务器具有桌面环境。

### 2.3 选择其他 3DGS 场景

默认加载羽毛球场。可以通过 URL 参数指定其他场景：

```text
http://127.0.0.1:15173/semantic-annotator.html?env=env_gs_room&splat=./resource/room.sog&voxelJson=./resource/room.voxel.json&voxelBin=./resource/room.voxel.bin
```

主要参数：

| 参数 | 含义 | 默认值 |
| --- | --- | --- |
| `env` | 环境名称，也是本地存储和导出文件名的一部分 | `env_gs_badminton_court` |
| `splat` | SOG 场景文件 | 羽毛球场 SOG |
| `voxelJson` | 碰撞体元数据 | 羽毛球场 voxel JSON |
| `voxelBin` | 碰撞体数据 | 羽毛球场 voxel BIN |
| `x,y,z` | 初始相机位置 | 页面内置值 |
| `yaw,pitch` | 初始观察方向，单位为弧度 | 0 |
| `maxRayDistance` | 表面吸附最大射线距离 | 100 m |
| `maxTriangulationResidual` | 多视角射线最大允许残差 | 0.5 m |
| `maxPlanarityError` | 四边形或多边形最大共面误差 | 0.25 m |
| `voxelVerticalOffset` | 体元与渲染坐标的竖直修正 | 0.55 m |

## 3. 基本操作

- 鼠标拖动：旋转视角。
- `W/A/S/D`：前后左右移动。
- `Q/E`：竖直移动。
- `Shift+左键`：记录当前几何顶点的一次观测。
- `Undo observation`：撤销当前顶点的最后一次观测。
- `Clear`：清除当前顶点尚未确认的全部观测。
- `Confirm vertex`：将当前观测解算成一个三维顶点并确认。
- `Undo vertex`：当前没有待处理观测时，撤销上一个已确认顶点。
- `Save ...`：保存完整对象。
- `Export JSON`：下载所有对象。
- `Import JSON`：载入已有标注文件。

蓝色标记表示已确认顶点，黄色标记表示当前待确认解算点，青色标记表示已保存对象。蓝线用于预览区域边界或 Box 边线。

## 4. 多视角射线标注原理

普通的屏幕点击只能确定一条从相机出发、穿过像素的三维射线，不能单独确定射线上哪个位置才是真实物体。

标注器记录：

- 相机三维位置；
- 相机 yaw、pitch、roll；
- 点击像素坐标；
- 射线起点；
- 射线方向；
- 当前视角编号和时间。

从不同相机位置点击同一个实体点后，工具计算不同射线之间的最近点对，并取其中点作为三维位置估计。射线最近距离作为 residual：

- residual 越小，不同视角越一致；
- residual 很大，通常说明两个视角点到的不是同一个实体位置；
- 默认 residual 超过 0.5 m 时拒绝确认。

正确操作要求移动相机位置，而不只是原地旋转。两条射线起点过近时无法形成可靠三角测量。建议让两个视角之间具有明显横向基线，并保持目标清晰可见。

对于细杆、球网、线缆等没有进入粗碰撞体的数据，应该使用默认的 `Multiview ray (thin objects)`。它不会沿射线寻找第一个碰撞面，因此不会把球网错误吸附到后方墙壁或地面。

## 5. Voxel surface snap

`Voxel surface snap` 会沿点击射线查询第一个碰撞体表面，适合墙、地板、大型桌面等已可靠包含在 voxel 数据中的实体。

它不适合：

- 球网、线缆、栏杆等细结构；
- 半透明物体；
- 碰撞体分辨率无法表达的细节；
- 前景物体缺失、但后方存在墙面或地面的情况。

表面吸附模式允许单次观测形成点，但从多个方向重复观测仍然有助于发现碰撞数据偏差。

## 6. Point 标注

适合只需要一个代表位置的实体。

操作：

1. Geometry 选择 `Point`。
2. 在第一个视角 `Shift+左键` 点击目标点。
3. 移动相机，从另一个视角点击相同物理点。
4. 点击 `Confirm vertex`。
5. 填写 Instance ID、Semantic type、Color 和 Size。
6. 点击 `Save point`。

导出示意：

```json
{
  "id": "net_center_01",
  "type": "badminton net",
  "shape": "point",
  "point": [1.2, 3.4, 1.55],
  "landmark_policy": "point_center"
}
```

## 7. Oriented 3D box 标注

Box 始终沿 OpenFly 导航 Z 轴竖直，yaw 表示其在导航 XY 平面内的方向。

依次标注三个控制点：

1. `base center`：Box 底面中心。
2. `length direction edge`：从底面中心沿物体长度正方向，到长度边界中点。
3. `width direction edge`：从底面中心沿物体宽度方向，到宽度边界中点。
4. 在 `Box height (m)` 输入物体高度。

长度是底面中心到长度边缘点距离的两倍；宽度同理；yaw 由底面中心指向长度方向点。宽度方向最终与长度方向正交，因此第二、第三控制点应尽量沿物体的两条正交轴点击。

完成三个控制点后，页面显示 L/W/H、yaw 和 Box 十二条边的投影视图。确认预览与实体一致后再保存。

导出包含：

```json
{
  "shape": "box",
  "center": [1.0, 2.0, 0.75],
  "size": [2.0, 0.8, 1.5],
  "yaw": 0.52,
  "corners": [[0, 0, 0], "... eight corners ..."],
  "landmark_policy": "box_keypoints"
}
```

## 8. Planar quadrilateral 标注

依次沿边界顺序标注四个角点，例如顺时针：

```text
corner 1 -> corner 2 -> corner 3 -> corner 4 -> corner 1
```

不要使用交叉顺序，例如左上、右下、右上、左下，否则导出的边界会自交。页面会连接相邻角点并闭合预览。

四个点可以位于地面、墙面或倾斜平面，不会被强制压到地面。保存前会检查共面性；最大点到拟合平面的偏差默认不得超过 0.25 m。

导出使用：

```json
{
  "shape": "rectangle",
  "corners": ["four ordered 3D points"],
  "landmark_policy": "rectangle_keypoints"
}
```

这里的 `rectangle` 是为了兼容 OpenFly 现有格式。页面记录的是四个实际角点，因此它也可表达透视场景中的一般平面四边形。

## 9. Polygon area 标注

适合不规则平面区域：

1. 沿轮廓顺时针或逆时针选择顶点。
2. 每个顶点完成多视角观测后点击 `Confirm vertex`。
3. 至少确认三个顶点。
4. 点击保存时，最后一个顶点会自动与第一个顶点闭合。
5. 不要重复点击第一个顶点，也不要让边界自交。

多边形同样执行共面误差检查。复杂区域建议只保留能够稳定描述外轮廓的关键拐点，避免过密点击放大人工误差。

导出使用：

```json
{
  "shape": "polygon",
  "points": ["three or more ordered 3D points"],
  "landmark_policy": "polygon_keypoints"
}
```

## 10. 字段填写建议

### Instance ID

必须在同一环境中唯一且长期稳定，建议使用英文小写、下划线和序号：

```text
chair_01
north_window_02
badminton_net_01
```

不要用仅在当前画面有意义的名称，例如 `left_object`。

### Semantic type

描述对象类别，而不是实例编号，例如：

```text
chair
window
badminton net
restricted area
```

重复物体共享 type，但必须拥有不同 id。

### Color 与 Size

用于后续语言生成和目标区分。Color 应尽可能使用稳定的常见颜色词。Size 是语义大小标签 `small/medium/large`，不是 Box 的米制尺寸。

## 11. 坐标系和观测元数据

页面内部使用 Aholo 渲染坐标，导出前转换为 OpenFly 导航坐标：

```text
nav = [aholo.x, aholo.z, -aholo.y]
```

不要手工交换导出坐标。每个已确认顶点的 `annotation.vertices` 中会保留：

- 顶点用途 role；
- 最终导航坐标 point；
- 原始 observations；
- rayResidual。

这些元数据用于复查标注质量，不会改变 OpenFly 对 shape、corners、points、center、size 和 yaw 的读取。

## 12. 保存、导入和数据安全

每次保存对象后，项目会写入当前浏览器的 localStorage。localStorage 的键包含 `env`，不同环境互相隔离。

注意：

- localStorage 不是可靠的长期备份；
- 更换浏览器、清除网站数据或更换域名/端口可能看不到原记录；
- 每完成一批标注都应使用 `Export JSON`；
- 导入 JSON 会替换当前环境内存储的 objects，因此导入前先导出现有结果；
- 构建数据集时只需要导出的 JSON，不需要浏览器 localStorage。

## 13. 首次使用建议

1. 先用一个明显角点练习 Point，理解“同一个物理点”的含义。
2. 第一次多视角点击后观察 residual，确认移动方向能形成足够基线。
3. 标细物体时坚持使用 Multiview ray。
4. 标 Box 时先确认方向轴和高度，不要只凭语义大小标签。
5. 四边形和多边形始终沿轮廓连续顺序标注。
6. 保存前旋转或移动相机，观察蓝色几何预览是否仍贴合实体。
7. 对重复物体使用明确唯一 id，并保持 type 一致。
8. 每完成若干对象就导出 JSON 并纳入版本或数据备份。

## 14. 常见问题

### 点击球网却落到地面

原因通常是使用了 Voxel surface snap，而球网没有被粗 voxel 表达。切换到 Multiview ray，从两个不同相机位置点击同一网格交点。

### 一直提示需要另一个 camera position

你可能只旋转了视角，没有移动相机。使用 W/A/S/D 横向移动一段距离再点击。

### residual 过大

两个视角没有点击同一个物理点，或者视角基线和目标方向接近平行。撤销错误观测，选择更清晰的特征点并改变观察侧向角度。

### 平面不共面

检查是否误点到背景、地面或物体另一侧。使用 `Undo vertex` 撤回最近顶点重新标注。只有确认真实表面本身不规则且误差合理时，才通过 URL 调大 `maxPlanarityError`。

### Box 朝向或尺寸不对

确认第二个控制点是长度方向的边缘中点，第三个是宽度方向边缘中点，而不是任意两个角点。高度需要手动输入实际米制估计。

### SSH 隧道连接后页面打不开

依次检查：

1. 服务器上的 Vite 进程是否仍在运行。
2. Vite 是否监听 `127.0.0.1:5173`。
3. 本机 SSH 隧道终端是否仍在运行。
4. 浏览器访问的是本机 `127.0.0.1:15173`。
5. `-p` 后填写的是服务器 SSH 登录端口，不是 5173。

