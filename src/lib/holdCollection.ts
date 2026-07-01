import { v4 as uuidv4 } from "uuid";
import {
	type AnnotationRegion,
	type AnnotationType,
	type AudioAnnotationClip,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_AUDIO_ANNOTATION_VOLUME,
	DEFAULT_FIGURE_DATA,
	DEFAULT_HOLD_COLLECTION_APPEND_SEGMENT_MS,
	DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS,
	type HoldCollection,
	type HoldCollectionSegment,
	type HoldCollectionSegmentAudio,
	type HoldCollectionSegmentContent,
	type HoldRegion,
	MAX_HOLD_DURATION_MS,
	MIN_HOLD_DURATION_MS,
} from "@/components/video-editor/types";
import { getAnnotationTextStylePreset } from "@/lib/annotationPreferences";
import type { OutputSpan } from "@/lib/timelineMapping";
import { sourceToOutputMs } from "@/lib/timelineMapping";

export { DEFAULT_HOLD_COLLECTION_APPEND_SEGMENT_MS, DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS };

function clampSegmentDurationMs(durationMs: number): number {
	return Math.max(MIN_HOLD_DURATION_MS, Math.min(MAX_HOLD_DURATION_MS, Math.round(durationMs)));
}

function clampOffsetMs(offsetMs: number): number {
	return Math.max(0, Math.round(offsetMs));
}

export type HoldCollectionSegmentKind = AnnotationType | "audio";

export function isHoldCollectionAudioSegment(segment: HoldCollectionSegment): boolean {
	return segment.audio !== undefined;
}

export function holdCollectionSegmentAudioRefId(segmentId: string): string {
	return `hold-seg-audio-${segmentId}`;
}

const HOLD_SEGMENT_AUDIO_CLIP_PREFIX = "hold-seg-audio-";

export function parseHoldSegmentIdFromAudioClipId(clipId: string): string | null {
	if (!clipId.startsWith(HOLD_SEGMENT_AUDIO_CLIP_PREFIX)) {
		return null;
	}
	return clipId.slice(HOLD_SEGMENT_AUDIO_CLIP_PREFIX.length);
}

export function findHoldCollectionSegmentById(
	holdCollections: HoldCollection[],
	segmentId: string,
): { collection: HoldCollection; segmentIndex: number; segment: HoldCollectionSegment } | null {
	for (const collection of holdCollections) {
		const segmentIndex = collection.segments.findIndex((segment) => segment.id === segmentId);
		if (segmentIndex >= 0) {
			return { collection, segmentIndex, segment: collection.segments[segmentIndex]! };
		}
	}
	return null;
}

/** Map hold segment audio clip to playback timeline (source or preview/output axis). */
export function resolveHoldSegmentAudioClipPlayback(
	clip: AudioAnnotationClip,
	holdCollections: HoldCollection[],
	holdRegions: HoldRegion[],
	axis: "source" | "preview",
): { anchorMs: number; durationMs: number } {
	const segmentId = parseHoldSegmentIdFromAudioClipId(clip.id);
	if (!segmentId) {
		return { anchorMs: clip.anchorMs, durationMs: clip.durationMs };
	}
	const match = findHoldCollectionSegmentById(holdCollections, segmentId);
	if (!match) {
		return { anchorMs: clip.anchorMs, durationMs: clip.durationMs };
	}
	const { collection, segmentIndex } = match;
	if (axis === "preview" && holdRegions.length > 0) {
		const span = holdCollectionSegmentToOutputSpan(collection, segmentIndex, holdRegions);
		return { anchorMs: span.start, durationMs: span.end - span.start };
	}
	const segment = collection.segments[segmentIndex]!;
	return {
		anchorMs: collection.sourceMs + segment.offsetMs,
		durationMs: segment.durationMs,
	};
}

