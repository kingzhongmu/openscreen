import {
	ARROW_ROTATIONS,
	ARROW_VIEWBOX_SIZE,
	computeArrowFitScale,
	computeArrowGeometry,
	normalizeFigureData,
} from "@/components/video-editor/arrowGeometry";
import {
	type AnnotationRegion,
	type FigureData,
	type HoldCollection,
	type HoldRegion,
} from "@/components/video-editor/types";
import { resolveAnnotationAnimationTimeMs } from "@/components/video-editor/videoPlayback/holdPlayback";
import { getTextAnimationState } from "@/lib/annotationTextAnimation";
import { getArrowAnimationState } from "@/lib/arrowAnimation";
import {
	applyMosaicToImageData,
	getBlurOverlayColor,
	getNormalizedBlurIntensity,
	getNormalizedMosaicBlockSize,
	normalizeBlurType,
} from "@/lib/blurEffects";
import { holdCollectionSegmentToOutputSpan } from "@/lib/holdCollection";
import { buildHoldCollectionOverlayAnnotations } from "@/lib/holdCollectionTimeline";
import {
	isFreezeLinkedRegionVisibleAtOutputTime,
	isRegionVisibleAtOutputTime,
} from "@/lib/timelineMapping";

let blurScratchCanvas: HTMLCanvasElement | null = null;
let blurScratchCtx: CanvasRenderingContext2D | null = null;

// Han/Hiragana/Katakana/Hangul code points, to split CJK text at character
// boundaries during wrap (CJK has no word-separating whitespace). Script
// escapes need ES2018+; tsconfig targets ES2020.
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

type GraphemeSegmenter = {
	segment(value: string): Iterable<{ segment: string }>;
};

type IntlWithSegmenter = typeof Intl & {
	Segmenter?: new (
		locales?: string | string[],
		options?: { granularity?: "grapheme" },
	) => GraphemeSegmenter;
};

const Segmenter = (Intl as IntlWithSegmenter).Segmenter;
const graphemeSegmenter =
	typeof Segmenter === "function" ? new Segmenter(undefined, { granularity: "grapheme" }) : null;

