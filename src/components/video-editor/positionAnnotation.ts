import {
	getAnnotationFigureDataPreset,
	getAnnotationTextStylePreset,
} from "@/lib/annotationPreferences";
import {
	type AnnotationRegion,
	type AnnotationType,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_BLUR_DATA,
} from "./types";

/** Default visible duration for a position annotation (Phase 1). */
export const DEFAULT_POSITION_ANNOTATION_DURATION_MS = 3000;

export const MIN_POSITION_ANNOTATION_DURATION_MS = 500;
export const MAX_POSITION_ANNOTATION_DURATION_MS = 30000;

export interface PositionAnnotationSpan {
	start: number;
	end: number;
}

export function computePositionAnnotationSpan(
	anchorMs: number,
	durationMs: number,
	totalMs: number,
): PositionAnnotationSpan {
	if (totalMs <= 0) {
		return { start: 0, end: 0 };
	}

	const clampedDuration = Math.max(
		MIN_POSITION_ANNOTATION_DURATION_MS,
		Math.min(durationMs, MAX_POSITION_ANNOTATION_DURATION_MS),
	);
	const start = Math.max(0, Math.min(Math.round(anchorMs), totalMs));
	const end = Math.min(start + clampedDuration, totalMs);
	return { start, end: Math.max(end, start + 1) };
}

export function buildPositionAnnotationRegion(
	type: AnnotationType,
	span: PositionAnnotationSpan,
	id: string,
	zIndex: number,
): AnnotationRegion {
	const base: AnnotationRegion = {
		id,
		startMs: Math.round(span.start),
		endMs: Math.round(span.end),
		type,
		content: "",
		position: { ...DEFAULT_ANNOTATION_POSITION },
		size: { ...DEFAULT_ANNOTATION_SIZE },
		style: { ...getAnnotationTextStylePreset() },
		zIndex,
	};

	switch (type) {
		case "text":
			return {
				...base,
				content: "Enter text...",
				textContent: "Enter text...",
			};
		case "image":
			return {
				...base,
				content: "",
				imageContent: "",
			};
		case "figure":
			return {
				...base,
				figureData: { ...getAnnotationFigureDataPreset() },
			};
		case "blur":
			return {
				...base,
				blurData: { ...DEFAULT_BLUR_DATA },
			};
		default:
			return base;
	}
}

export function formatAnnotationClockMs(ms: number): string {
	const safe = Math.max(0, Math.round(ms));
	const mins = Math.floor(safe / 60000);
	const secs = Math.floor((safe % 60000) / 1000);
	const tenths = Math.floor((safe % 1000) / 100);
	if (mins > 0) {
		return `${mins}:${secs.toString().padStart(2, "0")}.${tenths}`;
	}
	return `${secs}.${tenths}s`;
}
