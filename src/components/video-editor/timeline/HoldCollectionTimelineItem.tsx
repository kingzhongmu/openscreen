import type { Span } from "dnd-timeline";
import { useItem } from "dnd-timeline";
import { ChevronDown, ChevronUp, GripVertical, Layers } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useCallback, useMemo } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { holdCollectionMergedShellLabel } from "@/lib/holdCollectionTimeline";
import { cn } from "@/lib/utils";
import { formatAnnotationClockMs } from "../positionAnnotation";
import type { HoldCollection } from "../types";
import glassStyles from "./ItemGlass.module.css";

interface HoldCollectionTimelineItemProps {
	id: string;
	span: Span;
	rowId: string;
	collection: HoldCollection;
	isCollectionSelected?: boolean;
	isExpanded?: boolean;
	onSelectCollection?: () => void;
	onToggleExpand?: () => void;
	readOnly?: boolean;
}

const SHELL_RESIZE_EDGE_PX = 10;

export default function HoldCollectionTimelineItem({
	id,
	span,
	rowId,
	collection,
	isCollectionSelected = false,
	isExpanded = false,
	onSelectCollection,
	onToggleExpand,
	readOnly = false,
}: HoldCollectionTimelineItemProps) {
	const t = useScopedT("timeline");
	const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
		id,
		span,
		data: { rowId },
	});

	const canMove = !readOnly;
	const canResizeShell = !readOnly;
	const isHighlighted = isCollectionSelected;
	const safeItemStyle = { ...itemStyle, minWidth: 6, cursor: "default" };
	const endCapColor = "#38bdf8";
	const mergedLabel = holdCollectionMergedShellLabel(collection, t);
	const timeLabel = `${formatAnnotationClockMs(span.start)} – ${formatAnnotationClockMs(span.end)}`;

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
				onPointerMove?.(event);
			},
			onPointerDown: (event: ReactPointerEvent) => {
				const target = event.target as HTMLElement;

				if (target.closest("[data-hold-collection-grip]")) {
					onSelectCollection?.();
					if (canMove) {
						onPointerDown(event);
					}
					return;
				}

				if (target.closest("[data-hold-collection-control]")) {
					return;
				}

				const shellEdge = isNearShellEdge(event, event.currentTarget as HTMLElement);
				if (shellEdge) {
					if (canResizeShell) {
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
						"relative flex h-[30px] w-full overflow-visible",
						isHighlighted && glassStyles.selected,
					)}
					style={{ minWidth: 48 }}
					onClick={(event) => {
						event.stopPropagation();
						onSelectCollection?.();
					}}
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

					{isHighlighted && (
						<div className="absolute -top-1 right-1 z-40 flex flex-col items-center gap-0.5">
							<button
								type="button"
								data-hold-collection-grip=""
								data-hold-collection-control=""
								className={cn(
									"flex h-4 w-4 items-center justify-center rounded-full border border-sky-300/40 bg-sky-950/90 shadow-sm",
									canMove
										? "cursor-grab active:cursor-grabbing hover:border-sky-200/60"
										: "cursor-default opacity-50",
								)}
								title={
									canMove
										? t("labels.holdCollectionDragHandle")
										: t("labels.holdCollectionDragHandlePreview")
								}
							>
								<GripVertical className="pointer-events-none h-2.5 w-2.5 text-sky-200/90" />
							</button>
							<button
								type="button"
								data-hold-collection-control=""
								className="flex h-4 w-4 items-center justify-center rounded-full border border-sky-300/40 bg-sky-950/90 text-sky-200/90 shadow-sm hover:border-sky-200/60"
								title={
									isExpanded ? t("labels.holdCollectionCollapse") : t("labels.holdCollectionExpand")
								}
								onClick={(event) => {
									event.stopPropagation();
									onToggleExpand?.();
								}}
							>
								{isExpanded ? (
									<ChevronUp className="h-3 w-3" />
								) : (
									<ChevronDown className="h-3 w-3" />
								)}
							</button>
						</div>
					)}

					<div
						className="relative z-10 mx-2 flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 overflow-hidden px-2"
						onPointerDownCapture={() => onSelectCollection?.()}
					>
						<Layers className="h-3.5 w-3.5 shrink-0 text-sky-200/80" />
						<span className="truncate text-[11px] font-semibold text-white/90">{mergedLabel}</span>
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
