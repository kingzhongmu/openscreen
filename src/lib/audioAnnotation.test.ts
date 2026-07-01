import { describe, expect, it } from "vitest";
import {
	bgmClipToOutputSpan,
	buildAudioAnnotationClip,
	buildBgmAudioClip,
	getMaxBgmClipDurationMs,
	isAcceptedAudioAnnotationFile,
	isBgmAudioClip,
	usesSourceTimelineAudioPlayback,
} from "@/lib/audioAnnotation";

describe("buildAudioAnnotationClip", () => {
	it("anchors at playhead and clamps duration to source length", () => {
		const clip = buildAudioAnnotationClip(
			"audio-annotation-1",
			5000,
			"blob:audio",
			8000,
			"voice.wav",
			60_000,
		);

		expect(clip).toEqual({
			id: "audio-annotation-1",
			anchorMs: 5000,
			durationMs: 8000,
			source: "import",
			audioUrl: "blob:audio",
			fileName: "voice.wav",
			sourceDurationMs: 8000,
			volume: 1,
		});
	});
});

describe("buildBgmAudioClip", () => {
	it("anchors at 0 and marks role as bgm", () => {
		const clip = buildBgmAudioClip("bgm-1", "blob:audio", 45_000, "music.mp3", 60_000);

		expect(clip).toMatchObject({
			id: "bgm-1",
			anchorMs: 0,
			durationMs: 30_000,
			role: "bgm",
			fileName: "music.mp3",
		});
	});
});

describe("isBgmAudioClip", () => {
	it("treats legacy standalone clips as bgm", () => {
		expect(
			isBgmAudioClip({
				id: "audio-annotation-1",
				anchorMs: 0,
				durationMs: 5000,
				source: "import",
				audioUrl: "blob:",
			}),
		).toBe(true);
	});

	it("excludes linked narration clips", () => {
		expect(
			isBgmAudioClip({
				id: "linked-audio:annotation-1",
				anchorMs: 1000,
				durationMs: 5000,
				source: "import",
				audioUrl: "blob:",
			}),
		).toBe(false);
	});
});

describe("usesSourceTimelineAudioPlayback", () => {
	it("uses source timeline for bgm", () => {
		expect(
			usesSourceTimelineAudioPlayback({
				id: "bgm-1",
				anchorMs: 0,
				durationMs: 5000,
				source: "import",
				audioUrl: "blob:",
				role: "bgm",
			}),
		).toBe(true);
	});
});

describe("getMaxBgmClipDurationMs", () => {
	const holdRegions: import("@/components/video-editor/types").HoldRegion[] = [
		{ id: "hold-1", sourceMs: 5000, holdDurationMs: 3000 },
	];

	it("extends max duration to cover preview output when holds exist", () => {
		expect(getMaxBgmClipDurationMs(0, 60_000, holdRegions)).toBe(63_000);
	});

	it("caps at source file length", () => {
		expect(getMaxBgmClipDurationMs(0, 60_000, holdRegions, 45_000)).toBe(45_000);
	});
});

describe("bgmClipToOutputSpan", () => {
	it("maps bgm span onto output timeline in preview mode", () => {
		const holds: import("@/components/video-editor/types").HoldRegion[] = [
			{ id: "hold-1", sourceMs: 5000, holdDurationMs: 3000 },
		];
		expect(bgmClipToOutputSpan(0, 30_000, holds, 60_000)).toEqual({
			start: 0,
			end: 30_000,
		});
		expect(bgmClipToOutputSpan(0, 63_000, holds, 60_000)).toEqual({
			start: 0,
			end: 63_000,
		});
	});
});

describe("isAcceptedAudioAnnotationFile", () => {
	it("rejects invalid file types", () => {
		expect(
			isAcceptedAudioAnnotationFile(new File(["x"], "voice.txt", { type: "text/plain" })),
		).toBe(false);
		expect(
			isAcceptedAudioAnnotationFile(new File(["x"], "voice.mp3", { type: "audio/mpeg" })),
		).toBe(true);
	});
});
