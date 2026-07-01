import type {
	AnnotationRegion,
	AudioAnnotationClip,
	HoldCollectionSegment,
} from "@/components/video-editor/types";
import { isHoldCollectionAudioSegment } from "@/lib/holdCollection";

export type AnnotationTabKind = "text" | "image" | "figure" | "audio";

export const ANNOTATION_TAB_KINDS: AnnotationTabKind[] = ["text", "image", "figure", "audio"];

export const ANNOTATION_TAB_KIND_BY_KEY: Partial<Record<string, AnnotationTabKind>> = {
	t: "text",
	i: "image",
	a: "figure",
	s: "audio",
};

export interface AnnotationTabTimelineLabels {
	step: (index: number) => string;
	emptyText: string;
	image: string;
	arrow: string;
	untitledAudio: string;
}

export function cycleAnnotationTabKind(
	current: AnnotationTabKind,
	reverse = false,
): AnnotationTabKind {
	const index = ANNOTATION_TAB_KINDS.indexOf(current);
	if (index < 0) {
		return "text";
	}
	const nextIndex = reverse
		? (index - 1 + ANNOTATION_TAB_KINDS.length) % ANNOTATION_TAB_KINDS.length
		: (index + 1) % ANNOTATION_TAB_KINDS.length;
	return ANNOTATION_TAB_KINDS[nextIndex]!;
}

export function annotationTabKindIcon(kind: AnnotationTabKind): string {
	switch (kind) {
		case "text":
			return "T";
		case "image":
			return "🖼";
		case "figure":
			return "→";
		case "audio":
			return "♪";
	}
}

export function truncateTimelineLabel(text: string, maxLength = 14): string {
	const trimmed = text.trim();
	if (!trimmed) {
		return "";
	}
	if (trimmed.length <= maxLength) {
		return trimmed;
	}
	return `${trimmed.slice(0, maxLength)}...`;
}

export function resolveHoldSegmentTabKind(segment: HoldCollectionSegment): AnnotationTabKind {
	if (isHoldCollectionAudioSegment(segment)) {
		return "audio";
	}
	if (segment.content.type === "figure") {
		return "figure";
	}
	if (segment.content.type === "image") {
		return "image";
	}
	return "text";
}

export function resolveHoldSegmentDisplayName(
	segment: HoldCollectionSegment,
	labels: Pick<AnnotationTabTimelineLabels, "emptyText" | "image" | "arrow" | "untitledAudio">,
): string {
	if (isHoldCollectionAudioSegment(segment)) {
		return segment.audio?.fileName?.trim() || labels.untitledAudio;
	}
	if (segment.content.type === "figure") {
		return labels.arrow;
	}
	if (segment.content.type === "image") {
		return labels.image;
	}
	const text = segment.content.textContent?.trim() || segment.content.content?.trim();
	return text || labels.emptyText;
}

export function formatHoldSegmentTimelineLabel(
	segment: HoldCollectionSegment,
	index: number,
	labels: AnnotationTabTimelineLabels,
): string {
	const kind = resolveHoldSegmentTabKind(segment);
	const icon = annotationTabKindIcon(kind);
	const name = truncateTimelineLabel(resolveHoldSegmentDisplayName(segment, labels));
	return `${labels.step(index + 1)} ${icon} ${name}`;
}

export function resolveRegularAnnotationTabKind(
	region: AnnotationRegion,
	linkedAudioClip?: AudioAnnotationClip,
): AnnotationTabKind {
	if (linkedAudioClip?.audioUrl?.trim()) {
		return "audio";
	}
	if (region.type === "figure") {
		return "figure";
	}
	if (region.type === "image") {
		return "image";
	}
	return "text";
}

export function resolveRegularAnnotationDisplayName(
	region: AnnotationRegion,
	linkedAudioClip: AudioAnnotationClip | undefined,
	labels: Pick<AnnotationTabTimelineLabels, "emptyText" | "image" | "arrow" | "untitledAudio">,
): string {
	if (linkedAudioClip?.audioUrl?.trim()) {
		return linkedAudioClip.fileName?.trim() || labels.untitledAudio;
	}
	if (region.type === "figure") {
		return labels.arrow;
	}
	if (region.type === "image") {
		return labels.image;
	}
	const text = region.textContent?.trim() || region.content?.trim();
	return text || labels.emptyText;
}

export function formatRegularAnnotationTimelineLabel(
	region: AnnotationRegion,
	linkedAudioClip: AudioAnnotationClip | undefined,
	labels: Pick<AnnotationTabTimelineLabels, "emptyText" | "image" | "arrow" | "untitledAudio">,
): string {
	const kind = resolveRegularAnnotationTabKind(region, linkedAudioClip);
	const icon = annotationTabKindIcon(kind);
	const name = truncateTimelineLabel(
		resolveRegularAnnotationDisplayName(region, linkedAudioClip, labels),
	);
	return `${icon} ${name}`;
}

export function deriveInspectorTabKind(params: {
	holdSegment?: HoldCollectionSegment;
	annotation?: AnnotationRegion;
	linkedAudioClip?: AudioAnnotationClip;
}): AnnotationTabKind {
	const { holdSegment, annotation, linkedAudioClip } = params;
	if (holdSegment) {
		return resolveHoldSegmentTabKind(holdSegment);
	}
	if (annotation) {
		return resolveRegularAnnotationTabKind(annotation, linkedAudioClip);
	}
	return "text";
}
