import type { Span } from "dnd-timeline";
import { useItem, useTimelineContext } from "dnd-timeline";
import { GripVertical, Pause } from "lucide-react";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { formatAnnotationClockMs } from "../positionAnnotation";
import { type HoldCollection, MIN_HOLD_DURATION_MS } from "../types";
import glassStyles from "./ItemGlass.module.css";

interface HoldCollectionTimelineItemProps {
	id: string;
	span: Span;
	rowId: string;
	collection: HoldCollection;
	labelForSegment: (segmentIndex: number) => string;
	isCollectionSelected?: boolean;
	selectedHoldSegmentKey?: string | null;
	onSelectCollection?: () => void;
	onSelectSegment?: (collectionId: string, segmentId: string) => void;
	onSegmentDurationChange?: (collectionId: string, segmentId: string, durationMs: number) => void;
	onSegmentPairDurationChange?: (
		collectionId: string,
		leftSegmentId: string,
		leftDurationMs: number,
		rightSegmentId: string,
		rightDurationMs: number,
	) => void;
	readOnly?: boolean;
	/** Preview timeline: duration edits allowed, but shell anchor cannot move. */
	moveDisabled?: boolean;
}

const SHELL_RESIZE_EDGE_PX = 10;

type SegmentResizeEdge = "left" | "right";

interface SegmentResizeSession {
	segmentIndex: number;
	edge: SegmentResizeEdge;
	startClientX: number;
	startDurations: number[];
}

function clampSegmentDuration(durationMs: number): number {
	return Math.max(MIN_HOLD_DURATION_MS, Math.round(durationMs));
}

