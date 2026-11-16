# 琉潮-换装二

在大厅「选择人物」中选择「琉潮-换装二」，也可在人物工坊预览。可编辑文件保存在 `assets/source/liuchao/琉潮-换装二.blend`，贴图已打包，带自然站姿和四个动作样本。

## 模型来源和构建

以当前修复版的 `dist/assets/enhanced/liuchao/mesh.json` 为基底。沿用其脸部、后脑、发型、身体和动作骨架。服装来自用户提供的薇斯纳薄荷色泳装 XXMI 包，重建所需文件已存于 `assets/source/vesna-mint-swimwear/`。

`Vesna.ini` 记录 BodyD 的 10 个服装绘制区段。位置和 UV 缓冲分别按 40 字节和 28 字节读取，索引按小端 32 位读取。BodyB 的皮肤区段仅用于量取套装原来贴合的位置。BodyD 的原色图和镂空遮罩转成 2048 像素 WebP，保留源 UV。每个服装区段重新贴合琉潮并绑定到对应的游戏骨骼。分段索引及导出哈希见 [构建记录](build-evidence.json)。

在项目根目录先运行 `python3 scripts/blender/build_liuchao_mint.py --textures`，再按构建脚本顶部的 Blender 命令导出。附加 `-- --preview` 可生成正面和背面预览。

## 验证范围

人物工坊已实机载入换装版。运行时校验覆盖模型索引、权重、贴图，以及待机、跑步、跳跃和挥剑的采样帧。对照图包括 [站姿正面](front.png)、[站姿背面](back.png) 和 [跳跃](jump.png)。大幅抬腿时裙边仍可能与腿部交叠，当前衣物使用骨骼绑定。
