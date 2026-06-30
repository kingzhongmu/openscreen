import type { HoldRegion } from "@/components/video-editor/types";
import {
	getHoldPlaybackOutputSpan,
	getOutputDurationMs,
	mergeHoldRegions,
	outputToSourceMs,
	sourceToOutputMs,
} from "@/lib/timelineMapping";

export interface HoldPlaybackTick {
	sourceMs: number;
	outputMs: number;
	finished: boolean;
}

export function createHoldPlaybackClock(holdRegions: HoldRegion[], sourceDurationMs: number) {
	let outputTimeMs = 0;
	let lastTickMs = 0;

	const maxOutputMs = getOutputDurationMs(sourceDurationMs, holdRegions);

	return {
		resetFromSource(sourceMs: number, nowMs = performance.now()) {
			const mappedOutputMs = sourceToOutputMs(sourceMs, holdRegions, sourceDurationMs);
			outputTimeMs = Math.max(0, Math.min(mappedOutputMs, maxOutputMs));
			lastTickMs = nowMs;
		},
		resetFromOutput(outputMs: number, nowMs = performance.now()) {
			outputTimeMs = Math.max(0, Math.min(outputMs, maxOutputMs));
			lastTickMs = nowMs;
		},
		tick(nowMs: number): HoldPlaybackTick {
			const deltaMs = Math.max(0, nowMs - lastTickMs);
			lastTickMs = nowMs;
			outputTimeMs = Math.min(maxOutputMs, outputTimeMs + deltaMs);

			return {
				sourceMs: outputToSourceMs(outputTimeMs, holdRegions, sourceDurationMs),
				outputMs: outputTimeMs,
				finished: outputTimeMs >= maxOutputMs,
			};
		},
		getOutputTimeMs: () => outputTimeMs,
		getMaxOutputMs: () => maxOutputMs,
	};
}

export function resolveAudioAnnotationOutputAnchorMs(
	anchorMs: number,
	holdRegions: HoldRegion[],
	sourceDurationMs?: number,
): number {
	return sourceToOutputMs(anchorMs, holdRegions, sourceDurationMs);
}

/** Timeline clock for overlay animations (arrows, text) during hold segments. */
export function resolveAnnotationAnimationTimeMs(
	outputMs: number,
	annotationStartMs: number,
	holdRegions: HoldRegion[],
	sourceDurationMs?: number,
): number {
	if (holdRegions.length === 0) {
		return outputMs;
	}

	const holdAtStart = mergeHoldRegions(holdRegions).find(
		(hold) => hold.sourceMs === annotationStartMs,
	);
	const holdOutputSpan = holdAtStart ? getHoldPlaybackOutputSpan(holdAtStart, holdRegions) : null;
	const holdOutputStart =
		holdOutputSpan?.start ?? sourceToOutputMs(annotationStartMs, holdRegions, sourceDurationMs);
	const holdOutputEnd = holdOutputSpan?.end ?? holdOutputStart;

	if (outputMs < holdOutputStart) {
		return outputToSourceMs(outputMs, holdRegions, sourceDurationMs);
	}

	if (holdOutputSpan && outputMs < holdOutputEnd) {
		return annotationStartMs + (outputMs - holdOutputStart);
	}

	return outputToSourceMs(outputMs, holdRegions, sourceDurationMs);
}
