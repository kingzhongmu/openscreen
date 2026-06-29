import { describe, expect, it } from "vitest";
import { toFileUrl } from "@/components/video-editor/projectPersistence";
import {
	AUDIO_ANNOTATION_ASSETS_DIR,
	isEphemeralAudioUrl,
	isProjectRelativeAudioPath,
	normalizePersistedAudioUrl,
	resolveAudioClipsForProjectLoad,
} from "@/lib/audioAnnotationPersistence";

describe("audioAnnotationPersistence", () => {
	it("detects ephemeral blob urls", () => {
		expect(isEphemeralAudioUrl("blob:http://localhost/abc")).toBe(true);
		expect(isEphemeralAudioUrl("file:///C:/tmp/audio.mp3")).toBe(false);
	});

	it("detects project-relative audio paths", () => {
		expect(isProjectRelativeAudioPath("audio-assets/audio-annotation-1.mp3")).toBe(true);
		expect(isProjectRelativeAudioPath("file:///C:/tmp/audio.mp3")).toBe(false);
	});

	it("resolves relative audio paths when loading a project", () => {
		const projectPath = "C:\\Projects\\demo.openscreen";
		const [clip] = resolveAudioClipsForProjectLoad(
			[
				{
					id: "audio-annotation-1",
					anchorMs: 1000,
					durationMs: 3000,
					source: "import",
					audioUrl: `${AUDIO_ANNOTATION_ASSETS_DIR}/audio-annotation-1.mp3`,
					fileName: "narration.mp3",
				},
			],
			projectPath,
		);

		expect(clip.audioUrl).toBe(toFileUrl("C:\\Projects\\audio-assets\\audio-annotation-1.mp3"));
		expect(clip.sourceFilePath).toBe("C:\\Projects\\audio-assets\\audio-annotation-1.mp3");
	});

	it("normalizes project asset file urls for snapshots", () => {
		expect(
			normalizePersistedAudioUrl(toFileUrl("C:\\Projects\\audio-assets\\audio-annotation-1.mp3")),
		).toBe("audio-assets/audio-annotation-1.mp3");
	});
});
