import type { HoldRegion } from "@/components/video-editor/types";
import {
	getTotalHoldDurationMs,
	isOutputTimeInHold,
	outputToSourceMs,
} from "@/lib/timelineMapping";

const EXPORT_SAMPLE_RATE = 48_000;

function copyBaseSample(baseBuffer: AudioBuffer, sourceMs: number, channel: number): number {
	const sourceSec = Math.max(0, sourceMs / 1000);
	const sourceIndex = Math.min(
		baseBuffer.length - 1,
		Math.floor(sourceSec * baseBuffer.sampleRate),
	);
	return baseBuffer.getChannelData(channel)[sourceIndex] ?? 0;
}

export function getOutputAudioDurationSec(
	sourceDurationSec: number,
	holdRegions: HoldRegion[],
): number {
	return sourceDurationSec + getTotalHoldDurationMs(holdRegions) / 1000;
}

export function renderBaseAudioOnOutputTimeline(
	baseBuffer: AudioBuffer,
	holdRegions: HoldRegion[],
	outputDurationSec: number,
): AudioBuffer {
	const frameCount = Math.max(1, Math.ceil(EXPORT_SAMPLE_RATE * outputDurationSec));
	const offline = new OfflineAudioContext(
		baseBuffer.numberOfChannels,
		frameCount,
		EXPORT_SAMPLE_RATE,
	);
	const rendered = offline.createBuffer(
		baseBuffer.numberOfChannels,
		frameCount,
		EXPORT_SAMPLE_RATE,
	);

	for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
		const channelData = rendered.getChannelData(channel);
		for (let i = 0; i < frameCount; i++) {
			const outputMs = (i / EXPORT_SAMPLE_RATE) * 1000;
			if (isOutputTimeInHold(outputMs, holdRegions)) {
				channelData[i] = 0;
				continue;
			}
			const sourceMs = outputToSourceMs(outputMs, holdRegions);
			channelData[i] = copyBaseSample(baseBuffer, sourceMs, channel);
		}
	}

	return rendered;
}
