# dist 预压缩文件补齐报告

> **任务**：task-2「补齐缺失的 manifest 预压缩文件并扫描全站压缩缺口」
> **仓库**：`D:\meteor-web`（Windows / PowerShell 7 / Node v24.14.1）
> **完成时间**：2026-11-27 15:25 (+08:00)
> **结论**：扫描确认 **144 个源文件**缺少预压缩版本，已补齐 **288 个文件**（每个源文件一个新的 `.br` 和一个新的 `.gz`）；复扫 **0 缺口**；全量解压逐字节验证 **144/144 通过**。

## 1. 摘要

| 项目 | 补前 | 补后 |
| --- | ---: | ---: |
| dist 文件总数 | 5,853 | 6,141 |
| 源文件（可被压缩判断的资产） | 4,468 | 4,468 |
| `.br` 预压缩文件 | 692 | **836** |
| `.gz` 预压缩文件 | 693 | **837** |
| dist 占用 | 446.85 MB | 448.73 MB（+1.88 MB） |
| 按下面的判定规则，缺口 | **144** | **0** |

- 任务已知的 6 个 `manifest.json` 缺口**全部确认并补齐**（aether、doubao、hutao、liuchao、liuchao-mint、liuchao-wedding）。
- 全量扫描另发现 **1 个同类 manifest 缺口**（`assets/enhanced/weapons/raiden-sword/manifest.json`）与 **3 个其他目录的缺口群**（weapon-skins 模型 `.gmb`、original 脚本/角色数据、dist 根目录小体积 `.js`）。
- 约束遵守：只**新增** `.br`/`.gz`，未修改任何源文件，未覆盖任何既有压缩文件；未动 `scripts/`、`tests/`。本次仓库变更 = 288 个新压缩文件 + 本报告。

## 2. 扫描范围与方法

### 2.1 扫描范围

对 `D:\meteor-web\dist` 做全量递归扫描（含 `assets/`、`vendor/` 及所有子目录）：

- 补前：5853 个文件，446.85 MB；其中源文件 4468 个、既有 `.br` 692 个、既有 `.gz` 693 个。
- 既有预压缩覆盖：689 个源文件同时拥有 `.br` + `.gz`（不存在「只有 br 没有 gz」或反之的源文件）。
- 判定在「源文件」集合上进行：先排除 `.br`/`.gz` 本身，再按扩展名/尺寸/目录约定判断。

### 2.2 判定规则（三条并集，写入 `%TEMP%\meteor-decide.mjs`）

| 规则 | 内容 | 依据 |
| --- | --- | --- |
| **B：仓库脚本口径** | 扩展名不在「已压缩格式」名单，且文件 ≥ 4096 字节 → 必须有 `.br` 和 `.gz` | `scripts/precompress.mjs`（`SKIP` 集合 + `MIN_BYTES = 4096`，brotli q11 / gzip 9） |
| **C：目录约定（任务要求）** | 同目录下同扩展名的源文件「大多」（> 50%）已有 `.br`，则该目录其余缺 `.br`/`.gz` 的文件算缺口（不受 4096 门槛限制）；补齐后迭代到自洽 | 任务说明「同目录下同类文件大多已有 .br 则算缺口」 |
| **D：enhanced manifest 约定** | `assets/enhanced/**/manifest.json` 缺预压缩即算缺口 | 任务已知缺口 + 同组 16 个 manifest 中 9 个已有 sidecar（其余 7 个为本次补齐的缺口），且每个角色目录内 `mesh.json` 均有 sidecar |

补齐后按同样规则复扫，结果为 0（见 5.5）。

### 2.3 排除项（明确不压缩）

- **已压缩格式**（`scripts/precompress.mjs` 与服务端 `network-server.mjs` 都跳过）：.jpg 1233、.png 330、.bmp 242、.webp 188、.wav 157、.mp3 5。其中任务提示过的 `.webp` 共 188 个，**0 个**有 sidecar，属于「本就不该有」，不算缺口。
- **未形成目录多数的 < 4096 字节小文件**：共 338 个（如 `sounds/definitions/*.ef` 263 个、场景模型小 `.gmb` 29 个等）。服务端对 > 1024B 的文件仍会在请求时动态压缩，功能不受影响；按仓库既有约定不做预压缩（明细见 6.5）。

## 3. 补前扫描结果

### 3.1 各扩展名覆盖情况（补前 → 补后）