export function duplicateHoldCollectionSegment(
	collection: HoldCollection,
	segmentId: string,
): HoldCollection {
	const index = collection.segments.findIndex((segment) => segment.id === segmentId);
	if (index < 0) {
		return collection;
	}
	const source = collection.segments[index]!;
	const duplicate: HoldCollectionSegment = {
		id: uuidv4(),
		offsetMs: source.offsetMs + source.durationMs,
		durationMs: source.durationMs,
		content: {
			...source.content,
			style: { ...source.content.style },
			...(source.content.figureData ? { figureData: { ...source.content.figureData } } : {}),
		},
		...(source.audio ? { audio: { ...source.audio } } : {}),
	};
	const segments = [
		...collection.segments.slice(0, index + 1),
		duplicate,
		...collection.segments.slice(index + 1),
	];
	return syncShellDurationFromSegments({ ...collection, segments });
}

/** Virtual audio clips for preview/export from hold collection segment audio payloads. */
export function collectHoldCollectionSegmentAudioClips(
	holdCollections: HoldCollection[],
): AudioAnnotationClip[] {
	const clips: AudioAnnotationClip[] = [];
	for (const collection of holdCollections) {
		for (const segment of collection.segments) {
			const audioUrl = segment.audio?.audioUrl?.trim();
			if (!audioUrl) {
				continue;
			}
			clips.push({
				id: holdCollectionSegmentAudioRefId(segment.id),
				anchorMs: collection.sourceMs + segment.offsetMs,
				durationMs: segment.durationMs,
				source: "import",
				audioUrl,
				sourceFilePath: segment.audio?.sourceFilePath,
				fileName: segment.audio?.fileName,
				sourceDurationMs: segment.audio?.sourceDurationMs,
				volume: segment.audio?.volume ?? DEFAULT_AUDIO_ANNOTATION_VOLUME,
			});
		}
	}
	return clips;
}

export function segmentSpanEndMs(segment: HoldCollectionSegment): number {
	return segment.offsetMs + segment.durationMs;
}

export function maxSegmentSpanMs(collection: HoldCollection): number {
	return collection.segments.reduce((max, segment) => Math.max(max, segmentSpanEndMs(segment)), 0);
}

/** Effective insert length = max(shell, furthest segment end). */
export function effectiveDurationMs(collection: HoldCollection): number {
	return Math.max(collection.shellDurationMs, maxSegmentSpanMs(collection));
}

/** @deprecated alias */
export function collectionHoldDurationMs(collection: HoldCollection): number {
	return effectiveDurationMs(collection);
}

export function syncShellDurationFromSegments(collection: HoldCollection): HoldCollection {
	const effective = effectiveDurationMs(collection);
	if (effective <= collection.shellDurationMs) {
		return collection;
	}
	return { ...collection, shellDurationMs: effective };
}

export function setHoldCollectionShellDuration(
	collection: HoldCollection,
	shellDurationMs: number,
): HoldCollection {
	return {
		...collection,
		shellDurationMs: clampSegmentDurationMs(shellDurationMs),
	};
}

/** @deprecated use setHoldCollectionShellDuration — only changes shell, not segments */
export function setHoldCollectionTotalDuration(
	collection: HoldCollection,
	totalDurationMs: number,
): HoldCollection {
	return setHoldCollectionShellDuration(collection, totalDurationMs);
}

/** Canonical shell annotation / timeline item id for a hold collection. */
export function resolveHoldCollectionShellId(collection: HoldCollection): string {
	return collection.shellAnnotationId ?? `shell-${collection.id}`;
}

export function findHoldCollectionByShellId(
	collections: HoldCollection[] | undefined,
	shellAnnotationId: string,
): HoldCollection | undefined {
	return (collections ?? []).find(
		(collection) => resolveHoldCollectionShellId(collection) === shellAnnotationId,
	);
}

export function findHoldCollectionById(
	collections: HoldCollection[] | undefined,
	collectionId: string,
): HoldCollection | undefined {
	return (collections ?? []).find((collection) => collection.id === collectionId);
}

