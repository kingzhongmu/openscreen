# 视频指定点批注（Video Position Annotation）

> 状态：图形/文字批注与音频解说 V1 已上线；编辑器内录音、TTS 与「定帧批注」模式待实现  
> 本文档取代原先以停帧（Hold）为核心的方案叙述，停帧相关内容见 [附录：可选定帧模式](#附录可选定帧模式freeze--hold)

## 背景与目标

用户在**视频编辑播放过程中**，希望在某个时间点插入一段有**固定时长**的解说或标注，添加完成后视频**继续正常播放**。

典型场景：

1. 播放到 5 秒时，弹出文字说明「点击这里」——持续 3 秒，画面照常推进
2. 同一时刻叠加箭头/高亮图形，配合文字动画
3. 导入或录制一段旁白，与画面该段同步播放
4. （可选）批注期间**定住画面**讲解，类似教程停帧——见附录

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

模式 B — 定帧批注（可选，待实现）
源时间   0s ──── 5.0s ──── 5.0s ──── 8.0s ───►
              │ 定帧 3s + 叠加 │
成片时间 0s ──── 5.0s ──── 8.0s ──── 11.0s ───►
              ↑ 同一解码帧重复 3 秒
成片时长   = 源时长 + Σ 定帧插入时长
```


| 模式       | 视频    | 成片时长 | 时间轴          |
| -------- | ----- | ---- | ------------ |
| **叠加批注** | 继续播放  | 不变   | 单一源时间        |
| **定帧批注** | 锚点处停住 | 延长   | 源时间 ↔ 成片时间映射 |


**产品默认**：模式 A。模式 B 作为批注属性 `freezeDuringAnnotation: true` 的扩展，而非独立「停帧轨道」工作流。

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
4. 可选勾选「批注期间定帧画面」→ 联动 `HoldRegion`（附录）

同一锚点允许多条批注并存（现有标注轨已支持多段重叠）。

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


`getExportMetrics`：叠加模式时长不变；定帧模式 `outputDuration += Σ holdDurationMs`。

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
- UI：`AudioAnnotationSettingsPanel.tsx`、时间轴 `row-audio-annotation`

## 实现路线图


| 阶段    | 内容                                            | 状态    |
| ----- | --------------------------------------------- | ----- |
| **0** | 图形/文字批注：类型、预览、导出、时间轴轨                         | ✅ 已上线 |
| **1** | 统一「添加批注」入口：播放头锚点、默认时长、类型选择                    | ✅ 已上线 |
| **2** | 音频批注 V1：导入 mp3/wav + 预览播放 + 导出混音              | ✅ 已上线 |
| **3** | 音频批注 V2：编辑器内录音                                | 待做    |
| **4** | 音频批注 V3：TTS                                   | 待做    |
| **5** | 定帧批注模式：`freezeDuringAnnotation` + Hold + 时间映射 | 待做    |
| **6** | 定帧模式下标注/字幕/Whisper 时间重映射                      | 待做    |
| **7** | 体验：批注模板、批量编辑、复制到其他锚点                          | 待做    |


优先级建议：**1 → 2 → 5**。先完善叠加式工作流与音频，定帧作为进阶选项。

## 风险与兼容

1. **历史项目**：无 `audioAnnotationClips` / `holdRegions` 时退化为当前行为
2. **自动字幕**：叠加模式下时间戳无需改动；定帧模式需重映射或重新生成
3. **变速 + 批注**：锚点按源时间；变速区内的批注随源时间缩放（与 zoom/trim 一致）
4. **GIF 导出**：音频批注 GIF 无声；定帧需同帧重复
5. **多条重叠批注**：zIndex 排序已有；音频重叠需混音或禁止重叠策略

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


定帧模式额外涉及（待建）：


| 文件                                              | 职责       |
| ----------------------------------------------- | -------- |
| `src/lib/timelineMapping.ts`                    | 源/成片时间映射 |
| `src/lib/exporter/streamingDecoder.ts`          | 导出重复帧    |
| `src/components/video-editor/VideoPlayback.tsx` | 定帧预览 rAF |


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

- 勾选定帧 → 预览画面停住 → 导出 MP4 时长 = 源时长 + 定帧时长

---

## 附录：可选定帧模式（Freeze / Hold）

仅在用户为批注勾选 **「批注期间定帧画面」**（或等价的 `freezeDuringAnnotation: true`）时启用。不作为默认工作流。

### 数据模型

```typescript
interface HoldRegion {
  id: string;
  sourceMs: number;        // 定帧锚点（源时间，毫秒）
  holdDurationMs: number;  // 成片额外停留时长，默认 3000，范围 500–30000
  /** 可选：关联触发定帧的批注 id，便于联动删除 */
  linkedAnnotationId?: string;
}
```

可由批注创建时自动生成，也可在定帧模式下手动调节 `holdDurationMs`（须 ≥ 关联批注的 `durationMs`）。

### 时间映射

对按 `sourceMs` 升序排列的停帧列表 `H`：

- **源 → 成片**：`outputMs = sourceMs + Σ holdDurationMs`（所有 `hold.sourceMs < sourceMs`）
- **成片 → 源**：若落在某停帧的成片区间 `[holdOutStart, holdOutEnd)`，则 `sourceMs = hold.sourceMs`；否则减去已累计停帧时长

实现：`src/lib/timelineMapping.ts`（待建）

### 预览

- `outputDuration = sourceDuration + Σ holdDurationMs`
- 定帧段内：`video.currentTime` 固定在 `sourceMs`，独立 rAF 推进成片时间
- 批注/箭头/字幕：按**成片时间**判断可见性并重映射 Whisper 时间戳

### 导出

- 在 `sourceMs` 解码帧 emit 后，克隆同一 `VideoFrame` 追加 `holdDurationMs × fps` 帧
- 定帧段原声静音，由音频批注或后续旁白填充

### 与独立「停帧轨道」的区别

旧方案以 **Hold 轨道**为一等公民，用户先加停帧再加标注。新方案以 **批注**为一等公民，定帧是批注的可选属性；Hold 数据仍可用于导出/预览引擎，但 UI 不强制用户理解「源时间 vs 成片时间」。