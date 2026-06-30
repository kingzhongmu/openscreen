import { describe, expect, it } from "vitest";
import type { AnnotationRegion, AudioAnnotationClip } from "@/components/video-editor/types";
import { createHoldCollection } from "@/lib/holdCollection";
import {
	alignAllFreezeAnchors,
	resolveNearEndFreezeAnchorMs,
	snapMsToFreezeAnchors,
	syncHoldRegionsFromEditor,
} from "@/lib/holdRegions";
import { getFreezeLinkedOutputSpan } from "@/lib/timelineMapping";

const textFreeze: AnnotationRegion = {
	id: "annotation-1",
	startMs: 2000,
	endMs: 5000,
	type: "text",
	content: "二个",
	position: { x: 50, y: 50 },
	size: { width: 20, height: 10 },
	freezeDuringAnnotation: true,
};

const audioClip: AudioAnnotationClip = {
	id: "audio-annotation-1",
	anchorMs: 5100,
	durationMs: 13_600,
	source: "import",
	audioUrl: "file:///tmp/audio.mp3",
	freezeDuringAnnotation: true,
};

describe("holdRegions", () => {
	it("does not align audio anchors placed inside a text freeze span", () => {
		const { audioClips } = alignAllFreezeAnchors([textFreeze], [{ ...audioClip, anchorMs: 3500 }]);
		expect(audioClips[0]?.anchorMs).toBe(3500);
	});

	it("nudges anchors just past text freeze end to the shared start", () => {
		expect(resolveNearEndFreezeAnchorMs(5100, [textFreeze])).toBe(2000);
		expect(resolveNearEndFreezeAnchorMs(6000, [textFreeze])).toBe(6000);
	});

	it("snaps near-miss freeze anchors to a sibling start", () => {
		expect(snapMsToFreezeAnchors(2040, [2000])).toBe(2000);
		expect(snapMsToFreezeAnchors(2149, [2000])).toBe(2000);
		expect(snapMsToFreezeAnchors(2160, [2000])).toBe(2160);
	});

	it("alignAllFreezeAnchors snaps drifted audio anchor to text freeze start", () => {
		const { audioClips } = alignAllFreezeAnchors([textFreeze], [{ ...audioClip, anchorMs: 2040 }]);
		expect(audioClips[0]?.anchorMs).toBe(2000);
	});

	it("maps concurrent freeze items from the same snapped anchor", () => {
		const { audioClips: alignedClips } = alignAllFreezeAnchors(
			[textFreeze],
			[{ ...audioClip, anchorMs: 2040 }],
		);
		const holdRegions = syncHoldRegionsFromEditor([textFreeze], alignedClips, []);

		expect(alignedClips[0]?.anchorMs).toBe(2000);
		expect(getFreezeLinkedOutputSpan(2000, 5000, 3000, holdRegions)).toEqual({
			start: 2000,
			end: 5000,
		});
		expect(getFreezeLinkedOutputSpan(2000, 15_600, 13_600, holdRegions)).toEqual({
			start: 2000,
			end: 15_600,
		});
	});

	it("keeps hold regions when freeze is backed by a hold collection shell", () => {
		const collection = createHoldCollection(2324, { firstSegmentDurationMs: 3000 });
		collection.id = "collection-1";
		collection.shellAnnotationId = "annotation-1";
		const shell: AnnotationRegion = {
			...textFreeze,
			id: "annotation-1",
			startMs: 2324,
			endMs: 5324,
		};
		const holdRegions = syncHoldRegionsFromEditor([shell], [], [], [collection]);

		expect(holdRegions).toHaveLength(1);
		expect(holdRegions[0]?.sourceMs).toBe(2324);
		expect(holdRegions[0]?.holdDurationMs).toBe(3000);
		expect(holdRegions[0]?.linkedCollectionId).toBe("collection-1");
	});
});
