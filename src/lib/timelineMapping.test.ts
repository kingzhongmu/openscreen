import { describe, expect, it } from "vitest";
import type { HoldRegion } from "@/components/video-editor/types";
import {
	cumulativeHoldBefore,
	findHoldPlaybackAtOutput,
	getFreezeLinkedOutputSpan,
	getHoldOutputSpans,
	getMergedHoldOutputDurationMs,
	getMergedHoldOutputSpans,
	getOutputDurationMs,
	isFreezeLinkedRegionVisibleAtOutputTime,
	isOutputTimeInHold,
	isRegionVisibleAtOutputTime,
	mergeHoldRegions,
	outputSpanToFreezeLinkedSourceSpan,
	outputSpanToSourceSpan,
	outputToSourceMs,
	resolveContinuousSourceTimelineMs,
	sourceSpanToOutputSpan,
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

	it("maps source spans to output spans", () => {
		expect(sourceSpanToOutputSpan(5000, 8000, holds)).toEqual({ start: 5000, end: 11000 });
		expect(sourceSpanToOutputSpan(5000, 8000, [])).toEqual({ start: 5000, end: 8000 });
	});

	it("maps output spans back to source spans", () => {
		expect(outputSpanToSourceSpan(6500, 9000, holds)).toEqual({ start: 5000, end: 6000 });
	});

	it("checks region visibility at output time during hold", () => {
		expect(isRegionVisibleAtOutputTime(6500, 5000, 8000, holds)).toBe(true);
		expect(isRegionVisibleAtOutputTime(9500, 5000, 8000, holds)).toBe(true);
		expect(isRegionVisibleAtOutputTime(11000, 5000, 8000, holds)).toBe(false);
	});

	it("checks freeze-linked visibility only on hold insert span (no post-hold replay)", () => {
		const freezeHold: HoldRegion[] = [
			{ id: "hold-1", sourceMs: 2000, holdDurationMs: 3000, linkedAnnotationId: "a1" },
		];
		expect(isFreezeLinkedRegionVisibleAtOutputTime(2000, 2000, 5000, freezeHold)).toBe(true);
		expect(isFreezeLinkedRegionVisibleAtOutputTime(4999, 2000, 5000, freezeHold)).toBe(true);
		expect(isFreezeLinkedRegionVisibleAtOutputTime(5000, 2000, 5000, freezeHold)).toBe(false);
		expect(isFreezeLinkedRegionVisibleAtOutputTime(6500, 2000, 5000, freezeHold)).toBe(false);
		expect(isRegionVisibleAtOutputTime(6500, 2000, 5000, freezeHold)).toBe(true);
	});

	it("returns hold output spans for visualization", () => {
		expect(getHoldOutputSpans(holds)).toEqual([
			{ id: "hold-1", start: 5000, end: 8000, linkedAnnotationId: "a1" },
		]);
	});

	it("maps freeze-linked spans to output timeline using annotation span length", () => {
		const freezeAtAnchor: HoldRegion[] = [
			{ id: "hold-1", sourceMs: 700, holdDurationMs: 3600, linkedAnnotationId: "a1" },
		];
		expect(getFreezeLinkedOutputSpan(700, 4300, 3600, freezeAtAnchor)).toEqual({
			start: 700,
			end: 4300,
		});
		expect(sourceSpanToOutputSpan(700, 4300, freezeAtAnchor)).toEqual({
			start: 700,
			end: 7900,
		});
	});

	it("uses annotation span length on the freeze track (hold duration equals span)", () => {
		expect(getFreezeLinkedOutputSpan(700, 4300, 3600, holds)).toEqual({
			start: 700,
			end: 4300,
		});
	});

	it("converts freeze-linked output spans back to source without collapsing in hold", () => {
		expect(outputSpanToFreezeLinkedSourceSpan(700, 2500, holds, 100)).toEqual({
			start: 700,
			end: 2500,
		});
	});

	it("merges holds at the same source anchor instead of summing durations", () => {
		const duplicateAnchor: HoldRegion[] = [
			{ id: "hold-1", sourceMs: 700, holdDurationMs: 3600, linkedAnnotationId: "a1" },
			{ id: "hold-2", sourceMs: 700, holdDurationMs: 3600, linkedAnnotationId: "a2" },
		];
		expect(mergeHoldRegions(duplicateAnchor)).toEqual([
			{ id: "hold-1", sourceMs: 700, holdDurationMs: 3600, linkedAnnotationId: "a1" },
		]);
		expect(getMergedHoldOutputDurationMs(duplicateAnchor)).toBe(3600);
		expect(getOutputDurationMs(10_000, duplicateAnchor)).toBe(13_600);
	});

	it("stacks full hold durations on output for nearby source anchors", () => {
		const overlapping: HoldRegion[] = [
			{ id: "hold-1", sourceMs: 500, holdDurationMs: 5000, linkedAnnotationId: "a1" },
			{ id: "hold-2", sourceMs: 600, holdDurationMs: 3600, linkedAnnotationId: "a2" },
		];
		expect(getHoldOutputSpans(overlapping)).toEqual([
			{ id: "hold-1", start: 500, end: 5500, linkedAnnotationId: "a1" },
			{ id: "hold-2", start: 5600, end: 9200, linkedAnnotationId: "a2" },
		]);
		const merged = getMergedHoldOutputSpans(overlapping);
		expect(merged).toHaveLength(2);
		expect(getMergedHoldOutputDurationMs(overlapping)).toBe(8600);
	});

	it("sums full hold insert time for staggered source anchors", () => {
		const staggered: HoldRegion[] = [
			{ id: "hold-1", sourceMs: 700, holdDurationMs: 3600, linkedAnnotationId: "a1" },
			{ id: "hold-2", sourceMs: 800, holdDurationMs: 3600, linkedAnnotationId: "a2" },
		];
		expect(getMergedHoldOutputDurationMs(staggered)).toBe(7200);
		expect(getOutputDurationMs(10_000, staggered)).toBe(17_200);
	});

	it("maps consecutive holds with cumulative source-to-output offset", () => {
		const consecutive: HoldRegion[] = [
			{ id: "hold-1", sourceMs: 2000, holdDurationMs: 4000, linkedAnnotationId: "a1" },
			{ id: "hold-2", sourceMs: 6000, holdDurationMs: 3000, linkedAnnotationId: "a2" },
		];
		expect(getFreezeLinkedOutputSpan(2000, 6000, 4000, consecutive)).toEqual({
			start: 2000,
			end: 6000,
		});
		expect(getFreezeLinkedOutputSpan(6000, 9000, 3000, consecutive)).toEqual({
			start: 10_000,
			end: 13_000,
		});
		expect(sourceToOutputMs(6000, consecutive)).toBe(10_000);
	});

	it("keeps preview freeze for full linked hold duration when source spans overlap", () => {
		const holds: HoldRegion[] = [
			{ id: "hold-annotation-1", sourceMs: 2000, holdDurationMs: 4096, linkedAnnotationId: "a1" },
			{ id: "hold-annotation-2", sourceMs: 2000, holdDurationMs: 3093, linkedAnnotationId: "a2" },
			{ id: "hold-annotation-3", sourceMs: 2000, holdDurationMs: 5117, linkedAnnotationId: "a3" },
			{
				id: "hold-audio-annotation-1",
				sourceMs: 4050,
				holdDurationMs: 9447,
				linkedAnnotationId: "audio-1",
			},
		];
		const audioStart = sourceToOutputMs(4050, holds);
		expect(audioStart).toBe(9167);
		expect(getFreezeLinkedOutputSpan(4050, 4050 + 9447, 9447, holds)).toEqual({
			start: 9167,
			end: 18_614,
		});

		expect(isOutputTimeInHold(audioStart, holds)).toBe(true);
		expect(isOutputTimeInHold(audioStart + 4000, holds)).toBe(true);
		expect(isOutputTimeInHold(audioStart + 9446, holds)).toBe(true);
		expect(isOutputTimeInHold(audioStart + 9447, holds)).toBe(false);

		expect(findHoldPlaybackAtOutput(audioStart + 5000, holds)?.sourceMs).toBe(4050);
		expect(outputToSourceMs(audioStart + 5000, holds)).toBe(4050);

		expect(getOutputDurationMs(6900, holds)).toBeGreaterThanOrEqual(18_614);
	});

	it("stacks consecutive source-anchor holds (2s / 4s / 5s scenario)", () => {
		const threeHolds: HoldRegion[] = [
			{ id: "hold-2s", sourceMs: 2010, holdDurationMs: 4010, linkedAnnotationId: "a1" },
			{ id: "hold-4s", sourceMs: 4020, holdDurationMs: 4000, linkedAnnotationId: "a2" },
			{ id: "hold-5s", sourceMs: 5000, holdDurationMs: 7020, linkedAnnotationId: "a3" },
		];
		expect(getFreezeLinkedOutputSpan(2010, 2010 + 4010, 4010, threeHolds)).toEqual({
			start: 2010,
			end: 6020,
		});
		expect(getFreezeLinkedOutputSpan(4020, 4020 + 4000, 4000, threeHolds)).toEqual({
			start: 8030,
			end: 12_030,
		});
		expect(getFreezeLinkedOutputSpan(5000, 5000 + 7020, 7020, threeHolds)).toEqual({
			start: 13_010,
			end: 20_030,
		});
		expect(sourceToOutputMs(5000, threeHolds)).toBe(13_010);
		expect(findHoldPlaybackAtOutput(13_010, threeHolds)?.id).toBe("hold-5s");
		expect(outputToSourceMs(15_000, threeHolds)).toBe(5000);
	});

	it("keeps continuous source timeline during preview holds for bgm-style audio", () => {
		expect(resolveContinuousSourceTimelineMs(0, 0, holds)).toBe(0);
		expect(resolveContinuousSourceTimelineMs(4000, 4000, holds)).toBe(4000);
		expect(resolveContinuousSourceTimelineMs(6500, 5000, holds)).toBe(6500);
		expect(resolveContinuousSourceTimelineMs(7999, 5000, holds)).toBe(7999);
		expect(resolveContinuousSourceTimelineMs(9000, 6000, holds)).toBe(9000);
	});
});