| 扩展名 | 源文件数 | 补前有 `.br` | 补后有 `.br` |
| --- | ---: | ---: | ---: |
| `.ef` | 1092 | 132 | 132 |
| `.des` | 219 | 23 | 23 |
| `.gmb` | 202 | 79 | 166 |
| `.txt` | 151 | 36 | 37 |
| `.pst` | 130 | 29 | 29 |
| `.gmc` | 93 | 93 | 93 |
| `.js` | 83 | 44 | 83 |
| `.json` | 71 | 61 | 71 |
| `.pos` | 59 | 22 | 22 |
| `.wp` | 42 | 32 | 37 |
| `.fmc` | 37 | 37 | 37 |
| `.ifl` | 25 | 0 | 0 |
| `.cob` | 22 | 22 | 22 |
| `.amb` | 21 | 21 | 21 |
| `.bnc` | 20 | 20 | 20 |
| `.skc` | 20 | 20 | 20 |
| `.tga` | 7 | 7 | 7 |
| `.css` | 6 | 5 | 6 |
| `.html` | 5 | 1 | 2 |
| `.md` | 2 | 2 | 2 |
| `.svg` | 1 | 0 | 0 |
| `.bin` | 1 | 1 | 1 |
| `.act` | 1 | 1 | 1 |
| `.h` | 1 | 0 | 0 |
| `.lst` | 1 | 1 | 1 |
| `.res` | 1 | 0 | 0 |

### 3.2 缺口分组（共 144 个源文件）

| 目录分组 | 缺口文件数 | 源文件字节 |
| --- | ---: | ---: |
| `dist 根目录` | 41 | 98,583 |
| `assets/enhanced/**/manifest.json` | 7 | 20,277 |
| `assets/weapon-skins/**` | 88 | 3,779,101 |
| `assets/original/**` | 8 | 18,116 |
| **合计** | **144** | **3,916,077** |

### 3.3 与任务已知清单的对照

| 已知缺口 | 大小(B) | 本次处理 |
| --- | ---: | --- |
| `assets/enhanced/aether/manifest.json` | 4,148 | ✅ 本次已补 `.br` + `.gz` |
| `assets/enhanced/doubao/manifest.json` | 2,457 | ✅ 本次已补 `.br` + `.gz` |
| `assets/enhanced/hutao/manifest.json` | 3,934 | ✅ 本次已补 `.br` + `.gz` |
| `assets/enhanced/liuchao/manifest.json` | 1,519 | ✅ 本次已补 `.br` + `.gz` |
| `assets/enhanced/liuchao-mint/manifest.json` | 2,912 | ✅ 本次已补 `.br` + `.gz` |
| `assets/enhanced/liuchao-wedding/manifest.json` | 3,211 | ✅ 本次已补 `.br` + `.gz` |

- **额外发现（同一约定）**：`assets/enhanced/weapons/raiden-sword/manifest.json`（2096 B）同样缺 sidecar；`assets/enhanced/maps/qiyun/manifest.json` 是「上一次预压缩生成过」的对照（已存在 sidecar）。
- **额外发现（大缺口群）**：`assets/weapon-skins/collection/models/` 76 个 `.gmb` 与 `glow/models/` 11 个 `.gmb` 全部没有预压缩（该目录此前从未跑过预压缩；`.gmb` 在服务端属于 `compressibleExtra`，会按需动态压缩）。
- **额外发现（体积小但符合目录约定）**：dist 根目录 39 个 `.js`（同目录 43/82 已有 `.br`）、5 个 `.wp`、2 个 characters `.json` 等。
- 完整补前缺口清单见**附录 A**。

## 4. 补齐操作

### 4.1 参数（与 `scripts/precompress.mjs` 完全一致）

```js
// brotli：质量 11 + 源文件长度作为 SIZE_HINT
brotliCompress(source, {params: {
  [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
  [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
}});
// gzip：level 9
gzip(source, {level: 9});
```

- 源数据 = 当前 **工作区源文件的实际字节**（含 CRLF），保证解压后与源文件逐字节一致。
- **只补缺**：写文件前检查目标 sidecar 是否已存在，存在则跳过、绝不覆盖。
- 一次性脚本放在 `%TEMP%`，未写入仓库（仓库内 `scripts/`、`tests/` 未改动）。

### 4.2 执行结果

| 指标 | 数值 |
| --- | ---: |
| 生成 sidecar 的源文件 | **144** |
| 新增文件数 | **288**（144 `.br` + 144 `.gz`） |
| 源文件总字节 | 3,916,077 |
| `.br` 输出总字节 | 857,449（21.9%） |
| `.gz` 输出总字节 | 1,114,944（28.5%） |
| 耗时 | 14.8 秒 |

