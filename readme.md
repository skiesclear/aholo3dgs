> 3dgs 仿真环境获取指南



# 1. 场景视频获取

前置条件： 一台相机（手机不行）

结果：场地视频.mp4



## 场地拍摄要求：

明亮且稳定的照明 （早晨或傍晚）

相对可控的环境 （静止场景最好）



拍摄轨迹：形成闭环路径、缓慢且匀速行走



# 2. 3d点云文件.ply 获取

输入：一段或多段视频 .mp4

输出：场地点云文件.ply

平台：Aholo 3d studio （https://studio.aholo3d.com/library）



## 3d 点云重建

在Aholo 3d studio的`My Pojects` 界面，将视频拖入`3DGS Reconstruction` 界面，选择`capture type（indoor/outdoor）`，选择构建质量 `（standard/professional）`，点击`create`开始构建。



注意：

- 这是个国内平台，不翻墙更快
- free版，只能用`standard`, 并且只有10次机会。可以冲个pro版，无限 `standard`，还可以尝试`professional`
- 构建比较慢



## .ply 文件获取

点击构建成功的项目，右上方有export可以导出ply文件（**导出需要会员**）





# 3. 场景渲染

我将场景文件放在了`/VLM/3DGS_resource`



渲染所需代码库: Aholo viewer (https://aholojs.dev/en-US/manual/getting-started/)

我本地渲染代码已经上传github （https://github.com/skiesclear/aholo3dgs）



## 环境配置

npm nodejs配置 （https://nodejs.org/en/download）

aholo viewer库配置 （https://aholojs.dev/en-US/manual/getting-started/）

转换脚本配置 （https://github.com/playcanvas/splat-transform）



## 将.ply转为为Aholo viewer适合的 .sog格式 和碰撞文件 .voxel.bin， .voxel.json

使用splat-transform转换



教程参考：

sog转换：https://developer.playcanvas.com/user-manual/splat-transform/#generating-lod-format

```
splat-transform input.ply output.sog
```



碰撞文件转换：https://developer.playcanvas.com/user-manual/splat-transform/collision/

```
splat-transform terrain.ply \
    --filter-cluster --seed-pos 0,0,0 \
    terrain.voxel.json --voxel-floor-fill -K
```



## 代码运行



将转换后的 .sog  .voxel.bin  .voxel.json 放在resource/下。 记得同步 `index.ts`和`python-control.ts`中的资源目录设置

### 键盘鼠标控制

index.html, index.ts 用于鼠标键盘控制无人机模型在渲染场景中运动

项目目录运行`npx vite`

在浏览器打开`http://localhost:5173/`查看



### python代码控制

python-control.html

python-control.ts

用于python代码控制无人机飞行；获取front、back、left、right、down 五视角图片；获取深度图