export function removeHoldCollectionsByShellId(
	collections: HoldCollection[],
	shellAnnotationId: string,
): HoldCollection[] {
	return collections.filter(
		(collection) => resolveHoldCollectionShellId(collection) !== shellAnnotationId,
	);
}

export function shellContentFromAnnotationRegion(
	region: AnnotationRegion,
): HoldCollectionSegmentContent {
	const {
		startMs: _startMs,
		endMs: _endMs,
		freezeDuringAnnotation: _freeze,
		holdDurationMs: _hold,
		id: _id,
		annotationSource: _source,
		...content
	} = region;
	return { ...content, type: region.type } as HoldCollectionSegmentContent;
}

export function applyShellAnnotationEditsToCollection(
	collection: HoldCollection,
	region: AnnotationRegion,
): HoldCollection {
	if (!collection.segments.length) {
		return collection;
	}
	return {
		...collection,
		segments: [
			{ ...collection.segments[0], content: shellContentFromAnnotationRegion(region) },
			...collection.segments.slice(1),
		],
	};
}

export function setHoldCollectionFirstSegmentDuration(
	collection: HoldCollection,
	durationMs: number,
): HoldCollection {
	if (!collection.segments.length) {
		return collection;
	}
	return syncShellDurationFromSegments({
		...collection,
		segments: [
			{ ...collection.segments[0], durationMs: clampSegmentDurationMs(durationMs) },
			...collection.segments.slice(1),
		],
	});
}

/** Read segment offset (persisted field; legacy collections migrated in normalize). */
export function segmentOffsetMs(collection: HoldCollection, segmentIndex: number): number {
	return collection.segments[segmentIndex]?.offsetMs ?? 0;
}

export function holdRegionFromCollection(collection: HoldCollection): HoldRegion {
	return {
		id: collection.id.startsWith("hold-") ? collection.id : `hold-${collection.id}`,
		sourceMs: collection.sourceMs,
		holdDurationMs: effectiveDurationMs(collection),
		linkedAnnotationId: collection.shellAnnotationId,
		linkedCollectionId: collection.id,
	};
}

export function holdCollectionShellOutputSpan(
	collection: HoldCollection,
	holdRegions: HoldRegion[],
): OutputSpan {
	const start = sourceToOutputMs(collection.sourceMs, holdRegions);
	return { start, end: start + effectiveDurationMs(collection) };
}

export function holdCollectionSegmentToOutputSpan(
	collection: HoldCollection,
	segmentIndex: number,
	holdRegions: HoldRegion[],
): OutputSpan {
	const segment = collection.segments[segmentIndex];
	if (!segment) {
		const start = sourceToOutputMs(collection.sourceMs, holdRegions);
		return { start, end: start };
	}
	const holdOutputStart = sourceToOutputMs(collection.sourceMs, holdRegions);
	return {
		start: holdOutputStart + segment.offsetMs,
		end: holdOutputStart + segment.offsetMs + segment.durationMs,
	};
}

export function createDefaultSegmentContent(
	type: AnnotationType = "text",
): HoldCollectionSegmentContent {
	if (type === "figure") {
		return {
			type: "figure",
			content: "",
			position: { ...DEFAULT_ANNOTATION_POSITION },
			size: { ...DEFAULT_ANNOTATION_SIZE },
			style: getAnnotationTextStylePreset(),
			zIndex: 0,
			figureData: { ...DEFAULT_FIGURE_DATA },
		};
	}
	return {
		type: "text",
		content: "Enter text...",
		textContent: "Enter text...",
		position: { ...DEFAULT_ANNOTATION_POSITION },
		size: { ...DEFAULT_ANNOTATION_SIZE },
		style: getAnnotationTextStylePreset(),
		zIndex: 0,
	};
}

