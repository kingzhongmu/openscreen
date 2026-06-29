import { describe, expect, it } from "vitest";
import type { HoldRegion } from "@/components/video-editor/types";
import { resolveAnnotationAnimationTimeMs } from "./holdPlayback";

const holds: HoldRegion[] = [
	{ id: "hold-1", sourceMs: 4618, holdDurationMs: 3000, linkedAnnotationId: "a1" },
];

describe("resolveAnnotationAnimationTimeMs", () => {
	it("matches source time before the hold segment", () => {
		expect(resolveAnnotationAnimationTimeMs(12, 4618, holds)).toBe(12);
		expect(resolveAnnotationAnimationTimeMs(4617, 4618, holds)).toBe(4617);
	});

	it("advances animation time during the hold segment", () => {
		expect(resolveAnnotationAnimationTimeMs(4618, 4618, holds)).toBe(4618);
		expect(resolveAnnotationAnimationTimeMs(5118, 4618, holds)).toBe(5118);
		expect(resolveAnnotationAnimationTimeMs(7617, 4618, holds)).toBe(7617);
	});

	it("continues from source time after the hold segment", () => {
		expect(resolveAnnotationAnimationTimeMs(7618, 4618, holds)).toBe(4618);
		expect(resolveAnnotationAnimationTimeMs(8618, 4618, holds)).toBe(5618);
	});

	it("returns output time unchanged when no holds exist", () => {
		expect(resolveAnnotationAnimationTimeMs(1500, 4618, [])).toBe(1500);
	});
});
