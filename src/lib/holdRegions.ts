import type {
	AnnotationRegion,
	AudioAnnotationClip,
	HoldCollection,
	HoldRegion,
} from "@/components/video-editor/types";
import { MAX_HOLD_DURATION_MS, MIN_HOLD_DURATION_MS } from "@/components/video-editor/types";
import { syncHoldRegionsFromHoldCollections } from "@/lib/holdCollection";

/** Snap freeze anchors to a sibling freeze start when dragged within this distance. */
export const FREEZE_ANCHOR_SNAP_THRESHOLD_MS = 150;

/** Snap audio freeze anchors that sit on/near an existing text freeze span to the same source anchor. */
export const FREEZE_ANCHOR_ALIGN_AFTER_END_MS = 100;

export function collectFreezeAnnotationAnchorTargets(
	annotations: AnnotationRegion[],
	excludeId?: string,
): number[] {
	return annotations
		.filter((annotation) => annotation.freezeDuringAnnotation && annotation.id !== excludeId)
		.map((annotation) => annotation.startMs);
}

export function collectFreezeAnchorSnapTargets(
	annotations: AnnotationRegion[],
	audioClips: AudioAnnotationClip[],
	excludeId?: string,
): number[] {
	const targets = new Set<number>();
	for (const annotation of annotations) {
		if (!annotation.freezeDuringAnnotation || annotation.id === excludeId) {
			continue;
		}
		targets.add(annotation.startMs);
	}
	for (const clip of audioClips) {
		if (!clip.freezeDuringAnnotation || clip.id === excludeId) {
			continue;
		}
		targets.add(clip.anchorMs);
	}
	return [...targets];
}

export function snapMsToFreezeAnchors(
	ms: number,
	targets: number[],
	thresholdMs = FREEZE_ANCHOR_SNAP_THRESHOLD_MS,
): number {
	let best = ms;
	let bestDistance = thresholdMs + 1;
	for (const target of targets) {
		const distance = Math.abs(target - ms);
		if (distance <= thresholdMs && distance < bestDistance) {
			best = target;
			bestDistance = distance;
		}
	}
	return best;
}

/** Legacy load: nudge anchors just past a text freeze end back to its start. */
export function resolveNearEndFreezeAnchorMs(
	anchorMs: number,
	annotations: AnnotationRegion[],
): number {
	let resolved = anchorMs;
	for (const annotation of annotations) {
		if (!annotation.freezeDuringAnnotation) {
			continue;
		}
		const alignEndMs = annotation.endMs + FREEZE_ANCHOR_ALIGN_AFTER_END_MS;
		if (anchorMs > annotation.endMs && anchorMs <= alignEndMs) {
			resolved = Math.min(resolved, annotation.startMs);
		}
	}
	return resolved;
}

export function alignFreezeAnnotationAnchors(annotations: AnnotationRegion[]): AnnotationRegion[] {
	return annotations.map((region) => {
		if (!region.freezeDuringAnnotation) {
			return region;
		}
		const targets = collectFreezeAnnotationAnchorTargets(annotations, region.id);
		const startMs = snapMsToFreezeAnchors(region.startMs, targets);
		if (startMs === region.startMs) {
			return region;
		}
		const durationMs = region.endMs - region.startMs;
		return { ...region, startMs, endMs: startMs + durationMs };
	});
}

export function alignAudioFreezeAnchors(
	clips: AudioAnnotationClip[],
	annotations: AnnotationRegion[],
): AudioAnnotationClip[] {
	return clips.map((clip) => {
		if (!clip.freezeDuringAnnotation) {
			return clip;
		}
		const targets = collectFreezeAnchorSnapTargets(annotations, clips, clip.id);
		const snapped = snapMsToFreezeAnchors(clip.anchorMs, targets);
		const anchorMs = resolveNearEndFreezeAnchorMs(snapped, annotations);
		return anchorMs === clip.anchorMs ? clip : { ...clip, anchorMs };
	});
}

export function alignAllFreezeAnchors(
	annotations: AnnotationRegion[],
	audioClips: AudioAnnotationClip[],
): { annotations: AnnotationRegion[]; audioClips: AudioAnnotationClip[] } {
	const alignedAnnotations = alignFreezeAnnotationAnchors(annotations);
	const alignedClips = alignAudioFreezeAnchors(audioClips, alignedAnnotations);
	return { annotations: alignedAnnotations, audioClips: alignedClips };
}

export function getAnnotationHoldDurationMs(annotation: AnnotationRegion): number {
	const spanMs = Math.max(1, annotation.endMs - annotation.startMs);
	return Math.max(MIN_HOLD_DURATION_MS, Math.min(MAX_HOLD_DURATION_MS, spanMs));
}

export function getAudioClipHoldDurationMs(clip: AudioAnnotationClip): number {
	const spanMs = Math.max(1, clip.durationMs);
	return Math.max(MIN_HOLD_DURATION_MS, Math.min(MAX_HOLD_DURATION_MS, spanMs));
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
	holdCollections: HoldCollection[] = [],
): HoldRegion[] {
	const collectionShellIds = new Set(
		holdCollections.map((collection) => collection.shellAnnotationId).filter(Boolean),
	);
	const collectionSourceMs = new Set(holdCollections.map((collection) => collection.sourceMs));

	let holds = syncHoldRegionsFromHoldCollections(holdCollections, existingHoldRegions);

	const collectionIds = new Set(holdCollections.map((collection) => collection.id));
	const linkedIds = new Set<string>([
		...annotations
			.filter(
				(annotation) => annotation.freezeDuringAnnotation && !collectionShellIds.has(annotation.id),
			)
			.map((a) => a.id),
		...audioClips
			.filter((clip) => clip.freezeDuringAnnotation && !collectionShellIds.has(clip.id))
			.map((clip) => clip.id),
	]);

	holds = holds.filter(
		(hold) =>
			(hold.linkedCollectionId && collectionIds.has(hold.linkedCollectionId)) ||
			!hold.linkedAnnotationId ||
			linkedIds.has(hold.linkedAnnotationId),
	);

	for (const annotation of annotations) {
		if (!annotation.freezeDuringAnnotation || collectionShellIds.has(annotation.id)) {
			continue;
		}
		if (collectionSourceMs.has(annotation.startMs)) {
			continue;
		}
		holds = upsertHoldForAnnotation(holds, annotation);
	}

	for (const clip of audioClips) {
		if (!clip.freezeDuringAnnotation || collectionShellIds.has(clip.id)) {
			continue;
		}
		if (collectionSourceMs.has(clip.anchorMs)) {
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