export function createHoldCollectionSegment(
	type: AnnotationType = "text",
	durationMs = DEFAULT_HOLD_COLLECTION_APPEND_SEGMENT_MS,
	offsetMs = 0,
): HoldCollectionSegment {
	return {
		id: uuidv4(),
		offsetMs: clampOffsetMs(offsetMs),
		durationMs: clampSegmentDurationMs(durationMs),
		content: createDefaultSegmentContent(type),
	};
}

export function createHoldCollection(
	sourceMs: number,
	options?: {
		type?: AnnotationType;
		firstSegmentDurationMs?: number;
		shellDurationMs?: number;
		id?: string;
	},
): HoldCollection {
	const shellDurationMs = clampSegmentDurationMs(
		options?.shellDurationMs ??
			options?.firstSegmentDurationMs ??
			DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS,
	);
	const segment = createHoldCollectionSegment(options?.type ?? "text", shellDurationMs, 0);
	const id = options?.id ?? uuidv4();
	const shellAnnotationId = uuidv4();
	return {
		id,
		sourceMs: Math.max(0, Math.round(sourceMs)),
		shellDurationMs,
		segments: [segment],
		shellAnnotationId,
	};
}

export function appendHoldCollectionSegment(
	collection: HoldCollection,
	type: AnnotationType = "text",
	durationMs = DEFAULT_HOLD_COLLECTION_APPEND_SEGMENT_MS,
	alignOffsetMs?: number,
): HoldCollection {
	const offsetMs =
		alignOffsetMs ?? collection.segments[collection.segments.length - 1]?.offsetMs ?? 0;
	return syncShellDurationFromSegments({
		...collection,
		segments: [...collection.segments, createHoldCollectionSegment(type, durationMs, offsetMs)],
	});
}

export function updateHoldCollectionSegmentAudio(
	collection: HoldCollection,
	segmentId: string,
	patch: Partial<HoldCollectionSegmentAudio>,
): HoldCollection {
	return {
		...collection,
		segments: collection.segments.map((segment) => {
			if (segment.id !== segmentId) {
				return segment;
			}
			const base = segment.audio ?? {
				audioUrl: "",
				volume: DEFAULT_AUDIO_ANNOTATION_VOLUME,
			};
			return {
				...segment,
				audio: { ...base, ...patch },
			};
		}),
	};
}

export function setHoldCollectionSegmentKind(
	collection: HoldCollection,
	segmentId: string,
	kind: HoldCollectionSegmentKind,
): HoldCollection {
	return {
		...collection,
		segments: collection.segments.map((segment) => {
			if (segment.id !== segmentId) {
				return segment;
			}
			if (kind === "audio") {
				return {
					...segment,
					audio: segment.audio ?? {
						audioUrl: "",
						volume: DEFAULT_AUDIO_ANNOTATION_VOLUME,
					},
				};
			}
			const { audio: _audio, ...withoutAudio } = segment;
			const content = withoutAudio.content;
			if (kind === "text") {
				return {
					...withoutAudio,
					content: {
						...content,
						type: "text",
						content: content.textContent || "Enter text...",
					},
				};
			}
			if (kind === "image") {
				return {
					...withoutAudio,
					content: {
						...content,
						type: "image",
						content: content.imageContent || "",
					},
				};
			}
			if (kind === "figure") {
				return {
					...withoutAudio,
					content: {
						...content,
						type: "figure",
						content: "",
						figureData: content.figureData ?? { ...DEFAULT_FIGURE_DATA },
					},
				};
			}
			return { ...withoutAudio, content: { ...content, type: kind } };
		}),
	};
}

export function reorderHoldCollectionSegments(
	collection: HoldCollection,
	segmentIds: string[],
): HoldCollection {
	const byId = new Map(collection.segments.map((segment) => [segment.id, segment]));
	const reordered = segmentIds
		.map((id) => byId.get(id))
		.filter((segment): segment is HoldCollectionSegment => Boolean(segment));
	if (reordered.length !== collection.segments.length) {
		return collection;
	}
	return { ...collection, segments: reordered };
}

