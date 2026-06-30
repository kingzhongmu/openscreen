/** Timeline item span for overlap detection and lane assignment. */
export interface TimelineSpanItem {
	id: string;
	startMs: number;
	endMs: number;
}

export interface OverlapCluster {
	/** Stable id derived from sorted member ids. */
	id: string;
	memberIds: string[];
}

/** True when [start, end) intervals intersect (touching endpoints do not overlap). */
export function intervalsOverlap(
	a: Pick<TimelineSpanItem, "startMs" | "endMs">,
	b: Pick<TimelineSpanItem, "startMs" | "endMs">,
): boolean {
	return a.startMs < b.endMs && b.startMs < a.endMs;
}

export function sortSpanItems(items: TimelineSpanItem[]): TimelineSpanItem[] {
	return [...items].sort(
		(a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id),
	);
}

export function clusterIdFromMemberIds(memberIds: string[]): string {
	return [...memberIds].sort().join("|");
}

/**
 * Group items into connected components where edges = time overlap.
 * Singletons are included as clusters of size 1.
 */
export function detectOverlapClusters(items: TimelineSpanItem[]): OverlapCluster[] {
	if (items.length === 0) {
		return [];
	}

	const sorted = sortSpanItems(items);
	const parent = new Map<string, string>();

	function find(id: string): string {
		let root = id;
		while (parent.get(root) !== root) {
			root = parent.get(root)!;
		}
		let node = id;
		while (node !== root) {
			const next = parent.get(node)!;
			parent.set(node, root);
			node = next;
		}
		return root;
	}

	function union(a: string, b: string): void {
		const rootA = find(a);
		const rootB = find(b);
		if (rootA !== rootB) {
			parent.set(rootB, rootA);
		}
	}

	for (const item of sorted) {
		parent.set(item.id, item.id);
	}

	for (let i = 0; i < sorted.length; i++) {
		for (let j = i + 1; j < sorted.length; j++) {
			if (sorted[j].startMs >= sorted[i].endMs) {
				break;
			}
			if (intervalsOverlap(sorted[i], sorted[j])) {
				union(sorted[i].id, sorted[j].id);
			}
		}
	}

	const groups = new Map<string, string[]>();
	for (const item of sorted) {
		const root = find(item.id);
		const list = groups.get(root);
		if (list) {
			list.push(item.id);
		} else {
			groups.set(root, [item.id]);
		}
	}

	return [...groups.values()].map((memberIds) => ({
		id: clusterIdFromMemberIds(memberIds),
		memberIds,
	}));
}

export function hasAnyOverlap(items: TimelineSpanItem[]): boolean {
	return detectOverlapClusters(items).some((cluster) => cluster.memberIds.length > 1);
}

export interface LaneRowLayoutOptions {
	/** Source-time anchor per item (hold track: same anchor ⇒ expandable). */
	sourceAnchorById?: Map<string, number>;
	anchorSnapThresholdMs?: number;
}

/** Whether a track has 2+ overlapping items at the playhead. */
export function hasPlayheadOverlap(
	items: TimelineSpanItem[],
	playheadMs: number,
	layoutOptions?: LaneRowLayoutOptions,
): boolean {
	return getPlayheadExpandCluster(items, playheadMs, "", layoutOptions) !== null;
}

export function getItemsAtPlayhead(
	items: TimelineSpanItem[],
	playheadMs: number,
): TimelineSpanItem[] {
	return items.filter((item) => playheadMs >= item.startMs && playheadMs <= item.endMs);
}

function extendMemberIdsWithSameSourceAnchors(
	spanItems: TimelineSpanItem[],
	memberIds: string[],
	sourceAnchorById: Map<string, number>,
	thresholdMs: number,
): string[] {
	const anchorValues = memberIds.map(
		(id) => sourceAnchorById.get(id) ?? spanItems.find((item) => item.id === id)?.startMs ?? 0,
	);
	const extended = new Set(memberIds);
	for (const item of spanItems) {
		const anchor = sourceAnchorById.get(item.id) ?? item.startMs;
		if (anchorValues.some((value) => Math.abs(value - anchor) <= thresholdMs)) {
			extended.add(item.id);
		}
	}
	return [...extended].sort();
}

