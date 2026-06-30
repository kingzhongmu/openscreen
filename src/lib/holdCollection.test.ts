import { describe, expect, it } from "vitest";
import type { AnnotationRegion, HoldRegion } from "@/components/video-editor/types";
import {
	collectionHoldDurationMs,
	createHoldCollection,
	DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS,
	holdCollectionSegmentToOutputSpan,
	holdRegionFromCollection,
	migrateFreezeAnnotationsToHoldCollections,
	removeHoldCollectionsByShellId,
	segmentOffsetMs,
	setHoldCollectionFirstSegmentDuration,
	shellAnnotationFromCollection,
} from "@/lib/holdCollection";

describe("holdCollection", () => {
	it("creates a collection with a 10s default first segment", () => {
		const collection = createHoldCollection(5000);
		expect(collection.sourceMs).toBe(5000);
		expect(collection.segments).toHaveLength(1);
		expect(collection.segments[0]?.durationMs).toBe(DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS);
		expect(collectionHoldDurationMs(collection)).toBe(10_000);
	});

	it("maps collection to hold region with linkedCollectionId", () => {
		const collection = createHoldCollection(2000);
		const hold = holdRegionFromCollection(collection);
		expect(hold.sourceMs).toBe(2000);
		expect(hold.holdDurationMs).toBe(10_000);
		expect(hold.linkedCollectionId).toBe(collection.id);
	});

	it("computes serial segment offsets and output spans", () => {
		const collection = createHoldCollection(5000, { firstSegmentDurationMs: 7000 });
		collection.segments.push({
			id: "seg-2",
			durationMs: 3000,
			content: createHoldCollection(0).segments[0]!.content,
		});
		expect(segmentOffsetMs(collection, 1)).toBe(7000);
		expect(collectionHoldDurationMs(collection)).toBe(10_000);

		const holds: HoldRegion[] = [holdRegionFromCollection(collection)];
		expect(holdCollectionSegmentToOutputSpan(collection, 0, holds)).toEqual({
			start: 5000,
			end: 12_000,
		});
		expect(holdCollectionSegmentToOutputSpan(collection, 1, holds)).toEqual({
			start: 12_000,
			end: 15_000,
		});
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
		expect(holdCollections[0]?.segments[0]?.durationMs).toBe(3000);
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

	it("updates first segment duration for hold collection", () => {
		const collection = createHoldCollection(1000);
		const updated = setHoldCollectionFirstSegmentDuration(collection, 5000);
		expect(updated.segments[0]?.durationMs).toBe(5000);
		expect(collectionHoldDurationMs(updated)).toBe(5000);
	});
});
