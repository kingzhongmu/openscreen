import type { ArrowGeometry } from "@/components/video-editor/arrowGeometry";
import type { ArrowAnimation, FigureData } from "@/components/video-editor/types";

export const ARROW_ANIMATION_CYCLE_MS = 600;

export interface ArrowAnimationState {
	/** Offset along the arrow direction, in viewBox units. */
	translateLocalX: number;
	scale: number;
	opacity: number;
}

export const ARROW_ANIMATION_OPTIONS: Array<{
	value: ArrowAnimation;
	translationKey: string;
}> = [
	{ value: "none", translationKey: "arrowAnimation.none" },
	{ value: "nudge", translationKey: "arrowAnimation.nudge" },
	{ value: "pulse", translationKey: "arrowAnimation.pulse" },
];

export function normalizeArrowAnimation(value: unknown): ArrowAnimation {
	return ARROW_ANIMATION_OPTIONS.some((option) => option.value === value)
		? (value as ArrowAnimation)
		: "none";
}

function computeNudgeAmplitude(geometry: ArrowGeometry): number {
	return Math.min(Math.max(geometry.bounds.width * 0.07, 4), 14);
}

export function getArrowAnimationState(
	figureData: Pick<FigureData, "arrowAnimation">,
	startMs: number,
	currentTimeMs: number,
	geometry: ArrowGeometry,
): ArrowAnimationState {
	const animation = normalizeArrowAnimation(figureData.arrowAnimation);
	if (animation === "none") {
		return { translateLocalX: 0, scale: 1, opacity: 1 };
	}

	const elapsedMs = Math.max(0, currentTimeMs - startMs);
	const phase = ((elapsedMs % ARROW_ANIMATION_CYCLE_MS) / ARROW_ANIMATION_CYCLE_MS) * Math.PI * 2;
	const sin = Math.sin(phase);

	switch (animation) {
		case "nudge":
			return {
				translateLocalX: sin * computeNudgeAmplitude(geometry),
				scale: 1,
				opacity: 1,
			};
		case "pulse":
			return {
				translateLocalX: 0,
				scale: 1 + sin * 0.08,
				opacity: 1,
			};
		default:
			return { translateLocalX: 0, scale: 1, opacity: 1 };
	}
}

export function getStaticArrowAnimationState(): ArrowAnimationState {
	return { translateLocalX: 0, scale: 1, opacity: 1 };
}
