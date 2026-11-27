# 凝光头发物理（本地补完）

日期：2026-11-26

## 问题

凝光的运行时资产 `dist/assets/enhanced/ningguang/mesh.json` 里 `secondaryMotion` 是 `null`，
1,386 个头发顶点（材质 11 `髪`）100% 绑定在 13 号头骨上，所以头发完全不会动。
源归档 `凝光_纱中幽兰_可编辑.blend` 里也没有独立发骨链，项目标准的
`scripts/blender/add_hair_springs.py` 无法套用（它需要 PMX 的发骨层级）。

## 做法

新增 `scripts/derive-hair-springs.mjs`：不依赖 Blender、不依赖源 .blend，
直接从**已构建的运行时网格**反推弹簧骨骼：

1. 找出全部面都属头发材质的顶点（与非头发面共享的顶点保护不动）；
2. 按网格连通性聚成发束，丢弃少于 30 顶点的碎片（发饰、耳坠保持刚性）；
3. 每束以最靠近头骨的顶点为根，BFS 找到最远点作为发梢，取根→梢路径按弧长重采样成 2–5 个关节；
4. 骨骼 `position/tail/rotation` 直接落在网格所在的原生坐标系（Z-up、脚底为 0），
   旋转按 `+Y → 骨骼方向` 的 track 四元数生成；
5. 权重：每个发顶点就近取相邻两根骨骼做线性混合，靠近头皮的部分淡回 13 号头骨，
   保证根部不脱开；
6. 写入 `secondaryMotion`（`web-spring-bone`，`nativeBoneCount: 30`），
   并在头骨上放一颗半径 1.8 的球碰撞体压住刘海。

## 结果

| 项 | 数值 |
|---|---|
| 发束 | 9 束（≥30 顶点） |
| 弹簧骨 | 21 根（8 根一级，其余二级/三级） |
| 重新加权顶点 | 1,198 |
| 材质 | 只认名字里含 `髪` 的材质（凝光为 11） |
| `mesh.json` | 3,623,930 字节 → br 475,043 / gz 830,381 |
| `manifest.json` | `stats.secondaryBones = 21`、`retarget.hairPhysics = true`、`hairPhysicsProfile = web-spring-bone-v2-restrained` |

校验：

- `validateHairRig(rig, 30)` 通过；
- 全部 24,547 个顶点权重行和为 1（误差 < 1e-3）；
- 只有头发顶点使用 ≥30 的骨骼槽位，身体/服装权重一字未改；
- 追加 `tests/native-ningguang-hair-springs.test.mjs`：骨骼契约、权重归一、
  发根贴在头骨上、摆动时长度不爆炸、连续 90 帧有限。

## 追加：修复 .blend 转换留下的两处蒙皮错误（同日）

拿到源文件 `凝光_纱中幽兰_可编辑.blend`（sha256 与清单记录一致）后，
用 Blender 5.3 打开源场景核对顶点组，确认**错误来自源模型本身**：

| 材质 | 源文件顶点组 | 症状 |
|---|---|---|
| `新規`(12) | **頭 100%** | 肩到胯的两片长披挂跟着头甩 |
| `新規.001`(13) | **頭 100%** | 脑后两缕长发是刚体 |
| `裙`(28) | 上半身 1017 + **小指先.R/L 各 98** + 腕 85 | 裙摆被手带着扫过腿 |

修法改为**在构建脚本里重绑**（`scripts/blender/build_ningguang.py` 的 `CLOTH_ANCHORS`），
这样任何人重建都带着修复，而不是依赖运行时补丁：

- 披挂按高度混合 `锁骨 → spine1 → 脊柱 → 胯`，左右按 x 正负分边
- 裙按高度混合 `胯/脊柱 → 左右大腿`

重建命令（Blender 5.3 已在本机 `D:\Blender Foundation`）：

```sh
"D:\Blender Foundation\blender.exe" --background --factory-startup --disable-autoexec \
  --python scripts/blender/build_ningguang.py
node scripts/derive-hair-springs.mjs --appearance ningguang --materials 11,13
```

重建结果：材质 12 → `1:477 2:314 11:301 14:97 22:97`；材质 28 → `1:773 7:235 3:232 2:176`；
材质 13 并入头发弹簧（32 根 / 1,645 顶点）。manifest 增加 `provenance.skinRepair` 与两条 limits。

测试：`tests/native-ningguang-skin-repair.test.mjs`（4 项）与
`tests/native-ningguang-hair-springs.test.mjs`（3 项）共 7 项全绿，`npm run check` 84 模块通过。

## 仍未做

- 材质 `新規`（1,286 顶点）与 `新規.001`（554 顶点）没有当作头发：它们没有 `髪` 命名，
  其中一处 bbox 横跨 ±8、z 13–37，更像长袖/披挂。如果实机看下来背后长发也不该是刚性的，
  把这两个材质加进去重跑即可。
- 头饰（853 顶点）、耳饰、流苏保持刚性，与项目其它角色一致。
- 不是原版 MMD 刚体解算，是 Web 弹簧近似；刘海碰撞只有一颗头骨球。

## 复现

```sh
node scripts/derive-hair-springs.mjs --appearance ningguang --dry-run   # 只看统计
node scripts/derive-hair-springs.mjs --appearance ningguang             # 写入
```

脚本在 `secondaryMotion` 已存在时会拒绝覆盖；要重做请先 `git checkout -- dist/assets/enhanced/ningguang/`。
