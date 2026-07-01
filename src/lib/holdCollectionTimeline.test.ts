import { describe, expect, it } from "vitest";
import { createHoldCollection, holdRegionFromCollection } from "@/lib/holdCollection";
import {
	buildHoldCollectionSegmentTimelineItems,
	holdCollectionSegmentSubLabel,
	holdSegmentTimelineId,
	parseHoldSegmentTimelineId,
	setHoldCollectionSegmentDuration,
	setHoldCollectionSegmentOffset,
	setHoldCollectionSegmentTiming,
} from "@/lib/holdCollectionTimeline";

describe("holdCollectionTimeline", () => {
	it("round-trips hold segment timeline ids", () => {
		const id = holdSegmentTimelineId("col-1", "seg-1");
		expect(parseHoldSegmentTimelineId(id)).toEqual({
			collectionId: "col-1",
			segmentId: "seg-1",
		});
	});

	it("builds segment items with explicit offsets on the output axis", () => {
		const collection = createHoldCollection(5000, { shellDurationMs: 6000 });
		const second = collection.segments[0]!;
		collection.segments.push({
			...second,
			id: "seg-2",
			offsetMs: 3000,
			durationMs: 3000,
			content: { ...second.content, type: "figure" },
		});
		const holds = [holdRegionFromCollection(collection)];
		const items = buildHoldCollectionSegmentTimelineItems(
			collection,
			holds,
			(segment) => segment.content.type,
		);
		expect(items).toHaveLength(2);
		expect(items[0]?.timelineStartMs).toBe(5000);
		expect(items[0]?.timelineEndMs).toBe(11000);
		expect(items[1]?.timelineStartMs).toBe(8000);
		expect(items[1]?.timelineEndMs).toBe(11000);
		expect(items[1]?.collectionOffsetStartMs).toBe(3000);
	});

	it("formats segment sub-labels for source vs preview axes", () => {
		expect(holdCollectionSegmentSubLabel(0, 3500, "source", 3520, 7020)).toBe("+0.00s – +3.50s");
		expect(holdCollectionSegmentSubLabel(0, 3500, "preview", 3520, 7020)).toBe("3.52s – 7.02s");
	});

	it("updates one segment duration without shifting others", () => {
		const collection = createHoldCollection(1000, { shellDurationMs: 6000 });
		const segId = collection.segments[0]!.id;
		const updated = setHoldCollectionSegmentDuration(collection, segId, 5000);
		expect(updated.segments[0]?.durationMs).toBe(5000);
		expect(updated.shellDurationMs).toBe(6000);
	});

	it("updates segment offset independently", () => {
		const collection = createHoldCollection(1000, { shellDurationMs: 6000 });
		const segId = collection.segments[0]!.id;
		const updated = setHoldCollectionSegmentOffset(collection, segId, 1500);
		expect(updated.segments[0]?.offsetMs).toBe(1500);
	});

	it("syncs shell when timing extends past shell", () => {
		const collection = createHoldCollection(1000, { shellDurationMs: 6000 });
		const segId = collection.segments[0]!.id;
		const updated = setHoldCollectionSegmentTiming(collection, segId, {
			offsetMs: 5000,
			durationMs: 3000,
		});
		expect(updated.shellDurationMs).toBe(8000);
	});
});