/** Build shell annotation shown on the hold track (span = effective insert). */
export function shellAnnotationFromCollection(collection: HoldCollection): AnnotationRegion {
	const first = collection.segments[0];
	const durationMs = effectiveDurationMs(collection);
	const shellId = resolveHoldCollectionShellId(collection);
	return {
		id: shellId,
		startMs: collection.sourceMs,
		endMs: collection.sourceMs + durationMs,
		freezeDuringAnnotation: true,
		...(first?.content ?? createDefaultSegmentContent("text")),
	};
}

export function annotationRegionToHoldCollection(region: AnnotationRegion): HoldCollection | null {
	if (!region.freezeDuringAnnotation) {
		return null;
	}
	const durationMs = clampSegmentDurationMs(region.endMs - region.startMs);
	const {
		startMs,
		endMs: _end,
		freezeDuringAnnotation: _freeze,
		holdDurationMs: _hold,
		id,
		...content
	} = region;
	return {
		id: uuidv4(),
		sourceMs: startMs,
		shellDurationMs: durationMs,
		shellAnnotationId: id,
		segments: [
			{
				id: uuidv4(),
				offsetMs: 0,
				durationMs,
				content: { ...content, type: region.type } as HoldCollectionSegmentContent,
			},
		],
	};
}

function migrateLegacyHoldCollection(collection: HoldCollection): HoldCollection {
	let segments = collection.segments;
	const hasExplicitOffsets = segments.every(
		(segment) => typeof segment.offsetMs === "number" && Number.isFinite(segment.offsetMs),
	);

	if (!hasExplicitOffsets) {
		let runningOffset = 0;
		segments = segments.map((segment) => {
			const offsetMs = runningOffset;
			runningOffset += segment.durationMs;
			return { ...segment, offsetMs };
		});
	}

	let shellDurationMs = collection.shellDurationMs;
	if (typeof shellDurationMs !== "number" || !Number.isFinite(shellDurationMs)) {
		const serialSum = segments.reduce((sum, segment) => sum + segment.durationMs, 0);
		shellDurationMs = Math.max(serialSum, maxSegmentSpanMs({ ...collection, segments }));
	}

	return syncShellDurationFromSegments({
		...collection,
		shellDurationMs: clampSegmentDurationMs(shellDurationMs),
		segments,
	});
}

export function migrateFreezeAnnotationsToHoldCollections(
	annotations: AnnotationRegion[],
	audioClips: AudioAnnotationClip[],
	existingCollections: HoldCollection[] = [],
): { holdCollections: HoldCollection[]; annotationRegions: AnnotationRegion[] } {
	const collectionsByShellId = new Map(
		existingCollections
			.filter((collection) => collection.shellAnnotationId)
			.map((collection) => [collection.shellAnnotationId!, collection]),
	);
	const migratedIds = new Set<string>();
	const holdCollections: HoldCollection[] = existingCollections.map(migrateLegacyHoldCollection);

	for (const region of annotations) {
		if (!region.freezeDuringAnnotation) {
			continue;
		}
		if (collectionsByShellId.has(region.id)) {
			migratedIds.add(region.id);
			continue;
		}
		const collection = annotationRegionToHoldCollection(region);
		if (!collection) {
			continue;
		}
		holdCollections.push(collection);
		collectionsByShellId.set(region.id, collection);
		migratedIds.add(region.id);
	}

	for (const clip of audioClips) {
		if (!clip.freezeDuringAnnotation || collectionsByShellId.has(clip.id)) {
			continue;
		}
		const durationMs = clampSegmentDurationMs(clip.durationMs);
		holdCollections.push({
			id: uuidv4(),
			sourceMs: clip.anchorMs,
			shellDurationMs: durationMs,
			shellAnnotationId: clip.id,
			segments: [
				{
					id: uuidv4(),
					offsetMs: 0,
					durationMs,
					content: {
						type: "text",
						content: "",
						position: { ...DEFAULT_ANNOTATION_POSITION },
						size: { ...DEFAULT_ANNOTATION_SIZE },
						style: { ...DEFAULT_ANNOTATION_STYLE },
						zIndex: 0,
					},
				},
			],
		});
		migratedIds.add(clip.id);
	}

	const shellAnnotations = collectionsNeedingAnnotationShell(
		holdCollections,
		new Set(audioClips.map((clip) => clip.id)),
	).map(shellAnnotationFromCollection);
	const nonFreezeAnnotations = annotations.filter(
		(region) => !region.freezeDuringAnnotation || !migratedIds.has(region.id),
	);

	return {
		holdCollections,
		annotationRegions: [...nonFreezeAnnotations, ...shellAnnotations],
	};
}

