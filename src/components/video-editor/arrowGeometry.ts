import { normalizeArrowAnimation } from "@/lib/arrowAnimation";
import type { ArrowDirection, FigureData } from "./types";

export const ARROW_VIEWBOX_SIZE = 200;
export const ARROW_CENTER = 100;

export const ARROW_SHAFT_WIDTH = { min: 10, max: 70, default: 30 } as const;
export const ARROW_SHAFT_LENGTH = { min: 10, max: 200, default: 80 } as const;
export const ARROW_HEAD_WIDTH = { min: 20, max: 80, default: 40 } as const;
export const ARROW_HEAD_LENGTH = { min: 10, max: 80, default: 30 } as const;

export const ARROW_ROTATIONS: Record<ArrowDirection, number> = {
	right: 0,
	left: 180,
	up: -90,
	down: 90,
	"up-right": -45,
	"up-left": -135,
	"down-right": 45,
	"down-left": 135,
};

export const ARROW_VIEWBOX_PADDING = 16;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export interface ArrowBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	width: number;
	height: number;
}

export interface ArrowGeometry {
	shaft: { x: number; y: number; width: number; height: number; rx: number };
	headPoints: readonly [
		{ x: number; y: number },
		{ x: number; y: number },
		{ x: number; y: number },
	];
	centerX: number;
	centerY: number;
	bounds: ArrowBounds;
}

function computeRotatedBounds(
	bounds: ArrowBounds,
	centerX: number,
	centerY: number,
	rotationDeg: number,
): ArrowBounds {
	const corners = [
		{ x: bounds.minX, y: bounds.minY },
		{ x: bounds.maxX, y: bounds.minY },
		{ x: bounds.maxX, y: bounds.maxY },
		{ x: bounds.minX, y: bounds.maxY },
	];
	const rad = (rotationDeg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);

	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const corner of corners) {
		const dx = corner.x - centerX;
		const dy = corner.y - centerY;
		const rx = centerX + dx * cos - dy * sin;
		const ry = centerY + dx * sin + dy * cos;
		minX = Math.min(minX, rx);
		maxX = Math.max(maxX, rx);
		minY = Math.min(minY, ry);
		maxY = Math.max(maxY, ry);
	}

	return {
		minX,
		maxX,
		minY,
		maxY,
		width: maxX - minX,
		height: maxY - minY,
	};
}

/** Scale + center the arrow inside the viewBox for a given rotation. */
export function computeArrowFitScale(
	geometry: ArrowGeometry,
	rotationDeg: number,
	viewBoxSize = ARROW_VIEWBOX_SIZE,
	padding = ARROW_VIEWBOX_PADDING,
): number {
	const rotatedBounds = computeRotatedBounds(
		geometry.bounds,
		geometry.centerX,
		geometry.centerY,
		rotationDeg,
	);
	const available = Math.max(1, viewBoxSize - padding * 2);
	return Math.min(available / rotatedBounds.width, available / rotatedBounds.height);
}

export interface ArrowAnimationTransform {
	translateLocalX: number;
	scale: number;
	opacity: number;
}

export function getArrowTransform(
	geometry: ArrowGeometry,
	rotationDeg: number,
	animation?: Pick<ArrowAnimationTransform, "translateLocalX" | "scale">,
	viewBoxSize = ARROW_VIEWBOX_SIZE,
	padding = ARROW_VIEWBOX_PADDING,
): string {
	const fitScale = computeArrowFitScale(geometry, rotationDeg, viewBoxSize, padding);
	const viewCenter = viewBoxSize / 2;
	const animScale = animation?.scale ?? 1;
	const nudgeX = animation?.translateLocalX ?? 0;
	return `translate(${viewCenter} ${viewCenter}) rotate(${rotationDeg}) scale(${fitScale * animScale}) translate(${nudgeX} 0) translate(${-geometry.centerX} ${-geometry.centerY})`;
}

type LegacyFigureData = FigureData & { strokeWidth?: number };

export function normalizeFigureData(input: Partial<LegacyFigureData> | undefined): FigureData {
	const legacyStrokeWidth =
		typeof input?.strokeWidth === "number" && Number.isFinite(input.strokeWidth)
			? input.strokeWidth
			: undefined;

	const shaftWidth =
		typeof input?.shaftWidth === "number" && Number.isFinite(input.shaftWidth)
			? input.shaftWidth
			: legacyStrokeWidth !== undefined
				? clamp(Math.round(legacyStrokeWidth * 7.5), ARROW_SHAFT_WIDTH.min, ARROW_SHAFT_WIDTH.max)
				: ARROW_SHAFT_WIDTH.default;

	return {
		arrowDirection: input?.arrowDirection ?? "right",
		color: input?.color ?? "#34B27B",
		shaftWidth: clamp(shaftWidth, ARROW_SHAFT_WIDTH.min, ARROW_SHAFT_WIDTH.max),
		shaftLength: clamp(
			typeof input?.shaftLength === "number" && Number.isFinite(input.shaftLength)
				? input.shaftLength
				: ARROW_SHAFT_LENGTH.default,
			ARROW_SHAFT_LENGTH.min,
			ARROW_SHAFT_LENGTH.max,
		),
		headWidth: clamp(
			typeof input?.headWidth === "number" && Number.isFinite(input.headWidth)
				? input.headWidth
				: ARROW_HEAD_WIDTH.default,
			ARROW_HEAD_WIDTH.min,
			ARROW_HEAD_WIDTH.max,
		),
		headLength: clamp(
			typeof input?.headLength === "number" && Number.isFinite(input.headLength)
				? input.headLength
				: ARROW_HEAD_LENGTH.default,
			ARROW_HEAD_LENGTH.min,
			ARROW_HEAD_LENGTH.max,
		),
		arrowAnimation: normalizeArrowAnimation(input?.arrowAnimation),
	};
}

export function computeArrowGeometry(params: {
	shaftWidth: number;
	shaftLength: number;
	headWidth: number;
	headLength: number;
}): ArrowGeometry {
	const sw = params.shaftWidth;
	const sh = params.shaftLength;
	const aw = params.headWidth;
	const ah = params.headLength;
	const baseX = ARROW_CENTER;
	const shaftY = baseX - sw / 2;
	const tipX = baseX + sh + ah;
	const jointX = baseX + sh;
	const barbY1 = baseX - aw / 2;
	const barbY2 = baseX + aw / 2;
	const minX = baseX;
	const maxX = tipX;
	const minY = Math.min(shaftY, barbY1);
	const maxY = Math.max(shaftY + sw, barbY2);

	return {
		shaft: { x: baseX, y: shaftY, width: sh, height: sw, rx: 2 },
		headPoints: [
			{ x: tipX, y: baseX },
			{ x: jointX, y: barbY1 },
			{ x: jointX, y: barbY2 },
		],
		centerX: (minX + maxX) / 2,
		centerY: (minY + maxY) / 2,
		bounds: {
			minX,
			maxX,
			minY,
			maxY,
			width: maxX - minX,
			height: maxY - minY,
		},
	};
}
