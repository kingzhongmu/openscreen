import type { RowDefinition } from "dnd-timeline";
import { useRow } from "dnd-timeline";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RowProps extends RowDefinition {
	children: React.ReactNode;
	hint?: string;
	isEmpty?: boolean;
	background?: React.ReactNode;
	isSubLane?: boolean;
	laneExpand?: {
		expanded: boolean;
		onToggle: () => void;
		title: string;
	};
}

function stopTimelinePointerBubble(event: React.PointerEvent | React.MouseEvent) {
	event.stopPropagation();
}

/**
 * A horizontal timeline lane. Wraps dnd-timeline's `useRow` and adds an optional
 * `background` layer, an empty-state hint label, and a minimum height.
 */
export default function Row({
	id,
	children,
	hint,
	isEmpty,
	background,
	isSubLane = false,
	laneExpand,
}: RowProps) {
	const { setNodeRef, rowWrapperStyle, rowStyle } = useRow({ id });

	return (
		<div
			className={cn(
				"border-b border-white/[0.055] bg-[#101116] relative overflow-hidden",
				isSubLane && "bg-[#0d0e12]",
			)}
			style={{ ...rowWrapperStyle, minHeight: isSubLane ? 30 : 36 }}
		>
			{background}
			{laneExpand && (
				<div
					data-timeline-control=""
					className="absolute left-1 top-1/2 -translate-y-1/2 z-20"
					onPointerDown={stopTimelinePointerBubble}
					onMouseDown={stopTimelinePointerBubble}
				>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-5 w-5 rounded text-slate-500 hover:text-slate-200 hover:bg-white/10"
						title={laneExpand.title}
						onClick={(e) => {
							e.stopPropagation();
							laneExpand.onToggle();
						}}
						onPointerDown={stopTimelinePointerBubble}
						onMouseDown={stopTimelinePointerBubble}
					>
						{laneExpand.expanded ? (
							<ChevronDown className="h-3.5 w-3.5" />
						) : (
							<ChevronRight className="h-3.5 w-3.5" />
						)}
					</Button>
				</div>
			)}
			{isEmpty && hint && (
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10">
					<span className="text-[11px] text-white/[0.12] font-medium">{hint}</span>
				</div>
			)}
			<div
				ref={setNodeRef}
				style={{
					...rowStyle,
					paddingLeft: laneExpand || isSubLane ? 20 : undefined,
				}}
			>
				{children}
			</div>
		</div>
	);
}
