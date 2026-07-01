import { describe, expect, it } from "vitest";
import type { AnnotationRegion, HoldRegion } from "@/components/video-editor/types";
import {
	collectHoldCollectionSegmentAudioClips,
	collectionHoldDurationMs,
	createHoldCollection,
	DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS,
	duplicateHoldCollectionSegment,
	effectiveDurationMs,
	holdCollectionSegmentAudioRefId,
	holdCollectionSegmentToOutputSpan,
	holdRegionFromCollection,
	migrateFreezeAnnotationsToHoldCollections,
	removeHoldCollectionsByShellId,
	resolveHoldSegmentAudioClipPlayback,
	segmentOffsetMs,
	setHoldCollectionFirstSegmentDuration,
	setHoldCollectionShellDuration,
	shellAnnotationFromCollection,
	syncShellDurationFromSegments,
} from "@/lib/holdCollection";

describe("holdCollection", () => {
	it("creates a collection with a 6s default shell and first segment", () => {
		const collection = createHoldCollection(5000);
		expect(collection.sourceMs).toBe(5000);
		expect(collection.shellDurationMs).toBe(DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS);
		expect(collection.segments).toHaveLength(1);
		expect(collection.segments[0]?.offsetMs).toBe(0);
		expect(collection.segments[0]?.durationMs).toBe(DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS);
		expect(effectiveDurationMs(collection)).toBe(6000);
		expect(collectionHoldDurationMs(collection)).toBe(6000);
	});

	it("maps collection to hold region with linkedCollectionId", () => {
		const collection = createHoldCollection(2000);
		const hold = holdRegionFromCollection(collection);
		expect(hold.sourceMs).toBe(2000);
		expect(hold.holdDurationMs).toBe(6000);
		expect(hold.linkedCollectionId).toBe(collection.id);
	});

	it("uses explicit segment offsets and effective duration", () => {
		const collection = createHoldCollection(5000, { shellDurationMs: 6000 });
		collection.segments.push({
			id: "seg-2",
			offsetMs: 3000,
			durationMs: 4000,
			content: createHoldCollection(0).segments[0]!.content,
		});
		expect(segmentOffsetMs(collection, 1)).toBe(3000);
		expect(effectiveDurationMs(collection)).toBe(7000);

		const holds: HoldRegion[] = [holdRegionFromCollection(collection)];
		expect(holdCollectionSegmentToOutputSpan(collection, 0, holds)).toEqual({
			start: 5000,
			end: 11000,
		});
		expect(holdCollectionSegmentToOutputSpan(collection, 1, holds)).toEqual({
			start: 8000,
			end: 12000,
		});
	});

	it("extends shell when a segment spans past shell duration", () => {
		const collection = createHoldCollection(1000, { shellDurationMs: 6000 });
		const updated = syncShellDurationFromSegments({
			...collection,
			segments: [
				{
					...collection.segments[0]!,
					offsetMs: 5000,
					durationMs: 3000,
				},
			],
		});
		expect(updated.shellDurationMs).toBe(8000);
	});

	it("shell resize does not change segment offsets or durations", () => {
		const collection = createHoldCollection(1000, { shellDurationMs: 6000 });
		collection.segments.push({
			id: "seg-2",
			offsetMs: 2000,
			durationMs: 3000,
			content: collection.segments[0]!.content,
		});
		const resized = setHoldCollectionShellDuration(collection, 9000);
		expect(resized.shellDurationMs).toBe(9000);
		expect(resized.segments[0]?.offsetMs).toBe(0);
		expect(resized.segments[0]?.durationMs).toBe(6000);
		expect(resized.segments[1]?.offsetMs).toBe(2000);
		expect(resized.segments[1]?.durationMs).toBe(3000);
	});

	it("migrates a legacy freeze annotation into a single-segment collection", () => {
		const region: AnnotationRegion = {
			id: "ann-1",
			startMs: 5000,
			endMs: 8000,
			type: "text",
			content: "Hello",
			textContent: "Hello",
			position: { x: 50, y: 50 },
			size: { width: 30, height: 20 },
			style: {
				color: "#fff",
				backgroundColor: "transparent",
				fontSize: 32,
				fontFamily: "Inter",
				fontWeight: "bold",
				fontStyle: "normal",
				textDecoration: "none",
				textAlign: "center",
			},
			zIndex: 0,
			freezeDuringAnnotation: true,
		};
		const { holdCollections, annotationRegions } = migrateFreezeAnnotationsToHoldCollections(
			[region],
			[],
		);
		expect(holdCollections).toHaveLength(1);
		expect(holdCollections[0]?.shellAnnotationId).toBe("ann-1");
		expect(holdCollections[0]?.shellDurationMs).toBe(3000);
		expect(holdCollections[0]?.segments[0]?.durationMs).toBe(3000);
		expect(holdCollections[0]?.segments[0]?.offsetMs).toBe(0);
		const shell = annotationRegions.find((entry) => entry.id === "ann-1");
		expect(shell?.freezeDuringAnnotation).toBe(true);
		expect(shell!.endMs - shell!.startMs).toBe(3000);
		expect(shellAnnotationFromCollection(holdCollections[0]!).endMs).toBe(8000);
	});

	it("does not duplicate audio clip id on annotation shells when migrating audio freeze", () => {
		const clip = {
			id: "audio-annotation-1",
			anchorMs: 5000,
			durationMs: 3000,
			source: "import" as const,
			audioUrl: "blob:test",
			freezeDuringAnnotation: true as const,
		};
		const { holdCollections, annotationRegions } = migrateFreezeAnnotationsToHoldCollections(
			[],
			[clip],
		);
		expect(holdCollections).toHaveLength(1);
		expect(annotationRegions.some((region) => region.id === "audio-annotation-1")).toBe(false);
	});

	it("removes hold collection by shell annotation id", () => {
		const collection = createHoldCollection(1000);
		collection.shellAnnotationId = "annotation-1";
		const next = removeHoldCollectionsByShellId([collection], "annotation-1");
		expect(next).toHaveLength(0);
	});

	it("updates first segment duration and syncs shell when needed", () => {
		const collection = createHoldCollection(1000);
		const updated = setHoldCollectionFirstSegmentDuration(collection, 8000);
		expect(updated.segments[0]?.durationMs).toBe(8000);
		expect(updated.shellDurationMs).toBe(8000);
	});

	it("collects hold segment audio clips for preview playback", () => {
		const collection = createHoldCollection(5000, { shellDurationMs: 10000 });
		collection.segments.push({
			id: "seg-2",
			offsetMs: 3500,
			durationMs: 3000,
			content: collection.segments[0]!.content,
			audio: {
				audioUrl: "blob:audio-test",
				fileName: "narration.mp3",
				sourceDurationMs: 2800,
				volume: 0.8,
			},
		});
		const clips = collectHoldCollectionSegmentAudioClips([collection]);
		expect(clips).toHaveLength(1);
		expect(clips[0]?.id).toBe(holdCollectionSegmentAudioRefId("seg-2"));
		expect(clips[0]?.anchorMs).toBe(8500);
		expect(clips[0]?.durationMs).toBe(3000);
		expect(clips[0]?.volume).toBe(0.8);
	});

	it("maps hold segment audio to output timeline when offset > 0", () => {
		const collection = createHoldCollection(5000, { shellDurationMs: 10000 });
		collection.segments.push({
			id: "seg-2",
			offsetMs: 3500,
			durationMs: 3000,
			content: collection.segments[0]!.content,
			audio: {
				audioUrl: "blob:audio-test",
				fileName: "narration.mp3",
				sourceDurationMs: 2800,
			},
		});
		const holds: HoldRegion[] = [holdRegionFromCollection(collection)];
		const clip = collectHoldCollectionSegmentAudioClips([collection])[0]!;
		const preview = resolveHoldSegmentAudioClipPlayback(clip, [collection], holds, "preview");
		expect(preview).toEqual({ anchorMs: 8500, durationMs: 3000 });
		const source = resolveHoldSegmentAudioClipPlayback(clip, [collection], holds, "source");
		expect(source).toEqual({ anchorMs: 8500, durationMs: 3000 });
	});

	it("duplicates a hold collection segment after the source segment", () => {
		const collection = createHoldCollection(1000, { shellDurationMs: 6000 });
		collection.segments.push({
			id: "seg-2",
			offsetMs: 2000,
			durationMs: 3000,
			content: collection.segments[0]!.content,
			audio: {
				audioUrl: "blob:dup-audio",
				fileName: "voice.mp3",
				sourceDurationMs: 2500,
				volume: 0.6,
			},
		});
		const duplicated = duplicateHoldCollectionSegment(collection, "seg-2");
		expect(duplicated.segments).toHaveLength(3);
		expect(duplicated.segments[1]?.id).toBe("seg-2");
		const copy = duplicated.segments[2]!;
		expect(copy.id).not.toBe("seg-2");
		expect(copy.offsetMs).toBe(5000);
		expect(copy.durationMs).toBe(3000);
		expect(copy.audio?.audioUrl).toBe("blob:dup-audio");

		const singleSegment = createHoldCollection(1000, { shellDurationMs: 6000 });
		expect(
			duplicateHoldCollectionSegment(singleSegment, singleSegment.segments[0]!.id).segments,
		).toHaveLength(2);
	});
});
