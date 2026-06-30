import type { HoldRegion } from "@/components/video-editor/types";

export function normalizeHoldRegions(holdRegions: HoldRegion[]): HoldRegion[] {
	return [...holdRegions].sort((a, b) => a.sourceMs - b.sourceMs || a.id.localeCompare(b.id));
}

/** Merge holds at the same source anchor (keep max duration). */
export function mergeHoldRegions(holdRegions: HoldRegion[]): HoldRegion[] {
	const bySource = new Map<number, HoldRegion>();

	for (const hold of normalizeHoldRegions(holdRegions)) {
		const existing = bySource.get(hold.sourceMs);
		if (!existing) {
			bySource.set(hold.sourceMs, { ...hold });
			continue;
		}

		bySource.set(hold.sourceMs, {
			...existing,
			holdDurationMs: Math.max(existing.holdDurationMs, hold.holdDurationMs),
		});
	}

	return normalizeHoldRegions([...bySource.values()]);
}

export interface HoldOutputSegment {
	id: string;
	sourceMs: number;
	holdDurationMs: number;
	outputStart: number;
	outputEnd: number;
	insertIncrementMs: number;
	linkedAnnotationId?: string;
}

/** Build per-hold output segments with union-aware insert increments. */
export function computeHoldOutputSegments(holdRegions: HoldRegion[]): HoldOutputSegment[] {
	const sorted = normalizeHoldRegions(holdRegions);
	let accumulatedInsert = 0;
	let maxParallelEnd = 0;
	let lastOutputEnd = 0;
	const segments: HoldOutputSegment[] = [];

	for (const hold of sorted) {
		const parallelEnd = hold.sourceMs + hold.holdDurationMs;
		let insertIncrementMs = hold.holdDurationMs;
		let outputStart: number;

		if (maxParallelEnd <= hold.sourceMs) {
			outputStart = hold.sourceMs + accumulatedInsert;
		} else {
			outputStart = lastOutputEnd;
			if (parallelEnd <= maxParallelEnd) {
				insertIncrementMs =
					parallelEnd < maxParallelEnd ? hold.holdDurationMs - (maxParallelEnd - parallelEnd) : 0;
			} else {
				insertIncrementMs = parallelEnd - maxParallelEnd;
			}
		}

		const outputEnd = outputStart + insertIncrementMs;

		segments.push({
			id: hold.id,
			sourceMs: hold.sourceMs,
			holdDurationMs: hold.holdDurationMs,
			outputStart,
			outputEnd,
			insertIncrementMs,
			linkedAnnotationId: hold.linkedAnnotationId,
		});

		accumulatedInsert += insertIncrementMs;
		lastOutputEnd = outputEnd;
		maxParallelEnd = Math.max(maxParallelEnd, parallelEnd);
	}

	return segments;
}

/** Sum of full hold durations for source anchors strictly before `sourceMs`. */
export function cumulativeFullHoldDurationBefore(
	sourceMs: number,
	holdRegions: HoldRegion[],
): number {
	return mergeHoldRegions(holdRegions)
		.filter((hold) => hold.sourceMs < sourceMs)
		.reduce((sum, hold) => sum + hold.holdDurationMs, 0);
}

/** Per-hold output span used for preview freeze and freeze-track display (full holdDurationMs). */
export function getHoldPlaybackOutputSpan(hold: HoldRegion, holdRegions: HoldRegion[]): OutputSpan {
	const start = sourceToOutputMs(hold.sourceMs, holdRegions);
	return { start, end: start + hold.holdDurationMs };
}

/** Hold active at output time for preview freeze (uses each hold's full duration, not union insert). */
export function findHoldPlaybackAtOutput(
	outputMs: number,
	holdRegions: HoldRegion[],
): HoldRegion | null {
	for (const hold of normalizeHoldRegions(holdRegions)) {
		const span = getHoldPlaybackOutputSpan(hold, holdRegions);
		if (outputMs >= span.start && outputMs < span.end) {
			return hold;
		}
	}
	return null;
}

