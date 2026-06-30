import { describe, expect, it } from "vitest";
import {
	assignExpandedLaneLayout,
	assignOverlapLanes,
	detectOverlapClusters,
	getPlayheadExpandCluster,
	groupItemsByLaneRow,
	hasAnyOverlap,
	hasPlayheadOverlap,
	intervalsOverlap,
} from "./overlapClusters";

describe("intervalsOverlap", () => {
	it("detects partial overlap", () => {
		expect(intervalsOverlap({ startMs: 0, endMs: 3000 }, { startMs: 2000, endMs: 5000 })).toBe(
			true,
		);
	});

	it("treats touching endpoints as non-overlapping", () => {
		expect(intervalsOverlap({ startMs: 0, endMs: 2000 }, { startMs: 2000, endMs: 4000 })).toBe(
			false,
		);
	});
});

describe("detectOverlapClusters", () => {
	it("groups transitively overlapping items", () => {
		const clusters = detectOverlapClusters([
			{ id: "a", startMs: 0, endMs: 3000 },
			{ id: "b", startMs: 2000, endMs: 5000 },
			{ id: "c", startMs: 4500, endMs: 7000 },
			{ id: "d", startMs: 8000, endMs: 9000 },
		]);
		const multi = clusters.filter((c) => c.memberIds.length > 1);
		expect(multi).toHaveLength(1);
		expect(multi[0].memberIds.sort()).toEqual(["a", "b", "c"]);
	});

	it("keeps separate clusters when intervals do not connect", () => {
		const clusters = detectOverlapClusters([
			{ id: "a", startMs: 0, endMs: 2000 },
			{ id: "b", startMs: 1000, endMs: 3000 },
			{ id: "c", startMs: 5000, endMs: 7000 },
			{ id: "d", startMs: 6000, endMs: 8000 },
		]);
		expect(clusters.filter((c) => c.memberIds.length > 1)).toHaveLength(2);
	});
});

describe("assignOverlapLanes", () => {
	it("reuses lanes for non-overlapping items", () => {
		const lanes = assignOverlapLanes([
			{ id: "a", startMs: 0, endMs: 2000 },
			{ id: "b", startMs: 2000, endMs: 4000 },
			{ id: "c", startMs: 4000, endMs: 6000 },
		]);
		expect(lanes.get("a")).toBe(0);
		expect(lanes.get("b")).toBe(0);
		expect(lanes.get("c")).toBe(0);
	});

	it("assigns separate lanes for overlapping items", () => {
		const lanes = assignOverlapLanes([
			{ id: "a", startMs: 2000, endMs: 5000 },
			{ id: "b", startMs: 2000, endMs: 8000 },
			{ id: "c", startMs: 3000, endMs: 6000 },
		]);
		expect(new Set(lanes.values()).size).toBe(3);
	});
});

describe("assignExpandedLaneLayout", () => {
	it("assigns one lane per item sharing a source anchor", () => {
		const items = [
			{ id: "a", startMs: 2000, endMs: 5000 },
			{ id: "b", startMs: 8100, endMs: 11100 },
		];
		const sourceAnchorById = new Map([
			["a", 2000],
			["b", 2000],
		]);
		const lanes = assignExpandedLaneLayout(items, { sourceAnchorById, anchorSnapThresholdMs: 150 });
		expect(lanes.get("a")).toBe(0);
		expect(lanes.get("b")).toBe(1);
	});
});

describe("getPlayheadExpandCluster", () => {
	it("returns null when only one item at playhead", () => {
		const items = [
			{ id: "a", startMs: 0, endMs: 5000 },
			{ id: "b", startMs: 6000, endMs: 9000 },
		];
		expect(getPlayheadExpandCluster(items, 2500, "row-test")).toBeNull();
	});

	it("returns cluster for overlapping items at playhead", () => {
		const items = [
			{ id: "a", startMs: 0, endMs: 5000 },
			{ id: "b", startMs: 2000, endMs: 7000 },
			{ id: "c", startMs: 8000, endMs: 10000 },
		];
		const cluster = getPlayheadExpandCluster(items, 3000, "row-test");
		expect(cluster?.memberIds.sort()).toEqual(["a", "b"]);
	});
});

describe("groupItemsByLaneRow", () => {
	const baseRowId = "row-annotation";

	it("returns a single row when collapsed", () => {
		const items = [{ id: "a" }, { id: "b" }];
		const spans = new Map([
			["a", { startMs: 0, endMs: 3000 }],
			["b", { startMs: 1000, endMs: 4000 }],
		]);
		const groups = groupItemsByLaneRow(items, baseRowId, spans, 2000, null);
		expect(groups).toHaveLength(1);
		expect(groups[0].rowId).toBe(baseRowId);
		expect(groups[0].items).toHaveLength(2);
	});

	it("splits only playhead cluster when expanded", () => {
		const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const spans = new Map([
			["a", { startMs: 0, endMs: 3000 }],
			["b", { startMs: 1000, endMs: 4000 }],
			["c", { startMs: 8000, endMs: 10000 }],
		]);
		const cluster = getPlayheadExpandCluster(
			[...spans.entries()].map(([id, span]) => ({ id, ...span })),
			2000,
			baseRowId,
		);
		expect(cluster).not.toBeNull();

		const groups = groupItemsByLaneRow(items, baseRowId, spans, 2000, cluster!.id);
		expect(groups.length).toBeGreaterThan(1);
		expect(groups[0].items).toEqual([{ id: "c" }]);
		expect(hasAnyOverlap([...spans.entries()].map(([id, s]) => ({ id, ...s })))).toBe(true);
	});

	it("does not expand items away from playhead", () => {
		const items = [{ id: "a" }, { id: "b" }];
		const spans = new Map([
			["a", { startMs: 0, endMs: 3000 }],
			["b", { startMs: 1000, endMs: 4000 }],
		]);
		const cluster = getPlayheadExpandCluster(
			[...spans.entries()].map(([id, span]) => ({ id, ...span })),
			2000,
			baseRowId,
		);
		const groups = groupItemsByLaneRow(items, baseRowId, spans, 9000, cluster!.id);
		expect(groups).toHaveLength(1);
		expect(groups[0].items).toHaveLength(2);
	});
});

describe("hasPlayheadOverlap", () => {
	it("is true only at overlapping playhead", () => {
		const items = [
			{ id: "a", startMs: 0, endMs: 5000 },
			{ id: "b", startMs: 2000, endMs: 7000 },
		];
		expect(hasPlayheadOverlap(items, 3000)).toBe(true);
		expect(hasPlayheadOverlap(items, 7500)).toBe(false);
	});
});
