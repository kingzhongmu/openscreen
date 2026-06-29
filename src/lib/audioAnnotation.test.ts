import { describe, expect, it } from "vitest";
import { buildAudioAnnotationClip, isAcceptedAudioAnnotationFile } from "@/lib/audioAnnotation";

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

	it("rejects invalid file types", () => {
		expect(
			isAcceptedAudioAnnotationFile(new File(["x"], "voice.txt", { type: "text/plain" })),
		).toBe(false);
		expect(
			isAcceptedAudioAnnotationFile(new File(["x"], "voice.mp3", { type: "audio/mpeg" })),
		).toBe(true);
	});
});
