import { beforeEach, describe, expect, it } from "vitest";
import { computeArrowGeometry } from "@/components/video-editor/arrowGeometry";
import { DEFAULT_FIGURE_DATA } from "@/components/video-editor/types";
import {
	ARROW_ANIMATION_CYCLE_MS,
	getArrowAnimationState,
	normalizeArrowAnimation,
} from "./arrowAnimation";

describe("arrowAnimation", () => {
	const geometry = computeArrowGeometry(DEFAULT_FIGURE_DATA);

	it("normalizes unknown values to none", () => {
		expect(normalizeArrowAnimation("nudge")).toBe("nudge");
		expect(normalizeArrowAnimation("invalid")).toBe("none");
	});

	it("returns a static state for none", () => {
		expect(getArrowAnimationState({ arrowAnimation: "none" }, 0, 500, geometry)).toEqual({
			translateLocalX: 0,
			scale: 1,
			opacity: 1,
		});
	});

	it("loops nudge along the arrow direction", () => {
		const atStart = getArrowAnimationState({ arrowAnimation: "nudge" }, 0, 0, geometry);
		const midCycle = getArrowAnimationState(
			{ arrowAnimation: "nudge" },
			0,
			ARROW_ANIMATION_CYCLE_MS / 4,
			geometry,
		);

		expect(atStart.translateLocalX).toBe(0);
		expect(midCycle.translateLocalX).toBeGreaterThan(0);
		expect(midCycle.scale).toBe(1);
	});

	it("loops pulse scale", () => {
		const atStart = getArrowAnimationState({ arrowAnimation: "pulse" }, 0, 0, geometry);
		const midCycle = getArrowAnimationState(
			{ arrowAnimation: "pulse" },
			0,
			ARROW_ANIMATION_CYCLE_MS / 4,
			geometry,
		);

		expect(atStart.scale).toBe(1);
		expect(midCycle.scale).toBeGreaterThan(1);
		expect(midCycle.translateLocalX).toBe(0);
	});
});
