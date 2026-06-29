import type { HoldRegion } from "@/components/video-editor/types";

export function normalizeHoldRegions(holdRegions: HoldRegion[]): HoldRegion[] {
	return [...holdRegions].sort((a, b) => a.sourceMs - b.sourceMs || a.id.localeCompare(b.id));
}

export function getTotalHoldDurationMs(holdRegions: HoldRegion[]): number {
	return holdRegions.reduce((sum, hold) => sum + hold.holdDurationMs, 0);
}

export function cumulativeHoldBefore(sourceMs: number, holdRegions: HoldRegion[]): number {
	return normalizeHoldRegions(holdRegions)
		.filter((hold) => hold.sourceMs < sourceMs)
		.reduce((sum, hold) => sum + hold.holdDurationMs, 0);
}

/** Map source timeline position to output (export/preview) timeline. */
export function sourceToOutputMs(sourceMs: number, holdRegions: HoldRegion[]): number {
	return sourceMs + cumulativeHoldBefore(sourceMs, holdRegions);
}

/** Map output timeline position back to source time. */
export function outputToSourceMs(outputMs: number, holdRegions: HoldRegion[]): number {
	const sorted = normalizeHoldRegions(holdRegions);
	let accumulatedHoldMs = 0;

	for (const hold of sorted) {
		const holdOutputStartMs = hold.sourceMs + accumulatedHoldMs;
		const holdOutputEndMs = holdOutputStartMs + hold.holdDurationMs;

		if (outputMs >= holdOutputStartMs && outputMs < holdOutputEndMs) {
			return hold.sourceMs;
		}

		if (outputMs < holdOutputStartMs) {
			return outputMs - accumulatedHoldMs;
		}

		accumulatedHoldMs += hold.holdDurationMs;
	}

	return outputMs - accumulatedHoldMs;
}

export function getOutputDurationMs(sourceDurationMs: number, holdRegions: HoldRegion[]): number {
	return sourceDurationMs + getTotalHoldDurationMs(holdRegions);
}

export function isOutputTimeInHold(outputMs: number, holdRegions: HoldRegion[]): boolean {
	const sorted = normalizeHoldRegions(holdRegions);
	let accumulatedHoldMs = 0;

	for (const hold of sorted) {
		const holdOutputStartMs = hold.sourceMs + accumulatedHoldMs;
		const holdOutputEndMs = holdOutputStartMs + hold.holdDurationMs;

		if (outputMs >= holdOutputStartMs && outputMs < holdOutputEndMs) {
			return true;
		}

		accumulatedHoldMs += hold.holdDurationMs;
	}

	return false;
}

export function getHoldRegionAtSourceMs(
	sourceMs: number,
	holdRegions: HoldRegion[],
): HoldRegion | null {
	return normalizeHoldRegions(holdRegions).find((hold) => hold.sourceMs === sourceMs) ?? null;
}