### 4.3 新增文件按扩展名分布

| 扩展名 | 新增源文件数 |
| --- | ---: |
| `.gmb` | 87 |
| `.js` | 39 |
| `.json` | 10 |
| `.wp` | 5 |
| `.txt` | 1 |
| `.html` | 1 |
| `.css` | 1 |

## 5. 验证结果

### 5.1 全量解压比对（任务要求）

对本次生成的 **144 个文件 × 2 种编码**全部做 `brotliDecompress` / `gunzip` 后与源文件 `Buffer.compare`：

- **144/144 个 `.br` 解压后与源文件逐字节一致（SHA-256 全部相同）**；
- **144/144 个 `.gz` 解压后与源文件逐字节一致**；
- 失败 0，异常 0。

### 5.2 随机抽检 3 个（任务要求）

用 `crypto.randomInt` 从 144 个新文件中随机抽取 3 个，记录源文件与解压后 SHA-256（完全一致）：

| 文件 | 源大小(B) | `.br` 大小 | `.gz` 大小 | 源 SHA-256 | `.br` 解压 SHA-256 | `.gz` 解压 SHA-256 | 结论 |
| --- | ---: | ---: | ---: | --- | --- | --- | :---: |
| `assets/enhanced/liuchao-wedding/manifest.json` | 3,211 | 1,171 | 1,376 | `dae01334ed73f3fead90d46a90eb3648e100e97e546c7f728532a5ef7b25bdba` | `dae01334ed73f3fead90d46a90eb3648e100e97e546c7f728532a5ef7b25bdba` | `dae01334ed73f3fead90d46a90eb3648e100e97e546c7f728532a5ef7b25bdba` | 一致 |
| `assets/enhanced/liuchao-mint/manifest.json` | 2,912 | 1,086 | 1,290 | `1ba1d69e404252c353ac691fa3f1586bb798dac03b078045c8ec5d28a5ad261f` | `1ba1d69e404252c353ac691fa3f1586bb798dac03b078045c8ec5d28a5ad261f` | `1ba1d69e404252c353ac691fa3f1586bb798dac03b078045c8ec5d28a5ad261f` | 一致 |
| `network-push-stream.js` | 1,871 | 768 | 953 | `26fdec8a21fb364bbce79e61a64a9fe847a04a07a52d7b2a17aa571b5e5951c3` | `26fdec8a21fb364bbce79e61a64a9fe847a04a07a52d7b2a17aa571b5e5951c3` | `26fdec8a21fb364bbce79e61a64a9fe847a04a07a52d7b2a17aa571b5e5951c3` | 一致 |

### 5.3 服务端可用性（时间戳新鲜度）

服务端 `network-server.mjs` 仅在 `sidecar.mtimeMs >= source.mtimeMs` 时使用 sidecar。实测新生成的 **144/144 对 sidecar 均比源文件新**，服务端会优先发送它们，不再动态压缩。

### 5.4 HTTP 端到端验证（真实服务代码）

用 `network-server.mjs` 导出的 `createNetworkServer({root})` 在临时端口起真实服务，分别以 `Accept-Encoding: br, gzip` / `gzip` / 无编码请求：

- 抽 6 个新生成文件（2 个 enhanced manifest、2 个 weapon-skins `.gmb`、1 个根目录 `.js`、1 个 raiden-sword manifest）：均返回 200 + `Content-Encoding: br`/`gzip`，**响应体字节 == 对应 sidecar 字节**，解压后 == 源文件；无编码请求也返回源文件原始字节。
- 2 个既有对照：`app.js`（既有 sidecar）仍正常命中；`assets/enhanced/furina/manifest.json`（源文件较早前已被修改、sidecar 已 stale）服务端正确**忽略陈旧 sidecar 并即时压缩**，响应解压后 == 当前源文件。
- 合计 **8/8 通过**，编码协商与缓存头（`ETag`、`Vary: Accept-Encoding`、`Cache-Control`）行为正常。

### 5.5 复扫：缺口清零

对补后状态重新执行 2.2 的三条规则（B ∪ C ∪ D）：

> **GAPS = 0**（复扫文件总数 6141；源文件 4468；无任何 `manifest.json`/`.gmb`/`.js` 等缺口）。

### 5.6 不变式检查（证明「只新增、不改动」）

