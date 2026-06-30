# 视频指定点批注（Video Position Annotation）

> 状态：图形/文字批注与音频解说 V1 已上线；**定帧批注（阶段 5–7）已实现**；**源视频/预览双模式（阶段 8）已实现**；**批注重叠展开多轨（阶段 9）已确认、待实现**；定帧内批注（阶段 10）已确认、待实现；编辑器内录音、TTS 待实现  
> 本文档取代原先以停帧（Hold）为核心的方案叙述，停帧相关内容见 [附录：可选定帧模式](#附录可选定帧模式freeze--hold)

## 背景与目标

用户在**视频编辑播放过程中**，希望在某个时间点插入一段有**固定时长**的解说或标注，添加完成后视频**继续正常播放**。

典型场景：

1. 播放到 5 秒时，弹出文字说明「点击这里」——持续 3 秒，画面照常推进
2. 同一时刻叠加箭头/高亮图形，配合文字动画
3. 导入或录制一段旁白，与画面该段同步播放
4. （可选）批注期间**定住画面**讲解，类似教程停帧——见附录
5. （可选，阶段 10）在**已定帧的长停顿内**分步出现文字/箭头/旁白——见 [阶段 10](#阶段-10定帧内批注已确认待实现)

这与「必须先停帧、再叠加、再延长成片时间轴」的路径不同：**默认行为是叠加式批注**，底层视频时间轴不变；只有用户显式选择「定帧批注」时才需要源/成片双时间映射。

## 核心概念

### 指定点批注（Position Annotation）

在源视频时间轴上的**锚点** `anchorMs`（通常 = 播放头位置），挂载一段 **持续 `durationMs`** 的内容：


| 字段           | 说明                        |
| ------------ | ------------------------- |
| `anchorMs`   | 批注开始时刻（源视频毫秒）             |
| `durationMs` | 批注持续时长，默认 3000，可调         |
| `payload`    | 文字 overlay / 图形 / 音频 clip |


可见区间：`[anchorMs, anchorMs + durationMs)`，与现有 `AnnotationRegion` 的 `[startMs, endMs)` 一致。

### 两种播放模式

```text
模式 A — 叠加批注（默认，已实现）
源时间   0s ──── 5.0s ──── 8.0s ──── 11.0s ───►
              │ 文字/箭头 3s │
视频       正常播放，不暂停
成片时长   = 源视频时长（裁剪/变速后）

模式 B — 定帧批注（可选，阶段 5 已实现）
源时间   0s ──── 5.0s ──── 5.0s ──── 8.0s ───►
              │ 定帧 3s + 叠加 │
成片时间 0s ──── 5.0s ──── 8.0s ──── 11.0s ───►
              ↑ 同一解码帧重复 3 秒
成片时长   = 源时长 + 定帧插入并集时长（见 [阶段 7](#阶段-7定帧轨产品定义已实现)）
```


| 模式       | 视频    | 成片时长 | 时间轴          |
| -------- | ----- | ---- | ------------ |
| **叠加批注** | 继续播放  | 不变   | 单一源时间；**批注轨** |
| **定帧批注** | 锚点处停住 | 延长   | 源时间 ↔ 成片时间映射；**仅定帧轨** |
| **定帧内批注**（阶段 10） | 锚点处停住 | 不额外延长 | 相对某条定帧的 `holdOffsetMs`；预览/导出按成片时间显隐 |


**产品默认**：模式 A。模式 B 作为批注属性 `freezeDuringAnnotation: true` 的扩展；定帧批注在 UI 上**只出现在定帧轨**（见阶段 7），预览画布仍渲染 overlay。模式 C（定帧内批注）依附于已存在的定帧，不在源时间轴上单独「推进画面」。

## 与现有实现的关系

Openscreen **已具备叠加式图形/文字批注**的主体能力，不必从零设计时间引擎。

### 已有：`AnnotationRegion`（图形/文字批注）

```typescript
interface AnnotationRegion {
  id: string;
  startMs: number;   // = anchorMs
  endMs: number;     // = anchorMs + durationMs
  type: AnnotationType; // "text" | "image" | "figure" | "blur"
  content: string;
  textContent?: string;
  imageContent?: string;
  position: AnnotationPosition;
  size: AnnotationSize;
  style: AnnotationTextStyle;
  zIndex: number;
  annotationSource?: "auto-caption";
  figureData?: FigureData;  // 箭头方向、动画等
  blurData?: BlurData;
}
```

- **预览**：`VideoPlayback` 在 `currentTime ∈ [startMs, endMs)` 时渲染 overlay，视频照常 seek/播放
- **导出**：`annotationRenderer.renderAnnotations` 按 `currentTimeMs` 合成到帧
- **时间轴**：`TimelineEditor` 标注轨，播放头处添段（`handleAddAnnotation`）
- **类型**：文字、图片、箭头/图形（含入场动画）、模糊/马赛克
- **自动字幕**：Whisper 生成后写入 `annotationRegions`（`annotationSource: "auto-caption"`）

### 待增：音频批注（Audio Annotation）

与图形批注**同级**，锚点 + 时长，挂载音频载荷：

```typescript
interface AudioAnnotationClip {
  id: string;
  anchorMs: number;
  durationMs: number;
  source: "import" | "record" | "tts"; // 分阶段实现
  audioUrl: string;   // blob / 项目相对路径
  volume?: number;    // 0–1，默认 1
  /** 播放时是否 duck 原视频音轨 */
  duckOriginal?: boolean;
}
```

- V1：导入 mp3/wav，拖到锚点
- V2：编辑器内对着播放头录音
- V3：TTS

导出混音：`原视频音轨 + 批注音频`（定帧段原声可静音，见附录）。

### 待增：批注工作流 UI（统一入口）

当前添标注需熟悉时间轴快捷键/按钮。目标工作流：

1. 播放/暂停到目标时刻
2. 点击「添加批注」→ 选择类型（文字 / 图形 / 音频）
3. 默认 `durationMs = 3000`，侧栏可调
4. 可选勾选「批注期间定帧画面」→ 条目进入**定帧轨**（阶段 7），不再在批注轨显示

**批注轨**：仅叠加式批注；重叠时可 **展开为多子轨**（阶段 9）。**定帧轨**：定帧批注（可重叠，同样可展开）；同一锚点允许多条定帧批注并存。**定帧内批注轨**（阶段 10）：挂在某条定帧内部、按相对时间编排的 overlay / 旁白，见阶段 10。

## 时间轴与播放

### 默认（叠加模式）

- 标尺、播放头、所有轨道均使用**源视频毫秒**（经裁剪/变速后的有效区间）
- 批注可见性：`playheadMs >= startMs && playheadMs < endMs`
- 无需 `timelineMapping`

### 定帧模式（启用 Hold 时）

- 播放头与标尺切换为**成片时间**
- 批注/箭头/字幕的可见性按**成片时间**判断（当前实现仍按源时间，需迁移）
- 映射公式见附录

## 预览行为


| 能力    | 叠加模式                                                         | 定帧模式               |
| ----- | ------------------------------------------------------------ | ------------------ |
| 视频    | `video.currentTime` 正常推进                                     | 定帧段内固定在 `anchorMs` |
| 图形/文字 | overlay 按源时间显隐                                               | overlay 按成片时间显隐    |
| 箭头动画  | `getArrowAnimationState(figureData, startMs, currentTimeMs)` | 动画时钟改用成片时间         |
| 音频批注  | Web Audio 在锚点触发播放                                            | 与成片时间轴对齐           |
| 缩放/光标 | 现有逻辑                                                         | 使用映射后的源时间状态        |


## 导出行为


| 能力    | 叠加模式                                    | 定帧模式                       |
| ----- | --------------------------------------- | -------------------------- |
| 视频帧   | 正常解码顺序                                  | 锚点帧克隆 `durationMs × fps` 次 |
| 图形/文字 | `renderAnnotations(..., currentTimeMs)` | `currentTimeMs` 用成片时间      |
| 原声    | 保留                                      | 定帧段静音（旁白优先）                |
| 音频批注  | 混音叠加                                    | 按成片时间轴混音                   |
| GIF   | 同 MP4 逻辑                                | 同帧重复                       |


`getExportMetrics`：叠加模式时长不变；定帧模式 `outputDuration += 定帧插入并集时长`（非简单相加）。

## 数据持久化


| 数据      | 存储位置                                                                     | 现状                          |
| ------- | ------------------------------------------------------------------------ | --------------------------- |
| 图形/文字批注 | `EditorState.annotationRegions` / `ProjectEditorState.annotationRegions` | ✅ `PROJECT_VERSION = 2`     |
| 音频批注    | `EditorState.audioAnnotationClips`（拟）                                    | ❌ 待增，`PROJECT_VERSION` bump |
| 定帧      | `EditorState.holdRegions`（拟）                                             | ❌ 待增，见附录                    |


旧项目：缺失字段视为 `[]`，行为与现版一致。

## 阶段 1 交互（已实现）

### 用户流程

1. **定位**：播放或拖动播放头到目标时刻（可暂停，也可边播边加）
2. **添加**：点击 **「添加批注」** 下拉按钮（两处入口等价）：
   - 预览区播放条右侧（主入口）
   - 时间轴工具栏标注按钮（图标版）
3. **选类型**：文字解说 / 箭头标注 / 图片（模糊在 feature flag 开启时可见）
4. **自动创建**：
   - 锚点 = 当前播放头时间
   - 默认持续 **3 秒**（`DEFAULT_POSITION_ANNOTATION_DURATION_MS`）
   - 视频**继续可播**（叠加模式）；添加时自动**暂停**以便编辑
   - 右侧打开对应类型的设置面板，批注自动选中
5. **调节**：侧栏显示锚点时间与持续时长滑块（0.5s–30s）；时间轴上可拖拽调整区间

### 快捷键

| 按键 | 行为 |
|------|------|
| `A` | 在播放头处快速添加**文字**批注（3 秒） |
| `B` | 添加模糊批注（仅 `BLUR_REGIONS_ENABLED`） |
| `Tab` / `Shift+Tab` | 在同一时刻重叠的批注间切换选中 |

### 实现要点

- 逻辑集中在 `handlePositionAnnotationAdded`（`VideoEditor.tsx`）
- _span 计算：`computePositionAnnotationSpan`（`positionAnnotation.ts`）
- UI 组件：`AddPositionAnnotationMenu.tsx`

## 阶段 2 交互（已实现）

### 用户流程

1. 将播放头定位到目标时刻
2. 「添加批注」→ **音频解说**，选择 mp3 / wav 文件
3. 时间轴 **音频批注轨**（紫色条）出现在锚点处，默认时长 = min(源文件时长, 30s)
4. 选中条目 → 侧栏调节锚点、时长、音量；可替换或删除文件
5. 预览：进入 `[anchorMs, anchorMs + durationMs)` 时与视频同步播放旁白
6. 导出 MP4：旁白混入主音轨（与录屏原声叠加）

### 实现要点

- 数据：`AudioAnnotationClip`（`types.ts`），项目版本 v3
- 导入：`buildAudioAnnotationClip`（`audioAnnotation.ts`）
- 预览：`VideoPlayback.tsx` 维护 hidden `<audio>` 按播放头同步
- 导出：`audioAnnotationMixer.ts` → `AudioProcessor.process()` 混音后 mux
- **持久化**：保存项目时将音频复制到项目文件旁的 `audio-assets/` 目录（不在 `recordings/`）；加载时解析为 `file://` 路径
- UI：`AudioAnnotationSettingsPanel.tsx`、时间轴 `row-audio-annotation`

## 阶段 5 交互（已实现，阶段 7 将调整 UI）

### 用户流程（当前实现）

1. 选中图形/文字批注 → 侧栏开启 **「批注期间定帧画面」**
2. 侧栏有独立 **定帧时长** 滑块（阶段 7 将移除，改为条长 = 定帧时长）
3. 定帧批注当前在**批注轨与定帧轨双轨显示**（阶段 7 改为**仅定帧轨**）
4. 预览 / 导出：定帧段停帧、原声静音、成片时长延长

### 实现要点

- 批注字段：`freezeDuringAnnotation`、`holdDurationMs`（阶段 7 废弃独立 `holdDurationMs`）
- 内部数据：`HoldRegion[]`，由 `syncHoldRegionsFromEditor` 与批注联动
- 映射 / 预览 / 导出：见阶段 6 与附录

## 阶段 6 交互（已实现，阶段 7 将调整映射与轨道）

### 用户流程（当前实现）

1. 存在定帧区域时，时间轴**自动切换为成片标尺**
2. 播放头、拖拽 seek 使用**成片时间**；内部映射回源时间驱动视频
3. **定帧轨**显示 hold 插入段；定帧批注条同时在批注轨上映射显示
4. 预览 / 导出按成片时间判断可见性与动画

### 实现要点

- 映射：`timelineMapping.ts`（`sourceToOutputMs`、`getHoldOutputSpans` 等）
- 时间轴：`TimelineEditor` + `outputPlaybackTimeMs` 双向 seek
- **待阶段 7**：总定帧时长改为成片区间**并集**；定帧批注只渲染在定帧轨

## 阶段 7：定帧轨产品定义（已实现）

### 轨道分工

| 轨道 | 内容 | 成片时长 |
| --- | --- | --- |
| **批注轨** | 叠加式文字 / 图形 / 模糊 / 音频 | 不变 |
| **定帧轨** | 定帧批注（同样是上述类型，但 `freezeDuringAnnotation: true`） | 参与延长 |

定帧轨在交互上与批注轨类似：可添加、选中、拖拽改区间、侧栏编辑内容与样式。**定帧批注不在批注轨显示**；预览画布仍按成片时间渲染 overlay。

### 时长规则

- **定帧时长 = 批注条长度** = `endMs - startMs`（或音频 `durationMs`）
- **移除**侧栏「定帧时长」独立滑块；拖定帧轨上的条即同时改可见区间与定帧插入
- 不再维护与条长脱钩的 `holdDurationMs`（持久化可保留字段作迁移，运行时由 span 派生）

### 重叠与总时长

- 多条定帧批注**允许在定帧轨上重叠**（同锚点或多锚点均可）
- 每条映射到成片时间轴上的一段插入区间
- **总定帧插入时长** = 所有区间的**并集（Union）**长度，**非**各条时长简单相加
- **成片总长** = 源时长 + 并集长度
- 同一起点多条定帧：并集等价于取最长条（重叠部分只计一次）

```text
例 — 重叠
  定帧 A: 5.0s 起，长 3s
  定帧 B: 5.5s 起，长 3s
  → 定帧轨上两条可重叠；成片插入 = 并集（约 3.5s），不是 6s

例 — 源时间首尾相接
  定帧 A: 2.0s 起，长 4s（源锚点 2s）
  定帧 B: 6.0s 起，长 3s（源锚点 6s）
  → A 在成片 2s 起；B 在成片 10s 起（6s + 前序插入 4s）；中间 6–10s 为 A 结束后源视频继续推进

例 — 源时间有间隔
  定帧 A: 5.0s 起，长 3s
  定帧 B: 8.0s 起，长 2s
  → 并集 = 3s + 2s = 5s；A 与 B 之间正常播放源视频
```

### 实现要点

1. 时间轴：定帧批注仅 `HOLD_ROW`；批注轨过滤 `freezeDuringAnnotation`
2. 侧栏：移除定帧时长滑块；拖定帧轨条 = 改批注时长
3. 映射：`computeHoldOutputSegments` + 并集总时长（`timelineMapping.ts`）
4. 数据：`HoldRegion.holdDurationMs` 由 span 派生；加载时 legacy `holdDurationMs` 合并进 span
5. 测试：`timelineMapping.test.ts` 覆盖同锚点、重叠、部分重叠

## 阶段 8：源视频 / 预览双模式（已实现）

### 模式开关

存在定帧批注时，时间轴工具栏提供 **源视频模式** / **预览模式** 切换（默认真源视频模式）。

| 模式 | 播放时钟 | 时间轴 | 编辑 |
| --- | --- | --- | --- |
| **源视频模式** | 源时间，画面正常推进 | 源视频标尺 | 可编辑 |
| **预览模式** | 成片时间（含定帧插入） | **成片标尺**（只读） | 不可编辑 |

### 时间轴

- **源视频模式**：标尺、条位置、播放头均使用源视频毫秒（可编辑）
- **预览模式**：标尺、条位置、播放头映射为**成片时间**（定帧段在轴上展开）；只读，不可拖
- 预览模式工具栏显示源时间副标签（如 `源 0:05.0 / 0:30.0`），便于对照锚点
- 点击/拖拽预览时间轴 seek 时，内部转换为源时间驱动视频

### 预览画布

- **源视频模式**：overlay 按源时间显隐；定帧批注显示但**画面不停**
- **预览模式**：定帧批注 overlay 按 `getFreezeLinkedOutputSpan` 显隐（仅定帧插入段，不含定帧后源视频重播）；普通批注仍按源区间映射

### 导出

- 等同预览模式的成片时钟，无需用户先切预览

### 实现要点

- `EditorPlaybackMode`（`types.ts`）
- `VideoEditor`：`playbackMode` 状态 + 切换时暂停并对齐 output 时钟
- `TimelineEditor`：源模式用源标尺；预览模式映射成片标尺 + `timelineReadOnly`；seek 输出→源转换
- `videoEventHandlers`：仅预览模式启用 hold rAF 时钟
- `VideoPlayback`：可见性 / 音频 / overlay 交互按模式分支
- `SettingsPanel`：预览模式只读

## 阶段 9：批注重叠展开多轨（已确认，待实现）

### 动机与问题

定帧轨与批注轨均 **允许重叠**（同锚点或多条时间交叉）。当前所有条目画在 **同一物理行** 上，导致：

- 重叠条难以选中、拖拽改区间易误触相邻条；
- `Tab` 切换同锚点批注效率低，视觉密度高；
- 同锚点多条定帧（文本 + 音频等）编辑体验差。

阶段 9 不改变批注/定帧的 **时间语义**（仍为源 `startMs` / `anchorMs` 与 `freezeDuringAnnotation`），只改善 **时间轴编辑布局**：将重叠簇 **展开** 为多条子轨，子轨内不重叠。

### 与定帧内批注（阶段 10）的分工

| 维度 | 阶段 9 展开多轨 | 阶段 10 定帧内批注 |
| --- | --- | --- |
| 解决问题 | 同一时段多条批注/定帧 **不好选、不好拖** | 长定帧 **内部** 第 N 秒再出现内容 |
| 影响范围 | 时间轴 UI + 可选 `laneIndex` | 新时间坐标 + 预览/导出/映射 |
| 成片时钟 | 不变 | 不变（不额外延长） |

**先做阶段 9**：风险低、直接缓解当前重叠编辑痛点；阶段 10 实现时可复用 `AnnotationGroup` / 子轨 UI，避免两套布局。

### 核心交互

```text
折叠（默认）          展开
批注轨 ──[A][B]──     批注轨 lane 0 ──[A]──
      重叠              批注轨 lane 1 ──[B]──

定帧轨 ──[F1][F2]──   定帧轨 lane 0 ──[F1]──
      同锚点             定帧轨 lane 1 ──[F2]──
```

- **重叠检测**：同一轨道内，时间区间 `[start, end)` 有交集的条目归为 **一簇（cluster）**。
- **展开 / 收起**：簇级 toggle；展开后每条占一 **子 lane**，簇内按稳定规则排序（如 `startMs` → `id`）。
- **可逆**：收起后恢复单轨叠层显示；数据不丢。
- **源视频模式** 与 **预览模式** 均可展开（只读预览模式仍可展开查看，不可拖条）。

### 数据模型（拟）

不改变现有 `startMs` / `endMs` / `anchorMs` 语义。可选持久化字段：

```typescript
/** 重叠簇标识；同簇条目展开时共享 laneGroupId */
laneGroupId?: string;

/** 展开视图下的子轨序号，0 = 簇内第一条 lane；未展开时可省略 */
laneIndex?: number;
```

抽象 **AnnotationGroup**（实现层，可不单独持久化）：

- 重叠簇、将来的定帧组、父/子批注关系统一为 group；
- 阶段 9 MVP 仅用于 **重叠簇 ↔ 子 lane** 映射。

默认行为：无 `laneIndex` 时与现版完全一致（单轨叠层）。

### MVP 范围

1. **批注轨**：重叠簇检测 → 展开/收起 → 子 lane 渲染与选中
2. **定帧轨**：同锚点或多条重叠时同样可展开
3. **持久化** `laneIndex` / `laneGroupId`（可选，重开项目保持展开布局）
4. **不做**：父/子批注、`holdOffsetMs`、预览模式条拖拽编辑、音频批注轨独立展开（可第二期）

### 实现要点（规划，尚未编码）

1. **簇检测**：`detectOverlapClusters(items: { id, startMs, endMs }[])`（批注轨 / 定帧轨各算）
2. **布局**：`TimelineEditor` 按 `expandedGroupIds` 动态增加子 row 高度
3. **交互**：簇头 chevron、展开态 `Tab` 仅在当前 lane 内切换
4. **持久化**：`PROJECT_VERSION` bump；缺失字段视为折叠单轨

### 验证（阶段 9 完成后）

- 同锚点 3 条定帧 → 展开后 3 条子轨，各自可选中拖拽，预览/导出与折叠前一致
- 收起 → 恢复叠层；保存重开 → 展开状态与 lane 分配保持（若启用持久化）
- 无重叠时 UI 与现版相同，无额外空 lane

### 非目标（阶段 9）

- 不引入 `holdOffsetMs` / `linkedHoldId`（阶段 10）
- 不改变 `timelineMapping`、定帧播放、导出时长
- 不做批注模板、批量复制（阶段 11）

## 阶段 10：定帧内批注（已确认，待实现）

### 动机与问题

典型场景：**源 2.0s 起定帧 10s**（画面停在 2s 那一帧，成片插入 10s），希望在 **定帧开始后第 4s** 再出现一条箭头或旁白。

当前模型下，批注锚点一律绑定 **源时间** `startMs` / `anchorMs`。定帧期间源时钟 **停在锚点**，不会自然走到源 4s，因此：

- 「源 4.0s 的批注」在预览里往往要等到 **定帧结束、源片从 2s 继续播到 4s** 才出现；
- 无法在 **同一帧停住的 10s 内**，于第 4s 再叠一层说明。

这与教程式「长停顿 + 分步讲解」的预期不符。阶段 10 引入 **定帧内相对时间** 坐标，与源时间、定帧起点坐标并列。

### 三种批注坐标（对比）

| 类型 | 锚点字段 | 适用场景 | 画面 | 是否延长成片 |
| --- | --- | --- | --- | --- |
| **叠加批注** | 源 `startMs` | 视频照常播放时的 callout | 推进 | 否 |
| **定帧批注** | 源 `startMs` / `anchorMs` + `freezeDuringAnnotation` | 从锚点起停住并显示内容 | 停住 | 是（条长 = 插入时长） |
| **定帧内批注** | `linkedHoldId` + `holdOffsetMs` | 已定帧的长停顿 **内部** 分步出现 | 停住（继承所属定帧） | 否（时长受所属定帧边界约束） |

```text
例 — 源 2s 定帧 10s，定帧内 +4s 出现箭头 3s

源时间:     0────2s═══════════════════12s────►  （2–12s 为逻辑上的定帧区间）
                              ↑ 源时钟在定帧段内停在 2s

成片时间:   0────2s══════════════12s────►
              [---- 定帧 insert 10s ----]
                    ↑ +4s        ↑ +7s
                    箭头出现      箭头消失

定帧内坐标: holdOffsetMs = 4000，durationMs = 3000
成片绝对:   outputStart + 4000 ～ outputStart + 7000
```

**注意**：「定帧内 +4s」≠「源 4.0s」。UI 与持久化必须区分，避免再出现「看起来都是 2.0s / 4.0s，配置文件却是 20xx ms」的混淆。

### 数据模型（拟）

定帧内批注可复用 `AnnotationRegion` / `AudioAnnotationClip` 载荷，增加 **定帧内锚点** 字段（命名待定）：

```typescript
/** 批注时间坐标：源时间（默认）或定帧内相对时间 */
type AnnotationTiming =
  | { kind: "source"; startMs: number; endMs: number }
  | {
      kind: "hold-inner";
      linkedHoldId: string;   // 所属 HoldRegion.id（或定帧批注 id，实现时二选一绑定）
      holdOffsetMs: number;   // 相对该定帧 outputStart 的偏移，≥ 0
      durationMs: number;     // 定帧内持续时长
    };
```

约束：

- `holdOffsetMs + durationMs ≤` 所属定帧的 `holdDurationMs`（超出时 UI 裁剪或提示延长定帧，产品二选一，默认 **裁剪**）。
- 定帧内批注 **不** 再写源 `startMs = 4s` 来表达「定帧内第 4 秒」。
- 所属定帧删除时，级联删除或降级为叠加批注（待实现时选定，默认 **级联删除**）。

映射到成片时间（预览 / 导出）：

```text
holdOutputStart = sourceToOutputMs(hold.sourceMs)   // 或 computeHoldOutputSegments 的 outputStart
outputVisibleStart = holdOutputStart + holdOffsetMs
outputVisibleEnd   = outputVisibleStart + durationMs
```

可见性：`outputMs ∈ [outputVisibleStart, outputVisibleEnd)`，且 `outputMs` 落在该 hold 的插入段内。

### 与用户心智：默认播放头上下文，少选手动

**多数情况不需要**用户先选「参考定帧」再填「相对偏移」。与现有「播放头处添加批注」一致：

```text
holdOffsetMs = 当前成片播放头 − 所属定帧的 holdOutputStart
linkedHoldId   = 播放头所在的那条定帧（HoldRegion）
```

仅下列情况出现侧栏 **「所属定帧」** 下拉（人类可读：`源 2.0s · 长 10.0s`）：

1. 多条定帧并集重叠，播放头落在重叠区；
2. 播放头不在任何定帧内，但用户主动选「添加到定帧…」；
3. 将普通批注 **转换** 为定帧内批注。

偏移通过 **拖时间轴条 / 拖播放头 / 侧栏滑块** 调节，不提供原始毫秒输入框为主入口。

### UI 展示

#### 时间轴（预览模式 — 主编辑面）

定帧内批注条画在 **成片标尺** 上，位置 = `holdOutputStart + holdOffsetMs`，与普通预览条同一坐标系。

```text
成片轴:  0────2════════════════════12────►
              ↑ 定帧条（10s）
                    ↑ 定帧内批注条（+4s 起 3s）
              2.00s                 6.00s
              定帧+0s               定帧+4s（条标签副标题）
```

条标签建议 **双行**：

| 主标签 | 副标签（hover / 选中） |
| --- | --- |
| 成片绝对时间 `6.00s – 9.00s` | `定帧 +4.0s`（相对所属定帧） |

精度：至少 **0.01s**，避免 2000 ms 与 2040 ms 均显示为 `2.0s`。

#### 定帧条内嵌标记（可选增强）

选中某定帧时，在定帧条 **内部** 用竖线/圆点标出所有定帧内批注的 offset；点击标记选中批注，在条内空白点击创建新批注（播放头同步）。

#### 源视频模式

定帧内批注 **不在源轴上按源 4s 画条**（易与源时间混淆）。建议：

- 定帧条上只读显示内嵌标记；或
- 侧栏列表「此定帧内的步骤」；
- 提示：**切到预览模式** 编辑定帧内批注。

源模式继续编辑：定帧锚点、定帧总长、叠加批注。

#### 轨道分工（阶段 10 目标）

| 轨道 | 内容 |
| --- | --- |
| 批注轨 | 仅 `kind: "source"` 叠加批注 |
| 定帧轨 | `freezeDuringAnnotation` 定帧批注（延长成片） |
| 定帧内批注轨（或定帧子层） | `kind: "hold-inner"`，不额外延长成片 |

实现上可为独立 `row-hold-inner`，或在预览模式下渲染为定帧条 **子 Item**（可复用阶段 9 展开子轨 UI）；产品以「能看清、能拖、能选中」为准。

### 添加流程

**流程 A — 播放头在定帧段内（默认）**

1. 切换到 **预览模式**（成片时钟）；
2. 播放/拖动播放头到目标成片时刻（如 6.0s = 定帧 +4s）；
3. 「添加批注」→ 类型；若播放头在某定帧 insert 段内，创建 **定帧内批注**；
4. 自动写入 `linkedHoldId`、`holdOffsetMs`，默认 `durationMs = 3000`。

菜单策略（二选一，推荐前者）：

- **自动推断**：播放头在定帧内 → 定帧内批注；否则 → 叠加批注；
- 或菜单增加 **「定帧内批注」**，仅在播放头位于定帧段内时启用。

**流程 B — 从定帧条发起**

1. 选中定帧条 →「在此定帧内添加批注」；
2. 播放头跳到 `holdOutputStart`（或上次编辑 offset）；
3. 用户拖动播放头或点击条内位置 → 再选类型。

**流程 C — 歧义时选手动定帧**

侧栏出现「所属定帧」下拉；选定后 `holdOffsetMs` 仍由播放头或滑块决定。

### 侧栏字段（拟）

| 字段 | 可编辑 | 说明 |
| --- | --- | --- |
| 所属定帧 | 仅歧义时 | `源 2.0s · 长 10.0s`（只读为主） |
| 定帧内起点 | 是 | `+4.00s`，滑块范围 `[0, holdDuration − minDuration]` |
| 持续 | 是 | 默认定帧内 3s |
| 成片时间 | 只读 | `6.00s – 9.00s`，对照标尺 |

**不要**同时提供可编辑的「源 4.0s」与「定帧 +4.0s」两套锚点；定帧内批注以 **holdOffsetMs** 为权威，成片时间为派生只读。

### 预览与导出（目标行为）

| 能力 | 定帧内批注 |
| --- | --- |
| 视频 | 继承所属定帧：段内固定 `hold.sourceMs` 解码帧 |
| 图形/文字 | `outputMs` 在 `[holdOutStart+offset, holdOutStart+offset+duration)` 显隐 |
| 箭头动画 | 动画时钟 = 定帧内局部时间 `holdOffsetMs + (outputMs - holdOutStart - offset)` |
| 音频 | 在定帧内 offset 处开始播放，不重复延长成片 |
| 原声 | 继承定帧段静音策略 |

导出：在所属 hold 的帧克隆段内，按成片时间合成 overlay / 混音；**不**增加 `getMergedHoldOutputDurationMs` 以外的插入时长。

### 与阶段 7/8 的关系

- **阶段 7** 定帧轨：定义「停多久」；阶段 10 **不替代**定帧轨，只在已有 insert 段内编排内容。
- **阶段 8** 预览模式：定帧内批注的 **创建与精调** 以预览模式为主；源模式可查看、不宜按源时间拖条。
- **阶段 9** 展开多轨：定帧轨重叠编辑体验；定帧内批注条目可画在定帧组展开后的子 lane 上。
- 定帧 **起点** 的定帧批注（`holdOffset = 0`）与 **定帧内** 批注（`holdOffset > 0`）可并存；前者走现有 `freezeDuringAnnotation`，后者走 `hold-inner`（或统一模型后 `holdOffsetMs` 可选字段，实现时再定）。

### 实现要点（规划，尚未编码）

1. **类型**：`AnnotationTiming` 或 `holdInner?: { linkedHoldId, holdOffsetMs }` 扩展 `AnnotationRegion` / `AudioAnnotationClip`
2. **映射**：`holdInnerSpanToOutputSpan(linkedHold, holdOffsetMs, durationMs, holdRegions)`（`timelineMapping.ts`）
3. **可见性**：`VideoPlayback` / `annotationRenderer` 分支 `hold-inner` 时钟
4. **时间轴**：预览模式新轨或定帧子层；源模式只读标记
5. **持久化**：`PROJECT_VERSION` bump；加载时校验 `linkedHoldId` 仍存在
6. **测试**：定帧 10s + offset 4s 可见性；offset 边界；所属定帧删除；重叠定帧歧义

### 验证（阶段 10 完成后）

- 源 2s 定帧 10s → 预览 6s 处添加箭头 → 仅 6–9s 成片可见，画面始终为 2s 帧
- 定帧内 +0s 与 +4s 两条批注互不干扰；配置文件 `holdOffsetMs` 分别为 `0`、`4000`
- 侧栏与条标签：成片 6.00s 与「定帧 +4.00s」一致
- 导出 MP4 总长仍 = 源时长 + 定帧并集（不因定帧内批注额外加长）

### 非目标（阶段 10）

- 定帧内批注 **不** 单独拉长成片（那是定帧轨职责）；
- 不替代 TTS/录音（阶段 3/4）；
- 自动字幕默认仍按 **源时间** 生成；定帧内字幕需另定规则或阶段 11+。

## 实现路线图


| 阶段    | 内容                                            | 状态    |
| ----- | --------------------------------------------- | ----- |
| **0** | 图形/文字批注：类型、预览、导出、时间轴轨                         | ✅ 已上线 |
| **1** | 统一「添加批注」入口：播放头锚点、默认时长、类型选择                    | ✅ 已上线 |
| **2** | 音频批注 V1：导入 mp3/wav + 预览播放 + 导出混音              | ✅ 已上线 |
| **3** | 音频批注 V2：编辑器内录音                                | 待做    |
| **4** | 音频批注 V3：TTS                                   | 待做    |
| **5** | 定帧批注模式：`freezeDuringAnnotation` + Hold + 时间映射 | ✅ 已上线 |
| **6** | 定帧模式下标注/字幕/Whisper 时间重映射 + 成片标尺 | ✅ 已上线 |
| **7** | 定帧轨产品定义：仅定帧轨显示、条长=定帧时长、并集映射总时长 | ✅ 已实现 |
| **8** | 源视频/预览双模式 + 时间轴源时间编辑 | ✅ 已实现 |
| **9** | 批注重叠展开多轨：重叠簇展开/收起、子 lane、`laneIndex` | 已确认，待实现 |
| **10** | 定帧内批注：`linkedHoldId` + `holdOffsetMs` + 预览/导出显隐 | 已确认，待实现 |
| **11** | 体验：批注模板、批量编辑、复制到其他锚点                          | 待做    |


优先级建议：叠加式 **1 → 2** 优先；定帧 **5 → 7 → 8** 已落地；**9 → 10** 先做重叠展开多轨（编辑体验），再做定帧内批注（新时间坐标）；教程式长定帧分步场景依赖阶段 10。

## 风险与兼容

1. **历史项目**：无 `audioAnnotationClips` / `holdRegions` 时退化为当前行为
2. **自动字幕**：叠加模式下时间戳无需改动；定帧模式需重映射或重新生成
3. **变速 + 批注**：锚点按源时间；变速区内的批注随源时间缩放（与 zoom/trim 一致）
4. **GIF 导出**：音频批注 GIF 无声；定帧需同帧重复
5. **多条重叠批注**：叠加轨 zIndex 排序已有；定帧轨允许重叠，成片时长取并集；阶段 9 展开多轨改善编辑，不改变播放语义
6. **阶段 7 迁移**：旧项目独立 `holdDurationMs` 需与 span 对齐或忽略
7. **阶段 10**：定帧内批注与源时间批注、定帧起点批注三套坐标并存；文档与 UI 必须明确「定帧 +Xs」与「源 Xs」
8. **重叠定帧**：定帧内批注必须绑定 `linkedHoldId`，不能仅靠成片时间反推

## 相关文件


| 文件                                                        | 职责                                  |
| --------------------------------------------------------- | ----------------------------------- |
| `src/components/video-editor/types.ts`                    | `AnnotationRegion`、`AnnotationType` |
| `src/hooks/useEditorHistory.ts`                           | 编辑器状态 `annotationRegions`           |
| `src/components/video-editor/projectPersistence.ts`       | 项目读写                                |
| `src/components/video-editor/VideoEditor.tsx`             | 添删改批注、导出传参                          |
| `src/components/video-editor/VideoPlayback.tsx`           | 预览 overlay 显隐                       |
| `src/components/video-editor/AnnotationOverlay.tsx`       | 文字/箭头/模糊渲染与拖拽                       |
| `src/components/video-editor/timeline/TimelineEditor.tsx` | 标注轨 UI                              |
| `src/lib/exporter/annotationRenderer.ts`                  | 导出合成                                |
| `src/lib/exporter/frameRenderer.ts`                       | 帧管线调用标注                             |
| `src/components/video-editor/AddPositionAnnotationMenu.tsx` | 添加批注下拉入口 |
| `src/components/video-editor/positionAnnotation.ts` | 锚点/时长常量与 span 计算 |
| `src/lib/audioAnnotation.ts` | 音频批注导入校验与 clip 构建 |
| `src/lib/exporter/audioAnnotationMixer.ts` | 导出时旁白混音 |
| `src/components/video-editor/AudioAnnotationSettingsPanel.tsx` | 音频批注侧栏 |
| `src/lib/arrowAnimation.ts`                               | 箭头入场动画                              |
| `src/lib/captioning/annotationsFromCaptions.ts`           | 自动字幕 → 批注                           |


定帧模式（阶段 5）：

| 文件 | 职责 |
| --- | --- |
| `src/lib/timelineMapping.ts` | 源/成片时间映射 |
| `src/lib/holdRegions.ts` | 批注 → Hold 同步 |
| `src/lib/exporter/holdFrameExport.ts` | 导出重复帧 |
| `src/lib/exporter/holdAudioExport.ts` | 定帧段原声静音 |
| `src/components/video-editor/videoPlayback/holdPlayback.ts` | 预览成片时钟 |
| `src/components/video-editor/videoPlayback/videoEventHandlers.ts` | 定帧预览 rAF |
| `src/components/video-editor/AnnotationSettingsPanel.tsx` | 定帧开关（阶段 7 移除时长滑块） |

定帧内批注（阶段 10，规划）：

| 文件 | 职责 |
| --- | --- |
| `src/lib/timelineMapping.ts` | `holdInnerSpanToOutputSpan`、定帧内可见性 |
| `src/components/video-editor/types.ts` | `AnnotationTiming` / `hold-inner` 字段 |
| `src/components/video-editor/timeline/TimelineEditor.tsx` | 定帧内轨 / 定帧子层 UI |
| `src/components/video-editor/VideoPlayback.tsx` | 定帧内 overlay 显隐与动画时钟 |
| `src/lib/exporter/annotationRenderer.ts` | 导出按 hold-offset 合成 |

重叠展开多轨（阶段 9，规划）：

| 文件 | 职责 |
| --- | --- |
| `src/components/video-editor/timeline/TimelineEditor.tsx` | 重叠簇检测、展开/收起、子 lane 布局 |
| `src/components/video-editor/types.ts` | 可选 `laneIndex` / `laneGroupId` |
| `src/components/video-editor/projectPersistence.ts` | 展开布局持久化（可选） |

## 验证

叠加模式（现有）：

- 播放头处添加文字/箭头 → 预览区间内可见、区间外消失 → 导出 MP4 含 overlay
- 自动字幕生成 → 时间对齐可播放

音频批注（阶段 2 后）：

- 导入 mp3 对齐锚点 → 预览听到旁白 → 导出混音正确

定帧模式（阶段 5 后）：

```bash
npx vitest run src/lib/timelineMapping.test.ts
```

- 勾选定帧 → 预览画面停住 → 导出 MP4 时长 = 源时长 + 定帧并集时长

定帧轨（阶段 7 后）：

- 定帧批注只在定帧轨显示与编辑 → 预览 / 导出一致
- 重叠定帧条 → 成片总长 = 并集，非简单相加

重叠展开多轨（阶段 9 后）：

- 同锚点多条定帧 → 展开为子 lane，各自选中拖拽，预览/导出与折叠前一致
- 无重叠项目行为与现版相同

定帧内批注（阶段 10 后）：

- 长定帧（如 10s）内于 +4s 添加箭头 → 预览 6s 出现、画面仍为定帧锚点帧
- 项目 JSON 存 `holdOffsetMs: 4000`，非 `startMs: 4000` 冒充源时间

---

## 附录：定帧模式（Freeze / Hold）

用户为批注勾选 **「批注期间定帧画面」**（`freezeDuringAnnotation: true`）时启用。定帧批注**仅出现在定帧轨**（阶段 7）。

### 数据模型

```typescript
interface HoldRegion {
  id: string;
  sourceMs: number;        // 定帧锚点 = 批注 startMs / anchorMs
  holdDurationMs: number;  // 阶段 7：由 endMs - startMs 派生，不再独立编辑
  linkedAnnotationId?: string;
}
```

批注侧：`freezeDuringAnnotation: true`；**不再**提供独立 `holdDurationMs` 滑块（阶段 7）。

### 时间映射（阶段 7 目标）

1. 每条定帧批注 → 成片插入区间 `[outputStart, outputEnd)`（由源锚点 + 条长映射）
2. 合并所有区间为**并集**，得到有效定帧段集合
3. **成片总长** = 源时长 + 并集各段长度之和
4. **源 ↔ 成片** seek / 预览 / 导出均基于并集后的插入布局

> 当前实现（阶段 5–6）仍部分使用逐条累加与双轨显示；阶段 7 对齐本附录。

实现：`src/lib/timelineMapping.ts`

### 预览

- `outputDuration = sourceDuration + unionHoldDurationMs`
- 定帧段内：`video.currentTime` 固定在对应 `sourceMs`，rAF 推进成片时间
- 定帧批注 overlay 按**成片时间**显隐

定帧内批注（阶段 10，拟）：

- 可见区间 = `holdOutputStart + holdOffsetMs` 起，时长 `durationMs`
- 定帧段内 `video.currentTime` 仍固定于 `hold.sourceMs`；overlay / 动画按 **outputMs** 与 **hold 内局部时钟** 驱动

### 导出

- 在并集定帧段内克隆对应锚点 `VideoFrame`
- 定帧段原声静音；定帧音频批注按成片时间混音

### 与旧「停帧轨道」方案的区别

- **旧**：Hold 轨道为一等公民，用户先加停帧再加标注
- **现（阶段 7）**：批注为一等公民；定帧轨 = **定帧批注专用轨**（可编辑、可重叠），不是与内容脱钩的抽象 hold 条