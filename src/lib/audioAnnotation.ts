import {
	MAX_POSITION_ANNOTATION_DURATION_MS,
	MIN_POSITION_ANNOTATION_DURATION_MS,
} from "@/components/video-editor/positionAnnotation";
import type {
	AudioAnnotationClip,
	HoldCollectionSegmentAudio,
	HoldRegion,
} from "@/components/video-editor/types";
import { DEFAULT_AUDIO_ANNOTATION_VOLUME } from "@/components/video-editor/types";
import {
	getOutputDurationMs,
	outputToSourceMs,
	resolveContinuousSourceTimelineMs,
	sourceToOutputMs,
} from "@/lib/timelineMapping";

export const LINKED_ANNOTATION_AUDIO_PREFIX = "linked-audio:";

export function linkedAnnotationAudioClipId(annotationId: string): string {
	return `${LINKED_ANNOTATION_AUDIO_PREFIX}${annotationId}`;
}

export function isLinkedAnnotationAudioClipId(clipId: string): boolean {
	return clipId.startsWith(LINKED_ANNOTATION_AUDIO_PREFIX);
}

export function isBgmAudioClip(clip: AudioAnnotationClip): boolean {
	if (isLinkedAnnotationAudioClipId(clip.id)) {
		return false;
	}
	if (clip.freezeDuringAnnotation) {
		return false;
	}
	return clip.role === "bgm" || clip.role === undefined;
}

export function usesSourceTimelineAudioPlayback(clip: AudioAnnotationClip): boolean {
	return isBgmAudioClip(clip);
}

export function linkedAnnotationAudioFromClip(
	clip: AudioAnnotationClip | undefined,
): HoldCollectionSegmentAudio | undefined {
	if (!clip) {
		return undefined;
	}
	return {
		audioUrl: clip.audioUrl ?? "",
		sourceFilePath: clip.sourceFilePath,
		fileName: clip.fileName,
		sourceDurationMs: clip.sourceDurationMs,
		volume: clip.volume ?? DEFAULT_AUDIO_ANNOTATION_VOLUME,
	};
}

export function buildLinkedAnnotationAudioClip(
	annotationId: string,
	anchorMs: number,
	durationMs: number,
): AudioAnnotationClip {
	return {
		id: linkedAnnotationAudioClipId(annotationId),
		anchorMs: Math.max(0, Math.round(anchorMs)),
		durationMs: Math.max(MIN_POSITION_ANNOTATION_DURATION_MS, Math.round(durationMs)),
		source: "import",
		audioUrl: "",
		volume: DEFAULT_AUDIO_ANNOTATION_VOLUME,
	};
}

export function syncLinkedAnnotationAudioClipSpan(
	clips: AudioAnnotationClip[],
	annotationId: string,
	anchorMs: number,
	durationMs: number,
): AudioAnnotationClip[] {
	const clipId = linkedAnnotationAudioClipId(annotationId);
	if (!clips.some((clip) => clip.id === clipId)) {
		return clips;
	}
	const nextDurationMs = Math.max(MIN_POSITION_ANNOTATION_DURATION_MS, Math.round(durationMs));
	return clips.map((clip) =>
		clip.id === clipId
			? { ...clip, anchorMs: Math.max(0, Math.round(anchorMs)), durationMs: nextDurationMs }
			: clip,
	);
}

export const ACCEPTED_AUDIO_ANNOTATION_TYPES = [
	"audio/mpeg",
	"audio/mp3",
	"audio/wav",
	"audio/x-wav",
	"audio/wave",
] as const;

export const ACCEPTED_AUDIO_ANNOTATION_EXTENSIONS = [".mp3", ".wav"] as const;

export function isAcceptedAudioAnnotationFile(file: File): boolean {
	const lowerName = file.name.toLowerCase();
	if (ACCEPTED_AUDIO_ANNOTATION_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
		return true;
	}
	return ACCEPTED_AUDIO_ANNOTATION_TYPES.some((type) => file.type === type);
}

export function getAudioFileDurationMs(audioUrl: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const media = document.createElement("audio");
		media.preload = "metadata";
		media.src = audioUrl;

		const cleanup = () => {
			media.removeEventListener("loadedmetadata", onLoaded);
			media.removeEventListener("error", onError);
			media.src = "";
			media.load();
		};

		const onLoaded = () => {
			const durationSec = media.duration;
			cleanup();
			if (!Number.isFinite(durationSec) || durationSec <= 0) {
				reject(new Error("Invalid audio duration"));
				return;
			}
			resolve(Math.round(durationSec * 1000));
		};

		const onError = () => {
			cleanup();
			reject(new Error("Failed to load audio metadata"));
		};

		media.addEventListener("loadedmetadata", onLoaded);
		media.addEventListener("error", onError);
	});
}

