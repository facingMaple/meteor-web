# 已下线外观记录

本仓库的「精选人物」会随需求下线。为了让历史报告仍然可读，这里集中记录每次下线的名单；历史测试输出（`work/**/*.tap`、`*.json`）与整理后的报告保持原样，不逐条改写，以免篡改当时的验收结果。

## 2026-11-16

| 外观 id | 显示名 | 下线原因 |
|---|---|---|
| `raiden` | YS-影 · 模型适配 | 用户要求下线 |
| `emilia` | RE0-爱蜜莉雅 · 模型适配 | 用户要求下线 |
| `haku` | TDA 弱音 · 夏日特调 | 用户要求下线 |

同时下线的还有同日先前移除的：

| 外观 id | 显示名 | 下线日期 |
|---|---|---|
| `zhaojun` | 王昭君 · 长夜焕生 | 2026-11-16 |

### 一并移除的内容

- 目录注册（`dist/character-catalog.js`）与展示文案（`dist/character-appearances.js`）中的条目
- 运行资产 `dist/assets/enhanced/{raiden,emilia,haku}/`，源归档 `assets/source/haku/`
- 对应 Blender 构建/核查/预览脚本与专项测试
- `work/` 下的导入与比例核查目录
- 人物工坊的静态占位文案、`.featured-emilia` 样式、对话式标签表
- README 与 `dist/assets/SOURCES.md` 中对应的小节

### 没有随之下线的

- **雷电影佩刀**（`swordStyle: 'raiden'`，资源 `dist/assets/enhanced/weapons/raiden-sword/`）是武器外观，与人物「YS-影」相互独立，保留可用。
- `work/meteor-original/evidence/` 等历史测试输出：属于当时的验收证据，保留原文。

### 对测试的影响

下线这三个角色后，`hutao` 成为**唯一**仍复用原生骨骼节点的外观；其余外观均自带 source-proportions 显示骨架。原先用 `raiden`/`emilia` 当对照样本的用例改用 `hutao`/`doubao`/`ganyu`/`springfield`，并据实收紧了断言：

- `native-hair-springs`：零步长冻结、禁用冻结等不变量只对原生骨骼架构成立，因此只对 `hutao` 验证；`models` 列表相应从 3 个减为 1 个。
- `native-springfield-character`：「六种外观」用例改为四种，骨骼归属断言改为白名单（`original`、`hutao` 复用原生骨骼）。
- `native-doubao-character`：骨骼归属断言同样改为白名单。

全量测试从 896 项变为 870 项（删去 5 个已下线角色的专项文件），全部通过。