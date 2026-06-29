import { describe, expect, it } from "vitest";
import type { HoldRegion } from "@/components/video-editor/types";
import {
	cumulativeHoldBefore,
	getOutputDurationMs,
	outputToSourceMs,
	sourceToOutputMs,
} from "@/lib/timelineMapping";

const holds: HoldRegion[] = [
	{ id: "hold-1", sourceMs: 5000, holdDurationMs: 3000, linkedAnnotationId: "a1" },
];

describe("timelineMapping", () => {
	it("maps source to output with cumulative hold time", () => {
		expect(sourceToOutputMs(0, holds)).toBe(0);
		expect(sourceToOutputMs(5000, holds)).toBe(5000);
		expect(sourceToOutputMs(6000, holds)).toBe(9000);
	});

	it("maps output back to source inside and outside hold segments", () => {
		expect(outputToSourceMs(28, holds)).toBe(28);
		expect(outputToSourceMs(4999, holds)).toBe(4999);
		expect(outputToSourceMs(6500, holds)).toBe(5000);
		expect(outputToSourceMs(8000, holds)).toBe(5000);
		expect(outputToSourceMs(9000, holds)).toBe(6000);
	});

	it("maps early output time before the first hold without subtracting hold duration", () => {
		const earlyHold: HoldRegion[] = [
			{ id: "hold-1", sourceMs: 4618, holdDurationMs: 13301, linkedAnnotationId: "a1" },
		];
		expect(outputToSourceMs(0, earlyHold)).toBe(0);
		expect(outputToSourceMs(12, earlyHold)).toBe(12);
		expect(outputToSourceMs(4617, earlyHold)).toBe(4617);
		expect(outputToSourceMs(4618, earlyHold)).toBe(4618);
		expect(outputToSourceMs(6500, earlyHold)).toBe(4618);
	});

	it("extends output duration by total hold time", () => {
		expect(getOutputDurationMs(10_000, holds)).toBe(13_000);
	});

	it("sums hold time strictly before a source timestamp", () => {
		expect(cumulativeHoldBefore(5000, holds)).toBe(0);
		expect(cumulativeHoldBefore(5001, holds)).toBe(3000);
	});
});
