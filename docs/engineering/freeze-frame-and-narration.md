# 视频指定点批注（Video Position Annotation）

> 状态：图形/文字批注与音频解说 V1 已上线；**定帧批注（阶段 5–7）已实现**；**源视频/预览双模式（阶段 8）已实现**；**批注重叠展开多轨（阶段 9）已实现**；**定帧集合**（阶段 10）已确认、待实现；编辑器内录音、TTS 待实现  
> 本文档取代原先以停帧（Hold）为核心的方案叙述，停帧相关内容见 [附录：可选定帧模式](#附录可选定帧模式freeze--hold)

## 背景与目标

用户在**视频编辑播放过程中**，希望在某个时间点插入一段有**固定时长**的解说或标注，添加完成后视频**继续正常播放**。

典型场景：

1. 播放到 5 秒时，弹出文字说明「点击这里」——持续 3 秒，画面照常推进
2. 同一时刻叠加箭头/高亮图形，配合文字动画
3. 导入或录制一段旁白，与画面该段同步播放
4. （可选）批注期间**定住画面**讲解，类似教程停帧——见附录
5. （可选，阶段 10）在**定帧集合**内串行分步出现文字/箭头/旁白——见 [阶段 10](#阶段-10定帧集合已确认待实现)

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


| 模式              | 视频    | 成片时长         | 时间轴                           |
| --------------- | ----- | ------------ | ----------------------------- |
| **叠加批注**        | 继续播放  | 不变           | 单一源时间；**批注轨**                 |
| **定帧批注**        | 锚点处停住 | 延长           | 源时间 ↔ 成片时间映射；**仅定帧轨**         |
| **定帧集合**（阶段 10） | 锚点处停住 | 延长（= 各段时长之和） | 源锚点 + 集合内 **串行** 多段；与普通定帧同等地位 |


**产品默认**：模式 A。模式 B 作为批注属性 `freezeDuringAnnotation: true` 的扩展；定帧批注在 UI 上**只出现在定帧轨**（见阶段 7），预览画布仍渲染 overlay。模式 C（**定帧集合**）在单一源锚点下组织 **串行、不重叠** 的多段讲解步骤；**单段集合等价于 today's 普通定帧**（`segments.length === 1`）。

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

**批注轨**：仅叠加式批注；播放头处重叠时可 **展开为多子轨**（阶段 9，已实现）。**定帧轨**：普通定帧批注与 **定帧集合**（阶段 10）均在此轨；同一源锚点建议仅一条集合或普通定帧。**定帧集合**展开后，集合内各段占 **串行子轨**，见 [阶段 10](#阶段-10定帧集合已确认待实现)。

### 时间轴滚轮（阶段 9 同期）

时间轴区域滚轮行为（工具栏右侧有快捷键提示）：


| 操作                          | 行为                   |
| --------------------------- | -------------------- |
| **滚轮**                      | 上下滚动时间轴面板（垂直 scroll） |
| **Alt + 滚轮**                | 水平平移可见时间范围           |
| **Ctrl + 滚轮**（Mac：`⌘ + 滚轮`） | 以指针位置为中心缩放           |


实现：`TimelineEditor` 在滚动容器上使用原生 `wheel` 监听（`passive: false`）；Windows 下额外追踪 Alt 键状态，避免 `altKey` 在滚轮事件中不可靠。

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


| 按键                  | 行为                                |
| ------------------- | --------------------------------- |
| `A`                 | 在播放头处快速添加**文字**批注（3 秒）            |
| `B`                 | 添加模糊批注（仅 `BLUR_REGIONS_ENABLED`）  |
| `Tab` / `Shift+Tab` | 折叠时在播放头处重叠条目间切换；展开时在整簇成员间循环（阶段 9） |


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


| 轨道      | 内容                                             | 成片时长 |
| ------- | ---------------------------------------------- | ---- |
| **批注轨** | 叠加式文字 / 图形 / 模糊 / 音频                           | 不变   |
| **定帧轨** | 定帧批注（同样是上述类型，但 `freezeDuringAnnotation: true`） | 参与延长 |


定帧轨在交互上与批注轨类似：可添加、选中、拖拽改区间、侧栏编辑内容与样式。**定帧批注不在批注轨显示**；预览画布仍按成片时间渲染 overlay。

### 时长规则

- **定帧时长 = 批注条长度** = `endMs - startMs`（或音频 `durationMs`）
- **移除**侧栏「定帧时长」独立滑块；拖定帧轨上的条即同时改可见区间与定帧插入
- 不再维护与条长脱钩的 `holdDurationMs`（持久化可保留字段作迁移，运行时由 span 派生）

### 重叠与总时长

定帧映射分两层语义：


| 用途                                 | 规则                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| **单条定帧在成片上的位置**（预览 / seek / 定帧轨显示） | 源锚点 `sourceMs` 之前，所有定帧的 `holdDurationMs` **全长累加**（同锚点先 `mergeHoldRegions` 取最长） |
| **成片总插入时长**（导出 MP4 总长）             | 各 hold 的成片 insert span 做**并集**；成片上不重叠的段长度相加，重叠段只计一次                            |


- 多条定帧批注**允许在定帧轨上重叠**（同锚点或多锚点均可）
- **成片总长** = `max(源时长 + 并集插入时长, 最晚 hold 成片 end)`（见 `getOutputDurationMs`）
- 同一起点多条定帧：`mergeHoldRegions` 取最长条，并集等价于一条

```text
例 — 源锚点顺序累加（预览定位）
  定帧-2s: 源 2.01 起，长 4.01s
  定帧-4s: 源 4.02 起，长 4.00s
  定帧-5s: 源 5.00 起，长 7.02s
  → 定帧-2s 成片 2.01–6.02；定帧-4s 成片 8.03–12.03；定帧-5s 成片 13.01–20.03

例 — 源时间首尾相接
  定帧 A: 2.0s 起，长 4s（源锚点 2s）
  定帧 B: 6.0s 起，长 3s（源锚点 6s）
  → A 在成片 2s 起；B 在成片 10s 起（6s + 前序插入 4s）；中间 6–10s 为 A 结束后源视频继续推进

例 — 源时间有间隔
  定帧 A: 5.0s 起，长 3s
  定帧 B: 8.0s 起，长 2s
  → 成片 insert 并集 = 3s + 2s = 5s；A 与 B 之间正常播放源视频
```

### 实现要点

1. 时间轴：定帧批注仅 `HOLD_ROW`；批注轨过滤 `freezeDuringAnnotation`
2. 侧栏：移除定帧时长滑块；拖定帧轨条 = 改批注时长
3. 映射：`sourceToOutputMs` / `outputToSourceMs` 用全长累加；`getHoldOutputSpans` + `unionMergeHoldOutputSpans` 算导出并集（`timelineMapping.ts`）；`computeHoldOutputSegments` 保留作边际插入参考
4. 数据：`HoldRegion.holdDurationMs` 由 span 派生；加载时 legacy `holdDurationMs` 合并进 span
5. 测试：`timelineMapping.test.ts` 覆盖同锚点、顺序累加（2s/4s/5s）、部分重叠

## 阶段 8：源视频 / 预览双模式（已实现）

### 模式开关

存在定帧批注时，时间轴工具栏提供 **源视频模式** / **预览模式** 切换（默认真源视频模式）。


| 模式        | 播放时钟        | 时间轴          | 编辑   |
| --------- | ----------- | ------------ | ---- |
| **源视频模式** | 源时间，画面正常推进  | 源视频标尺        | 可编辑  |
| **预览模式**  | 成片时间（含定帧插入） | **成片标尺**（只读） | 不可编辑 |


### 时间轴

- **源视频模式**：标尺、条位置、播放头均使用源视频毫秒（可编辑）
- **预览模式**：标尺、条位置、播放头映射为**成片时间**（定帧段在轴上展开）；只读，不可拖
- **滚轮**：垂直滚动面板；**Alt + 滚轮** 平移；**Ctrl + 滚轮** 缩放（见上文「时间轴滚轮」）
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

## 阶段 9：批注重叠展开多轨（已实现）

### 动机与问题

定帧轨与批注轨均 **允许重叠**（同锚点或多条时间交叉）。折叠时所有条目画在 **同一物理行** 上，导致：

- 重叠条难以选中、拖拽改区间易误触相邻条；
- `Tab` 切换同锚点批注效率低，视觉密度高；
- 同锚点多条定帧（文本 + 音频等）编辑体验差。

阶段 9 不改变批注/定帧的 **时间语义**（仍为源 `startMs` / `anchorMs` 与 `freezeDuringAnnotation`），只改善 **时间轴编辑布局**：将 **播放头处** 的重叠簇 **展开** 为多条子轨，子轨内不重叠。

### 与定帧集合（阶段 10）的分工


| 维度   | 阶段 9 展开多轨                   | 阶段 10 定帧集合                           |
| ---- | --------------------------- | ------------------------------------ |
| 解决问题 | 同一时段多条批注/定帧 **不好选、不好拖**     | 长定帧 **内部** 串行分步讲解                    |
| 影响范围 | 时间轴 UI + 展开状态（localStorage） | 新实体 `HoldCollection` + 集合内子轨 + 映射    |
| 成片时钟 | 不变                          | 集合 insert = 各段时长 **之和**（与普通定帧同等延长成片） |


### 核心交互

```text
折叠（默认）                    展开（仅播放头处簇）
批注轨 ──[A][B]──（重叠）        批注轨 ──[C]──（非簇成员留主轨）
                                 批注轨 lane 1 ──[A]──
                                 批注轨 lane 2 ──[B]──

定帧轨 ──[F1][F2]──（同锚点）    定帧轨 lane 0 ──[F1]──
                                 定帧轨 lane 1 ──[F2]──
```

- **展开条件**：播放头下存在 **≥2 条** 可展开成员时显示 ▶/▼（成员来自下方簇定义）。
- **簇范围**：批注轨 = 播放头下任意条目所属的 **时间重叠连通分量**（区间有交集即连通，`aaa` 与 `bbb` 相交且 `bbb` 在播放头下 ⇒ `aaa` 一并展开）；定帧轨 = 上述分量 **并上** 同源锚点 sibling（150ms 吸附阈值，预览轴 span 可不相交）。
- **展开粒度**：每次只展开 **当前播放头簇**；簇外条目仍留在主轨，**非**整轨展开。
- **展开 / 收起**：簇级 toggle；展开后 **每条成员独占一子 lane**（按 `startMs` → `id` 排序），便于选中与水平拖动不换轨。
- **可逆**：收起后恢复单轨叠层显示；批注/定帧数据不变。
- **源视频模式** 与 **预览模式** 均可展开；预览模式只读时仍可展开查看，不可拖条。
- **Tab**：折叠时在播放头处重叠条目间切换；展开时在 **整簇成员** 间按 lane 顺序循环（定帧轨含定帧批注与定帧音频批注）。

### 数据与持久化

**不在** `AnnotationRegion` / 项目 JSON 上新增 `laneIndex` / `laneGroupId`（MVP 未 bump `PROJECT_VERSION`）。

展开状态为 **编辑器 UI 状态**，按轨道记录当前展开的簇 id：

```typescript
expandedClustersByTrack: Record<trackId, clusterId>
// localStorage key: openscreen-timeline-expanded-clusters
```

重开项目后批注/定帧条目不变；展开布局按 localStorage 恢复（同浏览器会话偏好）。

簇检测与 lane 布局见 `src/lib/overlapClusters.ts`（`detectOverlapClusters`、`getPlayheadExpandCluster`、`groupItemsByLaneRow`、`assignExpandedLaneLayout`）。

### MVP 范围（已实现 vs 未做）


| 项                                     | 状态                    |
| ------------------------------------- | --------------------- |
| 批注轨：播放头簇展开/收起 + 子 lane                | ✅                     |
| 定帧轨：同锚点 / 重叠展开                        | ✅                     |
| 展开按钮不触发 seek（`data-timeline-control`） | ✅                     |
| 展开态 Tab 限定 lane 内循环                   | ✅                     |
| localStorage 持久化展开簇 id                | ✅                     |
| 时间轴滚轮：垂直 / Alt 平移 / Ctrl 缩放           | ✅                     |
| 条目级 `laneIndex` / 项目内持久化布局            | ❌ 未做                  |
| 音频批注轨独立展开                             | ❌ 未做（定帧音频随定帧轨 Tab 循环） |
| 定帧集合 `segments[]`、集合内串行子轨             | ❌ 阶段 10               |


### 实现要点

1. **簇检测**：`overlapClusters.ts` — `detectOverlapClusters` + `getPlayheadExpandCluster`（播放头所在重叠连通分量 + 定帧轨同源锚点扩展）
2. **布局**：`TimelineEditor` — `LanedTrackRows` + `groupItemsByLaneRow(..., playheadMs, expandedClusterId)`
3. **交互**：`Row.tsx` — chevron、`stopPropagation`；`toggleClusterExpand(trackId, clusterId)`
4. **测试**：`overlapClusters.test.ts`（簇检测、lane 分配、播放头簇、持久化 helper）

### 验证

```bash
npx vitest run src/lib/overlapClusters.test.ts
```

- 播放头处同锚点 3 条定帧 → 展开后 3 条子轨，各自可选中拖拽，预览/导出与折叠前一致
- 收起 → 恢复叠层；刷新页面 → 展开簇 id 从 localStorage 恢复
- 无重叠或播放头不在簇内 → UI 与折叠态相同，无 ▶/▼
- 点击 ▶/▼ 时播放头不跳动

### 非目标（阶段 9）

- 不引入 `HoldCollection` / 集合内 `segments`（阶段 10）
- 不改变 `timelineMapping`、定帧播放、导出时长
- 不做批注模板、批量复制（阶段 11）

## 阶段 10：定帧集合（已确认，待实现）

> **方案演进**：早期草案为「定帧内批注」(`linkedHoldId` + 自由 `holdOffsetMs`、不额外延长成片)。经产品讨论改为 **定帧集合**：集合与普通定帧 **同等地位**（延长成片），集合内各段 **严格串行、不叠加**，UI 以子轨 + 拖边为主。下文为当前权威 spec。

### 动机与问题

典型场景：**源 5.0s 起定帧讲解**，希望先显示一段文字 7s，再切到箭头 3s——画面始终停在 5s 那一帧，成片上连续插入 10s。

当前 **单条定帧批注**（阶段 7）一条内容对应一条 hold，要在同一停帧内分步出现内容时：

- 若用源时间 `startMs = 9s` 表达第二步，预览会等到 **定帧结束、源片继续播** 才出现；
- 若同锚点多条定帧批注重叠，编辑与成片映射易混淆。

阶段 10 引入 **定帧集合（Hold Collection）**：在 **单一源锚点** 下，用 **串行多段** 组织教程式分步讲解；**单段集合 = 现有普通定帧** 的特例。

### 三种批注坐标（对比）


| 类型       | 锚点 / 结构                                     | 适用场景                          | 画面             | 是否延长成片                                   |
| -------- | ------------------------------------------- | ----------------------------- | -------------- | ---------------------------------------- |
| **叠加批注** | 源 `startMs`                                 | 视频照常播放时的 callout              | 推进             | 否                                        |
| **普通定帧** | 源 `startMs` + `freezeDuringAnnotation`，单条内容 | 从锚点起停住并显示 **一段** 内容           | 停住             | 是（条长 = 插入时长）                             |
| **定帧集合** | 源 `sourceMs` + `segments[]` 串行多段            | 同一锚点 **分步** 讲解（文字 → 箭头 → 音频…） | 停住（整段集合内同一解码帧） | **是**（insert = **Σ segment.durationMs**） |


```text
例 — 源 5s 定帧集合，段1 文本 7s + 段2 箭头 3s

源时间:     0────5s═══════════════════15s────►  （5s 后源时钟停在 5s）
                              ↑ 始终同一帧

成片时间:   0────5s══════════════15s────►
              [---- 集合 insert 10s ----]
              [段1 文本 7s][段2 箭头 3s]
              5.0–12.0s    12.0–15.0s

集合内坐标: 段2 offsetMs = 7000（派生），durationMs = 3000
           ≠ 源 startMs = 12s
```

**注意**：「集合内 +7s」≠「源 12.0s」。UI 与持久化以 **集合内串行 offset** 为权威（或由段序 + 各段 `durationMs` 派生），避免与源时间混淆。

### 核心产品规则

1. **与普通定帧同等地位**：定帧集合出现在 **定帧轨**，参与源 ↔ 成片映射，**延长成片**；导出在 insert 段内克隆 `sourceMs` 解码帧。
2. **集合内严格串行**：各段 `[offset, offset + duration)` 首尾相接、**不重叠**（默认 **无缝**；段间空隙若允许，仍计入 insert，见下）。
3. **集合 insert 时长** = 从首段起点到末段终点的跨度；默认 **无缝** 时 = `Σ segment.durationMs`。
4. **单段即普通定帧**：`segments.length === 1` 的集合与 today 的 `freezeDuringAnnotation` 批注等价，便于迁移。
5. **同源锚点**：同一 `sourceMs` **仅允许一条**定帧集合（与普通定帧路径合并后互斥；实现时拒绝同锚点重复创建）。

#### 产品定稿（2025-06，实现权威）


| #   | 决策        | 定稿                                                                                                  |
| --- | --------- | --------------------------------------------------------------------------------------------------- |
| 1   | **入口**    | **A — 一律集合化**：用户仅见「定帧 / 勾选定帧」一个入口；内部均为 `HoldCollection`，`segments.length === 1` 时 UI 与 today 单条定帧一致 |
| 2   | **默认时长**  | 新建集合 **首段 10s**（文本）；**追加段 3s**（与 `DEFAULT_POSITION_ANNOTATION_DURATION_MS` 一致）                      |
| 3   | **删最后一段** | **删除整个集合**（不降级为「普通定帧」类型）                                                                            |
| 4   | 段间        | **无缝串行**，不允许空隙                                                                                      |
| 5   | 同源锚点      | **互斥**，同 `sourceMs` 仅一条集合                                                                           |


#### 加段与改时长（已确认）


| 操作        | 行为                                                        |
| --------- | --------------------------------------------------------- |
| **创建集合**  | 源锚点 = 播放头；默认 **一段文本**，时长默认 10s（或与现有定帧默认策略一致）              |
| **末尾追加段** | 新段接在末段之后，默认 `durationMs = 3000`；**集合总长增加**，成片 insert 同步变长 |
| **中间插入段** | 从相邻段 **切分** 时间（总长可不变）；或先追加再拖边调整                           |
| **拖段边缘**  | 改本段 `durationMs`；与相邻段 **联动**（挤占 / 让出），保持串行不重叠             |
| **删除段**   | 若仅剩一段 → **删除整个集合**；多段时删除该段并重新 packing                     |


### 数据模型（拟）

```typescript
/** 定帧集合：单一源锚点 + 串行多段 */
interface HoldCollection {
  id: string;
  sourceMs: number;              // 源锚点 = 播放头 / 定帧轨外壳位置
  segments: HoldCollectionSegment[];
  /** 定帧轨外壳条可选关联 id（实现时与 HoldRegion / 首段批注 id 对齐） */
  shellAnnotationId?: string;
}

/** 集合内一段：复用批注载荷，时间在集合内串行 */
interface HoldCollectionSegment {
  id: string;
  durationMs: number;            // ≥ minDuration（如 100ms）
  type: AnnotationType;        // "text" | "figure" | …
  /** 图形/文字：复用 AnnotationRegion 的 content / style / figureData 等 */
  payload: Omit<AnnotationRegion, "startMs" | "endMs" | "freezeDuringAnnotation">;
  /** 音频段：可选 AudioAnnotationClip 载荷 */
  audio?: Pick<AudioAnnotationClip, "audioUrl" | "volume" | "duckOriginal">;
}

// 派生（不持久化为主字段）
function segmentOffsetMs(collection: HoldCollection, segmentIndex: number): number {
  return collection.segments
    .slice(0, segmentIndex)
    .reduce((sum, seg) => sum + seg.durationMs, 0);
}

function collectionHoldDurationMs(collection: HoldCollection): number {
  return collection.segments.reduce((sum, seg) => sum + seg.durationMs, 0);
}
```

与现有 `HoldRegion` 的关系：

```typescript
// 同步到 holdRegions 供 timelineMapping / 导出：
{
  id: collection.id,
  sourceMs: collection.sourceMs,
  holdDurationMs: collectionHoldDurationMs(collection),
  linkedAnnotationId: collection.shellAnnotationId,
}
```

**迁移**：现有 `freezeDuringAnnotation: true` 且单条批注 → 加载时转为 `HoldCollection`，`segments: [{ durationMs: endMs - startMs, payload: … }]`。

约束：

- 集合内各段 `durationMs` ≥ 最小时长；拖边不得产生负宽或重叠。
- 删除集合 → 级联删除 `HoldRegion` 与所有 segment 载荷（默认 **级联删除**）。
- 集合 **不** 使用源 `startMs` 表达集合内第 N 步（段序 + `durationMs` 派生 offset）。

### 时间映射

```text
holdOutputStart = sourceToOutputMs(collection.sourceMs, holdRegions)
segmentOutputStart[i] = holdOutputStart + segmentOffsetMs(i)
segmentOutputEnd[i]   = segmentOutputStart[i] + segments[i].durationMs
```

- **成片 insert 区间**：`[holdOutputStart, holdOutputStart + collectionHoldDurationMs)`
- **段可见性**：`outputMs ∈ [segmentOutputStart[i], segmentOutputEnd[i])`
- **视频解码**：整个 insert 段内 `video.currentTime = collection.sourceMs`
- 与阶段 7 一致：多集合并列时仍用 **源锚点前全长累加** 定位；导出总时长仍用 insert span **并集**

实现：`holdCollectionSpanToOutputSpan(collection, segmentIndex, holdRegions)`（`timelineMapping.ts`，规划）。

### UI 与交互

#### 轨道分工


| 轨道             | 内容                                      |
| -------------- | --------------------------------------- |
| **批注轨**        | 仅叠加式批注（源时间）                             |
| **定帧轨**        | 普通定帧 **或** 定帧集合 **外壳条**（源/预览均显示锚点与集合总长） |
| **集合内子轨**（展开后） | 各 `segment` 一条串行子 lane，**仅预览模式主编辑**     |


实现：预览模式下选中/展开集合 → 复用阶段 9 **子 lane** 布局，但增加 **串行约束**（拖边吸附、相邻段联动）；可为 `row-hold` 下 `row-hold-collection-{id}-lane-{n}`。

#### 时间轴（预览模式 — 主编辑面）

```text
成片轴:  0────5════════════════════════15────►
              ↑ 集合外壳（10s）
              子轨 lane 0  [====文本 7s====]
              子轨 lane 1              [箭头 3s]
              5.0s        12.0s        15.0s
```

条标签建议 **双行**：


| 层级   | 主标签                        | 副标签（hover / 选中）      |
| ---- | -------------------------- | -------------------- |
| 集合外壳 | 源 `5.0s`，成片 `5.0s – 15.0s` | `定帧集合 · 2 步`         |
| 段条   | 成片 `12.0s – 15.0s`         | `集合内 +7.0s – +10.0s` |


精度：至少 **0.01s**。

#### 源视频模式

- **外壳**：可编辑源锚点、拖动改 **集合总长**（等比缩放各段或仅改末段，产品实现时二选一，默认 **改末段 / 追加**）。
- **子段**：不在源轴按「源 12s」画条；外壳条上可显示 **分段刻度**（只读），或侧栏「此集合内的步骤」列表。
- 提示：**切到预览模式** 编辑段界与内容。

#### 选中与 Tab

- 选中集合外壳 → 侧栏显示集合摘要 + 步骤列表。
- 选中某段 → 侧栏编辑该段内容/样式（与普通批注侧栏相同字段，**无**源锚点编辑）。
- 集合内多段重叠在同一成片时刻 **不应出现**（串行约束）；Tab 在展开子轨间循环（复用阶段 9）。

### 添加流程

**流程 A — 新建定帧（一律为单段集合）**

1. 播放头在源时间目标处（如 5.0s）；
2. 「添加批注」→ 勾选定帧 / 定帧轨添加入口（**无**单独的「普通定帧 vs 集合」分叉）；
3. 自动创建 `HoldCollection`：`sourceMs = playhead`，`segments = [{ type: text, durationMs: 10000 }]`；
4. 定帧轨出现外壳条；单段时 UI 与 today 单条定帧一致；预览模式可展开见子轨。

**流程 B — 集合内追加步骤**

1. 选中集合 **或** 播放头在集合 insert 段内；
2. 「添加步骤」/「在集合末尾添加批注」；
3. 新段接在末段后，`durationMs` 默认 3000 → **集合总长 +3s**，成片变长；
4. 用户拖段边缘调整各段占比。

**流程 C — 中间插入步骤**

1. 选中集合，播放头落在某段 **内部**；
2. 「在此处插入步骤」→ 从当前段 **切分**（当前段缩短，新段占默认 3s，后续段 offset 顺延）；
3. 若切分导致总长不足，可 **仅切分**（总长不变）或 **插入并拉长**（默认：切分，总长不变）。

**流程 D — 普通定帧升级**

1. 选中已有单条定帧批注 →「转为定帧集合」；
2. 生成 `HoldCollection`，原批注成为 `segments[0]`。

### 侧栏字段（拟）

**集合外壳（选中外壳时）**


| 字段   | 可编辑    | 说明                |
| ---- | ------ | ----------------- |
| 源锚点  | 是（源模式） | 如 `5.00s`         |
| 集合总长 | 只读（派生） | `Σ 段长`，如 `10.00s` |
| 成片区间 | 只读     | `5.00s – 15.00s`  |
| 步骤列表 | —      | 点击选中某段            |


**集合内某段（选中子轨条时）**


| 字段      | 可编辑        | 说明                   |
| ------- | ---------- | -------------------- |
| 集合内区间   | 是（滑块 / 拖条） | 如 `+7.00s – +10.00s` |
| 持续      | 是          | 默认 3s                |
| 成片时间    | 只读         | 派生                   |
| 内容 / 样式 | 是          | 与普通批注相同              |


**不要**同时可编辑「源 12.0s」与「集合内 +7.0s」；段的时间以 **集合内串行坐标** 为权威。

### 预览与导出


| 能力    | 定帧集合                                      |
| ----- | ----------------------------------------- |
| 视频    | insert 全程固定 `collection.sourceMs`         |
| 图形/文字 | 按各段 `segmentOutputStart/End` 显隐           |
| 箭头动画  | 局部时钟 = `outputMs - segmentOutputStart[i]` |
| 音频段   | 在段对应成片区间播放；不重复计 insert                    |
| 原声    | 整个集合 insert 段继承定帧静音策略                     |
| 成片总长  | 源时长 + 定帧 insert（与普通定帧相同规则）                |


导出：在 `[holdOutputStart, holdOutputStart + collectionHoldDurationMs)` 内克隆锚点帧，按段 output 窗口合成 overlay / 混音。

### 与阶段 7 / 8 / 9 的关系


| 阶段         | 关系                                                     |
| ---------- | ------------------------------------------------------ |
| **7 定帧轨**  | 集合外壳在定帧轨；insert 语义与普通定帧一致                              |
| **8 预览模式** | 集合 **内段** 的创建、拖边、精调以预览模式为主                             |
| **9 展开多轨** | 集合展开 = 固定成员子 lane + **串行拖边约束**（比播放头簇展开多「相邻段联动」）        |
| **普通定帧**   | `segments.length === 1` 时行为与 today 单条定帧一致；UI 可隐藏「集合」概念 |


### 实现要点（规划，尚未编码）

1. **类型**：`HoldCollection` / `HoldCollectionSegment`（`types.ts`）；项目 JSON `holdCollections[]` + `PROJECT_VERSION` bump
2. **同步**：`holdRegions.ts` — 集合 ↔ `HoldRegion` 双向同步
3. **映射**：`holdCollectionSegmentToOutputSpan`、`collectionHoldDurationMs`（`timelineMapping.ts`）
4. **时间轴**：定帧轨外壳 + 预览模式集合展开子轨；串行拖边（`TimelineEditor` / `Item`）
5. **预览 / 导出**：`VideoPlayback`、`annotationRenderer` 按段 output 窗口分支
6. **迁移**：单条 `freezeDuringAnnotation` → 单段集合
7. **测试**：创建默认 10s 文本 → 追加 3s 段 → 总长 13s；中间切分；拖边不重叠；导出时长

### 验证（阶段 10 完成后）

- 源 5s 创建集合，默认文本 10s → 预览 5–15s 停同一帧，首段全程可见
- 追加箭头段 3s → 预览 12–15s 仅箭头可见，成片总长 15s → 18s（若从 10s 追加）或 5–15s 内切分为 7+3（若切分）
- JSON 存 `segments[].durationMs` 与段序，**不**用 `startMs: 12000` 表达第二步
- 侧栏「集合内 +7.0s」与成片 12.0s 一致
- 导出 MP4：insert = 集合段长之和，与普通定帧映射规则一致

### 非目标（阶段 10）

- 集合内段 **不可** 自由重叠（重叠编辑走阶段 9 的 **不同** 定帧/批注，非同一集合内）
- 不替代 TTS / 录音（阶段 3/4）；音频可作为集合内一种 segment 类型
- 自动字幕默认仍按 **源时间**；集合内字幕规则另定（阶段 11+）
- **不做** 已废弃的「attach 到任意 hold 的自由 `holdOffsetMs` 子定帧」模型

## 实现路线图


| 阶段     | 内容                                                   | 状态      |
| ------ | ---------------------------------------------------- | ------- |
| **0**  | 图形/文字批注：类型、预览、导出、时间轴轨                                | ✅ 已上线   |
| **1**  | 统一「添加批注」入口：播放头锚点、默认时长、类型选择                           | ✅ 已上线   |
| **2**  | 音频批注 V1：导入 mp3/wav + 预览播放 + 导出混音                     | ✅ 已上线   |
| **3**  | 音频批注 V2：编辑器内录音                                       | 待做      |
| **4**  | 音频批注 V3：TTS                                          | 待做      |
| **5**  | 定帧批注模式：`freezeDuringAnnotation` + Hold + 时间映射        | ✅ 已上线   |
| **6**  | 定帧模式下标注/字幕/Whisper 时间重映射 + 成片标尺                      | ✅ 已上线   |
| **7**  | 定帧轨产品定义：仅定帧轨显示、条长=定帧时长、并集映射总时长                       | ✅ 已实现   |
| **8**  | 源视频/预览双模式 + 时间轴源时间编辑                                 | ✅ 已实现   |
| **9**  | 批注重叠展开多轨：播放头簇展开/收起、子 lane、滚轮快捷键                      | ✅ 已实现   |
| **10** | 定帧集合：`HoldCollection` + 串行 `segments` + 子轨拖边 + 预览/导出 | 已确认，待实现 |
| **11** | 体验：批注模板、批量编辑、复制到其他锚点                                 | 待做      |


优先级建议：叠加式 **1 → 2** 优先；定帧 **5 → 7 → 8 → 9** 已落地；下一步 **10** 定帧集合（教程式串行分步）；单段集合与现有普通定帧兼容。

## 风险与兼容

1. **历史项目**：无 `audioAnnotationClips` / `holdRegions` 时退化为当前行为
2. **自动字幕**：叠加模式下时间戳无需改动；定帧模式需重映射或重新生成
3. **变速 + 批注**：锚点按源时间；变速区内的批注随源时间缩放（与 zoom/trim 一致）
4. **GIF 导出**：音频批注 GIF 无声；定帧需同帧重复
5. **多条重叠批注**：叠加轨 zIndex 排序已有；定帧轨允许重叠，成片时长取并集；阶段 9 播放头簇展开多轨改善编辑，不改变播放语义
6. **阶段 7 迁移**：旧项目独立 `holdDurationMs` 需与 span 对齐或忽略
7. **阶段 10**：定帧集合与叠加批注、普通定帧三套模型并存；单段集合 = 普通定帧；UI 须区分「源 Xs」与「集合内 +Xs」
8. **同源锚点**：定帧集合与普通定帧互斥或 merge；集合内段 strictly 串行，不靠成片时间反推所属集合

## 相关文件


| 文件                                                             | 职责                                     |
| -------------------------------------------------------------- | -------------------------------------- |
| `src/components/video-editor/types.ts`                         | `AnnotationRegion`、`AnnotationType`    |
| `src/hooks/useEditorHistory.ts`                                | 编辑器状态 `annotationRegions`              |
| `src/components/video-editor/projectPersistence.ts`            | 项目读写                                   |
| `src/components/video-editor/VideoEditor.tsx`                  | 添删改批注、导出传参                             |
| `src/components/video-editor/VideoPlayback.tsx`                | 预览 overlay 显隐                          |
| `src/components/video-editor/AnnotationOverlay.tsx`            | 文字/箭头/模糊渲染与拖拽                          |
| `src/components/video-editor/timeline/TimelineEditor.tsx`      | 标注轨 / 定帧轨 UI、展开多轨、滚轮平移/缩放              |
| `src/components/video-editor/timeline/Row.tsx`                 | 轨道行、展开 chevron、`data-timeline-control` |
| `src/lib/overlapClusters.ts`                                   | 重叠簇检测、播放头簇、子 lane 布局、展开状态 localStorage |
| `src/lib/overlapClusters.test.ts`                              | 阶段 9 单元测试                              |
| `src/lib/exporter/annotationRenderer.ts`                       | 导出合成                                   |
| `src/lib/exporter/frameRenderer.ts`                            | 帧管线调用标注                                |
| `src/components/video-editor/AddPositionAnnotationMenu.tsx`    | 添加批注下拉入口                               |
| `src/components/video-editor/positionAnnotation.ts`            | 锚点/时长常量与 span 计算                       |
| `src/lib/audioAnnotation.ts`                                   | 音频批注导入校验与 clip 构建                      |
| `src/lib/exporter/audioAnnotationMixer.ts`                     | 导出时旁白混音                                |
| `src/components/video-editor/AudioAnnotationSettingsPanel.tsx` | 音频批注侧栏                                 |
| `src/lib/arrowAnimation.ts`                                    | 箭头入场动画                                 |
| `src/lib/captioning/annotationsFromCaptions.ts`                | 自动字幕 → 批注                              |


定帧模式（阶段 5）：


| 文件                                                                | 职责                |
| ----------------------------------------------------------------- | ----------------- |
| `src/lib/timelineMapping.ts`                                      | 源/成片时间映射          |
| `src/lib/holdRegions.ts`                                          | 批注 → Hold 同步      |
| `src/lib/exporter/holdFrameExport.ts`                             | 导出重复帧             |
| `src/lib/exporter/holdAudioExport.ts`                             | 定帧段原声静音           |
| `src/components/video-editor/videoPlayback/holdPlayback.ts`       | 预览成片时钟            |
| `src/components/video-editor/videoPlayback/videoEventHandlers.ts` | 定帧预览 rAF          |
| `src/components/video-editor/AnnotationSettingsPanel.tsx`         | 定帧开关（阶段 7 移除时长滑块） |


定帧集合（阶段 10，规划）：


| 文件                                                        | 职责                                               |
| --------------------------------------------------------- | ------------------------------------------------ |
| `src/components/video-editor/types.ts`                    | `HoldCollection`、`HoldCollectionSegment`         |
| `src/lib/holdRegions.ts`                                  | 集合 ↔ `HoldRegion` 同步                             |
| `src/lib/timelineMapping.ts`                              | `holdCollectionSegmentToOutputSpan`、集合 insert 时长 |
| `src/components/video-editor/timeline/TimelineEditor.tsx` | 定帧轨外壳 + 集合展开串行子轨、拖边联动                            |
| `src/components/video-editor/VideoPlayback.tsx`           | 按段 output 窗口显隐与动画时钟                              |
| `src/lib/exporter/annotationRenderer.ts`                  | 导出按集合段合成                                         |
| `src/components/video-editor/projectPersistence.ts`       | `holdCollections[]` 持久化与迁移                       |


重叠展开多轨（阶段 9）：


| 文件                                                        | 职责                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| `src/lib/overlapClusters.ts`                              | 簇检测、`getPlayheadExpandCluster`、`groupItemsByLaneRow`、展开状态读写 |
| `src/components/video-editor/timeline/TimelineEditor.tsx` | `LanedTrackRows`、Tab 循环、滚轮（垂直/Alt 平移/Ctrl 缩放）               |
| `src/components/video-editor/timeline/Row.tsx`            | 子 lane 样式、展开/收起按钮                                           |
| `src/lib/shortcuts.ts`                                    | 固定快捷键说明（Scroll / Alt+Scroll / Ctrl+Scroll）                  |


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

重叠展开多轨（阶段 9）：

```bash
npx vitest run src/lib/overlapClusters.test.ts
```

- 播放头处同锚点多条定帧 → 展开为子 lane，各自选中拖拽，预览/导出与折叠前一致
- 无重叠或播放头不在簇内 → 与折叠态相同
- Alt+滚轮平移、滚轮垂直滚动、Ctrl+滚轮缩放

定帧集合（阶段 10 后）：

- 源 5s 创建集合，默认文本段 10s → 预览停 5s 帧，首段 5–15s 成片可见
- 追加 3s 箭头段 → 子轨串行、拖边可调；JSON 存 `segments[]`，非源 `startMs` 冒充集合内步骤
- 导出 MP4 insert 时长 = 各段之和，映射规则与普通定帧一致

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

### 时间映射

1. 每条定帧批注 → 成片 insert 区间 `[outputStart, outputStart + holdDurationMs)`，其中
  `outputStart = sourceMs + cumulativeFullHoldDurationBefore(sourceMs)`（同锚点先合并取最长）
2. **导出总插入时长** = 上述各区间在成片轴上的**并集**长度（`getMergedHoldOutputDurationMs`）
3. **成片总长** = `getOutputDurationMs(sourceDuration, holdRegions)`
4. **源 ↔ 成片** seek / 预览 / 定帧轨显示均基于全长累加映射；定帧段内 `video.currentTime` 固定于 `sourceMs`

实现：`src/lib/timelineMapping.ts`（`sourceToOutputMs`、`cumulativeFullHoldDurationBefore`、`getHoldOutputSpans`、`unionMergeHoldOutputSpans`）

### 预览

- `outputDuration = sourceDuration + unionHoldDurationMs`
- 定帧段内：`video.currentTime` 固定在对应 `sourceMs`，rAF 推进成片时间
- 定帧批注 overlay 按**成片时间**显隐

定帧集合（阶段 10，拟）：多段子轨

- 可见区间 = `holdOutputStart + segmentOffsetMs` 起，时长 `segment.durationMs`
- 整个集合 insert 段内 `video.currentTime` 固定于 `collection.sourceMs`；overlay / 动画按 **段级 output 窗口** 驱动
- 单段集合行为与 today 单条定帧批注一致

### 导出

- 在并集定帧段内克隆对应锚点 `VideoFrame`
- 定帧段原声静音；定帧音频批注按成片时间混音

### 与旧「停帧轨道」方案的区别

- **旧**：Hold 轨道为一等公民，用户先加停帧再加标注
- **现（阶段 7）**：批注为一等公民；定帧轨 = **定帧批注专用轨**（可编辑、可重叠），不是与内容脱钩的抽象 hold 条

