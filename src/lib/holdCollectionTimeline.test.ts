import { describe, expect, it } from "vitest";
import { createHoldCollection, holdRegionFromCollection } from "@/lib/holdCollection";
import {
	buildHoldCollectionSegmentTimelineItems,
	holdSegmentTimelineId,
	parseHoldSegmentTimelineId,
	setHoldCollectionSegmentDuration,
} from "@/lib/holdCollectionTimeline";

describe("holdCollectionTimeline", () => {
	it("round-trips hold segment timeline ids", () => {
		const id = holdSegmentTimelineId("col-1", "seg-1");
		expect(parseHoldSegmentTimelineId(id)).toEqual({
			collectionId: "col-1",
			segmentId: "seg-1",
		});
	});

	it("builds serial segment items on the output axis", () => {
		const collection = createHoldCollection(5000, { firstSegmentDurationMs: 7000 });
		const second = collection.segments[0]!;
		collection.segments.push({
			...second,
			id: "seg-2",
			durationMs: 3000,
			content: { ...second.content, type: "figure" },
		});
		const holds = [holdRegionFromCollection(collection)];
		const items = buildHoldCollectionSegmentTimelineItems(
			collection,
			holds,
			(content) => content.type,
		);
		expect(items).toHaveLength(2);
		expect(items[0]?.outputStartMs).toBe(5000);
		expect(items[0]?.outputEndMs).toBe(12000);
		expect(items[1]?.outputStartMs).toBe(12000);
		expect(items[1]?.outputEndMs).toBe(15000);
		expect(items[1]?.collectionOffsetStartMs).toBe(7000);
	});

	it("updates one segment duration without shifting others", () => {
		const collection = createHoldCollection(1000, { firstSegmentDurationMs: 3000 });
		const segId = collection.segments[0]!.id;
		const updated = setHoldCollectionSegmentDuration(collection, segId, 5000);
		expect(updated.segments[0]?.durationMs).toBe(5000);
	});
});