function splitGraphemes(value: string): string[] {
	if (!graphemeSegmenter) return Array.from(value);
	return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

function tokenizeForWrap(line: string): string[] {
	// Split Latin on whitespace (kept as its own token) and split CJK runs into
	// individual chars so each is breakable, mirroring the editor's CSS
	// word-break: break-word for CJK.
	const tokens: string[] = [];
	let buffer = "";
	const chars = Array.from(line);
	const flushBuffer = () => {
		if (buffer) {
			tokens.push(...buffer.split(/(\s+)/).filter((s) => s.length > 0));
			buffer = "";
		}
	};
	for (const ch of chars) {
		if (CJK_CHAR.test(ch)) {
			flushBuffer();
			tokens.push(ch);
		} else {
			buffer += ch;
		}
	}
	flushBuffer();
	return tokens;
}

function renderArrow(
	ctx: CanvasRenderingContext2D,
	figureData: FigureData,
	startMs: number,
	currentTimeMs: number,
	x: number,
	y: number,
	width: number,
	height: number,
	scaleFactor: number,
) {
	const normalized = normalizeFigureData(figureData);
	const geometry = computeArrowGeometry(normalized);
	const rotation = ARROW_ROTATIONS[normalized.arrowDirection];
	const animationState = getArrowAnimationState(normalized, startMs, currentTimeMs, geometry);
	const fitScale = computeArrowFitScale(geometry, rotation);
	const viewCenter = ARROW_VIEWBOX_SIZE / 2;

	ctx.save();

	const padding = 8 * scaleFactor;
	const availableWidth = Math.max(0, width - padding * 2);
	const availableHeight = Math.max(0, height - padding * 2);
	const containerScale = Math.min(
		availableWidth / ARROW_VIEWBOX_SIZE,
		availableHeight / ARROW_VIEWBOX_SIZE,
	);
	const offsetX = x + padding + (availableWidth - ARROW_VIEWBOX_SIZE * containerScale) / 2;
	const offsetY = y + padding + (availableHeight - ARROW_VIEWBOX_SIZE * containerScale) / 2;

	ctx.translate(offsetX + viewCenter * containerScale, offsetY + viewCenter * containerScale);
	ctx.rotate((rotation * Math.PI) / 180);
	ctx.scale(
		containerScale * fitScale * animationState.scale,
		containerScale * fitScale * animationState.scale,
	);
	ctx.translate(animationState.translateLocalX, 0);
	ctx.translate(-geometry.centerX, -geometry.centerY);
	ctx.globalAlpha *= animationState.opacity;

	ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
	ctx.shadowBlur = 8;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 4;

	ctx.fillStyle = normalized.color;

	if (typeof ctx.roundRect === "function") {
		ctx.beginPath();
		ctx.roundRect(
			geometry.shaft.x,
			geometry.shaft.y,
			geometry.shaft.width,
			geometry.shaft.height,
			geometry.shaft.rx,
		);
		ctx.fill();
	} else {
		ctx.fillRect(geometry.shaft.x, geometry.shaft.y, geometry.shaft.width, geometry.shaft.height);
	}

	ctx.beginPath();
	ctx.moveTo(geometry.headPoints[0].x, geometry.headPoints[0].y);
	ctx.lineTo(geometry.headPoints[1].x, geometry.headPoints[1].y);
	ctx.lineTo(geometry.headPoints[2].x, geometry.headPoints[2].y);
	ctx.closePath();
	ctx.fill();

	ctx.restore();
}

function drawBlurPath(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
) {
	const shape = annotation.blurData?.shape || "rectangle";
	if (shape === "rectangle") {
		ctx.beginPath();
		ctx.rect(x, y, width, height);
		return;
	}

	if (shape === "oval") {
		ctx.beginPath();
		ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
		return;
	}

	const points = annotation.blurData?.freehandPoints;
	if (shape === "freehand" && points && points.length >= 3) {
		ctx.beginPath();
		ctx.moveTo(x + (points[0].x / 100) * width, y + (points[0].y / 100) * height);
		for (let i = 1; i < points.length; i++) {
			ctx.lineTo(x + (points[i].x / 100) * width, y + (points[i].y / 100) * height);
		}
		ctx.closePath();
		return;
	}

	ctx.beginPath();
	ctx.rect(x, y, width, height);
}

function renderBlur(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	scaleFactor: number,
) {
	const canvas = ctx.canvas;
	const blurType = normalizeBlurType(annotation.blurData?.type);

	const blurRadius = Math.max(
		1,
		Math.round(getNormalizedBlurIntensity(annotation.blurData) * scaleFactor),
	);
	const samplePadding =
		blurType === "mosaic"
			? Math.max(0, Math.ceil(getNormalizedMosaicBlockSize(annotation.blurData, scaleFactor)))
			: Math.max(2, Math.ceil(blurRadius * 2));
	const sx = Math.max(0, Math.floor(x) - samplePadding);
	const sy = Math.max(0, Math.floor(y) - samplePadding);
	const ex = Math.min(canvas.width, Math.ceil(x + width) + samplePadding);
	const ey = Math.min(canvas.height, Math.ceil(y + height) + samplePadding);
	const sw = Math.max(0, ex - sx);
	const sh = Math.max(0, ey - sy);
	if (sw <= 0 || sh <= 0) return;

	if (!blurScratchCanvas || !blurScratchCtx) {
		blurScratchCanvas = document.createElement("canvas");
		blurScratchCtx = blurScratchCanvas.getContext("2d");
	}
	if (!blurScratchCanvas || !blurScratchCtx) return;

	blurScratchCanvas.width = sw;
	blurScratchCanvas.height = sh;
	blurScratchCtx.clearRect(0, 0, sw, sh);
	blurScratchCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

	if (blurType === "mosaic") {
		const imageData = blurScratchCtx.getImageData(0, 0, sw, sh);
		applyMosaicToImageData(
			imageData,
			getNormalizedMosaicBlockSize(annotation.blurData, scaleFactor),
		);
		blurScratchCtx.putImageData(imageData, 0, 0);
	}

	ctx.save();
	drawBlurPath(ctx, annotation, x, y, width, height);
	ctx.clip();
	ctx.filter = blurType === "mosaic" ? "none" : `blur(${blurRadius}px)`;
	ctx.drawImage(blurScratchCanvas, sx, sy);
	ctx.filter = "none";
	ctx.fillStyle = getBlurOverlayColor(annotation.blurData);
	ctx.fillRect(sx, sy, sw, sh);
	ctx.restore();
}

function renderText(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
	scaleFactor: number,
	currentTimeMs: number,
) {
	const style = annotation.style;
	const animationState = getTextAnimationState(annotation, currentTimeMs);

	ctx.save();

	const transformOriginX = x + width / 2;
	const transformOriginY = y + height / 2;
	ctx.translate(transformOriginX, transformOriginY);
	ctx.translate(animationState.translateX * scaleFactor, animationState.translateY * scaleFactor);
	ctx.scale(animationState.scale, animationState.scale);
	ctx.translate(-transformOriginX, -transformOriginY);
	ctx.globalAlpha *= animationState.opacity;

	// Clip to box bounds, matching editor's overflow: hidden
	ctx.beginPath();
	ctx.rect(x, y, width, height);
	ctx.clip();

	const fontWeight = style.fontWeight === "bold" ? "bold" : "normal";
	const fontStyle = style.fontStyle === "italic" ? "italic" : "normal";
	const scaledFontSize = style.fontSize * scaleFactor;
	ctx.font = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${style.fontFamily}`;
	ctx.textBaseline = "middle";

	const containerPadding = 8 * scaleFactor;

	let textX = x;
	let textY = y + height / 2;

	if (style.textAlign === "center") {
		textX = x + width / 2;
		ctx.textAlign = "center";
	} else if (style.textAlign === "right") {
		textX = x + width - containerPadding;
		ctx.textAlign = "right";
	} else {
		textX = x + containerPadding;
		ctx.textAlign = "left";
	}

	const availableWidth = width - containerPadding * 2;
	const rawLines = annotation.content.split("\n");
	const lines: string[] = [];
	for (const rawLine of rawLines) {
		if (!rawLine) {
			lines.push("");
			continue;
		}
		const tokens = tokenizeForWrap(rawLine);
		let current = "";
		for (const token of tokens) {
			const test = current + token;
			if (current && ctx.measureText(test).width > availableWidth) {
				lines.push(current);
				current = token.trimStart();
			} else {
				current = test;
			}
		}
		if (current) lines.push(current);
	}
	const lineHeight = scaledFontSize * 1.4;

	const startY = textY - ((lines.length - 1) * lineHeight) / 2;

	lines.forEach((line, index) => {
		const currentY = startY + index * lineHeight;
		const revealProgress = animationState.revealProgress;
		const graphemes = splitGraphemes(line);
		const visibleCount = Math.ceil(graphemes.length * revealProgress);
		const visibleLine = revealProgress >= 1 ? line : graphemes.slice(0, visibleCount).join("");
		if (!visibleLine && revealProgress < 1) return;

		const previousAlign = ctx.textAlign;
		const fullMetrics = ctx.measureText(line);
		let startX = textX;

		if (ctx.textAlign === "center") {
			startX = textX - fullMetrics.width / 2;
			ctx.textAlign = "left";
		} else if (ctx.textAlign === "right" || ctx.textAlign === "end") {
			startX = textX - fullMetrics.width;
			ctx.textAlign = "left";
		}

		if (style.backgroundColor && style.backgroundColor !== "transparent") {
			const metrics = ctx.measureText(visibleLine);
			const verticalPadding = scaledFontSize * 0.1;
			const horizontalPadding = scaledFontSize * 0.2;
			const borderRadius = 4 * scaleFactor;

			let bgX = startX - horizontalPadding;
			const bgWidth = metrics.width + horizontalPadding * 2;

			const contentHeight = scaledFontSize * 1.4;
			const bgHeight = contentHeight + verticalPadding * 2;
			const bgY = currentY - bgHeight / 2;

			if (previousAlign === "left" || previousAlign === "start") {
				bgX = textX - horizontalPadding;
			}

			ctx.fillStyle = style.backgroundColor;
			ctx.beginPath();
			ctx.roundRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
			ctx.fill();
		}

		ctx.fillStyle = style.color;
		ctx.fillText(visibleLine, startX, currentY);

		if (style.textDecoration === "underline") {
			const metrics = ctx.measureText(visibleLine);
			let underlineX = startX;
			const underlineY = currentY + scaledFontSize * 0.15;

			if (previousAlign === "left" || previousAlign === "start") {
				underlineX = textX;
			}

			ctx.strokeStyle = style.color;
			ctx.lineWidth = Math.max(1, scaledFontSize / 16);
			ctx.beginPath();
			ctx.moveTo(underlineX, underlineY);
			ctx.lineTo(underlineX + metrics.width, underlineY);
			ctx.stroke();
		}

		ctx.textAlign = previousAlign;
	});

	ctx.restore();
}

async function renderImage(
	ctx: CanvasRenderingContext2D,
	annotation: AnnotationRegion,
	x: number,
	y: number,
	width: number,
	height: number,
): Promise<void> {
	if (!annotation.content || !annotation.content.startsWith("data:image")) {
		return;
	}

	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			if (annotation.imageScaleMode === "fill") {
				ctx.drawImage(img, x, y, width, height);
				resolve();
				return;
			}

			// Contain within bounds, preserving aspect ratio
			const imgAspect = img.width / img.height;
			const boxAspect = width / height;

			let drawWidth = width;
			let drawHeight = height;
			let drawX = x;
			let drawY = y;

			if (imgAspect > boxAspect) {
				drawHeight = width / imgAspect;
				drawY = y + (height - drawHeight) / 2;
			} else {
				drawWidth = height * imgAspect;
				drawX = x + (width - drawWidth) / 2;
			}

			ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
			resolve();
		};
		img.onerror = () => {
			console.error("[AnnotationRenderer] Failed to load image annotation");
			resolve();
		};
		img.src = annotation.content;
	});
}

export async function renderAnnotations(
	ctx: CanvasRenderingContext2D,
	annotations: AnnotationRegion[],
	canvasWidth: number,
	canvasHeight: number,
	currentTimeMs: number,
	scaleFactor: number = 1.0,
	options?: {
		holdRegions?: HoldRegion[];
		holdCollections?: HoldCollection[];
		outputTimeMs?: number;
	},
): Promise<void> {
	const holdRegions = options?.holdRegions ?? [];
	const holdCollections = options?.holdCollections ?? [];
	const outputTimeMs = options?.outputTimeMs ?? currentTimeMs;
	const collectionShellIds = new Set(
		holdCollections.map((collection) => collection.shellAnnotationId).filter(Boolean) as string[],
	);

	const baseAnnotations = annotations.filter(
		(ann) => !(holdRegions.length > 0 && collectionShellIds.has(ann.id)),
	);

	const holdCollectionOverlays =
		holdRegions.length > 0 && holdCollections.length > 0
			? buildHoldCollectionOverlayAnnotations(holdCollections, holdRegions, outputTimeMs)
			: [];

	const mergedAnnotations = [...baseAnnotations, ...holdCollectionOverlays];

	const segmentIds = new Set(
		holdCollections.flatMap((collection) => collection.segments.map((segment) => segment.id)),
	);

	const activeAnnotations = mergedAnnotations.filter((ann) => {
		if (holdRegions.length === 0) {
			return currentTimeMs >= ann.startMs && currentTimeMs < ann.endMs;
		}
		if (segmentIds.has(ann.id)) {
			return outputTimeMs >= ann.startMs && outputTimeMs < ann.endMs;
		}
		if (ann.freezeDuringAnnotation) {
			return isFreezeLinkedRegionVisibleAtOutputTime(
				outputTimeMs,
				ann.startMs,
				ann.endMs,
				holdRegions,
			);
		}
		return isRegionVisibleAtOutputTime(outputTimeMs, ann.startMs, ann.endMs, holdRegions);
	});

	function resolveSegmentAnimationTimeMs(annotation: AnnotationRegion): number {
		for (const collection of holdCollections) {
			const segmentIndex = collection.segments.findIndex((segment) => segment.id === annotation.id);
			if (segmentIndex >= 0) {
				const span = holdCollectionSegmentToOutputSpan(collection, segmentIndex, holdRegions);
				return outputTimeMs - span.start;
			}
		}
		return resolveAnnotationAnimationTimeMs(outputTimeMs, annotation.startMs, holdRegions);
	}

	// Lower z-index first so higher draws on top
	const sortedAnnotations = [...activeAnnotations].sort((a, b) => a.zIndex - b.zIndex);

	for (const annotation of sortedAnnotations) {
		const animationTimeMs =
			holdRegions.length > 0 ? resolveSegmentAnimationTimeMs(annotation) : currentTimeMs;
		const x = (annotation.position.x / 100) * canvasWidth;
		const y = (annotation.position.y / 100) * canvasHeight;
		const width = (annotation.size.width / 100) * canvasWidth;
		const height = (annotation.size.height / 100) * canvasHeight;

		switch (annotation.type) {
			case "text":
				renderText(ctx, annotation, x, y, width, height, scaleFactor, animationTimeMs);
				break;

			case "image":
				await renderImage(ctx, annotation, x, y, width, height);
				break;

			case "figure":
				if (annotation.figureData) {
					renderArrow(
						ctx,
						annotation.figureData,
						annotation.startMs,
						animationTimeMs,
						x,
						y,
						width,
						height,
						scaleFactor,
					);
				}
				break;

			case "blur":
				renderBlur(ctx, annotation, x, y, width, height, scaleFactor);
				break;
		}
	}
}