| 检查项 | 结果 |
| --- | --- |
| 源文件（4468 个）大小 + mtime + SHA-256 前后对比 | **0 变化**（逐字节复核） |
| 既有 sidecar（1385 个）大小 + mtime + SHA-256 前后对比 | **0 变化**（未覆盖、未删除） |
| 被覆盖的既有压缩文件 | **0** |
| 文件集合变化 | **恰好新增 288 个**，删除 0 |
| `git status` 差集 | 补前 55 行 → 补后 343 行，**新增 288 行全部是新增 `.br`/`.gz`**，无其他改动（既有 `M` 状态来自本次之前的其他任务，未触碰） |
| `scripts/`、`tests/` | 未改动 |

## 6. 未处理项与观察（按约束不动既有文件，供后续处理）

### 6.1 既有 sidecar 比源文件旧（stale，4 对，未覆盖）

| 源文件 | 情况 |
| --- | --- |
| `assets/enhanced/furina/manifest.json` | 源文件在本次任务开始前已处于工作区修改状态（`git status M`，mtime 2026-11-27 09:42），sidecar 是旧内容 |
| `assets/enhanced/lumine/manifest.json` | 同上 |
| `assets/enhanced/yaemiko/manifest.json` | 同上 |
| `character-compare.js` | 源文件 2026-11-27 15:12 被修改（疑似并行任务），sidecar 未同步 |

服务端对以上 4 对会检测到 `sidecar.mtime < source.mtime` 并忽略 sidecar、改走动态压缩，**功能正确**，只是失去预压缩收益。约束要求不覆盖既有压缩文件，故未处理；建议这些源文件定稿后执行 `node scripts/precompress.mjs`（会重新生成这 4 对）。

### 6.2 既有 sidecar 内容与源文件不一致但 mtime 不旧（3 对，风险提示，未覆盖）

逐对解压审计（1666 个有效 sidecar 对）发现 7 对内容不一致，其中 3 对 **mtime 比源文件新**，服务端会优先发送旧内容的 sidecar：

| 源文件 | 解码后 vs 源 | 说明 |
| --- | --- | --- |
| `assets/SOURCES.md` | 8793 B vs 7870 B | sidecar 为旧版（含已删除章节） |
| `character-appearances.js` | 8737 B vs 7477 B | sidecar 为旧版（旧角色表） |
| `cold-ink.css` | 35314 B vs 35314 B | 同样长度但有一行内容不同 |

这是本次任务之前就存在的问题（HEAD 中即如此，非本次改动）。建议确认源文件为最新后，删除上述 6 个压缩文件并重跑 `node scripts/precompress.mjs`（`scripts/precompress.mjs` 的 mtime 判断不会发现这种「新 mtime 旧内容」，需先删除）。

### 6.3 既有 sidecar 与工作区源文件仅换行符不同（25 对，正常现象）

既有 sidecar 是基于 git 规范化后的 **LF** 内容生成，而本机工作区文件为 **CRLF**（Windows checkout），解压后内容仅差换行符；对 JS/CSS/JSON/MD 语义无影响，不计为问题。本次新增 sidecar 按工作区实际字节生成，保证「解压后与源文件逐字节一致」。

### 6.4 孤儿压缩文件（7 个，未处理）

`.DS_Store.br/.gz` ×3 组、`assets/original/characters/common/character.v1.ambpack.gz`（无对应源文件）。属既有状态；本次约束为只增不删，未处理。

### 6.5 按约定不压缩的小文件（338 个，不是缺口）

| 扩展名 | 数量 | 示例 |
| --- | ---: | --- |
| `.ef` | 263 | `assets/original/sounds/definitions/attrpois.ef`（1548 B；同目录 132/1092 有 sidecar，非多数） |
| `.gmb` | 29 | `assets/original/scene-models/models/bbbox01/bbbox01.gmb`（3163 B；该子目录 0/1） |
| `.des` | 21 | 场景模型小文件（< 4096 B，目录仅 1 个） |
| `.txt` | 15 | `assets/original/maps/sn02/sn02.pst.utf8.txt`（非多数） |
| `.pst` | 7 | `assets/original/maps/sn02/sn02.pst`（同目录 0/2） |
| `.html` | 3 | `disclaimer.html`、`performance-lab.html`（同目录 2/4，未过半） |

均未达到 4096 B 门槛，或所在目录同扩展名文件不构成多数，按仓库既有约定不做预压缩；服务端对其中 > 1024 B 的文件会动态压缩，功能不受影响。

### 6.6 工作区其他既有改动

补前 `git status` 已存在 `M dist/assets/enhanced/{furina,lumine,yaemiko}/manifest.json`、`M dist/character-compare.js`、未跟踪的 ningguang 贴图与其他工作目录文件；这些来自其他任务/此前状态，本次**未触碰**（见 5.6 差集）。

