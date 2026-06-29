import {
	MAX_POSITION_ANNOTATION_DURATION_MS,
	MIN_POSITION_ANNOTATION_DURATION_MS,
} from "@/components/video-editor/positionAnnotation";
import type { AudioAnnotationClip } from "@/components/video-editor/types";
import { DEFAULT_AUDIO_ANNOTATION_VOLUME } from "@/components/video-editor/types";

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
	};
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