export function normalizeHoldCollectionSegment(
	segment: HoldCollectionSegment,
): HoldCollectionSegment {
	const normalized: HoldCollectionSegment = {
		id: segment.id,
		offsetMs: clampOffsetMs(segment.offsetMs ?? 0),
		durationMs: clampSegmentDurationMs(segment.durationMs),
		content: segment.content,
	};
	if (segment.audio) {
		normalized.audio = {
			audioUrl: segment.audio.audioUrl ?? "",
			sourceFilePath: segment.audio.sourceFilePath,
			fileName: segment.audio.fileName,
			sourceDurationMs: segment.audio.sourceDurationMs,
			volume: segment.audio.volume ?? DEFAULT_AUDIO_ANNOTATION_VOLUME,
		};
	}
	return normalized;
}

export function normalizeHoldCollection(collection: HoldCollection): HoldCollection | null {
	if (!collection.segments.length) {
		return null;
	}
	const normalized = migrateLegacyHoldCollection({
		id: collection.id,
		sourceMs: Math.max(0, Math.round(collection.sourceMs)),
		shellDurationMs: collection.shellDurationMs,
		segments: collection.segments.map(normalizeHoldCollectionSegment),
		shellAnnotationId: collection.shellAnnotationId,
	});
	return normalized;
}

export function syncHoldRegionsFromHoldCollections(
	collections: HoldCollection[],
	existingHoldRegions: HoldRegion[],
): HoldRegion[] {
	const collectionIds = new Set(collections.map((collection) => collection.id));
	let holds = existingHoldRegions.filter(
		(hold) => !hold.linkedCollectionId || collectionIds.has(hold.linkedCollectionId),
	);

	for (const collection of collections) {
		const next = holdRegionFromCollection(collection);
		holds = [
			...holds.filter(
				(hold) =>
					hold.linkedCollectionId !== collection.id &&
					hold.linkedAnnotationId !== collection.shellAnnotationId,
			),
			next,
		];
	}

	return holds;
}

export function collectionsNeedingAnnotationShell(
	collections: HoldCollection[],
	audioClipIds: ReadonlySet<string>,
): HoldCollection[] {
	return collections.filter(
		(collection) =>
			!collection.shellAnnotationId || !audioClipIds.has(collection.shellAnnotationId),
	);
}

export function syncShellAnnotationsFromHoldCollections(
	annotations: AnnotationRegion[],
	collections: HoldCollection[],
	audioClipIds: ReadonlySet<string> = new Set(),
): AnnotationRegion[] {
	const shellIds = new Set(
		collectionsNeedingAnnotationShell(collections, audioClipIds)
			.map((collection) => collection.shellAnnotationId)
			.filter(Boolean) as string[],
	);
	const withoutShells = annotations.filter((region) => !shellIds.has(region.id));
	const shells = collectionsNeedingAnnotationShell(collections, audioClipIds).map(
		shellAnnotationFromCollection,
	);
	return [...withoutShells, ...shells];
}
