import type { HoldRegion } from "@/components/video-editor/types";
import { getOutputDurationMs, outputToSourceMs, sourceToOutputMs } from "@/lib/timelineMapping";

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
			const mappedOutputMs = sourceToOutputMs(sourceMs, holdRegions);
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
				sourceMs: outputToSourceMs(outputTimeMs, holdRegions),
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
): number {
	return sourceToOutputMs(anchorMs, holdRegions);
}

/** Timeline clock for overlay animations (arrows, text) during hold segments. */
export function resolveAnnotationAnimationTimeMs(
	outputMs: number,
	annotationStartMs: number,
	holdRegions: HoldRegion[],
): number {
	if (holdRegions.length === 0) {
		return outputMs;
	}

	const holdOutputStart = sourceToOutputMs(annotationStartMs, holdRegions);
	if (outputMs < holdOutputStart) {
		return outputToSourceMs(outputMs, holdRegions);
	}

	const hold = holdRegions.find((region) => region.sourceMs === annotationStartMs);
	if (!hold) {
		return outputToSourceMs(outputMs, holdRegions);
	}

	const holdOutputEnd = holdOutputStart + hold.holdDurationMs;
	if (outputMs < holdOutputEnd) {
		return annotationStartMs + (outputMs - holdOutputStart);
	}

	return outputToSourceMs(outputMs, holdRegions);
}
