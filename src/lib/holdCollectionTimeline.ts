import { formatAnnotationClockMs } from "@/components/video-editor/positionAnnotation";
import {
	type AnnotationRegion,
	type AnnotationType,
	type HoldCollection,
	type HoldCollectionSegment,
	type HoldCollectionSegmentContent,
	type HoldRegion,
	MAX_HOLD_DURATION_MS,
	MIN_HOLD_DURATION_MS,
} from "@/components/video-editor/types";
import {
	appendHoldCollectionSegment,
	effectiveDurationMs,
	holdCollectionSegmentToOutputSpan,
	isHoldCollectionAudioSegment,
	segmentOffsetMs,
	setHoldCollectionShellDuration,
	syncShellDurationFromSegments,
} from "@/lib/holdCollection";

export const HOLD_SEGMENT_TIMELINE_PREFIX = "hold-seg:";
export const EXPANDED_HOLD_COLLECTIONS_STORAGE_KEY = "openscreen-expanded-hold-collections";

export function holdSegmentTimelineId(collectionId: string, segmentId: string): string {
	return `${HOLD_SEGMENT_TIMELINE_PREFIX}${collectionId}:${segmentId}`;
}

export function parseHoldSegmentTimelineId(
	id: string,
): { collectionId: string; segmentId: string } | null {
	if (!id.startsWith(HOLD_SEGMENT_TIMELINE_PREFIX)) {
		return null;
	}
	const rest = id.slice(HOLD_SEGMENT_TIMELINE_PREFIX.length);
	const splitAt = rest.indexOf(":");
	if (splitAt <= 0) {
		return null;
	}
	return {
		collectionId: rest.slice(0, splitAt),
		segmentId: rest.slice(splitAt + 1),
	};
}

export function holdCollectionShellRowId(collectionId: string): string {
	return `row-hold-col-${collectionId}-shell`;
}

export function holdCollectionSubLaneRowId(collectionId: string, segmentIndex: number): string {
	return `row-hold-col-${collectionId}-lane-${segmentIndex}`;
}

export function readExpandedHoldCollectionIds(): Set<string> {
	try {
		const raw = localStorage.getItem(EXPANDED_HOLD_COLLECTIONS_STORAGE_KEY);
		if (!raw) {
			return new Set();
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return new Set();
		}
		return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
	} catch {
		return new Set();
	}
}

export function writeExpandedHoldCollectionIds(ids: Iterable<string>): void {
	localStorage.setItem(EXPANDED_HOLD_COLLECTIONS_STORAGE_KEY, JSON.stringify([...ids]));
}

function clampSegmentDurationMs(durationMs: number): number {
	return Math.max(MIN_HOLD_DURATION_MS, Math.min(MAX_HOLD_DURATION_MS, Math.round(durationMs)));
}

function clampOffsetMs(offsetMs: number): number {
	return Math.max(0, Math.round(offsetMs));
}

export function setHoldCollectionSegmentDuration(
	collection: HoldCollection,
	segmentId: string,
	durationMs: number,
): HoldCollection {
	return syncShellDurationFromSegments({
		...collection,
		segments: collection.segments.map((segment) =>
			segment.id === segmentId
				? { ...segment, durationMs: clampSegmentDurationMs(durationMs) }
				: segment,
		),
	});
}

export function setHoldCollectionSegmentOffset(
	collection: HoldCollection,
	segmentId: string,
	offsetMs: number,
): HoldCollection {
	return syncShellDurationFromSegments({
		...collection,
		segments: collection.segments.map((segment) =>
			segment.id === segmentId ? { ...segment, offsetMs: clampOffsetMs(offsetMs) } : segment,
		),
	});
}

export function setHoldCollectionSegmentTiming(
	collection: HoldCollection,
	segmentId: string,
	patch: { offsetMs?: number; durationMs?: number },
): HoldCollection {
	return syncShellDurationFromSegments({
		...collection,
		segments: collection.segments.map((segment) => {
			if (segment.id !== segmentId) {
				return segment;
			}
			return {
				...segment,
				...(patch.offsetMs !== undefined ? { offsetMs: clampOffsetMs(patch.offsetMs) } : {}),
				...(patch.durationMs !== undefined
					? { durationMs: clampSegmentDurationMs(patch.durationMs) }
					: {}),
			};
		}),
	});
}