/**
 * Overlap cluster at the playhead: the full time-overlap connected component
 * that contains any item under playheadMs (not only items whose span contains
 * the playhead). Same source-anchor siblings on the hold track are added after.
 * Returns null when fewer than 2 members.
 */
export function getPlayheadExpandCluster(
	spanItems: TimelineSpanItem[],
	playheadMs: number,
	trackKey: string,
	layoutOptions?: LaneRowLayoutOptions,
): { id: string; memberIds: string[] } | null {
	const atPlayhead = getItemsAtPlayhead(spanItems, playheadMs);
	if (atPlayhead.length === 0) {
		return null;
	}

	const playheadIds = new Set(atPlayhead.map((item) => item.id));
	const overlapCluster = detectOverlapClusters(spanItems).find(
		(cluster) =>
			cluster.memberIds.length >= 2 && cluster.memberIds.some((id) => playheadIds.has(id)),
	);

	let memberIds = overlapCluster
		? [...overlapCluster.memberIds]
		: atPlayhead.map((item) => item.id);

	if (layoutOptions?.sourceAnchorById) {
		memberIds = extendMemberIdsWithSameSourceAnchors(
			spanItems,
			memberIds,
			layoutOptions.sourceAnchorById,
			layoutOptions.anchorSnapThresholdMs ?? 150,
		);
	}

	if (memberIds.length < 2) {
		return null;
	}

	return {
		id: `${trackKey}:${clusterIdFromMemberIds(memberIds)}`,
		memberIds,
	};
}

/**
 * Greedy lane assignment: overlapping items get different lanes; non-overlapping
 * items reuse lanes. Returns lane index per id (0-based).
 */
export function assignOverlapLanes(items: TimelineSpanItem[]): Map<string, number> {
	const sorted = sortSpanItems(items);
	const laneEnds: number[] = [];
	const lanes = new Map<string, number>();

	for (const item of sorted) {
		let lane = laneEnds.findIndex((endMs) => endMs <= item.startMs);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(item.endMs);
		} else {
			laneEnds[lane] = item.endMs;
		}
		lanes.set(item.id, lane);
	}

	return lanes;
}

/**
 * Lane layout when expanded: one physical row per cluster member (sorted by start → id).
 * Avoids sharing a sub-lane between non-overlapping items so drag stays on one row.
 */
export function assignExpandedLaneLayout(
	items: TimelineSpanItem[],
	_options?: LaneRowLayoutOptions,
): Map<string, number> {
	const sorted = sortSpanItems(items);
	const lanes = new Map<string, number>();
	sorted.forEach((item, laneIndex) => {
		lanes.set(item.id, laneIndex);
	});
	return lanes;
}

export function buildLaneRowId(baseRowId: string, laneIndex: number): string {
	return laneIndex === 0 ? baseRowId : `${baseRowId}-lane-${laneIndex}`;
}

/** Sub-lane row id when a cluster is expanded; never aliases `baseRowId`. */
export function buildExpandedClusterLaneRowId(baseRowId: string, laneIndex: number): string {
	return `${baseRowId}-lane-${laneIndex}`;
}

