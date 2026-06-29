import { beforeEach, describe, expect, it } from "vitest";
import { normalizeFigureData } from "@/components/video-editor/arrowGeometry";
import { DEFAULT_ANNOTATION_STYLE, DEFAULT_FIGURE_DATA } from "@/components/video-editor/types";
import {
	getAnnotationFigureDataPreset,
	getAnnotationTextStylePreset,
	restoreAnnotationFigureDataDefaults,
	restoreAnnotationTextStyleDefaults,
	saveAnnotationFigureDataPreset,
	saveAnnotationTextStylePreset,
} from "./annotationPreferences";

describe("annotationPreferences", () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		Object.defineProperty(globalThis, "localStorage", {
			value: {
				getItem: (key: string) => store.get(key) ?? null,
				setItem: (key: string, value: string) => {
					store.set(key, String(value));
				},
				removeItem: (key: string) => {
					store.delete(key);
				},
				clear: () => store.clear(),
			},
			configurable: true,
		});
		localStorage.clear();
	});

	it("returns built-in defaults when nothing is persisted", () => {
		expect(getAnnotationTextStylePreset()).toEqual(DEFAULT_ANNOTATION_STYLE);
		expect(getAnnotationFigureDataPreset()).toEqual(DEFAULT_FIGURE_DATA);
	});

	it("persists text style changes for the next annotation", () => {
		saveAnnotationTextStylePreset({ fontFamily: "Georgia, serif", fontSize: 48, color: "#ff0000" });

		expect(getAnnotationTextStylePreset()).toMatchObject({
			fontFamily: "Georgia, serif",
			fontSize: 48,
			color: "#ff0000",
		});
	});

	it("persists figure data changes for the next annotation", () => {
		saveAnnotationFigureDataPreset(
			normalizeFigureData({
				arrowDirection: "up",
				color: "#123456",
				shaftWidth: 40,
				shaftLength: 120,
				headWidth: 50,
				headLength: 35,
			}),
		);

		expect(getAnnotationFigureDataPreset()).toMatchObject({
			arrowDirection: "up",
			color: "#123456",
			shaftWidth: 40,
			shaftLength: 120,
			headWidth: 50,
			headLength: 35,
		});
	});

	it("restores built-in defaults and clears saved presets", () => {
		saveAnnotationTextStylePreset({ fontSize: 96 });
		saveAnnotationFigureDataPreset(
			normalizeFigureData({ ...DEFAULT_FIGURE_DATA, arrowDirection: "left" }),
		);

		expect(restoreAnnotationTextStyleDefaults()).toEqual(DEFAULT_ANNOTATION_STYLE);
		expect(restoreAnnotationFigureDataDefaults()).toEqual(DEFAULT_FIGURE_DATA);
		expect(getAnnotationTextStylePreset()).toEqual(DEFAULT_ANNOTATION_STYLE);
		expect(getAnnotationFigureDataPreset()).toEqual(DEFAULT_FIGURE_DATA);
	});
});