/** Merged hold duration at a source anchor (0 if none). */
export function getHoldDurationAtSourceMs(sourceMs: number, holdRegions: HoldRegion[]): number {
	return (
		normalizeHoldRegions(holdRegions).find((hold) => hold.sourceMs === sourceMs)?.holdDurationMs ??
		0
	);
}

export function getTotalHoldDurationMs(holdRegions: HoldRegion[]): number {
	return getMergedHoldOutputDurationMs(holdRegions);
}

export function cumulativeHoldBefore(sourceMs: number, holdRegions: HoldRegion[]): number {
	return cumulativeFullHoldDurationBefore(sourceMs, holdRegions);
}

/** Map source timeline position to output (export/preview) timeline. */
export function sourceToOutputMs(
	sourceMs: number,
	holdRegions: HoldRegion[],
	_sourceDurationMs?: number,
): number {
	return sourceMs + cumulativeFullHoldDurationBefore(sourceMs, holdRegions);
}

/** Map output timeline position back to source time. */
export function outputToSourceMs(
	outputMs: number,
	holdRegions: HoldRegion[],
	_sourceDurationMs?: number,
): number {
	const activeHold = findHoldPlaybackAtOutput(outputMs, holdRegions);
	if (activeHold) {
		return activeHold.sourceMs;
	}

	const merged = mergeHoldRegions(holdRegions);
	let insertBefore = 0;

	for (const hold of merged) {
		const outputAtAnchor = hold.sourceMs + insertBefore;
		const outputAtHoldEnd = outputAtAnchor + hold.holdDurationMs;

		if (outputMs < outputAtAnchor) {
			return outputMs - insertBefore;
		}

		if (outputMs < outputAtHoldEnd) {
			return hold.sourceMs;
		}

		insertBefore += hold.holdDurationMs;
	}

	return outputMs - insertBefore;
}

export function getOutputDurationMs(sourceDurationMs: number, holdRegions: HoldRegion[]): number {
	if (holdRegions.length === 0) {
		return sourceDurationMs;
	}
	const segmentBasedDuration = sourceDurationMs + getMergedHoldOutputDurationMs(holdRegions);
	const maxHoldPlaybackEnd = Math.max(
		0,
		...normalizeHoldRegions(holdRegions).map(
			(hold) => getHoldPlaybackOutputSpan(hold, holdRegions).end,
		),
	);
	return Math.max(segmentBasedDuration, maxHoldPlaybackEnd);
}

export function isOutputTimeInHold(outputMs: number, holdRegions: HoldRegion[]): boolean {
	return findHoldPlaybackAtOutput(outputMs, holdRegions) !== null;
}

export function getHoldRegionAtSourceMs(
	sourceMs: number,
	holdRegions: HoldRegion[],
): HoldRegion | null {
	return normalizeHoldRegions(holdRegions).find((hold) => hold.sourceMs === sourceMs) ?? null;
}

export function getHoldInsertIncrementAtSourceMs(
	sourceMs: number,
	holdRegions: HoldRegion[],
): number {
	return getHoldDurationAtSourceMs(sourceMs, holdRegions);
}

export interface OutputSpan {
	start: number;
	end: number;
}

/** Map a source-time span to output timeline coordinates. */
export function sourceSpanToOutputSpan(
	startMs: number,
	endMs: number,
	holdRegions: HoldRegion[],
): OutputSpan {
	if (holdRegions.length === 0) {
		return { start: startMs, end: endMs };
	}
	return {
		start: sourceToOutputMs(startMs, holdRegions),
		end: sourceToOutputMs(endMs, holdRegions),
	};
}

/**
 * Output span for a freeze annotation on the freeze track.
 * Hold duration equals annotation span length (phase 7).
 */
export function getFreezeLinkedOutputSpan(
	startMs: number,
	endMs: number,
	_holdDurationMs: number,
	holdRegions: HoldRegion[],
): OutputSpan {
	if (holdRegions.length === 0) {
		return { start: startMs, end: endMs };
	}
	const outputStart = sourceToOutputMs(startMs, holdRegions);
	const durationMs = Math.max(1, endMs - startMs);
	return { start: outputStart, end: outputStart + durationMs };
}