## 7. 复现与产物

一次性脚本与原始日志（均在 `%TEMP%`，未入库）：

| 文件 | 用途 |
| --- | --- |
| `%TEMP%\meteor-scan.mjs`、`meteor-scan-before.txt`、`meteor-scan-after.txt` | 全站扫描（补前/补后） |
| `%TEMP%\meteor-decide.mjs`、`meteor-gapset-before.txt` | 按 B/C/D 规则计算缺口集合 |
| `%TEMP%\meteor-snapshot.mjs`、`meteor-precompress-snapshot.json` | 补前基线快照（全文件 SHA-256/mtime） |
| `%TEMP%\meteor-precompress-run.mjs`、`.log`、`meteor-precompress-plan.json`、`meteor-precompress-result.json` | 补齐 + 全量验证 + 复扫 |
| `%TEMP%\meteor-audit-sidecars.mjs` | 既有 sidecar 内容/mtime 审计 |
| `%TEMP%\meteor-http-check.mjs`、`.log` | HTTP 端到端验证 |

本报告路径：`work/model-review/precompress.md`。仓库内实际改动：`dist/` 下 **288 个新增 `.br`/`.gz`**，无其他文件改动。

## 附录 A：补前缺口清单（144 个源文件，均已新增 `.br` + `.gz`）

> 判定列：`B` = precompress.mjs 口径（≥4096）；`C:family x/y` = 同目录同扩展名 x/y 已有 sidecar（>50%）；`D` = enhanced manifest 约定；`C-after-fill` = 补齐后同目录占比过半时迭代补齐。每行对应的 `<路径>.br` 与 `<路径>.gz` 均已生成并通过逐字节校验。

