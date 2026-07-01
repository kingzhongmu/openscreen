import type { Span } from "dnd-timeline";
import Item from "./Item";

interface HoldCollectionSegmentTimelineItemProps {
	id: string;
	span: Span;
	rowId: string;
	label: string;
	subLabel?: string;
	isSelected?: boolean;
	onSelect?: () => void;
	readOnly?: boolean;
}

export default function HoldCollectionSegmentTimelineItem({
	id,
	span,
	rowId,
	label,
	subLabel,
	isSelected = false,
	onSelect,
	readOnly = false,
}: HoldCollectionSegmentTimelineItemProps) {
	return (
		<Item
			id={id}
			span={span}
			rowId={rowId}
			isSelected={isSelected}
			onSelect={onSelect}
			variant="hold"
			readOnly={readOnly}
			secondaryLabel={subLabel}
			suppressTimeLabel
		>
			{label}
		</Item>
	);
}