/** @deprecated serial pair resize — no longer used for overlapping segments */
export function setHoldCollectionSegmentPairDurations(
	collection: HoldCollection,
	leftSegmentId: string,
	leftDurationMs: number,
	rightSegmentId: string,
	rightDurationMs: number,
): HoldCollection {
	return syncShellDurationFromSegments({
		...collection,
		segments: collection.segments.map((segment) => {
			if (segment.id === leftSegmentId) {
				return { ...segment, durationMs: clampSegmentDurationMs(leftDurationMs) };
			}
			if (segment.id === rightSegmentId) {
				return { ...segment, durationMs: clampSegmentDurationMs(rightDurationMs) };
			}
			return segment;
		}),
	});
}

export function setHoldCollectionTotalDuration(
	collection: HoldCollection,
	totalDurationMs: number,
): HoldCollection {
	return setHoldCollectionShellDuration(collection, totalDurationMs);
}

export function findActiveHoldCollectionSegmentIndex(
	collection: HoldCollection,
	timelineMs: number,
	axis: "source" | "preview",
	holdRegions: HoldRegion[] = [],
): number | null {
	for (let segmentIndex = 0; segmentIndex < collection.segments.length; segmentIndex++) {
		const segment = collection.segments[segmentIndex]!;
		let start: number;
		let end: number;
		if (axis === "source") {
			start = collection.sourceMs + segment.offsetMs;
			end = start + segment.durationMs;
		} else {
			const span = holdCollectionSegmentToOutputSpan(collection, segmentIndex, holdRegions);
			start = span.start;
			end = span.end;
		}
		if (timelineMs >= start && timelineMs < end) {
			return segmentIndex;
		}
	}
	return null;
}

/** Remove a segment; deleting the last segment removes the whole collection. */
export function removeHoldCollectionSegment(
	collection: HoldCollection,
	segmentId: string,
): HoldCollection | null {
	if (collection.segments.length <= 1) {
		return null;
	}
	return {
		...collection,
		segments: collection.segments.filter((segment) => segment.id !== segmentId),
	};
}

export function segmentContentToAnnotationRegion(
	content: HoldCollectionSegmentContent,
	segmentId: string,
	outputStartMs: number,
	outputEndMs: number,
): AnnotationRegion {
	return {
		id: segmentId,
		startMs: outputStartMs,
		endMs: outputEndMs,
		...content,
		freezeDuringAnnotation: true,
	} as AnnotationRegion;
}

export interface HoldCollectionSegmentTimelineItem {
	id: string;
	collectionId: string;
	segmentId: string;
	segmentIndex: number;
	rowId: string;
	timelineStartMs: number;
	timelineEndMs: number;
	collectionOffsetStartMs: number;
	collectionOffsetEndMs: number;
	label: string;
	subLabel: string;
}

export function holdCollectionSegmentSubLabel(
	offsetStartMs: number,
	offsetEndMs: number,
	axis: "source" | "preview",
	timelineStartMs: number,
	timelineEndMs: number,
): string {
	if (axis === "source") {
		return `+${(offsetStartMs / 1000).toFixed(2)}s – +${(offsetEndMs / 1000).toFixed(2)}s`;
	}
	return `${formatAnnotationClockMs(timelineStartMs)} – ${formatAnnotationClockMs(timelineEndMs)}`;
}

export function buildHoldCollectionSegmentTimelineItems(
	collection: HoldCollection,
	holdRegions: HoldRegion[],
	labelForSegment: (segment: HoldCollectionSegment, index: number) => string,
	axis: "source" | "preview" = "preview",
): HoldCollectionSegmentTimelineItem[] {
	return collection.segments.map((segment, segmentIndex) => {
		const offsetStart = segmentOffsetMs(collection, segmentIndex);
		const offsetEnd = offsetStart + segment.durationMs;
		let timelineStartMs: number;
		let timelineEndMs: number;
		if (axis === "source") {
			timelineStartMs = collection.sourceMs + offsetStart;
			timelineEndMs = collection.sourceMs + offsetEnd;
		} else {
			const outputSpan = holdCollectionSegmentToOutputSpan(collection, segmentIndex, holdRegions);
			timelineStartMs = outputSpan.start;
			timelineEndMs = outputSpan.end;
		}
		const subLabel = holdCollectionSegmentSubLabel(
			offsetStart,
			offsetEnd,
			axis,
			timelineStartMs,
			timelineEndMs,
		);
		return {
			id: holdSegmentTimelineId(collection.id, segment.id),
			collectionId: collection.id,
			segmentId: segment.id,
			segmentIndex,
			rowId: holdCollectionSubLaneRowId(collection.id, segmentIndex),
			timelineStartMs,
			timelineEndMs,
			collectionOffsetStartMs: offsetStart,
			collectionOffsetEndMs: offsetEnd,
			label: labelForSegment(segment, segmentIndex),
			subLabel,
		};
	});
}

