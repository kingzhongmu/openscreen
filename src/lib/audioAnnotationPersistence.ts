import { fromFileUrl, toFileUrl } from "@/components/video-editor/projectPersistence";
import type { AudioAnnotationClip } from "@/components/video-editor/types";
import { ACCEPTED_AUDIO_ANNOTATION_EXTENSIONS } from "@/lib/audioAnnotation";
import { parentDirectoryOf } from "@/lib/userPreferences";

export const AUDIO_ANNOTATION_ASSETS_DIR = "audio-assets";

export interface ProjectAudioAssetPayload {
	clipId: string;
	fileName: string;
	data?: ArrayBuffer;
	sourcePath?: string;
}

export function isEphemeralAudioUrl(audioUrl: string): boolean {
	return audioUrl.startsWith("blob:") || audioUrl.startsWith("data:");
}

export function isProjectRelativeAudioPath(audioUrl: string): boolean {
	return (
		audioUrl.startsWith(`${AUDIO_ANNOTATION_ASSETS_DIR}/`) ||
		audioUrl.startsWith(`./${AUDIO_ANNOTATION_ASSETS_DIR}/`)
	);
}

function joinProjectPath(projectDir: string, relativePath: string): string {
	const sep = projectDir.includes("\\") ? "\\" : "/";
	const rel = relativePath
		.replace(/^\.?\//, "")
		.split(/[/\\]/)
		.join(sep);
	return `${projectDir}${projectDir.endsWith(sep) ? "" : sep}${rel}`;
}

function normalizeAudioExtension(fileName: string): string {
	const lower = fileName.toLowerCase();
	for (const ext of ACCEPTED_AUDIO_ANNOTATION_EXTENSIONS) {
		if (lower.endsWith(ext)) {
			return ext;
		}
	}
	return ".mp3";
}

function isPathUnderDirectory(filePath: string, directory: string): boolean {
	const normalizedFile = filePath.replace(/\\/g, "/").toLowerCase();
	const normalizedDir = directory.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	return normalizedFile.startsWith(`${normalizedDir}/`);
}

export function resolveImportedAudioReference(file: File): {
	audioUrl: string;
	sourceFilePath?: string;
} {
	const sourceFilePath = window.electronAPI?.getPathForFile?.(file)?.trim();
	if (sourceFilePath) {
		return {
			audioUrl: toFileUrl(sourceFilePath),
			sourceFilePath,
		};
	}

	return { audioUrl: URL.createObjectURL(file) };
}

export function resolveAudioClipsForProjectLoad(
	clips: AudioAnnotationClip[],
	projectFilePath: string | null | undefined,
): AudioAnnotationClip[] {
	if (!projectFilePath) {
		return clips;
	}

	const projectDir = parentDirectoryOf(projectFilePath);
	if (!projectDir) {
		return clips;
	}

	return clips.map((clip) => {
		const url = clip.audioUrl;

		if (isEphemeralAudioUrl(url)) {
			return clip;
		}

		if (isProjectRelativeAudioPath(url)) {
			const absolutePath = joinProjectPath(projectDir, url);
			return {
				...clip,
				audioUrl: toFileUrl(absolutePath),
				sourceFilePath: absolutePath,
			};
		}

		if (url.startsWith("file://")) {
			const absolutePath = fromFileUrl(url);
			return {
				...clip,
				sourceFilePath: clip.sourceFilePath ?? absolutePath,
			};
		}

		return clip;
	});
}

export async function collectAudioAssetsForProjectSave(
	clips: AudioAnnotationClip[],
	projectFilePath: string | null,
): Promise<ProjectAudioAssetPayload[]> {
	const projectDir = projectFilePath ? parentDirectoryOf(projectFilePath) : null;
	const assets: ProjectAudioAssetPayload[] = [];

	for (const clip of clips) {
		const url = clip.audioUrl;
		const fileName =
			clip.fileName ?? `${clip.id}${normalizeAudioExtension(clip.fileName ?? ".mp3")}`;

		if (projectDir && isProjectRelativeAudioPath(url) && !isEphemeralAudioUrl(url)) {
			continue;
		}

		if (url.startsWith("file://") && projectDir) {
			const absolutePath = fromFileUrl(url);
			if (
				isPathUnderDirectory(absolutePath, joinProjectPath(projectDir, AUDIO_ANNOTATION_ASSETS_DIR))
			) {
				continue;
			}
		}

		if (isEphemeralAudioUrl(url)) {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`Failed to read audio clip ${clip.id}`);
			}
			assets.push({
				clipId: clip.id,
				fileName,
				data: await response.arrayBuffer(),
			});
			continue;
		}

		const sourcePath =
			clip.sourceFilePath ?? (url.startsWith("file://") ? fromFileUrl(url) : undefined);
		if (sourcePath) {
			assets.push({
				clipId: clip.id,
				fileName,
				sourcePath,
			});
		}
	}

	return assets;
}

export function applyPersistedAudioClipPaths(
	clips: AudioAnnotationClip[],
	projectFilePath: string,
	audioClipPaths: Record<string, string>,
): AudioAnnotationClip[] {
	const projectDir = parentDirectoryOf(projectFilePath);
	if (!projectDir) {
		return clips;
	}

	return clips.map((clip) => {
		const relativePath = audioClipPaths[clip.id];
		if (!relativePath) {
			return clip;
		}

		const absolutePath = joinProjectPath(projectDir, relativePath);
		return {
			...clip,
			audioUrl: toFileUrl(absolutePath),
			sourceFilePath: absolutePath,
		};
	});
}

export function serializeAudioClipsForProjectJson(
	clips: AudioAnnotationClip[],
	audioClipPaths: Record<string, string>,
): AudioAnnotationClip[] {
	return clips.map((clip) => {
		const relativePath = audioClipPaths[clip.id] ?? clip.audioUrl;
		const { sourceFilePath: _sourceFilePath, ...rest } = clip;
		return {
			...rest,
			audioUrl: relativePath.startsWith("file://")
				? relativePath
				: relativePath.replace(/\\/g, "/"),
		};
	});
}

export function normalizePersistedAudioUrl(audioUrl: string): string {
	if (isProjectRelativeAudioPath(audioUrl)) {
		return audioUrl.replace(/^\.\//, "");
	}

	if (audioUrl.startsWith("file://")) {
		const absolutePath = fromFileUrl(audioUrl).replace(/\\/g, "/");
		const marker = `/${AUDIO_ANNOTATION_ASSETS_DIR}/`;
		const markerIndex = absolutePath.indexOf(marker);
		if (markerIndex >= 0) {
			return absolutePath.slice(markerIndex + 1);
		}
	}

	return audioUrl;
}
