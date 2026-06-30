import { formatAnnotationClockMs } from "@/components/video-editor/positionAnnotation";
import type { HoldRegion } from "@/components/video-editor/types";
import {
	type AnnotationRegion,
	type AnnotationType,
	type HoldCollection,
	type HoldCollectionSegmentContent,
	MAX_HOLD_DURATION_MS,
	MIN_HOLD_DURATION_MS,
} from "@/components/video-editor/types";
import {
	appendHoldCollectionSegment,
	collectionHoldDurationMs,
	holdCollectionSegmentToOutputSpan,
	segmentOffsetMs,
} from "@/lib/holdCollection";

export const HOLD_SEGMENT_TIMELINE_PREFIX = "hold-seg:";

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

export function holdCollectionSubLaneRowId(collectionId: string, segmentIndex: number): string {
	return `row-hold-col-${collectionId}-lane-${segmentIndex}`;
}

function clampSegmentDurationMs(durationMs: number): number {
	return Math.max(MIN_HOLD_DURATION_MS, Math.min(MAX_HOLD_DURATION_MS, Math.round(durationMs)));
}

export function setHoldCollectionSegmentDuration(
	collection: HoldCollection,
	segmentId: string,
	durationMs: number,
): HoldCollection {
	return {
		...collection,
		segments: collection.segments.map((segment) =>
			segment.id === segmentId
				? { ...segment, durationMs: clampSegmentDurationMs(durationMs) }
				: segment,
		),
	};
}

/** Adjust durations on both sides of an internal segment boundary (total unchanged). */
export function setHoldCollectionSegmentPairDurations(
	collection: HoldCollection,
	leftSegmentId: string,
	leftDurationMs: number,
	rightSegmentId: string,
	rightDurationMs: number,
): HoldCollection {
	return {
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
	};
}

export function setHoldCollectionTotalDuration(
	collection: HoldCollection,
	totalDurationMs: number,
): HoldCollection {
	if (collection.segments.length === 0) {
		return collection;
	}
	if (collection.segments.length === 1) {
		return setHoldCollectionSegmentDuration(
			collection,
			collection.segments[0]!.id,
			totalDurationMs,
		);
	}
	const otherDurationMs = collection.segments
		.slice(0, -1)
		.reduce((sum, segment) => sum + segment.durationMs, 0);
	const lastSegment = collection.segments[collection.segments.length - 1]!;
	return setHoldCollectionSegmentDuration(
		collection,
		lastSegment.id,
		totalDurationMs - otherDurationMs,
	);
}

export function findActiveHoldCollectionSegmentIndex(
	collection: HoldCollection,
	timelineMs: number,
): number | null {
	for (let segmentIndex = 0; segmentIndex < collection.segments.length; segmentIndex++) {
		const offset = segmentOffsetMs(collection, segmentIndex);
		const segment = collection.segments[segmentIndex]!;
		const start = collection.sourceMs + offset;
		const end = start + segment.durationMs;
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
	outputStartMs: number;
	outputEndMs: number;
	collectionOffsetStartMs: number;
	collectionOffsetEndMs: number;
	label: string;
	subLabel: string;
}

export function buildHoldCollectionSegmentTimelineItems(
	collection: HoldCollection,
	holdRegions: HoldRegion[],
	labelForContent: (content: HoldCollectionSegmentContent, index: number) => string,
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
		const subLabel =
			axis === "source"
				? `+${(offsetStart / 1000).toFixed(2)}s – +${(offsetEnd / 1000).toFixed(2)}s · 源 ${(timelineStartMs / 1000).toFixed(2)}s – ${(timelineEndMs / 1000).toFixed(2)}s`
				: `+${(offsetStart / 1000).toFixed(2)}s – +${(offsetEnd / 1000).toFixed(2)}s · ${formatAnnotationClockMs(timelineStartMs)} – ${formatAnnotationClockMs(timelineEndMs)}`;
		return {
			id: holdSegmentTimelineId(collection.id, segment.id),
			collectionId: collection.id,
			segmentId: segment.id,
			segmentIndex,
			rowId: holdCollectionSubLaneRowId(collection.id, segmentIndex),
			outputStartMs: timelineStartMs,
			outputEndMs: timelineEndMs,
			collectionOffsetStartMs: offsetStart,
			collectionOffsetEndMs: offsetEnd,
			label: labelForContent(segment.content, segmentIndex),
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
): HoldCollection {
	return appendHoldCollectionSegment(collection, type);
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

/** Source-axis overlays: visible while playhead is inside each segment's serial span. */
export function buildHoldCollectionSourceOverlayAnnotations(
	holdCollections: HoldCollection[],
	sourceMs: number,
	alwaysVisibleSegmentIds: ReadonlySet<string> = new Set(),
): AnnotationRegion[] {
	const overlays: AnnotationRegion[] = [];
	for (const collection of holdCollections) {
		for (let segmentIndex = 0; segmentIndex < collection.segments.length; segmentIndex++) {
			const segment = collection.segments[segmentIndex]!;
			const offset = segmentOffsetMs(collection, segmentIndex);
			const start = collection.sourceMs + offset;
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
	holdRegions: HoldRegion[],
	sourceLabel: string,
): string {
	const totalMs = collectionHoldDurationMs(collection);
	const holdOutputStart = holdCollectionSegmentToOutputSpan(collection, 0, holdRegions).start;
	const holdOutputEnd = holdOutputStart + totalMs;
	return `${sourceLabel} · ${collection.segments.length} steps · ${formatAnnotationClockMs(holdOutputStart)} – ${formatAnnotationClockMs(holdOutputEnd)}`;
}