export function buildAudioAnnotationClip(
	id: string,
	anchorMs: number,
	audioUrl: string,
	sourceDurationMs: number,
	fileName: string,
	totalMs: number,
	sourceFilePath?: string,
): AudioAnnotationClip | null {
	if (totalMs <= 0) {
		return null;
	}

	const clampedAnchor = Math.max(0, Math.min(Math.round(anchorMs), totalMs - 1));
	const remainingMs = totalMs - clampedAnchor;
	const durationMs = Math.max(
		MIN_POSITION_ANNOTATION_DURATION_MS,
		Math.min(sourceDurationMs, remainingMs, MAX_POSITION_ANNOTATION_DURATION_MS),
	);

	if (durationMs <= 0) {
		return null;
	}

	return {
		id,
		anchorMs: clampedAnchor,
		durationMs,
		source: "import",
		audioUrl,
		fileName,
		sourceDurationMs,
		volume: DEFAULT_AUDIO_ANNOTATION_VOLUME,
		...(sourceFilePath ? { sourceFilePath } : {}),
	};
}

export function buildBgmAudioClip(
	id: string,
	audioUrl: string,
	sourceDurationMs: number,
	fileName: string,
	totalMs: number,
	sourceFilePath?: string,
): AudioAnnotationClip | null {
	const clip = buildAudioAnnotationClip(
		id,
		0,
		audioUrl,
		sourceDurationMs,
		fileName,
		totalMs,
		sourceFilePath,
	);
	if (!clip) {
		return null;
	}
	return { ...clip, role: "bgm" };
}

export function audioAnnotationClipSpan(clip: AudioAnnotationClip): {
	startMs: number;
	endMs: number;
} {
	return {
		startMs: clip.anchorMs,
		endMs: clip.anchorMs + clip.durationMs,
	};
}

/** Max BGM duration on the continuous source clock (covers full preview when holds extend output). */
export function getMaxBgmClipDurationMs(
	anchorMs: number,
	sourceDurationMs: number,
	holdRegions: HoldRegion[],
	sourceFileDurationMs?: number,
): number {
	if (sourceDurationMs <= 0) {
		return MIN_POSITION_ANNOTATION_DURATION_MS;
	}

	const outputDurationMs = getOutputDurationMs(sourceDurationMs, holdRegions);
	const continuousAtPreviewEnd = resolveContinuousSourceTimelineMs(
		outputDurationMs,
		sourceDurationMs,
		holdRegions,
	);
	const timelineMax = Math.max(
		MIN_POSITION_ANNOTATION_DURATION_MS,
		continuousAtPreviewEnd - Math.max(0, Math.round(anchorMs)),
	);
	const fileMax =
		sourceFileDurationMs && sourceFileDurationMs > 0 ? sourceFileDurationMs : timelineMax;
	return Math.min(timelineMax, fileMax);
}

export function bgmClipToOutputSpan(
	anchorMs: number,
	durationMs: number,
	holdRegions: HoldRegion[],
	sourceDurationMs: number,
): { start: number; end: number } {
	if (holdRegions.length === 0) {
		const start = Math.max(0, Math.round(anchorMs));
		return { start, end: start + Math.max(1, Math.round(durationMs)) };
	}

	const outputStart = sourceToOutputMs(Math.max(0, Math.round(anchorMs)), holdRegions);
	const outputEnd = Math.min(
		getOutputDurationMs(sourceDurationMs, holdRegions),
		outputStart + Math.max(1, Math.round(durationMs)),
	);
	return { start: outputStart, end: Math.max(outputStart + 1, outputEnd) };
}

export function outputSpanToBgmClipSpan(
	outputStart: number,
	outputEnd: number,
	holdRegions: HoldRegion[],
	minDurationMs = MIN_POSITION_ANNOTATION_DURATION_MS,
): { anchorMs: number; durationMs: number } {
	const roundedStart = Math.max(0, Math.round(outputStart));
	const roundedEnd = Math.max(roundedStart + 1, Math.round(outputEnd));

	if (holdRegions.length === 0) {
		return {
			anchorMs: roundedStart,
			durationMs: Math.max(minDurationMs, roundedEnd - roundedStart),
		};
	}

	const anchorMs = outputToSourceMs(roundedStart, holdRegions);
	const sourceAtEnd = outputToSourceMs(roundedEnd, holdRegions);
	const continuousEnd = resolveContinuousSourceTimelineMs(roundedEnd, sourceAtEnd, holdRegions);
	return {
		anchorMs,
		durationMs: Math.max(minDurationMs, continuousEnd - anchorMs),
	};
}

export function clampBgmClipDurationMs(
	anchorMs: number,
	durationMs: number,
	sourceDurationMs: number,
	holdRegions: HoldRegion[],
	sourceFileDurationMs?: number,
): number {
	const maxDurationMs = getMaxBgmClipDurationMs(
		anchorMs,
		sourceDurationMs,
		holdRegions,
		sourceFileDurationMs,
	);
	return Math.max(
		MIN_POSITION_ANNOTATION_DURATION_MS,
		Math.min(Math.round(durationMs), maxDurationMs),
	);
}
