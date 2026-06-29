import { describe, expect, it } from "vitest";
import {
	computePositionAnnotationSpan,
	DEFAULT_POSITION_ANNOTATION_DURATION_MS,
} from "@/components/video-editor/positionAnnotation";

describe("computePositionAnnotationSpan", () => {
	it("anchors at playhead with default duration", () => {
		expect(
			computePositionAnnotationSpan(5000, DEFAULT_POSITION_ANNOTATION_DURATION_MS, 60_000),
		).toEqual({ start: 5000, end: 8000 });
	});

	it("clamps end to video duration", () => {
		expect(
			computePositionAnnotationSpan(58_000, DEFAULT_POSITION_ANNOTATION_DURATION_MS, 60_000),
		).toEqual({ start: 58_000, end: 60_000 });
	});

	it("returns zero span when timeline is empty", () => {
		expect(computePositionAnnotationSpan(1000, 3000, 0)).toEqual({ start: 0, end: 0 });
	});
});