export default function HoldCollectionTimelineItem({
	id,
	span,
	rowId,
	collection,
	labelForSegment,
	isCollectionSelected = false,
	selectedHoldSegmentKey = null,
	onSelectCollection,
	onSelectSegment,
	onSegmentDurationChange,
	onSegmentPairDurationChange,
	readOnly = false,
	moveDisabled = false,
}: HoldCollectionTimelineItemProps) {
	const t = useScopedT("timeline");
	const { pixelsToValue } = useTimelineContext();
	const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
		id,
		span,
		data: { rowId },
	});

	const resizeSessionRef = useRef<SegmentResizeSession | null>(null);
	const [previewDurations, setPreviewDurations] = useState<number[] | null>(null);

	const baseDurations = useMemo(
		() => collection.segments.map((segment) => segment.durationMs),
		[collection.segments],
	);
	const displayDurations = previewDurations ?? baseDurations;
	const totalDurationMs = displayDurations.reduce((sum, duration) => sum + duration, 0);
	const timeLabel = `${formatAnnotationClockMs(span.start)} – ${formatAnnotationClockMs(span.end)}`;

	const segmentWidths = useMemo(
		() =>
			displayDurations.map((duration) =>
				totalDurationMs > 0 ? (duration / totalDurationMs) * 100 : 0,
			),
		[displayDurations, totalDurationMs],
	);

	const applyResizeDelta = useCallback(
		(session: SegmentResizeSession, deltaMs: number): number[] | null => {
			const next = [...session.startDurations];
			const index = session.segmentIndex;

			if (session.edge === "left") {
				if (index <= 0) {
					return null;
				}
				const maxGrowLeft = session.startDurations[index]! - MIN_HOLD_DURATION_MS;
				const maxShrinkLeft = session.startDurations[index - 1]! - MIN_HOLD_DURATION_MS;
				const clampedDelta = Math.max(-maxShrinkLeft, Math.min(maxGrowLeft, deltaMs));
				next[index - 1] = session.startDurations[index - 1]! + clampedDelta;
				next[index] = session.startDurations[index]! - clampedDelta;
				return next;
			}

			if (index < collection.segments.length - 1) {
				const maxGrowLeft = session.startDurations[index + 1]! - MIN_HOLD_DURATION_MS;
				const maxShrinkLeft = session.startDurations[index]! - MIN_HOLD_DURATION_MS;
				const clampedDelta = Math.max(-maxShrinkLeft, Math.min(maxGrowLeft, deltaMs));
				next[index] = session.startDurations[index]! + clampedDelta;
				next[index + 1] = session.startDurations[index + 1]! - clampedDelta;
				return next;
			}

			next[index] = clampSegmentDuration(session.startDurations[index]! + deltaMs);
			return next;
		},
		[collection.segments.length],
	);

	const commitResize = useCallback(
		(session: SegmentResizeSession, durations: number[]) => {
			const index = session.segmentIndex;
			if (session.edge === "left" && index > 0) {
				onSegmentPairDurationChange?.(
					collection.id,
					collection.segments[index - 1]!.id,
					durations[index - 1]!,
					collection.segments[index]!.id,
					durations[index]!,
				);
				return;
			}

			if (session.edge === "right" && index < collection.segments.length - 1) {
				onSegmentPairDurationChange?.(
					collection.id,
					collection.segments[index]!.id,
					durations[index]!,
					collection.segments[index + 1]!.id,
					durations[index + 1]!,
				);
				return;
			}

			onSegmentDurationChange?.(collection.id, collection.segments[index]!.id, durations[index]!);
		},
		[collection.id, collection.segments, onSegmentDurationChange, onSegmentPairDurationChange],
	);

	const handleSegmentResizePointerDown = useCallback(
		(event: React.PointerEvent, segmentIndex: number, edge: SegmentResizeEdge) => {
			if (readOnly) {
				return;
			}
			event.stopPropagation();
			event.preventDefault();
			resizeSessionRef.current = {
				segmentIndex,
				edge,
				startClientX: event.clientX,
				startDurations: baseDurations,
			};
			setPreviewDurations(baseDurations);
			event.currentTarget.setPointerCapture(event.pointerId);
			onSelectSegment?.(collection.id, collection.segments[segmentIndex]!.id);
		},
		[baseDurations, collection.id, collection.segments, onSelectSegment, readOnly],
	);

	const handleSegmentResizePointerMove = useCallback(
		(event: React.PointerEvent) => {
			const session = resizeSessionRef.current;
			if (!session) {
				return;
			}
			event.stopPropagation();
			const deltaMs = Math.round(pixelsToValue(event.clientX - session.startClientX));
			const next = applyResizeDelta(session, deltaMs);
			if (next) {
				setPreviewDurations(next);
			}
		},
		[applyResizeDelta, pixelsToValue],
	);

	const handleSegmentResizePointerUp = useCallback(
		(event: React.PointerEvent) => {
			const session = resizeSessionRef.current;
			if (!session) {
				return;
			}
			event.stopPropagation();
			const deltaMs = Math.round(pixelsToValue(event.clientX - session.startClientX));
			const next = applyResizeDelta(session, deltaMs);
			if (next) {
				commitResize(session, next);
			}
			resizeSessionRef.current = null;
			setPreviewDurations(null);
		},
		[applyResizeDelta, commitResize, pixelsToValue],
	);

	const MIN_ITEM_PX = 6;
	const canMove = !readOnly && !moveDisabled;
	const canResizeShell = isCollectionSelected && !selectedHoldSegmentKey;
	const isHighlighted =
		isCollectionSelected || selectedHoldSegmentKey?.startsWith(`${collection.id}:`);
	const safeItemStyle = { ...itemStyle, minWidth: MIN_ITEM_PX, cursor: "default" };
	const endCapColor = "#38bdf8";

	const isNearShellEdge = useCallback((event: ReactPointerEvent, element: HTMLElement) => {
		const rect = element.getBoundingClientRect();
		return (
			Math.abs(event.clientX - rect.left) <= SHELL_RESIZE_EDGE_PX ||
			Math.abs(event.clientX - rect.right) <= SHELL_RESIZE_EDGE_PX
		);
	}, []);

	const wrappedListeners = useMemo(() => {
		if (readOnly || !listeners?.onPointerDown) {
			return undefined;
		}

		const { onPointerDown, onPointerMove, ...restListeners } = listeners;

		return {
			...restListeners,
			onPointerMove: (event: ReactPointerEvent) => {
				if (!canResizeShell && !canMove) {
					return;
				}
				onPointerMove?.(event);
			},
			onPointerDown: (event: ReactPointerEvent) => {
				const target = event.target as HTMLElement;
				if (target.closest("[data-hold-segment]") || target.closest("[data-hold-segment-resize]")) {
					return;
				}

				const shellEdge = isNearShellEdge(event, event.currentTarget as HTMLElement);
				if (shellEdge) {
					if (canResizeShell) {
						onPointerDown(event);
					}
					return;
				}

				if (target.closest("[data-hold-collection-grip]")) {
					onSelectCollection?.();
					if (canMove) {
						onPointerDown(event);
					}
					return;
				}

				onSelectCollection?.();
			},
		};
	}, [canMove, canResizeShell, isNearShellEdge, listeners, onSelectCollection, readOnly]);

	return (
		<div
			ref={setNodeRef}
			style={safeItemStyle}
			{...(wrappedListeners ?? {})}
			{...(readOnly ? {} : attributes)}
			className="group"
		>
			<div style={{ ...itemContentStyle, minWidth: 48 }}>
				<div
					className={cn(
						glassStyles.glassHold,
						"relative flex h-[30px] w-full overflow-hidden",
						isHighlighted && glassStyles.selected,
					)}
					style={{ minWidth: 48 }}
				>
					<div
						className={cn(glassStyles.zoomEndCap, glassStyles.left)}
						style={{
							cursor: canResizeShell ? "col-resize" : "default",
							pointerEvents: canResizeShell ? "auto" : "none",
							width: 8,
							opacity: canResizeShell ? 0.9 : 0.35,
							background: endCapColor,
							zIndex: 20,
						}}
						title={canResizeShell ? t("labels.holdCollectionResizeShell") : undefined}
					/>
					<div
						className={cn(glassStyles.zoomEndCap, glassStyles.right)}
						style={{
							cursor: canResizeShell ? "col-resize" : "default",
							pointerEvents: canResizeShell ? "auto" : "none",
							width: 8,
							opacity: canResizeShell ? 0.9 : 0.35,
							background: endCapColor,
							zIndex: 20,
						}}
						title={canResizeShell ? t("labels.holdCollectionResizeShell") : undefined}
					/>

					<button
						type="button"
						data-hold-collection-grip=""
						className={cn(
							"absolute right-[9px] top-0.5 z-30 flex h-4 w-4 items-center justify-center rounded-full border border-sky-300/40 bg-sky-950/80 shadow-sm transition-opacity",
							canMove
								? "cursor-grab active:cursor-grabbing hover:border-sky-200/60 hover:bg-sky-900/90"
								: "cursor-default opacity-50",
							isHighlighted ? "opacity-100" : "opacity-0 group-hover:opacity-100",
						)}
						title={
							canMove
								? t("labels.holdCollectionDragHandle")
								: t("labels.holdCollectionDragHandlePreview")
						}
					>
						<GripVertical className="pointer-events-none h-2.5 w-2.5 text-sky-200/90" aria-hidden />
					</button>

					<div
						className="relative z-10 mx-2 flex h-full min-w-0 flex-1 items-stretch overflow-hidden rounded-sm border border-dashed border-sky-400/50 bg-black/20 pr-4"
						onPointerDownCapture={(event) => {
							if (
								(event.target as HTMLElement).closest("[data-hold-segment]") ||
								(event.target as HTMLElement).closest("[data-hold-segment-resize]") ||
								(event.target as HTMLElement).closest("[data-hold-collection-grip]")
							) {
								return;
							}
							onSelectCollection?.();
						}}
					>
						{collection.segments.map((segment, index) => {
							const isSegmentSelected = selectedHoldSegmentKey === `${collection.id}:${segment.id}`;
							const canResizeSegment = isSegmentSelected;
							return (
								<div
									key={segment.id}
									data-hold-segment=""
									style={{ width: `${segmentWidths[index]}%` }}
									className={cn(
										"relative flex min-w-0 cursor-pointer flex-col items-center justify-center gap-0 border-r border-sky-400/25 px-1 last:border-r-0",
										"text-white/90 transition-colors hover:bg-sky-400/10",
										isSegmentSelected && "bg-sky-400/20 ring-1 ring-inset ring-sky-300/60",
									)}
									onPointerDown={(event) => {
										if ((event.target as HTMLElement).closest("[data-hold-segment-resize]")) {
											return;
										}
										event.stopPropagation();
										onSelectSegment?.(collection.id, segment.id);
									}}
									onClick={(event) => {
										event.stopPropagation();
									}}
								>
									{canResizeSegment && index > 0 && (
										<div
											data-hold-segment-resize=""
											className="absolute left-0 top-0 bottom-0 z-20 w-2 cursor-col-resize bg-sky-300/30 hover:bg-sky-300/60"
											onPointerDown={(event) =>
												handleSegmentResizePointerDown(event, index, "left")
											}
											onPointerMove={handleSegmentResizePointerMove}
											onPointerUp={handleSegmentResizePointerUp}
											onPointerCancel={handleSegmentResizePointerUp}
										/>
									)}
									{canResizeSegment && (
										<div
											data-hold-segment-resize=""
											className="absolute right-0 top-0 bottom-0 z-20 w-2 cursor-col-resize bg-sky-300/30 hover:bg-sky-300/60"
											onPointerDown={(event) =>
												handleSegmentResizePointerDown(event, index, "right")
											}
											onPointerMove={handleSegmentResizePointerMove}
											onPointerUp={handleSegmentResizePointerUp}
											onPointerCancel={handleSegmentResizePointerUp}
										/>
									)}
									<span className="pointer-events-none flex max-w-full items-center gap-0.5 truncate text-[10px] font-semibold">
										{index === 0 ? <Pause className="h-3 w-3 shrink-0 opacity-80" /> : null}
										<span className="truncate">
											{t("labels.holdCollectionStep", { index: String(index + 1) })}
										</span>
									</span>
									<span className="pointer-events-none max-w-full truncate text-[8px] opacity-70">
										{labelForSegment(index)}
									</span>
								</div>
							);
						})}
					</div>

					<span
						className={cn(
							"pointer-events-none absolute bottom-0.5 left-1/2 z-10 -translate-x-1/2 text-[8px] tabular-nums tracking-tight whitespace-nowrap text-white/70 transition-opacity",
							isHighlighted ? "opacity-60" : "opacity-0 group-hover:opacity-40",
						)}
					>
						{timeLabel}
					</span>
				</div>
			</div>
		</div>
	);
}