export function parseLaneIndexFromRowId(baseRowId: string, rowId: string): number {
	if (rowId === baseRowId) {
		return 0;
	}
	const prefix = `${baseRowId}-lane-`;
	if (!rowId.startsWith(prefix)) {
		return 0;
	}
	const parsed = Number.parseInt(rowId.slice(prefix.length), 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

export interface LaneRowGroup<T extends { id: string }> {
	rowId: string;
	laneIndex: number;
	items: T[];
}

/**
 * Default: all items on one row. When expandedClusterId matches the playhead
 * cluster, only that cluster's members split into sub-lanes; others stay on the main row.
 */
export function groupItemsByLaneRow<T extends { id: string }>(
	items: T[],
	baseRowId: string,
	spanById: Map<string, Pick<TimelineSpanItem, "startMs" | "endMs">>,
	playheadMs: number,
	expandedClusterId: string | null | undefined,
	layoutOptions?: LaneRowLayoutOptions,
): LaneRowGroup<T>[] {
	if (items.length === 0) {
		return [];
	}

	const spanItems: TimelineSpanItem[] = items.map((item) => {
		const span = spanById.get(item.id);
		return {
			id: item.id,
			startMs: span?.startMs ?? 0,
			endMs: span?.endMs ?? 0,
		};
	});

	const cluster = getPlayheadExpandCluster(spanItems, playheadMs, baseRowId, layoutOptions);
	const isClusterExpanded = Boolean(
		cluster && expandedClusterId && expandedClusterId === cluster.id,
	);

	if (!isClusterExpanded || !cluster) {
		return [{ rowId: baseRowId, laneIndex: 0, items }];
	}

	const memberSet = new Set(cluster.memberIds);
	const mainItems = items.filter((item) => !memberSet.has(item.id));
	const clusterItems = items.filter((item) => memberSet.has(item.id));

	const clusterSpanItems: TimelineSpanItem[] = clusterItems.map((item) => {
		const span = spanById.get(item.id);
		return {
			id: item.id,
			startMs: span?.startMs ?? 0,
			endMs: span?.endMs ?? 0,
		};
	});

	const laneById = assignExpandedLaneLayout(clusterSpanItems, layoutOptions);
	const maxLane = Math.max(...laneById.values(), 0);
	const groups: LaneRowGroup<T>[] = [{ rowId: baseRowId, laneIndex: 0, items: mainItems }];

	for (let lane = 0; lane <= maxLane; lane++) {
		const rowId = buildExpandedClusterLaneRowId(baseRowId, lane);
		const laneItems = clusterItems.filter((item) => (laneById.get(item.id) ?? 0) === lane);
		if (laneItems.length > 0) {
			groups.push({ rowId, laneIndex: lane, items: laneItems });
		}
	}

	return groups;
}

const EXPANDED_CLUSTERS_STORAGE_KEY = "openscreen-timeline-expanded-clusters";
const LEGACY_EXPANDED_LANES_STORAGE_KEY = "openscreen-timeline-expanded-lanes";

export function loadExpandedClustersByTrack(): Record<string, string> {
	try {
		const raw = localStorage.getItem(EXPANDED_CLUSTERS_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, string>;
			}
		}
	} catch {
		// fall through
	}
	return {};
}

export function saveExpandedClustersByTrack(clusters: Record<string, string>): void {
	try {
		if (Object.keys(clusters).length === 0) {
			localStorage.removeItem(EXPANDED_CLUSTERS_STORAGE_KEY);
			localStorage.removeItem(LEGACY_EXPANDED_LANES_STORAGE_KEY);
			return;
		}
		localStorage.setItem(EXPANDED_CLUSTERS_STORAGE_KEY, JSON.stringify(clusters));
		localStorage.removeItem(LEGACY_EXPANDED_LANES_STORAGE_KEY);
	} catch {
		// ignore quota / private mode
	}
}

/** @deprecated Track-wide expand; replaced by per-cluster at playhead. */
export function loadExpandedLaneTracks(): Set<string> {
	try {
		const raw = localStorage.getItem(LEGACY_EXPANDED_LANES_STORAGE_KEY);
		if (!raw) {
			return new Set();
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			return new Set();
		}
		return new Set(parsed.filter((value): value is string => typeof value === "string"));
	} catch {
		return new Set();
	}
}

export function saveExpandedLaneTracks(_tracks: Set<string>): void {
	// legacy no-op
}
