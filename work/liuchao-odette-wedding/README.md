# 琉潮-换装三

在大厅选角或人物工坊选择「琉潮-换装三」。可编辑文件在 `assets/source/liuchao/琉潮-换装三.blend`，包含打包贴图和原版动作样本。

## 来源与构建

婚纱为用户提供的 Odette 白色婚纱默认组合。源包 `help.txt` 署名 ArmpitBelly。构建所需的绘制配置、索引、顶点、贴图和参考图归档于 `assets/source/odette-wedding/`。构建脚本按 A、B、D 绘制区段提取服饰，保留原 UV；B 区段的腿部网格用于贴合参考和定位独立的长袜 UV 岛。

脸、头发、后脑、身体比例和动作骨架取自项目中的修复版琉潮。婚纱保留头冠、头纱、不对称裙摆和配件，并加上贴合身体的珍珠白内衬。构建过程和来源哈希分别记录在 [构建记录](build-evidence.json) 与婚纱资源清单中。

从项目目录运行 `python3 scripts/blender/build_liuchao_wedding.py --textures`，再使用脚本顶部的 Blender 命令。附加 `-- --preview` 可导出正背预览。

## 验证

本地浏览器选用婚纱版进入栖云古庭。另在游戏引擎中验证人物资源、贴图及四段原版动作的采样帧。裙摆和头纱由骨骼带动。
