import { normalizeFigureData } from "@/components/video-editor/arrowGeometry";
import {
	type AnnotationTextStyle,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	type FigureData,
} from "@/components/video-editor/types";
import { normalizeTextAnimation } from "@/lib/annotationTextAnimation";

const PRESETS_KEY = "openscreen_annotation_presets";

interface AnnotationPresets {
	textStyle: AnnotationTextStyle;
	figureData: FigureData;
}

const DEFAULT_PRESETS: AnnotationPresets = {
	textStyle: { ...DEFAULT_ANNOTATION_STYLE },
	figureData: { ...DEFAULT_FIGURE_DATA },
};

function safeJsonParse(text: string | null): Record<string, unknown> | null {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function clampFontSize(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_ANNOTATION_STYLE.fontSize;
	}
	return Math.max(8, Math.min(256, Math.round(value)));
}

export function normalizeAnnotationTextStyle(
	input: Partial<AnnotationTextStyle> | undefined,
): AnnotationTextStyle {
	const style = input && typeof input === "object" ? input : {};
	return {
		color: typeof style.color === "string" ? style.color : DEFAULT_ANNOTATION_STYLE.color,
		backgroundColor:
			typeof style.backgroundColor === "string"
				? style.backgroundColor
				: DEFAULT_ANNOTATION_STYLE.backgroundColor,
		fontSize: clampFontSize(style.fontSize),
		fontFamily:
			typeof style.fontFamily === "string" ? style.fontFamily : DEFAULT_ANNOTATION_STYLE.fontFamily,
		fontWeight: style.fontWeight === "bold" ? "bold" : "normal",
		fontStyle: style.fontStyle === "italic" ? "italic" : "normal",
		textDecoration: style.textDecoration === "underline" ? "underline" : "none",
		textAlign:
			style.textAlign === "left" || style.textAlign === "right" ? style.textAlign : "center",
		textAnimation: normalizeTextAnimation(style.textAnimation),
	};
}

function loadPresets(): AnnotationPresets {
	let raw: Record<string, unknown> | null = null;
	try {
		raw = safeJsonParse(localStorage.getItem(PRESETS_KEY));
	} catch {
		return { ...DEFAULT_PRESETS, textStyle: { ...DEFAULT_PRESETS.textStyle } };
	}

	if (!raw || typeof raw !== "object") {
		return {
			textStyle: { ...DEFAULT_PRESETS.textStyle },
			figureData: { ...DEFAULT_PRESETS.figureData },
		};
	}

	const textStyleRaw =
		raw.textStyle && typeof raw.textStyle === "object"
			? (raw.textStyle as Partial<AnnotationTextStyle>)
			: undefined;
	const figureDataRaw =
		raw.figureData && typeof raw.figureData === "object"
			? (raw.figureData as Partial<FigureData>)
			: undefined;

	return {
		textStyle: normalizeAnnotationTextStyle(textStyleRaw),
		figureData: normalizeFigureData({
			...DEFAULT_FIGURE_DATA,
			...figureDataRaw,
		}),
	};
}

function savePresets(partial: Partial<AnnotationPresets>): void {
	const current = loadPresets();
	const next: AnnotationPresets = {
		textStyle: partial.textStyle
			? normalizeAnnotationTextStyle(partial.textStyle)
			: current.textStyle,
		figureData: partial.figureData ? normalizeFigureData(partial.figureData) : current.figureData,
	};

	try {
		localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
	} catch {
		// localStorage may be unavailable
	}
}

export function getAnnotationTextStylePreset(): AnnotationTextStyle {
	return { ...loadPresets().textStyle };
}

export function saveAnnotationTextStylePreset(style: Partial<AnnotationTextStyle>): void {
	const current = loadPresets().textStyle;
	savePresets({ textStyle: { ...current, ...style } });
}

export function restoreAnnotationTextStyleDefaults(): AnnotationTextStyle {
	const defaults = { ...DEFAULT_ANNOTATION_STYLE };
	savePresets({ textStyle: defaults });
	return defaults;
}

export function getAnnotationFigureDataPreset(): FigureData {
	return { ...loadPresets().figureData };
}

export function saveAnnotationFigureDataPreset(figureData: FigureData): void {
	savePresets({ figureData: normalizeFigureData(figureData) });
}

export function restoreAnnotationFigureDataDefaults(): FigureData {
	const defaults = { ...DEFAULT_FIGURE_DATA };
	savePresets({ figureData: defaults });
	return defaults;
}