export function isOutputMsInHoldCollectionSegment(
	outputMs: number,
	collection: HoldCollection,
	segmentIndex: number,
	holdRegions: HoldRegion[],
): boolean {
	const span = holdCollectionSegmentToOutputSpan(collection, segmentIndex, holdRegions);
	return outputMs >= span.start && outputMs < span.end;
}

export function findHoldCollectionSegmentAtOutputMs(
	collections: HoldCollection[],
	outputMs: number,
	holdRegions: HoldRegion[],
): { collection: HoldCollection; segmentIndex: number } | null {
	for (const collection of collections) {
		for (let segmentIndex = 0; segmentIndex < collection.segments.length; segmentIndex++) {
			if (isOutputMsInHoldCollectionSegment(outputMs, collection, segmentIndex, holdRegions)) {
				return { collection, segmentIndex };
			}
		}
	}
	return null;
}

export function updateHoldCollectionSegmentContent(
	collection: HoldCollection,
	segmentId: string,
	patch: (content: HoldCollectionSegmentContent) => HoldCollectionSegmentContent,
): HoldCollection {
	return {
		...collection,
		segments: collection.segments.map((segment) =>
			segment.id === segmentId ? { ...segment, content: patch(segment.content) } : segment,
		),
	};
}

export function appendHoldCollectionSegmentWithType(
	collection: HoldCollection,
	type: AnnotationType = "text",
	alignOffsetMs?: number,
): HoldCollection {
	return appendHoldCollectionSegment(collection, type, undefined, alignOffsetMs);
}

export function buildHoldCollectionOverlayAnnotations(
	holdCollections: HoldCollection[],
	holdRegions: HoldRegion[],
	outputMs: number,
	alwaysVisibleSegmentIds: ReadonlySet<string> = new Set(),
): AnnotationRegion[] {
	const overlays: AnnotationRegion[] = [];
	for (const collection of holdCollections) {
		for (let segmentIndex = 0; segmentIndex < collection.segments.length; segmentIndex++) {
			const segment = collection.segments[segmentIndex]!;
			if (isHoldCollectionAudioSegment(segment)) {
				continue;
			}
			const span = holdCollectionSegmentToOutputSpan(collection, segmentIndex, holdRegions);
			const forceVisible = alwaysVisibleSegmentIds.has(segment.id);
			if (!forceVisible && (outputMs < span.start || outputMs >= span.end)) {
				continue;
			}
			overlays.push(
				segmentContentToAnnotationRegion(segment.content, segment.id, span.start, span.end),
			);
		}
	}
	return overlays;
}

/** Source-axis overlays: visible while playhead is inside each segment span. */
export function buildHoldCollectionSourceOverlayAnnotations(
	holdCollections: HoldCollection[],
	sourceMs: number,
	alwaysVisibleSegmentIds: ReadonlySet<string> = new Set(),
): AnnotationRegion[] {
	const overlays: AnnotationRegion[] = [];
	for (const collection of holdCollections) {
		for (const segment of collection.segments) {
			if (isHoldCollectionAudioSegment(segment)) {
				continue;
			}
			const start = collection.sourceMs + segment.offsetMs;
			const end = start + segment.durationMs;
			const forceVisible = alwaysVisibleSegmentIds.has(segment.id);
			if (!forceVisible && (sourceMs < start || sourceMs >= end)) {
				continue;
			}
			overlays.push(segmentContentToAnnotationRegion(segment.content, segment.id, start, end));
		}
	}
	return overlays;
}

export function holdCollectionShellLabel(
	collection: HoldCollection,
	_holdRegions: HoldRegion[],
	sourceLabel: string,
): string {
	const totalMs = effectiveDurationMs(collection);
	return `${sourceLabel} · ${collection.segments.length} 步 · ${(totalMs / 1000).toFixed(2)}s`;
}

export function holdCollectionMergedShellLabel(
	collection: HoldCollection,
	t: (key: string, params?: Record<string, string>) => string,
): string {
	const totalMs = effectiveDurationMs(collection);
	return t("labels.holdCollectionMerged", {
		count: String(collection.segments.length),
		duration: (totalMs / 1000).toFixed(2),
	});
}
