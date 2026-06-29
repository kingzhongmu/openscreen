import type { HoldRegion } from "@/components/video-editor/types";
import { getHoldRegionAtSourceMs } from "@/lib/timelineMapping";

export function countHoldDuplicateFrames(holdDurationMs: number, targetFrameRate: number): number {
	const totalFrames = Math.max(1, Math.round((holdDurationMs / 1000) * targetFrameRate));
	return Math.max(0, totalFrames - 1);
}

export function findHoldForExportFrame(
	sourceTimestampMs: number,
	holdRegions: HoldRegion[],
	framePeriodMs: number,
): HoldRegion | null {
	const exact = getHoldRegionAtSourceMs(sourceTimestampMs, holdRegions);
	if (exact) {
		return exact;
	}

	return (
		holdRegions.find(
			(hold) =>
				sourceTimestampMs >= hold.sourceMs && sourceTimestampMs < hold.sourceMs + framePeriodMs,
		) ?? null
	);
}

export async function emitExportFrameWithHoldDuplicates(options: {
	videoFrame: VideoFrame;
	sourceTimestampMs: number;
	exportFrameIndex: number;
	frameDurationUs: number;
	targetFrameRate: number;
	holdRegions: HoldRegion[];
	onFrame: (
		frame: VideoFrame,
		exportTimestampUs: number,
		sourceTimestampMs: number,
	) => Promise<void>;
}): Promise<number> {
	const {
		videoFrame,
		sourceTimestampMs,
		exportFrameIndex,
		frameDurationUs,
		targetFrameRate,
		holdRegions,
		onFrame,
	} = options;

	let nextIndex = exportFrameIndex;
	await onFrame(videoFrame, nextIndex * frameDurationUs, sourceTimestampMs);
	nextIndex++;

	const framePeriodMs = 1000 / targetFrameRate;
	const hold = findHoldForExportFrame(sourceTimestampMs, holdRegions, framePeriodMs);
	if (!hold) {
		return nextIndex;
	}

	const duplicateCount = countHoldDuplicateFrames(hold.holdDurationMs, targetFrameRate);
	for (let i = 0; i < duplicateCount; i++) {
		const clone = new VideoFrame(videoFrame, { timestamp: videoFrame.timestamp });
		try {
			await onFrame(clone, nextIndex * frameDurationUs, sourceTimestampMs);
			nextIndex++;
		} finally {
			clone.close();
		}
	}

	return nextIndex;
}