| # | 源文件 | 大小(B) | 判定 |
| ---: | --- | ---: | --- |
| 1 | `assets/enhanced/aether/manifest.json` | 4,148 | `B:script>=4096, D:enhanced-manifest` |
| 2 | `assets/enhanced/doubao/manifest.json` | 2,457 | `D:enhanced-manifest` |
| 3 | `assets/enhanced/hutao/manifest.json` | 3,934 | `D:enhanced-manifest` |
| 4 | `assets/enhanced/liuchao-mint/manifest.json` | 2,912 | `D:enhanced-manifest` |
| 5 | `assets/enhanced/liuchao-wedding/manifest.json` | 3,211 | `D:enhanced-manifest` |
| 6 | `assets/enhanced/liuchao/manifest.json` | 1,519 | `D:enhanced-manifest` |
| 7 | `assets/enhanced/weapons/raiden-sword/manifest.json` | 2,096 | `D:enhanced-manifest` |
| 8 | `assets/original/characters/pose-reference.json` | 1,602 | `C:family6/8` |
| 9 | `assets/original/characters/roster.json` | 2,303 | `C:family6/8` |
| 10 | `assets/original/scripts/level/sn02.wp` | 1,903 | `C:family16/21` |
| 11 | `assets/original/scripts/level/sn06.wp` | 2,325 | `C:family16/21` |
| 12 | `assets/original/scripts/level/sn07.wp` | 2,732 | `C:family16/21` |
| 13 | `assets/original/scripts/level/sn08.wp` | 2,637 | `C:family16/21` |
| 14 | `assets/original/scripts/level/sn14.wp` | 3,802 | `C:family16/21` |
| 15 | `assets/original/scripts/pscriptlib/def.h.utf8.txt` | 812 | `C:family4/5` |
| 16 | `assets/weapon-skins/collection/manifest.json` | 28,853 | `B:script>=4096` |
| 17 | `assets/weapon-skins/collection/models/collection-festive-w0_4.gmb` | 58,783 | `B:script>=4096` |
| 18 | `assets/weapon-skins/collection/models/collection-festive-w1_4.gmb` | 30,852 | `B:script>=4096` |
| 19 | `assets/weapon-skins/collection/models/collection-festive-w4_4.gmb` | 79,223 | `B:script>=4096` |
| 20 | `assets/weapon-skins/collection/models/collection-festive-w5_4.gmb` | 30,287 | `B:script>=4096` |
| 21 | `assets/weapon-skins/collection/models/collection-festive-w6_4.gmb` | 57,508 | `B:script>=4096` |
| 22 | `assets/weapon-skins/collection/models/collection-festive-w7_4.gmb` | 29,257 | `B:script>=4096` |
| 23 | `assets/weapon-skins/collection/models/collection-w0_0.gmb` | 9,667 | `B:script>=4096` |
| 24 | `assets/weapon-skins/collection/models/collection-w0_1.gmb` | 49,779 | `B:script>=4096` |
| 25 | `assets/weapon-skins/collection/models/collection-w0_2.gmb` | 28,107 | `B:script>=4096` |
| 26 | `assets/weapon-skins/collection/models/collection-w0_3.gmb` | 561,283 | `B:script>=4096` |
| 27 | `assets/weapon-skins/collection/models/collection-w0_4.gmb` | 10,258 | `B:script>=4096` |
| 28 | `assets/weapon-skins/collection/models/collection-w1_0.gmb` | 16,128 | `B:script>=4096` |
| 29 | `assets/weapon-skins/collection/models/collection-w1_1.gmb` | 14,155 | `B:script>=4096` |
| 30 | `assets/weapon-skins/collection/models/collection-w1_2.gmb` | 13,411 | `B:script>=4096` |
| 31 | `assets/weapon-skins/collection/models/collection-w1_3.gmb` | 15,592 | `B:script>=4096` |
| 32 | `assets/weapon-skins/collection/models/collection-w1_4.gmb` | 9,582 | `B:script>=4096` |
| 33 | `assets/weapon-skins/collection/models/collection-w10_0l.gmb` | 9,135 | `B:script>=4096` |
| 34 | `assets/weapon-skins/collection/models/collection-w10_0r.gmb` | 9,135 | `B:script>=4096` |
| 35 | `assets/weapon-skins/collection/models/collection-w10_1l.gmb` | 7,787 | `B:script>=4096` |
| 36 | `assets/weapon-skins/collection/models/collection-w10_1r.gmb` | 7,787 | `B:script>=4096` |
| 37 | `assets/weapon-skins/collection/models/collection-w10_2l.gmb` | 28,139 | `B:script>=4096` |
| 38 | `assets/weapon-skins/collection/models/collection-w10_2r.gmb` | 28,139 | `B:script>=4096` |
| 39 | `assets/weapon-skins/collection/models/collection-w10_3l.gmb` | 11,407 | `B:script>=4096` |
| 40 | `assets/weapon-skins/collection/models/collection-w10_3r.gmb` | 11,407 | `B:script>=4096` |
| 41 | `assets/weapon-skins/collection/models/collection-w11_0.gmb` | 53,555 | `B:script>=4096` |
| 42 | `assets/weapon-skins/collection/models/collection-w11_1.gmb` | 27,167 | `B:script>=4096` |
| 43 | `assets/weapon-skins/collection/models/collection-w11_2.gmb` | 24,397 | `B:script>=4096` |
| 44 | `assets/weapon-skins/collection/models/collection-w11_3.gmb` | 8,579 | `B:script>=4096` |
| 45 | `assets/weapon-skins/collection/models/collection-w2_0.gmb` | 107,419 | `B:script>=4096` |
| 46 | `assets/weapon-skins/collection/models/collection-w2_1.gmb` | 84,645 | `B:script>=4096` |
| 47 | `assets/weapon-skins/collection/models/collection-w2_2.gmb` | 44,743 | `B:script>=4096` |
| 48 | `assets/weapon-skins/collection/models/collection-w2_3.gmb` | 27,101 | `B:script>=4096` |
| 49 | `assets/weapon-skins/collection/models/collection-w2_4.gmb` | 14,513 | `B:script>=4096` |
| 50 | `assets/weapon-skins/collection/models/collection-w3_0.gmb` | 148,927 | `B:script>=4096` |
| 51 | `assets/weapon-skins/collection/models/collection-w3_1.gmb` | 24,171 | `B:script>=4096` |
| 52 | `assets/weapon-skins/collection/models/collection-w3_2.gmb` | 915 | `C-after-fill:73/76` |
| 53 | `assets/weapon-skins/collection/models/collection-w3_3.gmb` | 915 | `C-after-fill:73/76` |
| 54 | `assets/weapon-skins/collection/models/collection-w3_4.gmb` | 3,000 | `C-after-fill:73/76` |
| 55 | `assets/weapon-skins/collection/models/collection-w3_5.gmb` | 6,488 | `B:script>=4096` |
| 56 | `assets/weapon-skins/collection/models/collection-w4_0.gmb` | 79,223 | `B:script>=4096` |
| 57 | `assets/weapon-skins/collection/models/collection-w4_1.gmb` | 24,323 | `B:script>=4096` |
| 58 | `assets/weapon-skins/collection/models/collection-w4_2.gmb` | 15,255 | `B:script>=4096` |
| 59 | `assets/weapon-skins/collection/models/collection-w4_3.gmb` | 81,815 | `B:script>=4096` |
| 60 | `assets/weapon-skins/collection/models/collection-w4_4.gmb` | 4,954 | `B:script>=4096` |
| 61 | `assets/weapon-skins/collection/models/collection-w5_0.gmb` | 27,891 | `B:script>=4096` |
| 62 | `assets/weapon-skins/collection/models/collection-w5_1.gmb` | 17,441 | `B:script>=4096` |
| 63 | `assets/weapon-skins/collection/models/collection-w5_2.gmb` | 24,582 | `B:script>=4096` |
| 64 | `assets/weapon-skins/collection/models/collection-w5_4.gmb` | 6,512 | `B:script>=4096` |
| 65 | `assets/weapon-skins/collection/models/collection-w6_0.gmb` | 48,029 | `B:script>=4096` |
| 66 | `assets/weapon-skins/collection/models/collection-w6_1.gmb` | 16,233 | `B:script>=4096` |
| 67 | `assets/weapon-skins/collection/models/collection-w6_2.gmb` | 20,151 | `B:script>=4096` |
| 68 | `assets/weapon-skins/collection/models/collection-w6_3.gmb` | 73,265 | `B:script>=4096` |
| 69 | `assets/weapon-skins/collection/models/collection-w6_4.gmb` | 9,960 | `B:script>=4096` |
| 70 | `assets/weapon-skins/collection/models/collection-w7_0.gmb` | 37,693 | `B:script>=4096` |
| 71 | `assets/weapon-skins/collection/models/collection-w7_1.gmb` | 215,626 | `B:script>=4096` |
| 72 | `assets/weapon-skins/collection/models/collection-w7_2.gmb` | 30,463 | `B:script>=4096` |
| 73 | `assets/weapon-skins/collection/models/collection-w7_3.gmb` | 344,161 | `B:script>=4096` |
| 74 | `assets/weapon-skins/collection/models/collection-w7_4.gmb` | 10,396 | `B:script>=4096` |
| 75 | `assets/weapon-skins/collection/models/collection-w8_0l.gmb` | 37,935 | `B:script>=4096` |
| 76 | `assets/weapon-skins/collection/models/collection-w8_0r.gmb` | 37,935 | `B:script>=4096` |
| 77 | `assets/weapon-skins/collection/models/collection-w8_1l.gmb` | 7,826 | `B:script>=4096` |
| 78 | `assets/weapon-skins/collection/models/collection-w8_1r.gmb` | 7,826 | `B:script>=4096` |
| 79 | `assets/weapon-skins/collection/models/collection-w8_2l.gmb` | 6,866 | `B:script>=4096` |
| 80 | `assets/weapon-skins/collection/models/collection-w8_2r.gmb` | 6,866 | `B:script>=4096` |
| 81 | `assets/weapon-skins/collection/models/collection-w8_3l.gmb` | 8,479 | `B:script>=4096` |
| 82 | `assets/weapon-skins/collection/models/collection-w8_3r.gmb` | 8,479 | `B:script>=4096` |
| 83 | `assets/weapon-skins/collection/models/collection-w8_4l.gmb` | 37,935 | `B:script>=4096` |
| 84 | `assets/weapon-skins/collection/models/collection-w8_4r.gmb` | 37,935 | `B:script>=4096` |
| 85 | `assets/weapon-skins/collection/models/collection-w9_0l.gmb` | 6,505 | `B:script>=4096` |
| 86 | `assets/weapon-skins/collection/models/collection-w9_0r.gmb` | 35,377 | `B:script>=4096` |
| 87 | `assets/weapon-skins/collection/models/collection-w9_1l.gmb` | 24,740 | `B:script>=4096` |
| 88 | `assets/weapon-skins/collection/models/collection-w9_1r.gmb` | 19,413 | `B:script>=4096` |
| 89 | `assets/weapon-skins/collection/models/collection-w9_2l.gmb` | 4,863 | `B:script>=4096` |
| 90 | `assets/weapon-skins/collection/models/collection-w9_2r.gmb` | 6,143 | `B:script>=4096` |
| 91 | `assets/weapon-skins/collection/models/collection-w9_3l.gmb` | 12,295 | `B:script>=4096` |
| 92 | `assets/weapon-skins/collection/models/collection-w9_3r.gmb` | 16,304 | `B:script>=4096` |
| 93 | `assets/weapon-skins/glow/models/glow-w0_0.gmb` | 46,400 | `B:script>=4096` |
| 94 | `assets/weapon-skins/glow/models/glow-w0_1.gmb` | 30,980 | `B:script>=4096` |
| 95 | `assets/weapon-skins/glow/models/glow-w1_0.gmb` | 87,231 | `B:script>=4096` |
| 96 | `assets/weapon-skins/glow/models/glow-w7_0.gmb` | 110,749 | `B:script>=4096` |
| 97 | `assets/weapon-skins/glow/models/glow-w7_1.gmb` | 41,239 | `B:script>=4096` |
| 98 | `assets/weapon-skins/glow/models/glow-w8_0l.gmb` | 51,607 | `B:script>=4096` |
| 99 | `assets/weapon-skins/glow/models/glow-w8_0r.gmb` | 86,370 | `B:script>=4096` |
| 100 | `assets/weapon-skins/glow/models/glow-w9_0a.gmb` | 72,267 | `B:script>=4096` |
| 101 | `assets/weapon-skins/glow/models/glow-w9_0b.gmb` | 30,981 | `B:script>=4096` |
| 102 | `assets/weapon-skins/glow/models/glow-w9_0l.gmb` | 46,402 | `B:script>=4096` |
| 103 | `assets/weapon-skins/glow/models/glow-w9_0r.gmb` | 30,984 | `B:script>=4096` |
| 104 | `battle-music.js` | 932 | `C:family43/82` |
| 105 | `character-catalog.js` | 3,755 | `C:family43/82` |
| 106 | `character-compare.html` | 4,230 | `B:script>=4096` |
| 107 | `character-materials.js` | 1,422 | `C:family43/82` |
| 108 | `collision-index.js` | 1,851 | `C:family43/82` |
| 109 | `combat-targeting.js` | 1,057 | `C:family43/82` |
| 110 | `fixed-step.js` | 1,091 | `C:family43/82` |
| 111 | `frame-meter.js` | 3,724 | `C:family43/82` |
| 112 | `frame-trial.js` | 1,758 | `C:family43/82` |
| 113 | `glow-weapon-assets.js` | 3,078 | `C:family43/82` |
| 114 | `keybindings.css` | 621 | `C:family5/6` |
| 115 | `menu-scenery.js` | 1,819 | `C:family43/82` |
| 116 | `model-viewer.js` | 2,745 | `C:family43/82` |
| 117 | `mouse-look.js` | 3,539 | `C:family43/82` |
| 118 | `native-animation-pack.js` | 2,173 | `C:family43/82` |
| 119 | `native-awareness.js` | 2,537 | `C:family43/82` |
| 120 | `native-input.js` | 3,547 | `C:family43/82` |
| 121 | `native-missions.js` | 3,742 | `C:family43/82` |
| 122 | `native-movement-profile.js` | 3,258 | `C:family43/82` |
| 123 | `native-stealth-feedback.js` | 2,554 | `C:family43/82` |
| 124 | `native-teams.js` | 433 | `C:family43/82` |
| 125 | `native-wall-traversal.js` | 2,511 | `C:family43/82` |
| 126 | `native-weapon-menu.js` | 2,676 | `C:family43/82` |
| 127 | `native-weather.js` | 3,241 | `C:family43/82` |
| 128 | `network-endpoint.js` | 417 | `C:family43/82` |
| 129 | `network-frame-buffer.js` | 2,479 | `C:family43/82` |
| 130 | `network-jump-preview.js` | 3,008 | `C:family43/82` |
| 131 | `network-local-movement.js` | 9,426 | `B:script>=4096, C:family43/82` |
| 132 | `network-melee-history.js` | 1,966 | `C:family43/82` |
| 133 | `network-push-stream.js` | 1,871 | `C:family43/82` |
| 134 | `network-rules.js` | 1,392 | `C:family43/82` |
| 135 | `network-spawns.js` | 1,314 | `C:family43/82` |
| 136 | `original-manifest.js` | 359 | `C:family43/82` |
| 137 | `player-control.js` | 3,801 | `C:family43/82` |
| 138 | `proportional-rig.js` | 3,383 | `C:family43/82` |
| 139 | `qiyun-map.js` | 158 | `C:family43/82` |
| 140 | `rage-burst.js` | 384 | `C:family43/82` |
| 141 | `training-breakables.js` | 2,983 | `C:family43/82` |
| 142 | `training-settings.js` | 470 | `C:family43/82` |
| 143 | `weapon-collection-assets.js` | 3,842 | `C:family43/82` |
| 144 | `weapon-collection-catalog.js` | 3,036 | `C:family43/82` |
