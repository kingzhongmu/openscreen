import type {
	AnnotationRegion,
	AudioAnnotationClip,
	HoldRegion,
} from "@/components/video-editor/types";
import { MAX_HOLD_DURATION_MS, MIN_HOLD_DURATION_MS } from "@/components/video-editor/types";

export function getAnnotationHoldDurationMs(annotation: AnnotationRegion): number {
	const spanMs = Math.max(1, annotation.endMs - annotation.startMs);
	const requested = annotation.holdDurationMs ?? spanMs;
	return Math.max(
		MIN_HOLD_DURATION_MS,
		Math.min(MAX_HOLD_DURATION_MS, Math.max(requested, spanMs)),
	);
}

export function getAudioClipHoldDurationMs(clip: AudioAnnotationClip): number {
	const spanMs = Math.max(1, clip.durationMs);
	const requested = clip.holdDurationMs ?? spanMs;
	return Math.max(
		MIN_HOLD_DURATION_MS,
		Math.min(MAX_HOLD_DURATION_MS, Math.max(requested, spanMs)),
	);
}

export function upsertHoldForAnnotation(
	holdRegions: HoldRegion[],
	annotation: AnnotationRegion,
): HoldRegion[] {
	if (!annotation.freezeDuringAnnotation) {
		return holdRegions.filter((hold) => hold.linkedAnnotationId !== annotation.id);
	}

	const holdDurationMs = getAnnotationHoldDurationMs(annotation);
	const existing = holdRegions.find((hold) => hold.linkedAnnotationId === annotation.id);

	const nextHold: HoldRegion = {
		id: existing?.id ?? `hold-${annotation.id}`,
		sourceMs: annotation.startMs,
		holdDurationMs,
		linkedAnnotationId: annotation.id,
	};

	return [...holdRegions.filter((hold) => hold.linkedAnnotationId !== annotation.id), nextHold];
}

export function upsertHoldForAudioClip(
	holdRegions: HoldRegion[],
	clip: AudioAnnotationClip,
): HoldRegion[] {
	if (!clip.freezeDuringAnnotation) {
		return holdRegions.filter((hold) => hold.linkedAnnotationId !== clip.id);
	}

	const holdDurationMs = getAudioClipHoldDurationMs(clip);
	const existing = holdRegions.find((hold) => hold.linkedAnnotationId === clip.id);

	const nextHold: HoldRegion = {
		id: existing?.id ?? `hold-${clip.id}`,
		sourceMs: clip.anchorMs,
		holdDurationMs,
		linkedAnnotationId: clip.id,
	};

	return [...holdRegions.filter((hold) => hold.linkedAnnotationId !== clip.id), nextHold];
}

export function removeHoldForAnnotation(
	holdRegions: HoldRegion[],
	annotationId: string,
): HoldRegion[] {
	return holdRegions.filter((hold) => hold.linkedAnnotationId !== annotationId);
}

export function syncHoldRegionsFromEditor(
	annotations: AnnotationRegion[],
	audioClips: AudioAnnotationClip[],
	existingHoldRegions: HoldRegion[],
): HoldRegion[] {
	const linkedIds = new Set<string>([
		...annotations.filter((annotation) => annotation.freezeDuringAnnotation).map((a) => a.id),
		...audioClips.filter((clip) => clip.freezeDuringAnnotation).map((clip) => clip.id),
	]);

	let holds = existingHoldRegions.filter(
		(hold) => !hold.linkedAnnotationId || linkedIds.has(hold.linkedAnnotationId),
	);

	for (const annotation of annotations) {
		if (!annotation.freezeDuringAnnotation) {
			continue;
		}
		holds = upsertHoldForAnnotation(holds, annotation);
	}

	for (const clip of audioClips) {
		if (!clip.freezeDuringAnnotation) {
			continue;
		}
		holds = upsertHoldForAudioClip(holds, clip);
	}

	return holds;
}

/** @deprecated Use syncHoldRegionsFromEditor */
export function syncHoldRegionsFromAnnotations(
	annotations: AnnotationRegion[],
	existingHoldRegions: HoldRegion[],
): HoldRegion[] {
	return syncHoldRegionsFromEditor(annotations, [], existingHoldRegions);
}