/**
 * Inverse of getFreezeLinkedOutputSpan for timeline drag/resize edits.
 */
export function outputSpanToFreezeLinkedSourceSpan(
	outputStart: number,
	outputEnd: number,
	holdRegions: HoldRegion[],
	minDurationMs = 100,
): OutputSpan {
	const outputDurationMs = Math.max(minDurationMs, outputEnd - outputStart);
	if (holdRegions.length === 0) {
		return { start: outputStart, end: outputStart + outputDurationMs };
	}
	const sourceStart = outputToSourceMs(outputStart, holdRegions);
	return { start: sourceStart, end: sourceStart + outputDurationMs };
}

/** Map an output-time span back to source coordinates (for timeline drag edits). */
export function outputSpanToSourceSpan(
	startMs: number,
	endMs: number,
	holdRegions: HoldRegion[],
): OutputSpan {
	if (holdRegions.length === 0) {
		return { start: startMs, end: endMs };
	}
	return {
		start: outputToSourceMs(startMs, holdRegions),
		end: outputToSourceMs(endMs, holdRegions),
	};
}

/** Whether a source-time region is visible at output playhead time. */
export function isRegionVisibleAtOutputTime(
	outputMs: number,
	startMs: number,
	endMs: number,
	holdRegions: HoldRegion[],
): boolean {
	if (holdRegions.length === 0) {
		return outputMs >= startMs && outputMs < endMs;
	}
	const sourceMs = outputToSourceMs(outputMs, holdRegions);
	return sourceMs >= startMs && sourceMs < endMs;
}

/** Freeze annotations: visible only on the hold insert span (not during post-hold source replay). */
export function isFreezeLinkedRegionVisibleAtOutputTime(
	outputMs: number,
	startMs: number,
	endMs: number,
	holdRegions: HoldRegion[],
): boolean {
	const span = getFreezeLinkedOutputSpan(startMs, endMs, Math.max(1, endMs - startMs), holdRegions);
	return outputMs >= span.start && outputMs < span.end;
}

export interface HoldOutputSpan {
	id: string;
	start: number;
	end: number;
	linkedAnnotationId?: string;
}

/** Per-hold insert spans on the output timeline (full anchor stacking; union for total duration). */
export function getHoldOutputSpans(holdRegions: HoldRegion[]): HoldOutputSpan[] {
	return mergeHoldRegions(holdRegions).map((hold) => {
		const span = getHoldPlaybackOutputSpan(hold, holdRegions);
		return {
			id: hold.id,
			start: span.start,
			end: span.end,
			linkedAnnotationId: hold.linkedAnnotationId,
		};
	});
}

/** Union-merge overlapping hold spans on the output timeline for total duration. */
export function unionMergeHoldOutputSpans(spans: HoldOutputSpan[]): HoldOutputSpan[] {
	if (spans.length === 0) {
		return [];
	}

	const sorted = [...spans].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
	const merged: HoldOutputSpan[] = [{ ...sorted[0] }];

	for (let index = 1; index < sorted.length; index++) {
		const span = sorted[index];
		const last = merged[merged.length - 1]!;

		if (span.start <= last.end) {
			last.end = Math.max(last.end, span.end);
			continue;
		}

		merged.push({ ...span });
	}

	return merged;
}

/** Merged hold segments for timeline ruler / total duration. */
export function getMergedHoldOutputSpans(holdRegions: HoldRegion[]): HoldOutputSpan[] {
	return unionMergeHoldOutputSpans(getHoldOutputSpans(holdRegions));
}

export function getMergedHoldOutputDurationMs(holdRegions: HoldRegion[]): number {
	return getMergedHoldOutputSpans(holdRegions).reduce(
		(sum, span) => sum + (span.end - span.start),
		0,
	);
}

export function usesOutputTimeline(holdRegions: HoldRegion[]): boolean {
	return holdRegions.length > 0;
}
