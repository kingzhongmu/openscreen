import { v4 as uuidv4 } from "uuid";
import {
	type AnnotationRegion,
	type AnnotationType,
	type AudioAnnotationClip,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	DEFAULT_HOLD_COLLECTION_APPEND_SEGMENT_MS,
	DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS,
	type HoldCollection,
	type HoldCollectionSegment,
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

export function collectionHoldDurationMs(collection: HoldCollection): number {
	return collection.segments.reduce((sum, segment) => sum + segment.durationMs, 0);
}

export function findHoldCollectionByShellId(
	collections: HoldCollection[] | undefined,
	shellAnnotationId: string,
): HoldCollection | undefined {
	return (collections ?? []).find(
		(collection) => collection.shellAnnotationId === shellAnnotationId,
	);
}

export function removeHoldCollectionsByShellId(
	collections: HoldCollection[],
	shellAnnotationId: string,
): HoldCollection[] {
	return collections.filter((collection) => collection.shellAnnotationId !== shellAnnotationId);
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
	return {
		...collection,
		segments: [
			{ ...collection.segments[0], durationMs: clampSegmentDurationMs(durationMs) },
			...collection.segments.slice(1),
		],
	};
}

export function segmentOffsetMs(collection: HoldCollection, segmentIndex: number): number {
	return collection.segments
		.slice(0, segmentIndex)
		.reduce((sum, segment) => sum + segment.durationMs, 0);
}

export function holdRegionFromCollection(collection: HoldCollection): HoldRegion {
	return {
		id: collection.id.startsWith("hold-") ? collection.id : `hold-${collection.id}`,
		sourceMs: collection.sourceMs,
		holdDurationMs: collectionHoldDurationMs(collection),
		linkedAnnotationId: collection.shellAnnotationId,
		linkedCollectionId: collection.id,
	};
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
	const offset = segmentOffsetMs(collection, segmentIndex);
	return {
		start: holdOutputStart + offset,
		end: holdOutputStart + offset + segment.durationMs,
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
	durationMs = DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS,
): HoldCollectionSegment {
	return {
		id: uuidv4(),
		durationMs: clampSegmentDurationMs(durationMs),
		content: createDefaultSegmentContent(type),
	};
}

export function createHoldCollection(
	sourceMs: number,
	options?: { type?: AnnotationType; firstSegmentDurationMs?: number; id?: string },
): HoldCollection {
	const segment = createHoldCollectionSegment(
		options?.type ?? "text",
		options?.firstSegmentDurationMs ?? DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS,
	);
	const id = options?.id ?? uuidv4();
	const shellAnnotationId = uuidv4();
	return {
		id,
		sourceMs: Math.max(0, Math.round(sourceMs)),
		segments: [segment],
		shellAnnotationId,
	};
}

export function appendHoldCollectionSegment(
	collection: HoldCollection,
	type: AnnotationType = "text",
	durationMs = DEFAULT_HOLD_COLLECTION_APPEND_SEGMENT_MS,
): HoldCollection {
	return {
		...collection,
		segments: [...collection.segments, createHoldCollectionSegment(type, durationMs)],
	};
}

/** Build shell annotation shown on the hold track (span = full collection insert). */
export function shellAnnotationFromCollection(collection: HoldCollection): AnnotationRegion {
	const first = collection.segments[0];
	const durationMs = collectionHoldDurationMs(collection);
	const shellId = collection.shellAnnotationId ?? `shell-${collection.id}`;
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
		shellAnnotationId: id,
		segments: [
			{
				id: uuidv4(),
				durationMs,
				content: { ...content, type: region.type } as HoldCollectionSegmentContent,
			},
		],
	};
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
	const holdCollections: HoldCollection[] = [...existingCollections];

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
			shellAnnotationId: clip.id,
			segments: [
				{
					id: uuidv4(),
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
	return {
		id: segment.id,
		durationMs: clampSegmentDurationMs(segment.durationMs),
		content: segment.content,
	};
}

export function normalizeHoldCollection(collection: HoldCollection): HoldCollection | null {
	if (!collection.segments.length) {
		return null;
	}
	return {
		id: collection.id,
		sourceMs: Math.max(0, Math.round(collection.sourceMs)),
		segments: collection.segments.map(normalizeHoldCollectionSegment),
		shellAnnotationId: collection.shellAnnotationId,
	};
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
