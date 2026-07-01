import { describe, expect, it } from "vitest";
import {
	ANNOTATION_TAB_KINDS,
	cycleAnnotationTabKind,
	formatHoldSegmentTimelineLabel,
	formatRegularAnnotationTimelineLabel,
} from "@/lib/annotationTabKind";
import { createHoldCollection } from "@/lib/holdCollection";

describe("annotationTabKind", () => {
	it("cycles tab kinds forward and backward", () => {
		expect(cycleAnnotationTabKind("text")).toBe("image");
		expect(cycleAnnotationTabKind("audio")).toBe("text");
		expect(cycleAnnotationTabKind("figure", true)).toBe("image");
	});

	it("formats hold segment labels with step, icon, and name", () => {
		const collection = createHoldCollection(1000);
		const segment = collection.segments[0]!;
		segment.content = {
			...segment.content,
			type: "text",
			content: "Hello narration",
			textContent: "Hello narration",
		};
		const label = formatHoldSegmentTimelineLabel(segment, 0, {
			step: (index) => `Step ${index}`,
			emptyText: "Empty",
			image: "Image",
			arrow: "Arrow",
			untitledAudio: "Untitled",
		});
		expect(label).toBe("Step 1 T Hello narratio...");
	});

	it("formats regular annotation labels with icon and name", () => {
		const label = formatRegularAnnotationTimelineLabel(
			{
				id: "a1",
				type: "figure",
				content: "",
				startMs: 0,
				endMs: 3000,
				position: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
				style: {},
				zIndex: 0,
			},
			undefined,
			{
				emptyText: "Empty",
				image: "Image",
				arrow: "Arrow",
				untitledAudio: "Untitled",
			},
		);
		expect(label).toBe("→ Arrow");
	});

	it("includes all four tab kinds", () => {
		expect(ANNOTATION_TAB_KINDS).toEqual(["text", "image", "figure", "audio"]);
	});
});
