import type { Span } from "dnd-timeline";
import { FolderOpen, Languages, Save, Video } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { type EditorState, INITIAL_EDITOR_STATE, useEditorHistory } from "@/hooks/useEditorHistory";
import { type Locale } from "@/i18n/config";
import { getAvailableLocales, getLocaleName } from "@/i18n/loader";
import {
	getAnnotationFigureDataPreset,
	saveAnnotationFigureDataPreset,
	saveAnnotationTextStylePreset,
} from "@/lib/annotationPreferences";
import {
	buildAudioAnnotationClip,
	getAudioFileDurationMs,
	isAcceptedAudioAnnotationFile,
} from "@/lib/audioAnnotation";
import {
	applyPersistedAudioClipPaths,
	collectAudioAssetsForProjectSave,
	resolveAudioClipsForProjectLoad,
	resolveImportedAudioReference,
} from "@/lib/audioAnnotationPersistence";
import {
	captionSegmentsToAnnotationRegions,
	extractMono16kFromVideoUrl,
	MAX_CAPTION_AUDIO_SEC,
	reconcileAutoCaptionTimelineGaps,
	shiftTrimRegionsMsForCaptionBuffer,
	transcribeMono16kToSegments,
	trimLeadingSilenceMono16k,
} from "@/lib/captioning";
import { hasNativeCursorRecordingData } from "@/lib/cursor/nativeCursor";
import {
	calculateEffectiveSourceDimensions,
	calculateMp4ExportSettings,
	calculateOutputDimensions,
	type ExportFormat,
	type ExportProgress,
	type ExportQuality,
	type ExportSettings,
	GIF_SIZE_PRESETS,
	GifExporter,
	type GifFrameRate,
	type GifSizePreset,
	VideoExporter,
} from "@/lib/exporter";
import { computeFrameStepTime } from "@/lib/frameStep";
import {
	annotationRegionToHoldCollection,
	appendHoldCollectionSegment,
	applyShellAnnotationEditsToCollection,
	createHoldCollection,
	DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS,
	findHoldCollectionByShellId,
	removeHoldCollectionsByShellId,
	setHoldCollectionFirstSegmentDuration,
	syncShellAnnotationsFromHoldCollections,
} from "@/lib/holdCollection";
import {
	removeHoldCollectionSegment,
	setHoldCollectionSegmentDuration,
	setHoldCollectionSegmentPairDurations,
	setHoldCollectionTotalDuration,
	updateHoldCollectionSegmentContent,
} from "@/lib/holdCollectionTimeline";
import { alignAllFreezeAnchors, syncHoldRegionsFromEditor } from "@/lib/holdRegions";
import type { CursorCaptureMode, ProjectMedia } from "@/lib/recordingSession";
import { matchesShortcut } from "@/lib/shortcuts";
import { getOutputDurationMs, sourceToOutputMs } from "@/lib/timelineMapping";
import {
	getExportFolder,
	getProjectFolder,
	loadUserPreferences,
	parentDirectoryOf,
	saveUserPreferences,
} from "@/lib/userPreferences";
import { BackgroundLoadError } from "@/lib/wallpaper";
import { nativeBridgeClient, useCursorRecordingData, useCursorTelemetry } from "@/native";
import type { NativePlatform } from "@/native/contracts";
import {
	getAspectRatioValue,
	getNativeAspectRatioValue,
	isPortraitAspectRatio,
} from "@/utils/aspectRatioUtils";
import { AddPositionAnnotationMenu } from "./AddPositionAnnotationMenu";
import { EditorEmptyState } from "./EditorEmptyState";
import { ExportDialog } from "./ExportDialog";
import {
	DEFAULT_CURSOR_SETTINGS,
	DEFAULT_EXPORT_SETTINGS,
	DEFAULT_GIF_SETTINGS,
	DEFAULT_SOURCE_DIMENSIONS,
} from "./editorDefaults";
import PlaybackControls from "./PlaybackControls";
import {
	buildPositionAnnotationRegion,
	computePositionAnnotationSpan,
	DEFAULT_POSITION_ANNOTATION_DURATION_MS,
	MIN_POSITION_ANNOTATION_DURATION_MS,
} from "./positionAnnotation";
import {
	createProjectData,
	createProjectSnapshot,
	deriveNextId,
	fromFileUrl,
	hasProjectUnsavedChanges,
	normalizeProjectEditor,
	resolveProjectMedia,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";
import { SettingsPanel } from "./SettingsPanel";
import TimelineEditor from "./timeline/TimelineEditor";
import { buildAutoZoomSuggestions } from "./timeline/zoomSuggestionUtils";
import {
	type AnnotationRegion,
	type BlurData,
	clampFocusToDepth,
	DEFAULT_BLUR_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_ZOOM_DEPTH,
	type EditorPlaybackMode,
	type FigureData,
	type PlaybackSpeed,
	type Rotation3DPreset,
	type SpeedRegion,
	type TrimRegion,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomFocusMode,
	type ZoomRegion,
} from "./types";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import { holdPlaybackLog } from "./videoPlayback/holdPlaybackDebug";

/** Single Sonner slot so auto-caption phases update in place instead of stacking. */
const AUTO_CAPTION_PROGRESS_TOAST_ID = "auto-caption-progress";

function isClickInteractionType(interactionType: string | null | undefined) {
	return (
		interactionType === "click" ||
		interactionType === "double-click" ||
		interactionType === "right-click" ||
		interactionType === "middle-click"
	);
}

interface ExportDiagnostics {
	formatLabel: "GIF" | "Video";
	reason?: string;
	sourcePath?: string | null;
	width?: number;
	height?: number;
	frameRate?: number;
	codec?: string;
	bitrate?: number;
}

function getFileNameForDiagnostics(filePath?: string | null) {
	if (!filePath) return "unknown";

	try {
		const url = new URL(filePath);
		if (url.protocol === "file:") {
			return decodeURIComponent(url.pathname).split(/[\\/]/).pop() || filePath;
		}
	} catch {
		// Treat non-URL values as filesystem paths.
	}

	return filePath.split(/[\\/]/).pop() || filePath;
}

function buildExportDiagnosticMessage(diagnostics: ExportDiagnostics) {
	const details = [
		diagnostics.reason ? `Reason: ${diagnostics.reason}` : null,
		`Source: ${getFileNameForDiagnostics(diagnostics.sourcePath)}`,
		diagnostics.width && diagnostics.height
			? `Output: ${diagnostics.width}x${diagnostics.height}${
					diagnostics.frameRate ? ` @ ${diagnostics.frameRate} fps` : ""
				}`
			: null,
		diagnostics.codec ? `Codec: ${diagnostics.codec}` : null,
		diagnostics.bitrate ? `Bitrate: ${Math.round(diagnostics.bitrate / 1_000_000)} Mbps` : null,
		`VideoEncoder: ${"VideoEncoder" in window ? "available" : "unavailable"}`,
	].filter(Boolean);

	return `${diagnostics.formatLabel} export failed\n${details.join("\n")}`;
}

function buildSaveDiagnosticMessage(formatLabel: "GIF" | "Video", reason?: string) {
	return `${formatLabel} export save failed${reason ? `\nReason: ${reason}` : ""}`;
}

const CAPTION_WORD_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function withSyncedHoldRegions(
	prev: EditorState,
	updates: Partial<
		Pick<EditorState, "annotationRegions" | "audioAnnotationClips" | "holdCollections">
	>,
): Partial<EditorState> {
	const holdCollections = updates.holdCollections ?? prev.holdCollections ?? [];
	const rawAnnotations = updates.annotationRegions ?? prev.annotationRegions;
	const rawClips = updates.audioAnnotationClips ?? prev.audioAnnotationClips;
	const audioClipIds = new Set(rawClips.map((clip) => clip.id));
	const annotationRegions = syncShellAnnotationsFromHoldCollections(
		rawAnnotations,
		holdCollections,
		audioClipIds,
	);
	const { annotations: alignedAnnotations, audioClips: audioAnnotationClips } =
		alignAllFreezeAnchors(annotationRegions, rawClips);
	return {
		...updates,
		holdCollections,
		annotationRegions: alignedAnnotations,
		audioAnnotationClips,
		holdRegions: syncHoldRegionsFromEditor(
			alignedAnnotations,
			audioAnnotationClips,
			prev.holdRegions,
			holdCollections,
		),
	};
}

function syncHoldCollectionShellEdit(
	prev: EditorState,
	shellId: string,
	patchRegion: (region: AnnotationRegion) => AnnotationRegion,
): Partial<EditorState> {
	const collection = findHoldCollectionByShellId(prev.holdCollections, shellId);
	if (!collection) {
		return {
			annotationRegions: prev.annotationRegions.map((region) =>
				region.id === shellId ? patchRegion(region) : region,
			),
		};
	}
	const region = prev.annotationRegions.find((entry) => entry.id === shellId);
	if (!region) {
		return {};
	}
	const updatedCollection = applyShellAnnotationEditsToCollection(collection, patchRegion(region));
	return withSyncedHoldRegions(prev, {
		holdCollections: (prev.holdCollections ?? []).map((entry) =>
			entry.id === collection.id ? updatedCollection : entry,
		),
	});
}

export default function VideoEditor() {
	const {
		state: editorState,
		pushState,
		updateState,
		commitState,
		undo,
		redo,
		resetState,
	} = useEditorHistory(INITIAL_EDITOR_STATE);

	const {
		zoomRegions,
		autoZoomEnabled,
		autoFocusAll,
		trimRegions,
		speedRegions,
		annotationRegions,
		audioAnnotationClips,
		holdRegions,
		holdCollections,
		cropRegion,
		wallpaper,
		shadowIntensity,
		showBlur,
		showTrimWaveform,
		motionBlurAmount,
		borderRadius,
		padding,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamMirrored,
		webcamReactiveZoom,
		webcamSizePreset,
		webcamPosition,
	} = editorState;

	// Non-undoable state
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [webcamVideoPath, setWebcamVideoPath] = useState<string | null>(null);
	const [webcamVideoSourcePath, setWebcamVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [outputPlaybackTimeMs, setOutputPlaybackTimeMs] = useState(0);
	const [playbackMode, setPlaybackMode] = useState<EditorPlaybackMode>("source");
	const [duration, setDuration] = useState(0);
	const currentTimeRef = useRef(currentTime);
	currentTimeRef.current = currentTime;
	const durationRef = useRef(duration);
	durationRef.current = duration;
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [isPreviewingZoom, setIsPreviewingZoom] = useState(false);
	const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
	const [selectedSpeedId, setSelectedSpeedId] = useState<string | null>(null);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [selectedHoldSegmentKey, setSelectedHoldSegmentKey] = useState<string | null>(null);
	const [selectedAudioAnnotationId, setSelectedAudioAnnotationId] = useState<string | null>(null);
	const [selectedBlurId, setSelectedBlurId] = useState<string | null>(null);
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDialog, setShowExportDialog] = useState(false);
	const [showNewRecordingDialog, setShowNewRecordingDialog] = useState(false);
	const [exportQuality, setExportQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_SETTINGS.quality,
	);
	const [exportFormat, setExportFormat] = useState<ExportFormat>(DEFAULT_EXPORT_SETTINGS.format);
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(DEFAULT_GIF_SETTINGS.frameRate);
	const [gifLoop, setGifLoop] = useState(DEFAULT_GIF_SETTINGS.loop);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(
		DEFAULT_GIF_SETTINGS.sizePreset,
	);
	const [exportedFilePath, setExportedFilePath] = useState<string | null>(null);
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
	const [unsavedExport, setUnsavedExport] = useState<{
		arrayBuffer: ArrayBuffer;
		fileName: string;
		format: string;
	} | null>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showCloseConfirmDialog, setShowCloseConfirmDialog] = useState(false);
	// Unsaved-changes confirmation for New Project / Load Project.
	// The window-close flow uses showCloseConfirmDialog above.
	const [confirmDialogVariant, setConfirmDialogVariant] = useState<
		"newProject" | "loadProject" | null
	>(null);
	const playerContainerRef = useRef<HTMLDivElement | null>(null);
	const cursorTelemetrySourcePath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
	const { samples: cursorTelemetry, error: cursorTelemetryError } =
		useCursorTelemetry(cursorTelemetrySourcePath);
	const { data: cursorRecordingData, error: cursorRecordingDataError } =
		useCursorRecordingData(cursorTelemetrySourcePath);
	const cursorClickTimestamps = useMemo<number[]>(() => {
		const recordingClicks =
			cursorRecordingData?.samples
				.filter((sample) => isClickInteractionType(sample.interactionType))
				.map((sample) => sample.timeMs) ?? [];
		if (recordingClicks.length > 0) {
			return recordingClicks;
		}

		return cursorTelemetry
			.filter((sample) => isClickInteractionType(sample.interactionType))
			.map((sample) => sample.timeMs);
	}, [cursorRecordingData, cursorTelemetry]);

	// Cursor & motion blur visual settings (non-undoable preferences)
	const [showCursor, setShowCursor] = useState(DEFAULT_CURSOR_SETTINGS.show);
	const [cursorSize, setCursorSize] = useState(DEFAULT_CURSOR_SETTINGS.size);
	const [cursorSmoothing, setCursorSmoothing] = useState(DEFAULT_CURSOR_SETTINGS.smoothing);
	const [cursorMotionBlur, setCursorMotionBlur] = useState(DEFAULT_CURSOR_SETTINGS.motionBlur);
	const [cursorClickBounce, setCursorClickBounce] = useState(DEFAULT_CURSOR_SETTINGS.clickBounce);
	const [cursorClipToBounds, setCursorClipToBounds] = useState(
		DEFAULT_CURSOR_SETTINGS.clipToBounds,
	);
	const [cursorTheme, setCursorTheme] = useState(DEFAULT_CURSOR_SETTINGS.theme);
	const [nativePlatform, setNativePlatform] = useState<NativePlatform | null>(null);
	const [recordingCursorCaptureMode, setRecordingCursorCaptureMode] =
		useState<CursorCaptureMode | null>(null);

	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);

	const nextZoomIdRef = useRef(1);
	const nextTrimIdRef = useRef(1);
	const nextSpeedIdRef = useRef(1);

	const { shortcuts, isMac } = useShortcuts();
	// Windows recordings include captured cursor assets. macOS hides the system
	// cursor in ScreenCaptureKit and renders telemetry samples with OpenScreen's
	// default arrow asset for the editable overlay.
	const hasEditableCursorRecording =
		recordingCursorCaptureMode === "editable-overlay" &&
		(nativePlatform === "win32" || nativePlatform === "darwin") &&
		hasNativeCursorRecordingData(cursorRecordingData);
	const effectiveShowCursor = showCursor && hasEditableCursorRecording;
	const showCursorSettings = hasEditableCursorRecording;
	const { locale, setLocale, t: rawT } = useI18n();
	const t = useScopedT("editor");
	const ts = useScopedT("settings");
	const availableLocales = getAvailableLocales();

	const nextAnnotationIdRef = useRef(1);
	const nextAudioAnnotationIdRef = useRef(1);
	const audioImportInputRef = useRef<HTMLInputElement | null>(null);
	const nextAnnotationZIndexRef = useRef(1);
	const isAutoCaptioningRef = useRef(false);
	const [isAutoCaptioning, setIsAutoCaptioning] = useState(false);
	const [showAutoCaptionsDialog, setShowAutoCaptionsDialog] = useState(false);
	const [captionWordsMin, setCaptionWordsMin] = useState(2);
	const [captionWordsMax, setCaptionWordsMax] = useState(7);
	const exporterRef = useRef<VideoExporter | null>(null);

	const annotationOnlyRegions = useMemo(
		() => annotationRegions.filter((region) => region.type !== "blur"),
		[annotationRegions],
	);
	const blurRegions = useMemo(
		() => annotationRegions.filter((region) => region.type === "blur"),
		[annotationRegions],
	);

	const currentProjectMedia = useMemo<ProjectMedia | null>(() => {
		const screenVideoPath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
		if (!screenVideoPath) {
			return null;
		}

		const webcamSourcePath =
			webcamVideoSourcePath ?? (webcamVideoPath ? fromFileUrl(webcamVideoPath) : null);
		return {
			screenVideoPath,
			...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
			...(recordingCursorCaptureMode ? { cursorCaptureMode: recordingCursorCaptureMode } : {}),
		};
	}, [
		videoPath,
		videoSourcePath,
		webcamVideoPath,
		webcamVideoSourcePath,
		recordingCursorCaptureMode,
	]);

	const applyLoadedProject = useCallback(
		async (candidate: unknown, path?: string | null) => {
			if (!validateProjectData(candidate)) {
				return false;
			}

			const project = candidate;
			const projectMedia = resolveProjectMedia(project);
			if (!projectMedia) {
				return false;
			}
			const sourcePath = projectMedia.screenVideoPath;
			const webcamSourcePath = projectMedia.webcamVideoPath ?? null;
			const projectCursorCaptureMode = projectMedia.cursorCaptureMode ?? null;
			const normalizedEditor = normalizeProjectEditor(project.editor);
			const inferredDurationMs = Math.max(
				0,
				...normalizedEditor.zoomRegions.map((region) => region.endMs),
				...normalizedEditor.trimRegions.map((region) => region.endMs),
				...normalizedEditor.speedRegions.map((region) => region.endMs),
				...normalizedEditor.annotationRegions.map((region) => region.endMs),
				...normalizedEditor.audioAnnotationClips.map((clip) => clip.anchorMs + clip.durationMs),
			);

			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// no-op
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(inferredDurationMs > 0 ? inferredDurationMs / 1000 : 0);

			setError(null);
			setVideoSourcePath(sourcePath);
			setVideoPath(toFileUrl(sourcePath));
			setWebcamVideoSourcePath(webcamSourcePath);
			setWebcamVideoPath(webcamSourcePath ? toFileUrl(webcamSourcePath) : null);
			setRecordingCursorCaptureMode(projectCursorCaptureMode);
			setCurrentProjectPath(path ?? null);

			// A loaded project keeps its zooms exactly as saved, so never auto-suggest
			// over it (even if it has zero zooms because the user deleted them all).
			autoProcessedSourceRef.current = sourcePath;

			pushState({
				wallpaper: normalizedEditor.wallpaper,
				shadowIntensity: normalizedEditor.shadowIntensity,
				showBlur: normalizedEditor.showBlur,
				showTrimWaveform: normalizedEditor.showTrimWaveform,
				motionBlurAmount: normalizedEditor.motionBlurAmount,
				borderRadius: normalizedEditor.borderRadius,
				padding: normalizedEditor.padding,
				cropRegion: normalizedEditor.cropRegion,
				zoomRegions: normalizedEditor.zoomRegions,
				autoZoomEnabled: normalizedEditor.autoZoomEnabled,
				autoFocusAll: normalizedEditor.autoFocusAll,
				trimRegions: normalizedEditor.trimRegions,
				speedRegions: normalizedEditor.speedRegions,
				annotationRegions: normalizedEditor.annotationRegions,
				audioAnnotationClips: resolveAudioClipsForProjectLoad(
					normalizedEditor.audioAnnotationClips,
					path,
				),
				holdRegions: normalizedEditor.holdRegions,
				holdCollections: normalizedEditor.holdCollections,
				aspectRatio: normalizedEditor.aspectRatio,
				webcamLayoutPreset: normalizedEditor.webcamLayoutPreset,
				webcamMaskShape: normalizedEditor.webcamMaskShape,
				webcamMirrored: normalizedEditor.webcamMirrored,
				webcamReactiveZoom: normalizedEditor.webcamReactiveZoom,
				webcamSizePreset: normalizedEditor.webcamSizePreset,
				webcamPosition: normalizedEditor.webcamPosition,
			});
			setExportQuality(normalizedEditor.exportQuality);
			setExportFormat(normalizedEditor.exportFormat);
			setGifFrameRate(normalizedEditor.gifFrameRate);
			setGifLoop(normalizedEditor.gifLoop);
			setGifSizePreset(normalizedEditor.gifSizePreset);
			setCursorTheme(normalizedEditor.cursorTheme);

			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioAnnotationId(null);
			setSelectedBlurId(null);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				normalizedEditor.zoomRegions.map((region) => region.id),
			);
			nextTrimIdRef.current = deriveNextId(
				"trim",
				normalizedEditor.trimRegions.map((region) => region.id),
			);
			nextSpeedIdRef.current = deriveNextId(
				"speed",
				normalizedEditor.speedRegions.map((region) => region.id),
			);
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				normalizedEditor.annotationRegions.map((region) => region.id),
			);
			nextAudioAnnotationIdRef.current = deriveNextId(
				"audio-annotation",
				normalizedEditor.audioAnnotationClips.map((clip) => clip.id),
			);
			nextAnnotationZIndexRef.current =
				normalizedEditor.annotationRegions.reduce(
					(max, region) => Math.max(max, region.zIndex),
					0,
				) + 1;

			setLastSavedSnapshot(
				createProjectSnapshot(
					{
						screenVideoPath: sourcePath,
						...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
						...(projectCursorCaptureMode ? { cursorCaptureMode: projectCursorCaptureMode } : {}),
					},
					normalizedEditor,
				),
			);
			return true;
		},
		[pushState],
	);

	const currentProjectSnapshot = useMemo(() => {
		if (!currentProjectMedia) {
			return null;
		}
		return createProjectSnapshot(currentProjectMedia, {
			wallpaper,
			shadowIntensity,
			showBlur,
			showTrimWaveform,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			autoZoomEnabled,
			autoFocusAll,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioAnnotationClips,
			holdRegions,
			holdCollections,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			cursorTheme,
		});
	}, [
		currentProjectMedia,
		cursorTheme,
		wallpaper,
		shadowIntensity,
		showBlur,
		showTrimWaveform,
		motionBlurAmount,
		borderRadius,
		padding,
		cropRegion,
		zoomRegions,
		autoZoomEnabled,
		autoFocusAll,
		trimRegions,
		speedRegions,
		annotationRegions,
		audioAnnotationClips,
		holdRegions,
		holdCollections,
		aspectRatio,
		webcamLayoutPreset,
		webcamMaskShape,
		webcamMirrored,
		webcamReactiveZoom,
		webcamSizePreset,
		webcamPosition,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
	]);

	const hasUnsavedChanges = hasProjectUnsavedChanges(currentProjectSnapshot, lastSavedSnapshot);

	useEffect(() => {
		async function loadInitialData() {
			try {
				const currentProjectResult = await nativeBridgeClient.project.loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						return;
					}
				}

				const currentSessionResult = await window.electronAPI.getCurrentRecordingSession();
				if (currentSessionResult.success && currentSessionResult.session) {
					const session = currentSessionResult.session;
					const sourcePath = fromFileUrl(session.screenVideoPath);
					const webcamSourcePath = session.webcamVideoPath
						? fromFileUrl(session.webcamVideoPath)
						: null;
					setVideoSourcePath(sourcePath);
					setVideoPath(toFileUrl(sourcePath));
					setWebcamVideoSourcePath(webcamSourcePath);
					setWebcamVideoPath(webcamSourcePath ? toFileUrl(webcamSourcePath) : null);
					setRecordingCursorCaptureMode(session.cursorCaptureMode ?? null);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot(
							{
								screenVideoPath: sourcePath,
								...(webcamSourcePath ? { webcamVideoPath: webcamSourcePath } : {}),
								...(session.cursorCaptureMode
									? { cursorCaptureMode: session.cursorCaptureMode }
									: {}),
							},
							INITIAL_EDITOR_STATE,
						),
					);
					return;
				}

				const result = await nativeBridgeClient.project.getCurrentVideoPath();
				if (result.success && result.path) {
					setVideoSourcePath(result.path);
					setVideoPath(toFileUrl(result.path));
					setRecordingCursorCaptureMode(null);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(
						createProjectSnapshot({ screenVideoPath: result.path }, INITIAL_EDITOR_STATE),
					);
				}
				// No video/project/session, so leave videoPath null and let the
				// EditorEmptyState dashboard render instead of an error screen.
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}

		loadInitialData();
	}, [applyLoadedProject]);

	// Avoid overwriting saved prefs with defaults before they've loaded.
	const [prefsHydrated, setPrefsHydrated] = useState(false);

	// Load persisted user preferences on mount (intentionally runs once)
	useEffect(() => {
		const prefs = loadUserPreferences();
		updateState({
			padding: prefs.padding,
			aspectRatio: prefs.aspectRatio,
		});
		setExportQuality(prefs.exportQuality);
		setExportFormat(prefs.exportFormat);
		setPrefsHydrated(true);
	}, [updateState]);

	// Auto-save user preferences when settings change
	useEffect(() => {
		if (!prefsHydrated) return;
		saveUserPreferences({ padding, aspectRatio, exportQuality, exportFormat });
	}, [prefsHydrated, padding, aspectRatio, exportQuality, exportFormat]);

	const saveProject = useCallback(
		async (forceSaveAs: boolean) => {
			if (!videoPath) {
				toast.error(t("errors.noVideoLoaded"));
				return false;
			}

			if (!currentProjectMedia) {
				toast.error(t("errors.unableToDetermineSourcePath"));
				return false;
			}

			let audioAssets: Awaited<ReturnType<typeof collectAudioAssetsForProjectSave>> = [];
			try {
				audioAssets = await collectAudioAssetsForProjectSave(
					audioAnnotationClips,
					currentProjectPath,
				);
			} catch {
				toast.error(t("audioAnnotation.failedToLoad"));
				return false;
			}

			const editorState = {
				wallpaper,
				shadowIntensity,
				showBlur,
				showTrimWaveform,
				motionBlurAmount,
				borderRadius,
				padding,
				cropRegion,
				zoomRegions,
				autoZoomEnabled,
				autoFocusAll,
				trimRegions,
				speedRegions,
				annotationRegions,
				audioAnnotationClips,
				holdRegions,
				holdCollections,
				aspectRatio,
				webcamLayoutPreset,
				webcamMaskShape,
				webcamMirrored,
				webcamReactiveZoom,
				webcamSizePreset,
				webcamPosition,
				exportQuality,
				exportFormat,
				gifFrameRate,
				gifLoop,
				gifSizePreset,
				cursorTheme,
			};
			const projectData = createProjectData(currentProjectMedia, editorState);

			const fileNameBase =
				currentProjectMedia.screenVideoPath
					.split(/[\\/]/)
					.pop()
					?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
			// Normalize the same way as currentProjectSnapshot so the post-save
			// baseline compares equal and hasUnsavedChanges clears.
			const projectSnapshot = createProjectSnapshot(currentProjectMedia, editorState);
			const result = await nativeBridgeClient.project.saveProjectFile(
				projectData,
				fileNameBase,
				forceSaveAs ? undefined : (currentProjectPath ?? undefined),
				audioAssets,
			);

			if (result.canceled) {
				toast.info(t("project.saveCanceled"));
				return false;
			}

			if (!result.success) {
				toast.error(result.message || t("project.failedToSave"));
				return false;
			}

			if (result.path) {
				setCurrentProjectPath(result.path);
			}

			if (result.path && result.audioClipPaths) {
				updateState((prev) => ({
					audioAnnotationClips: applyPersistedAudioClipPaths(
						prev.audioAnnotationClips,
						result.path as string,
						result.audioClipPaths as Record<string, string>,
					),
				}));
			}

			setLastSavedSnapshot(projectSnapshot);

			toast.success(t("project.savedTo", { path: result.path ?? "" }));
			return true;
		},
		[
			currentProjectMedia,
			currentProjectPath,
			wallpaper,
			shadowIntensity,
			showBlur,
			showTrimWaveform,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			autoZoomEnabled,
			autoFocusAll,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioAnnotationClips,
			holdRegions,
			holdCollections,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			cursorTheme,
			videoPath,
			t,
			updateState,
		],
	);

	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);

	useEffect(() => {
		const cleanup = window.electronAPI.onRequestSaveBeforeClose(async () => {
			return saveProject(false);
		});
		return () => cleanup();
	}, [saveProject]);

	useEffect(() => {
		const cleanup = window.electronAPI.onRequestCloseConfirm(() => {
			setShowCloseConfirmDialog(true);
		});
		return () => cleanup();
	}, []);

	const handleCloseConfirmSave = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("save");
	}, []);

	const handleCloseConfirmDiscard = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("discard");
	}, []);

	const handleCloseConfirmCancel = useCallback(() => {
		setShowCloseConfirmDialog(false);
		window.electronAPI.sendCloseConfirmResponse("cancel");
	}, []);

	const handleSaveProject = useCallback(async () => {
		await saveProject(false);
	}, [saveProject]);

	const handleSaveProjectAs = useCallback(async () => {
		await saveProject(true);
	}, [saveProject]);

	const handleNewRecordingConfirm = useCallback(async () => {
		const result = await window.electronAPI.startNewRecording();
		if (result.success) {
			setShowNewRecordingDialog(false);
		} else {
			console.error("Failed to start new recording:", result.error);
			setError("Failed to start new recording: " + (result.error || "Unknown error"));
		}
	}, []);

	const doLoadProject = useCallback(async () => {
		const result = await nativeBridgeClient.project.loadProjectFile(getProjectFolder());

		if (result.canceled) {
			return;
		}

		if (!result.success) {
			toast.error(result.message || t("project.failedToLoad"));
			return;
		}

		const restored = await applyLoadedProject(result.project, result.path ?? null);
		if (!restored) {
			toast.error(t("project.invalidFormat"));
			return;
		}

		if (result.path) {
			const folder = parentDirectoryOf(result.path);
			if (folder) {
				saveUserPreferences({ projectFolder: folder });
			}
		}

		toast.success(t("project.loadedFrom", { path: result.path ?? "" }));
	}, [applyLoadedProject, t]);

	const handleLoadProject = useCallback(async () => {
		if (hasUnsavedChanges) {
			setConfirmDialogVariant("loadProject");
			return;
		}
		await doLoadProject();
	}, [hasUnsavedChanges, doLoadProject]);

	const handleLoadProjectConfirmSave = useCallback(async () => {
		setConfirmDialogVariant(null);
		const saved = await saveProject(false);
		if (saved) {
			await doLoadProject();
		}
	}, [saveProject, doLoadProject]);

	const handleLoadProjectConfirmDiscard = useCallback(async () => {
		setConfirmDialogVariant(null);
		await doLoadProject();
	}, [doLoadProject]);

	// New Project: clear all media/project/editor state back to the empty
	// Studio dashboard. Prompts to save first when there are unsaved changes.
	const doNewProject = useCallback(async () => {
		await nativeBridgeClient.project.clearCurrentVideoPath();
		setVideoPath(null);
		setVideoSourcePath(null);
		setWebcamVideoPath(null);
		setWebcamVideoSourcePath(null);
		setCurrentProjectPath(null);
		setLastSavedSnapshot(null);
		// Reset undoable editor state + undo/redo history to a clean slate.
		resetState();
		// Reset non-undoable selection state.
		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedSpeedId(null);
		setSelectedAnnotationId(null);
		setSelectedAudioAnnotationId(null);
		setSelectedBlurId(null);
		// Reset playback.
		setCurrentTime(0);
		setIsPlaying(false);
		// Reset cursor preferences to defaults.
		setShowCursor(DEFAULT_CURSOR_SETTINGS.show);
		setCursorSize(DEFAULT_CURSOR_SETTINGS.size);
		setCursorSmoothing(DEFAULT_CURSOR_SETTINGS.smoothing);
		setCursorMotionBlur(DEFAULT_CURSOR_SETTINGS.motionBlur);
		setCursorClickBounce(DEFAULT_CURSOR_SETTINGS.clickBounce);
		setCursorClipToBounds(DEFAULT_CURSOR_SETTINGS.clipToBounds);
		setCursorTheme(DEFAULT_CURSOR_SETTINGS.theme);
		// Reset region ID counters.
		nextZoomIdRef.current = 1;
		nextTrimIdRef.current = 1;
		nextSpeedIdRef.current = 1;
		nextAnnotationIdRef.current = 1;
		nextAnnotationZIndexRef.current = 1;
		nextAudioAnnotationIdRef.current = 1;
	}, [resetState]);

	const handleNewProject = useCallback(async () => {
		if (hasUnsavedChanges) {
			setConfirmDialogVariant("newProject");
			return;
		}
		await doNewProject();
	}, [hasUnsavedChanges, doNewProject]);

	const handleNewProjectConfirmSave = useCallback(async () => {
		setConfirmDialogVariant(null);
		const saved = await saveProject(false);
		if (saved) {
			await doNewProject();
		}
	}, [saveProject, doNewProject]);

	const handleNewProjectConfirmDiscard = useCallback(async () => {
		setConfirmDialogVariant(null);
		await doNewProject();
	}, [doNewProject]);

	useEffect(() => {
		const removeNewProjectListener = window.electronAPI.onMenuNewProject(handleNewProject);
		const removeLoadListener = window.electronAPI.onMenuLoadProject(handleLoadProject);
		const removeSaveListener = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAsListener = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);

		return () => {
			removeNewProjectListener?.();
			removeLoadListener?.();
			removeSaveListener?.();
			removeSaveAsListener?.();
		};
	}, [handleNewProject, handleLoadProject, handleSaveProject, handleSaveProjectAs]);

	useEffect(() => {
		let canceled = false;
		nativeBridgeClient.system
			.getPlatform()
			.then((platform) => {
				if (!canceled) {
					setNativePlatform(platform);
				}
			})
			.catch((error) => {
				console.warn("Unable to resolve native platform for cursor settings:", error);
				if (!canceled) {
					setNativePlatform(null);
				}
			});

		return () => {
			canceled = true;
		};
	}, []);

	useEffect(() => {
		if (cursorTelemetryError) {
			console.warn("Unable to load cursor telemetry:", cursorTelemetryError);
		}
	}, [cursorTelemetryError]);

	useEffect(() => {
		if (cursorRecordingDataError) {
			console.warn("Unable to load cursor recording data:", cursorRecordingDataError);
		}
	}, [cursorRecordingDataError]);

	function togglePlayPause() {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;

		if (isPlaying) {
			playback.pause();
		} else {
			playback.play().catch((err) => console.error("Video play failed:", err));
		}
	}

	const toggleFullscreen = useCallback(() => {
		setIsFullscreen((prev) => !prev);
	}, []);

	useEffect(() => {
		if (!isFullscreen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsFullscreen(false);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFullscreen]);

	function handleSeek(time: number) {
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		holdPlaybackLog("ui-seek", {
			targetSec: time,
			targetMs: Math.round(time * 1000),
			videoBeforeMs: Math.round(video.currentTime * 1000),
			reactCurrentTimeMs: Math.round(currentTime * 1000),
			holdRegions,
		});
		video.currentTime = time;
	}

	const handleTimeUpdate = useCallback(
		(time: number, outputTimeMs?: number) => {
			setCurrentTime(time);
			if (holdRegions.length > 0) {
				setOutputPlaybackTimeMs(
					outputTimeMs ?? sourceToOutputMs(Math.round(time * 1000), holdRegions),
				);
			}
		},
		[holdRegions],
	);

	const handleTimelineSeek = useCallback(
		(timeSec: number) => {
			const video = videoPlaybackRef.current?.video;
			if (!video) return;

			video.currentTime = timeSec;
			if (holdRegions.length > 0) {
				setOutputPlaybackTimeMs(sourceToOutputMs(Math.round(timeSec * 1000), holdRegions));
			}
		},
		[holdRegions],
	);

	const handlePlaybackModeChange = useCallback(
		(mode: EditorPlaybackMode) => {
			if (mode === playbackMode) {
				return;
			}
			videoPlaybackRef.current?.pause();
			setIsPlaying(false);
			setPlaybackMode(mode);
			if (holdRegions.length > 0) {
				const sourceMs = Math.round(currentTime * 1000);
				setOutputPlaybackTimeMs(sourceToOutputMs(sourceMs, holdRegions));
			}
		},
		[playbackMode, holdRegions, currentTime],
	);

	useEffect(() => {
		if (holdRegions.length === 0 && playbackMode !== "source") {
			setPlaybackMode("source");
		}
	}, [holdRegions.length, playbackMode]);

	const outputDurationMs = useMemo(
		() =>
			holdRegions.length > 0
				? getOutputDurationMs(Math.round(duration * 1000), holdRegions)
				: Math.round(duration * 1000),
		[duration, holdRegions],
	);

	const timelineReadOnly = holdRegions.length > 0 && playbackMode === "preview";

	const selectTimelineItem = useCallback(
		(
			item:
				| { kind: "zoom"; id: string }
				| { kind: "trim"; id: string }
				| { kind: "speed"; id: string }
				| { kind: "annotation"; id: string }
				| { kind: "blur"; id: string }
				| { kind: "audio"; id: string },
		) => {
			setSelectedZoomId(item.kind === "zoom" ? item.id : null);
			setSelectedTrimId(item.kind === "trim" ? item.id : null);
			setSelectedSpeedId(item.kind === "speed" ? item.id : null);
			setSelectedAnnotationId(item.kind === "annotation" ? item.id : null);
			setSelectedBlurId(item.kind === "blur" ? item.id : null);
			setSelectedAudioAnnotationId(item.kind === "audio" ? item.id : null);
			setSelectedHoldSegmentKey(null);
		},
		[],
	);

	const handleSelectHoldSegment = useCallback((collectionId: string, segmentId: string) => {
		setSelectedHoldSegmentKey(`${collectionId}:${segmentId}`);
		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedSpeedId(null);
		setSelectedAnnotationId(null);
		setSelectedBlurId(null);
		setSelectedAudioAnnotationId(null);
	}, []);

	const handleSelectZoom = useCallback(
		(id: string | null) => {
			if (id) {
				selectTimelineItem({ kind: "zoom", id });
			} else {
				setSelectedZoomId(null);
			}
		},
		[selectTimelineItem],
	);

	const handleSelectTrim = useCallback(
		(id: string | null) => {
			if (id) {
				selectTimelineItem({ kind: "trim", id });
			} else {
				setSelectedTrimId(null);
			}
		},
		[selectTimelineItem],
	);

	const handleSelectAnnotation = useCallback(
		(id: string | null) => {
			setSelectedHoldSegmentKey(null);
			if (id) {
				selectTimelineItem({ kind: "annotation", id });
			} else {
				setSelectedAnnotationId(null);
			}
		},
		[selectTimelineItem],
	);

	const handleSelectBlur = useCallback(
		(id: string | null) => {
			if (id) {
				selectTimelineItem({ kind: "blur", id });
			} else {
				setSelectedBlurId(null);
			}
		},
		[selectTimelineItem],
	);

	const handleZoomAdded = useCallback(
		(span: Span) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
				focus: { cx: 0.5, cy: 0.5 },
				// Auto-Focus on means new zooms follow the cursor too.
				focusMode: autoFocusAll ? "auto" : undefined,
				source: "manual",
			};
			pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, newRegion] }));
			selectTimelineItem({ kind: "zoom", id });
		},
		[pushState, autoFocusAll, selectTimelineItem],
	);

	// Builds fresh "auto" zoom regions from cursor telemetry without overlapping
	// existing ones. Used by both the on-load auto-suggest pass and the wand toggle.
	const buildAutoZoomRegions = useCallback(
		(existingRegions: ZoomRegion[]): ZoomRegion[] => {
			const totalMs = Math.round(duration * 1000);
			const suggestions = buildAutoZoomSuggestions({
				cursorTelemetry,
				totalMs,
				existingRegions,
				defaultDurationMs: Math.max(1000, Math.round(totalMs * 0.05)),
			});
			return suggestions.map((suggestion) => ({
				id: `zoom-${nextZoomIdRef.current++}`,
				startMs: Math.round(suggestion.span.start),
				endMs: Math.round(suggestion.span.end),
				depth: DEFAULT_ZOOM_DEPTH,
				customScale: ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH],
				focus: clampFocusToDepth(suggestion.focus, DEFAULT_ZOOM_DEPTH),
				focusMode: autoFocusAll ? ("auto" as const) : undefined,
				source: "auto" as const,
			}));
		},
		[cursorTelemetry, duration, autoFocusAll],
	);

	// Auto-suggest zooms once per fresh recording (no existing zooms, telemetry
	// available, wand enabled). Loaded projects are marked processed elsewhere so
	// they're never touched. The ref guard runs this once per source and survives undo.
	const autoProcessedSourceRef = useRef<string | null>(null);
	useEffect(() => {
		if (!autoZoomEnabled || !cursorTelemetrySourcePath) return;
		if (autoProcessedSourceRef.current === cursorTelemetrySourcePath) return;
		if (cursorTelemetry.length < 2 || duration <= 0) return;
		// Only auto-suggest for a fresh recording; don't disturb existing zooms.
		if (zoomRegions.length > 0) {
			autoProcessedSourceRef.current = cursorTelemetrySourcePath;
			return;
		}
		const newRegions = buildAutoZoomRegions([]);
		autoProcessedSourceRef.current = cursorTelemetrySourcePath;
		if (newRegions.length === 0) return;
		pushState((prev) => ({ zoomRegions: [...prev.zoomRegions, ...newRegions] }));
	}, [
		autoZoomEnabled,
		cursorTelemetrySourcePath,
		cursorTelemetry,
		duration,
		zoomRegions,
		buildAutoZoomRegions,
		pushState,
	]);

	// Wand toggle: ON regenerates suggestions around existing zooms; OFF removes
	// only untouched auto zooms (manual and edited-to-manual survive).
	const handleToggleAutoZoom = useCallback(
		(enabled: boolean) => {
			if (enabled) {
				autoProcessedSourceRef.current = cursorTelemetrySourcePath;
				pushState((prev) => ({
					autoZoomEnabled: true,
					zoomRegions: [...prev.zoomRegions, ...buildAutoZoomRegions(prev.zoomRegions)],
				}));
			} else {
				pushState((prev) => ({
					autoZoomEnabled: false,
					zoomRegions: prev.zoomRegions.filter((region) => region.source !== "auto"),
				}));
			}
		},
		[pushState, buildAutoZoomRegions, cursorTelemetrySourcePath],
	);

	// Flip every zoom between auto (cursor-follow) and manual at once.
	const handleToggleAutoFocusAll = useCallback(
		(on: boolean) => {
			pushState((prev) => ({
				autoFocusAll: on,
				zoomRegions: prev.zoomRegions.map((region) => ({
					...region,
					focusMode: on ? "auto" : "manual",
				})),
			}));
		},
		[pushState],
	);

	const handleTrimAdded = useCallback(
		(span: Span) => {
			const id = `trim-${nextTrimIdRef.current++}`;
			const newRegion: TrimRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
			};
			pushState((prev) => ({ trimRegions: [...prev.trimRegions, newRegion] }));
			selectTimelineItem({ kind: "trim", id });
		},
		[pushState, selectTimelineItem],
	);

	const handleZoomSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
								source: "manual",
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleTrimSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	// Focus drag: updateState for live preview, commitState on pointer-up.
	const handleZoomFocusChange = useCallback(
		(id: string, focus: ZoomFocus) => {
			updateState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === id
						? { ...region, focus: clampFocusToDepth(focus, region.depth), source: "manual" }
						: region,
				),
			}));
		},
		[updateState],
	);

	const handleZoomDepthChange = useCallback(
		(depth: ZoomDepth) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId
						? {
								...region,
								depth,
								customScale: ZOOM_DEPTH_SCALES[depth],
								focus: clampFocusToDepth(region.focus, depth),
								source: "manual",
							}
						: region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomCustomScaleChange = useCallback(
		(scale: number) => {
			if (!selectedZoomId) return;
			const rounded = Math.round(scale * 100) / 100;
			if (!Number.isFinite(rounded)) return;
			updateState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId
						? { ...region, customScale: rounded, source: "manual" }
						: region,
				),
			}));
		},
		[selectedZoomId, updateState],
	);

	const handleZoomCustomScaleCommit = useCallback(() => {
		commitState();
	}, [commitState]);

	const handleZoomFocusModeChange = useCallback(
		(focusMode: ZoomFocusMode) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) =>
					region.id === selectedZoomId ? { ...region, focusMode, source: "manual" } : region,
				),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleZoomDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.filter((r) => r.id !== id),
			}));
			if (selectedZoomId === id) {
				setSelectedZoomId(null);
			}
		},
		[selectedZoomId, pushState],
	);

	const handleZoomRotationPresetChange = useCallback(
		(preset: Rotation3DPreset | null) => {
			if (!selectedZoomId) return;
			pushState((prev) => ({
				zoomRegions: prev.zoomRegions.map((region) => {
					if (region.id !== selectedZoomId) return region;
					if (preset === null) {
						const { rotationPreset: _p, ...rest } = region;
						return { ...rest, source: "manual" };
					}
					return { ...region, rotationPreset: preset, source: "manual" };
				}),
			}));
		},
		[selectedZoomId, pushState],
	);

	const handleTrimDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				trimRegions: prev.trimRegions.filter((r) => r.id !== id),
			}));
			if (selectedTrimId === id) {
				setSelectedTrimId(null);
			}
		},
		[selectedTrimId, pushState],
	);

	const handleSelectSpeed = useCallback(
		(id: string | null) => {
			if (id) {
				selectTimelineItem({ kind: "speed", id });
			} else {
				setSelectedSpeedId(null);
			}
		},
		[selectTimelineItem],
	);

	const handleSpeedAdded = useCallback(
		(span: Span) => {
			const id = `speed-${nextSpeedIdRef.current++}`;
			const newRegion: SpeedRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				speed: DEFAULT_PLAYBACK_SPEED,
			};
			pushState((prev) => ({
				speedRegions: [...prev.speedRegions, newRegion],
			}));
			selectTimelineItem({ kind: "speed", id });
		},
		[pushState, selectTimelineItem],
	);

	const handleSpeedSpanChange = useCallback(
		(id: string, span: Span) => {
			pushState((prev) => ({
				speedRegions: prev.speedRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleSpeedDelete = useCallback(
		(id: string) => {
			pushState((prev) => ({
				speedRegions: prev.speedRegions.filter((region) => region.id !== id),
			}));
			if (selectedSpeedId === id) {
				setSelectedSpeedId(null);
			}
		},
		[selectedSpeedId, pushState],
	);

	const handleSpeedChange = useCallback(
		(speed: PlaybackSpeed) => {
			if (!selectedSpeedId) return;
			pushState((prev) => ({
				speedRegions: prev.speedRegions.map((region) =>
					region.id === selectedSpeedId ? { ...region, speed } : region,
				),
			}));
		},
		[selectedSpeedId, pushState],
	);

	const handlePositionAnnotationAdded = useCallback(
		(
			type: AnnotationRegion["type"],
			options?: {
				anchorMs?: number;
				durationMs?: number;
				pausePlayback?: boolean;
				freeze?: boolean;
			},
		) => {
			const totalMs = Math.round(durationRef.current * 1000);
			if (totalMs <= 0) {
				return;
			}

			const anchorMs = options?.anchorMs ?? Math.round(currentTime * 1000);

			if (options?.freeze) {
				const id = `annotation-${nextAnnotationIdRef.current++}`;
				const collection = createHoldCollection(anchorMs, {
					type,
					firstSegmentDurationMs: options.durationMs ?? DEFAULT_HOLD_COLLECTION_FIRST_SEGMENT_MS,
				});
				collection.shellAnnotationId = id;

				pushState((prev) =>
					withSyncedHoldRegions(prev, {
						holdCollections: [...(prev.holdCollections ?? []), collection],
					}),
				);
				selectTimelineItem({ kind: "annotation", id });
				if (options?.pausePlayback !== false) {
					setIsPlaying(false);
				}
				return;
			}

			const span = computePositionAnnotationSpan(
				anchorMs,
				options?.durationMs ?? DEFAULT_POSITION_ANNOTATION_DURATION_MS,
				totalMs,
			);
			if (span.end <= span.start) {
				return;
			}

			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion = buildPositionAnnotationRegion(type, span, id, zIndex);

			pushState((prev) =>
				withSyncedHoldRegions(prev, {
					annotationRegions: [...prev.annotationRegions, newRegion],
				}),
			);

			if (type === "blur") {
				selectTimelineItem({ kind: "blur", id });
			} else {
				selectTimelineItem({ kind: "annotation", id });
			}

			if (options?.pausePlayback !== false) {
				setIsPlaying(false);
			}
		},
		[currentTime, pushState, selectTimelineItem],
	);

	const handleAnnotationAdded = useCallback(
		(type: AnnotationRegion["type"] = "text", options?: { freeze?: boolean }) => {
			handlePositionAnnotationAdded(type, options);
		},
		[handlePositionAnnotationAdded],
	);

	const handleAnnotationSpanChange = useCallback(
		(id: string, span: Span) => {
			const startMs = Math.round(span.start);
			const endMs = Math.max(startMs + MIN_POSITION_ANNOTATION_DURATION_MS, Math.round(span.end));
			const durationMs = endMs - startMs;
			pushState((prev) => {
				const collection = findHoldCollectionByShellId(prev.holdCollections, id);
				if (collection) {
					const updated =
						collection.segments.length === 1
							? setHoldCollectionFirstSegmentDuration(
									{ ...collection, sourceMs: startMs },
									durationMs,
								)
							: setHoldCollectionTotalDuration({ ...collection, sourceMs: startMs }, durationMs);
					return withSyncedHoldRegions(prev, {
						holdCollections: (prev.holdCollections ?? []).map((entry) =>
							entry.id === collection.id ? updated : entry,
						),
					});
				}

				const editedAutoCaption =
					prev.annotationRegions.find((region) => region.id === id)?.annotationSource ===
					"auto-caption";
				const next = prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								startMs,
								endMs,
							}
						: region,
				);
				return withSyncedHoldRegions(prev, {
					annotationRegions: editedAutoCaption ? reconcileAutoCaptionTimelineGaps(next) : next,
				});
			});
		},
		[pushState],
	);

	const handleAnnotationDurationChange = useCallback(
		(id: string, durationMs: number) => {
			const totalMs = Math.round(durationRef.current * 1000);
			pushState((prev) => {
				const collection = findHoldCollectionByShellId(prev.holdCollections, id);
				if (collection) {
					const updated =
						collection.segments.length === 1
							? setHoldCollectionFirstSegmentDuration(collection, durationMs)
							: setHoldCollectionTotalDuration(collection, durationMs);
					return withSyncedHoldRegions(prev, {
						holdCollections: (prev.holdCollections ?? []).map((entry) =>
							entry.id === collection.id ? updated : entry,
						),
					});
				}

				const source = prev.annotationRegions.find((region) => region.id === id);
				if (!source) {
					return {};
				}

				const span = computePositionAnnotationSpan(source.startMs, durationMs, totalMs);
				const editedAutoCaption = source.annotationSource === "auto-caption";
				const next = prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								endMs: span.end,
							}
						: region,
				);
				return withSyncedHoldRegions(prev, {
					annotationRegions: editedAutoCaption ? reconcileAutoCaptionTimelineGaps(next) : next,
				});
			});
		},
		[pushState],
	);

	const handleAnnotationFreezeChange = useCallback(
		(id: string, enabled: boolean) => {
			pushState((prev) => {
				if (enabled) {
					const region = prev.annotationRegions.find((entry) => entry.id === id);
					if (!region || region.freezeDuringAnnotation) {
						return prev;
					}
					const existing = prev.holdCollections?.find(
						(collection) => collection.shellAnnotationId === id,
					);
					if (existing) {
						return prev;
					}
					const collection =
						annotationRegionToHoldCollection({ ...region, freezeDuringAnnotation: true }) ??
						createHoldCollection(region.startMs, {
							firstSegmentDurationMs: Math.max(500, region.endMs - region.startMs),
						});
					collection.shellAnnotationId = id;
					const { freezeDuringAnnotation: _freeze, holdDurationMs: _hold, ...rest } = region;
					const nextAnnotations = prev.annotationRegions.map((entry) =>
						entry.id === id ? rest : entry,
					);
					return withSyncedHoldRegions(prev, {
						annotationRegions: nextAnnotations,
						holdCollections: [...(prev.holdCollections ?? []), collection],
					});
				}

				const collection = (prev.holdCollections ?? []).find(
					(entry) => entry.shellAnnotationId === id,
				);
				const nextCollections = (prev.holdCollections ?? []).filter(
					(entry) => entry.shellAnnotationId !== id,
				);
				const nextAnnotations = prev.annotationRegions.map((entry) => {
					if (entry.id !== id) {
						return entry;
					}
					const { freezeDuringAnnotation: _freeze, holdDurationMs: _hold, ...rest } = entry;
					return rest;
				});
				if (!collection) {
					return withSyncedHoldRegions(prev, { annotationRegions: nextAnnotations });
				}
				return withSyncedHoldRegions(prev, {
					annotationRegions: nextAnnotations,
					holdCollections: nextCollections,
				});
			});
		},
		[pushState],
	);

	const handleAudioImportRequest = useCallback(() => {
		audioImportInputRef.current?.click();
	}, []);

	const handleAudioFileSelected = useCallback(
		async (event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = "";
			if (!file) {
				return;
			}

			if (!isAcceptedAudioAnnotationFile(file)) {
				toast.error(t("audioAnnotation.invalidFileType"));
				return;
			}

			const totalMs = Math.round(durationRef.current * 1000);
			if (totalMs <= 0) {
				return;
			}

			try {
				const { audioUrl, sourceFilePath } = resolveImportedAudioReference(file);
				const sourceDurationMs = await getAudioFileDurationMs(audioUrl);
				const id = `audio-annotation-${nextAudioAnnotationIdRef.current++}`;
				const clip = buildAudioAnnotationClip(
					id,
					Math.round(currentTime * 1000),
					audioUrl,
					sourceDurationMs,
					file.name,
					totalMs,
					sourceFilePath,
				);
				if (!clip) {
					if (audioUrl.startsWith("blob:")) {
						URL.revokeObjectURL(audioUrl);
					}
					return;
				}

				pushState((prev) => ({
					audioAnnotationClips: [...prev.audioAnnotationClips, clip],
				}));
				selectTimelineItem({ kind: "audio", id });
				setIsPlaying(false);
			} catch {
				toast.error(t("audioAnnotation.failedToLoad"));
			}
		},
		[currentTime, pushState, selectTimelineItem, t],
	);

	const handleAudioAnnotationSpanChange = useCallback(
		(id: string, span: Span) => {
			const durationMs = Math.max(1, Math.round(span.end - span.start));
			pushState((prev) =>
				withSyncedHoldRegions(prev, {
					audioAnnotationClips: prev.audioAnnotationClips.map((clip) =>
						clip.id === id
							? {
									...clip,
									anchorMs: Math.round(span.start),
									durationMs,
								}
							: clip,
					),
				}),
			);
		},
		[pushState],
	);

	const handleAudioAnnotationDurationChange = useCallback(
		(id: string, durationMs: number) => {
			const totalMs = Math.round(durationRef.current * 1000);
			pushState((prev) =>
				withSyncedHoldRegions(prev, {
					audioAnnotationClips: prev.audioAnnotationClips.map((clip) => {
						if (clip.id !== id) {
							return clip;
						}
						const maxDuration = Math.max(500, totalMs - clip.anchorMs);
						return {
							...clip,
							durationMs: Math.max(500, Math.min(durationMs, maxDuration, 30_000)),
						};
					}),
				}),
			);
		},
		[pushState],
	);

	const handleAudioAnnotationFreezeChange = useCallback(
		(id: string, enabled: boolean) => {
			pushState((prev) => {
				const clip = prev.audioAnnotationClips.find((entry) => entry.id === id);
				if (!clip) {
					return prev;
				}

				if (enabled) {
					if (clip.freezeDuringAnnotation) {
						return prev;
					}
					const existing = prev.holdCollections?.find(
						(collection) => collection.shellAnnotationId === id,
					);
					const durationMs = Math.max(500, clip.durationMs);
					const collection =
						existing ??
						(() => {
							const created = createHoldCollection(clip.anchorMs, {
								firstSegmentDurationMs: durationMs,
							});
							created.shellAnnotationId = id;
							created.segments[0]!.durationMs = durationMs;
							return created;
						})();

					return withSyncedHoldRegions(prev, {
						audioAnnotationClips: prev.audioAnnotationClips.map((entry) =>
							entry.id === id ? { ...entry, freezeDuringAnnotation: true as const } : entry,
						),
						holdCollections: existing
							? (prev.holdCollections ?? [])
							: [...(prev.holdCollections ?? []), collection],
					});
				}

				const nextCollections = (prev.holdCollections ?? []).filter(
					(entry) => entry.shellAnnotationId !== id,
				);
				return withSyncedHoldRegions(prev, {
					audioAnnotationClips: prev.audioAnnotationClips.map((entry) => {
						if (entry.id !== id) {
							return entry;
						}
						const { freezeDuringAnnotation: _freeze, holdDurationMs: _hold, ...rest } = entry;
						return rest;
					}),
					holdCollections: nextCollections,
				});
			});
		},
		[pushState],
	);

	const handleAudioAnnotationVolumeChange = useCallback(
		(id: string, volume: number) => {
			pushState((prev) => ({
				audioAnnotationClips: prev.audioAnnotationClips.map((clip) =>
					clip.id === id ? { ...clip, volume } : clip,
				),
			}));
		},
		[pushState],
	);

	const handleAudioAnnotationReplace = useCallback(
		(
			id: string,
			audioUrl: string,
			fileName: string,
			sourceDurationMs: number,
			sourceFilePath?: string,
		) => {
			const totalMs = Math.round(durationRef.current * 1000);
			pushState((prev) => ({
				audioAnnotationClips: prev.audioAnnotationClips.map((clip) => {
					if (clip.id !== id) {
						return clip;
					}
					const maxDuration = Math.max(500, totalMs - clip.anchorMs);
					return {
						...clip,
						audioUrl,
						fileName,
						sourceDurationMs,
						sourceFilePath,
						durationMs: Math.min(clip.durationMs, sourceDurationMs, maxDuration, 30_000),
					};
				}),
			}));
		},
		[pushState],
	);

	const handleAudioAnnotationDelete = useCallback(
		(id: string) => {
			pushState((prev) =>
				withSyncedHoldRegions(prev, {
					audioAnnotationClips: prev.audioAnnotationClips.filter((clip) => clip.id !== id),
					holdCollections: removeHoldCollectionsByShellId(prev.holdCollections ?? [], id),
				}),
			);
			if (selectedAudioAnnotationId === id) {
				setSelectedAudioAnnotationId(null);
			}
		},
		[selectedAudioAnnotationId, pushState],
	);

	const handleSelectAudioAnnotation = useCallback(
		(id: string | null) => {
			if (id) {
				selectTimelineItem({ kind: "audio", id });
			} else {
				setSelectedAudioAnnotationId(null);
			}
		},
		[selectTimelineItem],
	);

	const handleAnnotationDuplicate = useCallback(
		(id: string) => {
			const duplicateId = `annotation-${nextAnnotationIdRef.current++}`;
			const duplicateZIndex = nextAnnotationZIndexRef.current++;
			pushState((prev) => {
				const source = prev.annotationRegions.find((region) => region.id === id);
				if (!source) return {};

				const { annotationSource: _stripCaptionLink, ...sourceWithoutCaptionLink } = source;

				const duplicate: AnnotationRegion = {
					...sourceWithoutCaptionLink,
					id: duplicateId,
					zIndex: duplicateZIndex,
					position: { x: source.position.x + 4, y: source.position.y + 4 },
					size: { ...source.size },
					style: { ...source.style },
					figureData: source.figureData ? { ...source.figureData } : undefined,
				};

				return withSyncedHoldRegions(prev, {
					annotationRegions: [...prev.annotationRegions, duplicate],
				});
			});
			selectTimelineItem({ kind: "annotation", id: duplicateId });
		},
		[pushState, selectTimelineItem],
	);

	const updateHoldCollectionById = useCallback(
		(
			prev: EditorState,
			collectionId: string,
			updater: (collection: import("./types").HoldCollection) => import("./types").HoldCollection,
		) => {
			const nextCollections = (prev.holdCollections ?? []).map((collection) =>
				collection.id === collectionId ? updater(collection) : collection,
			);
			return withSyncedHoldRegions(prev, { holdCollections: nextCollections });
		},
		[],
	);

	const handleHoldSegmentDurationChange = useCallback(
		(collectionId: string, segmentId: string, durationMs: number) => {
			pushState((prev) =>
				updateHoldCollectionById(prev, collectionId, (collection) =>
					setHoldCollectionSegmentDuration(collection, segmentId, durationMs),
				),
			);
		},
		[pushState, updateHoldCollectionById],
	);

	const handleHoldSegmentPairDurationChange = useCallback(
		(
			collectionId: string,
			leftSegmentId: string,
			leftDurationMs: number,
			rightSegmentId: string,
			rightDurationMs: number,
		) => {
			pushState((prev) =>
				updateHoldCollectionById(prev, collectionId, (collection) =>
					setHoldCollectionSegmentPairDurations(
						collection,
						leftSegmentId,
						leftDurationMs,
						rightSegmentId,
						rightDurationMs,
					),
				),
			);
		},
		[pushState, updateHoldCollectionById],
	);

	const handleHoldCollectionTotalDurationChange = useCallback(
		(shellAnnotationId: string, durationMs: number) => {
			pushState((prev) => {
				const collection = findHoldCollectionByShellId(prev.holdCollections, shellAnnotationId);
				if (!collection) {
					return prev;
				}
				const updated = setHoldCollectionTotalDuration(collection, durationMs);
				return withSyncedHoldRegions(prev, {
					holdCollections: (prev.holdCollections ?? []).map((entry) =>
						entry.id === collection.id ? updated : entry,
					),
				});
			});
		},
		[pushState],
	);

	const handleHoldCollectionAppendSegment = useCallback(
		(collectionId: string, type: AnnotationRegion["type"] = "text") => {
			pushState((prev) =>
				updateHoldCollectionById(prev, collectionId, (collection) =>
					appendHoldCollectionSegment(collection, type),
				),
			);
		},
		[pushState, updateHoldCollectionById],
	);

	const handleHoldSegmentContentChange = useCallback(
		(collectionId: string, segmentId: string, content: string) => {
			pushState((prev) =>
				updateHoldCollectionById(prev, collectionId, (collection) =>
					updateHoldCollectionSegmentContent(collection, segmentId, (segmentContent) => {
						if (segmentContent.type === "text") {
							return { ...segmentContent, content, textContent: content };
						}
						if (segmentContent.type === "image") {
							return { ...segmentContent, content, imageContent: content };
						}
						return { ...segmentContent, content };
					}),
				),
			);
		},
		[pushState, updateHoldCollectionById],
	);

	const handleHoldSegmentStyleChange = useCallback(
		(collectionId: string, segmentId: string, style: Partial<AnnotationRegion["style"]>) => {
			saveAnnotationTextStylePreset(style);
			pushState((prev) =>
				updateHoldCollectionById(prev, collectionId, (collection) =>
					updateHoldCollectionSegmentContent(collection, segmentId, (segmentContent) => ({
						...segmentContent,
						style: { ...segmentContent.style, ...style },
					})),
				),
			);
		},
		[pushState, updateHoldCollectionById],
	);

	const handleHoldSegmentTypeChange = useCallback(
		(collectionId: string, segmentId: string, type: AnnotationRegion["type"]) => {
			pushState((prev) =>
				updateHoldCollectionById(prev, collectionId, (collection) =>
					updateHoldCollectionSegmentContent(collection, segmentId, (segmentContent) => {
						if (type === "text") {
							return {
								...segmentContent,
								type: "text",
								content: segmentContent.textContent || "Enter text...",
							};
						}
						if (type === "image") {
							return {
								...segmentContent,
								type: "image",
								content: segmentContent.imageContent || "",
							};
						}
						if (type === "figure") {
							return {
								...segmentContent,
								type: "figure",
								content: "",
								figureData: segmentContent.figureData ?? { ...getAnnotationFigureDataPreset() },
							};
						}
						return { ...segmentContent, type };
					}),
				),
			);
		},
		[pushState, updateHoldCollectionById],
	);

	const handleHoldSegmentFigureDataChange = useCallback(
		(collectionId: string, segmentId: string, figureData: FigureData) => {
			saveAnnotationFigureDataPreset(figureData);
			pushState((prev) =>
				updateHoldCollectionById(prev, collectionId, (collection) =>
					updateHoldCollectionSegmentContent(collection, segmentId, (segmentContent) => ({
						...segmentContent,
						figureData,
					})),
				),
			);
		},
		[pushState, updateHoldCollectionById],
	);

	const handleHoldSegmentDelete = useCallback(
		(collectionId: string, segmentId: string) => {
			pushState((prev) => {
				const collection = (prev.holdCollections ?? []).find((entry) => entry.id === collectionId);
				if (!collection) {
					return prev;
				}
				const nextCollection = removeHoldCollectionSegment(collection, segmentId);
				if (!nextCollection) {
					const shellId = collection.shellAnnotationId;
					return withSyncedHoldRegions(prev, {
						annotationRegions: shellId
							? prev.annotationRegions.filter((region) => region.id !== shellId)
							: prev.annotationRegions,
						holdCollections: removeHoldCollectionsByShellId(
							prev.holdCollections ?? [],
							shellId ?? "",
						),
						audioAnnotationClips: shellId
							? prev.audioAnnotationClips.filter((clip) => clip.id !== shellId)
							: prev.audioAnnotationClips,
					});
				}
				return withSyncedHoldRegions(prev, {
					holdCollections: (prev.holdCollections ?? []).map((entry) =>
						entry.id === collectionId ? nextCollection : entry,
					),
				});
			});
			setSelectedHoldSegmentKey(null);
		},
		[pushState],
	);

	const handleAnnotationDelete = useCallback(
		(id: string) => {
			pushState((prev) =>
				withSyncedHoldRegions(prev, {
					annotationRegions: prev.annotationRegions.filter((r) => r.id !== id),
					holdCollections: removeHoldCollectionsByShellId(prev.holdCollections ?? [], id),
					audioAnnotationClips: prev.audioAnnotationClips.filter((clip) => clip.id !== id),
				}),
			);
			if (selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
			}
			if (selectedBlurId === id) {
				setSelectedBlurId(null);
			}
			if (selectedAudioAnnotationId === id) {
				setSelectedAudioAnnotationId(null);
			}
			setSelectedHoldSegmentKey(null);
		},
		[selectedAnnotationId, selectedBlurId, selectedAudioAnnotationId, pushState],
	);

	const handleAnnotationContentChange = useCallback(
		(id: string, content: string) => {
			pushState((prev) =>
				syncHoldCollectionShellEdit(prev, id, (region) => {
					if (region.type === "text") {
						return { ...region, content, textContent: content };
					}
					if (region.type === "image") {
						return { ...region, content, imageContent: content };
					}
					return { ...region, content };
				}),
			);
		},
		[pushState],
	);

	const handleAnnotationTypeChange = useCallback(
		(id: string, type: AnnotationRegion["type"]) => {
			pushState((prev) => {
				const patched = syncHoldCollectionShellEdit(prev, id, (region) => {
					const updatedRegion = { ...region, type };
					if (type === "text") {
						updatedRegion.content = region.textContent || "Enter text...";
					} else if (type === "image") {
						updatedRegion.content = region.imageContent || "";
					} else if (type === "figure") {
						updatedRegion.content = "";
						if (!region.figureData) {
							updatedRegion.figureData = { ...getAnnotationFigureDataPreset() };
						}
					} else if (type === "blur") {
						updatedRegion.content = "";
						if (!region.blurData) {
							updatedRegion.blurData = { ...DEFAULT_BLUR_DATA };
						}
					}
					return updatedRegion;
				});
				return patched;
			});

			if (type === "blur" && selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
				setSelectedBlurId(id);
				setSelectedSpeedId(null);
			} else if (type !== "blur" && selectedBlurId === id) {
				setSelectedBlurId(null);
				setSelectedAnnotationId(id);
			}
		},
		[pushState, selectedAnnotationId, selectedBlurId],
	);

	const handleAnnotationStyleChange = useCallback(
		(id: string, style: Partial<AnnotationRegion["style"]>) => {
			saveAnnotationTextStylePreset(style);
			pushState((prev) => {
				const touched = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = touched?.annotationSource === "auto-caption";
				if (syncAutoCaptions) {
					return {
						annotationRegions: prev.annotationRegions.map((region) =>
							region.annotationSource === "auto-caption"
								? { ...region, style: { ...region.style, ...style } }
								: region,
						),
					};
				}
				return syncHoldCollectionShellEdit(prev, id, (region) => ({
					...region,
					style: { ...region.style, ...style },
				}));
			});
		},
		[pushState],
	);

	const handleAnnotationFigureDataChange = useCallback(
		(id: string, figureData: FigureData) => {
			saveAnnotationFigureDataPreset(figureData);
			pushState((prev) =>
				syncHoldCollectionShellEdit(prev, id, (region) => ({ ...region, figureData })),
			);
		},
		[pushState],
	);

	const handleBlurDataPreviewChange = useCallback(
		(id: string, blurData: BlurData) => {
			updateState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								blurData,
								// Freehand drawing area is the full video surface.
								...(blurData.shape === "freehand"
									? {
											position: { x: 0, y: 0 },
											size: { width: 100, height: 100 },
										}
									: {}),
							}
						: region,
				),
			}));
		},
		[updateState],
	);

	const handleBlurDataPanelChange = useCallback(
		(id: string, blurData: BlurData) => {
			pushState((prev) => ({
				annotationRegions: prev.annotationRegions.map((region) =>
					region.id === id
						? {
								...region,
								blurData,
								...(blurData.shape === "freehand"
									? {
											position: { x: 0, y: 0 },
											size: { width: 100, height: 100 },
										}
									: {}),
							}
						: region,
				),
			}));
		},
		[pushState],
	);

	const handleAnnotationPositionChange = useCallback(
		(id: string, position: { x: number; y: number }) => {
			pushState((prev) => {
				const owningCollection = (prev.holdCollections ?? []).find((collection) =>
					collection.segments.some((segment) => segment.id === id),
				);
				if (owningCollection) {
					const updated = updateHoldCollectionSegmentContent(owningCollection, id, (content) => ({
						...content,
						position,
					}));
					return withSyncedHoldRegions(prev, {
						holdCollections: (prev.holdCollections ?? []).map((entry) =>
							entry.id === owningCollection.id ? updated : entry,
						),
					});
				}

				const moved = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = moved?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, position };
						}
						return region.id === id ? { ...region, position } : region;
					}),
				};
			});
		},
		[pushState],
	);

	const handleAnnotationSizeChange = useCallback(
		(id: string, size: { width: number; height: number }) => {
			pushState((prev) => {
				const owningCollection = (prev.holdCollections ?? []).find((collection) =>
					collection.segments.some((segment) => segment.id === id),
				);
				if (owningCollection) {
					const updated = updateHoldCollectionSegmentContent(owningCollection, id, (content) => ({
						...content,
						size,
					}));
					return withSyncedHoldRegions(prev, {
						holdCollections: (prev.holdCollections ?? []).map((entry) =>
							entry.id === owningCollection.id ? updated : entry,
						),
					});
				}

				const resized = prev.annotationRegions.find((r) => r.id === id);
				const syncAutoCaptions = resized?.annotationSource === "auto-caption";
				return {
					annotationRegions: prev.annotationRegions.map((region) => {
						if (syncAutoCaptions && region.annotationSource === "auto-caption") {
							return { ...region, size };
						}
						return region.id === id ? { ...region, size } : region;
					}),
				};
			});
		},
		[pushState],
	);

	const handleAnnotationImageScaleModeChange = useCallback(
		(id: string, mode: "contain" | "fill") => {
			pushState((prev) => {
				const owningCollection = (prev.holdCollections ?? []).find((collection) =>
					collection.segments.some((segment) => segment.id === id),
				);
				if (owningCollection) {
					const updated = updateHoldCollectionSegmentContent(owningCollection, id, (content) => ({
						...content,
						imageScaleMode: mode,
					}));
					return withSyncedHoldRegions(prev, {
						holdCollections: (prev.holdCollections ?? []).map((entry) =>
							entry.id === owningCollection.id ? updated : entry,
						),
					});
				}

				return {
					annotationRegions: prev.annotationRegions.map((region) =>
						region.id === id ? { ...region, imageScaleMode: mode } : region,
					),
				};
			});
		},
		[pushState],
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			const key = e.key.toLowerCase();

			if (mod && key === "z" && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				undo();
				return;
			}
			if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
				e.preventDefault();
				e.stopPropagation();
				redo();
				return;
			}

			// Frame-step navigation (arrow keys, no modifiers)
			if (
				(e.key === "ArrowLeft" || e.key === "ArrowRight") &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.shiftKey &&
				!e.altKey
			) {
				const target = e.target;
				if (
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement ||
					(target instanceof HTMLElement &&
						(target.isContentEditable ||
							target.closest('[role="separator"], [role="slider"], [role="spinbutton"]')))
				) {
					return;
				}
				e.preventDefault();
				const video = videoPlaybackRef.current?.video;
				if (!video) {
					return;
				}
				const direction = e.key === "ArrowLeft" ? "backward" : "forward";
				const newTime = computeFrameStepTime(
					video.currentTime,
					Number.isFinite(video.duration) ? video.duration : durationRef.current,
					direction,
				);
				video.currentTime = newTime;
				return;
			}

			const isInput =
				e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

			if (e.key === "Tab" && !isInput) {
				e.preventDefault();
			}

			if (matchesShortcut(e, shortcuts.playPause, isMac)) {
				// Let space pass through inside inputs/textareas.
				if (isInput) {
					return;
				}
				e.preventDefault();
				const playback = videoPlaybackRef.current;
				if (playback?.video) {
					playback.video.paused ? playback.play().catch(console.error) : playback.pause();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [undo, redo, shortcuts, isMac]);

	useEffect(() => {
		if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
			setSelectedZoomId(null);
		}
	}, [selectedZoomId, zoomRegions]);

	useEffect(() => {
		if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
			setSelectedTrimId(null);
		}
	}, [selectedTrimId, trimRegions]);

	useEffect(() => {
		if (
			selectedAnnotationId &&
			!annotationOnlyRegions.some((region) => region.id === selectedAnnotationId)
		) {
			setSelectedAnnotationId(null);
		}
		if (selectedBlurId && !blurRegions.some((region) => region.id === selectedBlurId)) {
			setSelectedBlurId(null);
		}
	}, [selectedAnnotationId, selectedBlurId, annotationOnlyRegions, blurRegions]);

	useEffect(() => {
		if (selectedSpeedId && !speedRegions.some((region) => region.id === selectedSpeedId)) {
			setSelectedSpeedId(null);
		}
	}, [selectedSpeedId, speedRegions]);

	const handleShowExportedFile = useCallback(async (filePath: string) => {
		try {
			const result = await window.electronAPI.revealInFolder(filePath);
			if (!result.success) {
				const errorMessage = result.error || result.message || "Failed to reveal item in folder.";
				console.error("Failed to reveal in folder:", errorMessage);
				toast.error(errorMessage);
			}
		} catch (error) {
			const errorMessage = String(error);
			console.error("Error calling revealInFolder IPC:", errorMessage);
			toast.error(`Error revealing in folder: ${errorMessage}`);
		}
	}, []);

	const handleExportSaved = useCallback(
		(formatLabel: "GIF" | "Video", filePath: string) => {
			setExportedFilePath(filePath);
			const folder = parentDirectoryOf(filePath);
			if (folder) {
				saveUserPreferences({ exportFolder: folder });
			}
			toast.success(
				t("export.exportedSuccessfully", {
					format: formatLabel,
				}),
				{
					description: filePath,
					action: {
						label: rawT("common.actions.showInFolder"),
						onClick: () => {
							void handleShowExportedFile(filePath);
						},
					},
				},
			);
		},
		[handleShowExportedFile, t, rawT],
	);

	const handleSaveUnsavedExport = useCallback(async () => {
		if (!unsavedExport) return;
		try {
			const pickResult = await window.electronAPI.pickExportSavePath(
				unsavedExport.fileName,
				getExportFolder(),
			);
			if (pickResult.canceled || !pickResult.success || !pickResult.path) {
				toast.info("Export canceled");
				return;
			}
			const saveResult = await window.electronAPI.writeExportToPath(
				unsavedExport.arrayBuffer,
				pickResult.path,
			);
			if (saveResult.success && saveResult.path) {
				setUnsavedExport(null);
				handleExportSaved(unsavedExport.format === "gif" ? "GIF" : "Video", saveResult.path);
			} else {
				toast.error(
					buildSaveDiagnosticMessage(
						unsavedExport.format === "gif" ? "GIF" : "Video",
						saveResult.message || "Failed to save export",
					),
				);
			}
		} catch (error) {
			console.error("Error saving unsaved export:", error);
			toast.error(
				buildSaveDiagnosticMessage(
					unsavedExport.format === "gif" ? "GIF" : "Video",
					error instanceof Error ? error.message : "Failed to save exported video",
				),
			);
		}
	}, [unsavedExport, handleExportSaved]);

	const handleExport = useCallback(
		async (settings: ExportSettings) => {
			if (!videoPath) {
				toast.error("No video loaded");
				return;
			}

			const video = videoPlaybackRef.current?.video;
			if (!video) {
				toast.error("Video not ready");
				return;
			}

			// Pick the save path before exporting, otherwise the save dialog can end up
			// hidden behind other windows after a long-running export.
			const isGifFormat = settings.format === "gif";
			const targetFileName = `export-${Date.now()}.${isGifFormat ? "gif" : "mp4"}`;
			const pickResult = await window.electronAPI.pickExportSavePath(
				targetFileName,
				getExportFolder(),
			);
			if (pickResult.canceled || !pickResult.success || !pickResult.path) {
				setShowExportDialog(false);
				return;
			}
			const targetPath = pickResult.path;

			setIsExporting(true);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);

			try {
				const wasPlaying = isPlaying;
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				const sourceWidth = video.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
				const sourceHeight = video.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;
				const effectiveSourceDimensions = calculateEffectiveSourceDimensions(
					sourceWidth,
					sourceHeight,
					cropRegion,
				);
				const aspectRatioValue =
					aspectRatio === "native"
						? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
						: getAspectRatioValue(aspectRatio);

				// Preview container dimensions, used for scaling.
				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || DEFAULT_SOURCE_DIMENSIONS.width;
				const previewHeight = containerElement?.clientHeight || DEFAULT_SOURCE_DIMENSIONS.height;

				if (settings.format === "gif" && settings.gifConfig) {
					// GIF Export
					const gifExporter = new GifExporter({
						videoUrl: videoPath,
						webcamVideoUrl: webcamVideoPath || undefined,
						width: settings.gifConfig.width,
						height: settings.gifConfig.height,
						frameRate: settings.gifConfig.frameRate,
						loop: settings.gifConfig.loop,
						sizePreset: settings.gifConfig.sizePreset,
						wallpaper,
						zoomRegions,
						trimRegions,
						speedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						showBlur,
						motionBlurAmount,
						borderRadius,
						padding,
						videoPadding: padding,
						cropRegion,
						cursorRecordingData,
						cursorScale: effectiveShowCursor ? cursorSize : 0,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClipToBounds,
						cursorTheme,
						annotationRegions,
						webcamLayoutPreset,
						webcamMaskShape,
						webcamMirrored,
						webcamReactiveZoom,
						webcamSizePreset,
						webcamPosition,
						previewWidth,
						previewHeight,
						cursorTelemetry,
						cursorClickTimestamps,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = gifExporter as unknown as VideoExporter;
					const result = await gifExporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();

						if (result.warnings) {
							for (const warning of result.warnings) {
								toast.warning(warning);
							}
						}

						const saveResult = await window.electronAPI.writeExportToPath(arrayBuffer, targetPath);

						if (saveResult.success && saveResult.path) {
							setUnsavedExport(null);
							handleExportSaved("GIF", saveResult.path);
						} else {
							setUnsavedExport({ arrayBuffer, fileName: targetFileName, format: "gif" });
							const message = buildSaveDiagnosticMessage(
								"GIF",
								saveResult.message || "Failed to save GIF",
							);
							setExportError(message);
							toast.error(message);
						}
					} else {
						const message = buildExportDiagnosticMessage({
							formatLabel: "GIF",
							reason: result.error || "GIF export failed",
							sourcePath: videoSourcePath ?? videoPath,
							width: settings.gifConfig.width,
							height: settings.gifConfig.height,
							frameRate: settings.gifConfig.frameRate,
						});
						setExportError(message);
						toast.error(message);
					}
				} else {
					// MP4 Export
					const quality = settings.quality || exportQuality;
					const {
						width: exportWidth,
						height: exportHeight,
						bitrate,
					} = calculateMp4ExportSettings({
						quality,
						sourceWidth: effectiveSourceDimensions.width,
						sourceHeight: effectiveSourceDimensions.height,
						aspectRatioValue,
					});

					const exporter = new VideoExporter({
						videoUrl: videoPath,
						webcamVideoUrl: webcamVideoPath || undefined,
						width: exportWidth,
						height: exportHeight,
						frameRate: 60,
						bitrate,
						codec: "avc1.640033",
						wallpaper,
						zoomRegions,
						trimRegions,
						speedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						showBlur,
						motionBlurAmount,
						borderRadius,
						padding,
						cropRegion,
						cursorRecordingData,
						cursorScale: effectiveShowCursor ? cursorSize : 0,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClipToBounds,
						cursorTheme,
						annotationRegions,
						audioAnnotationClips,
						holdRegions,
						holdCollections,
						webcamLayoutPreset,
						webcamMaskShape,
						webcamMirrored,
						webcamReactiveZoom,
						webcamSizePreset,
						webcamPosition,
						previewWidth,
						previewHeight,
						cursorTelemetry,
						cursorClickTimestamps,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = exporter;
					const result = await exporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();

						if (result.warnings) {
							for (const warning of result.warnings) {
								toast.warning(warning);
							}
						}

						const saveResult = await window.electronAPI.writeExportToPath(arrayBuffer, targetPath);

						if (saveResult.success && saveResult.path) {
							setUnsavedExport(null);
							handleExportSaved("Video", saveResult.path);
						} else {
							setUnsavedExport({ arrayBuffer, fileName: targetFileName, format: "mp4" });
							const message = buildSaveDiagnosticMessage(
								"Video",
								saveResult.message || "Failed to save video",
							);
							setExportError(message);
							toast.error(message);
						}
					} else {
						const message = buildExportDiagnosticMessage({
							formatLabel: "Video",
							reason: result.error || "Export failed",
							sourcePath: videoSourcePath ?? videoPath,
							width: exportWidth,
							height: exportHeight,
							frameRate: 60,
							codec: "avc1.640033",
							bitrate,
						});
						setExportError(message);
						toast.error(message);
					}
				}

				if (wasPlaying) {
					videoPlaybackRef.current?.play();
				}
			} catch (error) {
				console.error("Export error:", error);
				if (error instanceof BackgroundLoadError) {
					const message = t("errors.exportBackgroundLoadFailed", { url: error.displayUrl });
					setExportError(message);
					toast.error(message);
				} else {
					const errorMessage = error instanceof Error ? error.message : "Unknown error";
					const message = buildExportDiagnosticMessage({
						formatLabel: settings.format === "gif" ? "GIF" : "Video",
						reason: errorMessage,
						sourcePath: videoSourcePath ?? videoPath,
					});
					setExportError(message);
					toast.error(t("errors.exportFailedWithError", { error: message }));
				}
			} finally {
				setIsExporting(false);
				exporterRef.current = null;
				// Reset so the next export can reopen the dialog (second export
				// otherwise wouldn't show the save dialog).
				setShowExportDialog(false);
				setExportProgress(null);
			}
		},
		[
			videoPath,
			videoSourcePath,
			webcamVideoPath,
			wallpaper,
			zoomRegions,
			trimRegions,
			speedRegions,
			shadowIntensity,
			showBlur,
			motionBlurAmount,
			borderRadius,
			padding,
			cropRegion,
			cursorRecordingData,
			annotationRegions,
			audioAnnotationClips,
			holdRegions,
			isPlaying,
			aspectRatio,
			webcamLayoutPreset,
			webcamMaskShape,
			webcamMirrored,
			webcamReactiveZoom,
			webcamSizePreset,
			webcamPosition,
			exportQuality,
			handleExportSaved,
			cursorTelemetry,
			cursorClickTimestamps,
			effectiveShowCursor,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClipToBounds,
			cursorTheme,
			t,
			holdCollections,
		],
	);

	const handleOpenExportDialog = useCallback(() => {
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}

		const video = videoPlaybackRef.current?.video;
		if (!video) {
			toast.error("Video not ready");
			return;
		}

		// Build export settings from current state
		const sourceWidth = video.videoWidth || DEFAULT_SOURCE_DIMENSIONS.width;
		const sourceHeight = video.videoHeight || DEFAULT_SOURCE_DIMENSIONS.height;
		const effectiveSourceDimensions = calculateEffectiveSourceDimensions(
			sourceWidth,
			sourceHeight,
			cropRegion,
		);
		const aspectRatioValue =
			aspectRatio === "native"
				? getNativeAspectRatioValue(sourceWidth, sourceHeight, cropRegion)
				: getAspectRatioValue(aspectRatio);
		const gifDimensions = calculateOutputDimensions(
			effectiveSourceDimensions.width,
			effectiveSourceDimensions.height,
			gifSizePreset,
			GIF_SIZE_PRESETS,
			aspectRatioValue,
		);

		const settings: ExportSettings = {
			format: exportFormat,
			quality: exportFormat === "mp4" ? exportQuality : undefined,
			gifConfig:
				exportFormat === "gif"
					? {
							frameRate: gifFrameRate,
							loop: gifLoop,
							sizePreset: gifSizePreset,
							width: gifDimensions.width,
							height: gifDimensions.height,
						}
					: undefined,
		};

		setShowExportDialog(true);
		setExportError(null);
		setExportedFilePath(null);

		// Start export immediately
		handleExport(settings);
	}, [
		videoPath,
		exportFormat,
		exportQuality,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		aspectRatio,
		cropRegion,
		handleExport,
	]);

	const handleCancelExport = useCallback(() => {
		if (exporterRef.current) {
			exporterRef.current.cancel();
			toast.info("Export canceled");
			setShowExportDialog(false);
			setIsExporting(false);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(null);
		}
	}, []);

	const generateAutoCaptions = useCallback(
		async (minWords: number, maxWords: number) => {
			if (!videoPath) {
				toast.error(t("errors.noVideoLoaded"));
				return;
			}
			if (isAutoCaptioningRef.current) {
				toast.error(t("autoCaptions.busy"));
				return;
			}
			const minW = Math.max(1, Math.min(minWords, maxWords));
			const maxW = Math.max(minW, maxWords);

			isAutoCaptioningRef.current = true;
			setIsAutoCaptioning(true);
			toast.loading(t("autoCaptions.generating"), { id: AUTO_CAPTION_PROGRESS_TOAST_ID });
			try {
				const { samples, truncated, durationSec } = await extractMono16kFromVideoUrl(videoPath);
				if (!Number.isFinite(durationSec) || durationSec <= 0 || samples.length < 800) {
					toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
					toast.error(t("autoCaptions.noAudio"));
					return;
				}

				const { samples: speechSamples, trimSec } = trimLeadingSilenceMono16k(samples);
				if (speechSamples.length < 800) {
					toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
					toast.error(t("autoCaptions.noAudio"));
					return;
				}

				const trimMs = Math.round(trimSec * 1000);
				const trimRegionsForTranscribe = shiftTrimRegionsMsForCaptionBuffer(trimRegions, trimMs);

				const transcribeOptions = {
					onStatus: (phase: "model" | "transcribe") => {
						if (phase === "model") {
							toast.loading(t("autoCaptions.loadingModel"), {
								id: AUTO_CAPTION_PROGRESS_TOAST_ID,
							});
						} else {
							toast.loading(t("autoCaptions.transcribing"), {
								id: AUTO_CAPTION_PROGRESS_TOAST_ID,
							});
						}
					},
				};

				let { segments: segmentsRaw, granularity } = await transcribeMono16kToSegments(
					speechSamples,
					{
						trimRegions: trimRegionsForTranscribe,
						...transcribeOptions,
					},
				);
				let transcribedFromTrimmedBuffer = true;

				// Leading-silence trimming can return empty even when the full source has
				// speech. Retry once against the untrimmed buffer before giving up.
				if (segmentsRaw.length === 0 && trimSec > 0) {
					({ segments: segmentsRaw, granularity } = await transcribeMono16kToSegments(samples, {
						trimRegions,
						...transcribeOptions,
					}));
					transcribedFromTrimmedBuffer = false;
				}

				const segments =
					transcribedFromTrimmedBuffer && trimSec > 0
						? segmentsRaw.map((s) => ({
								...s,
								startSec: s.startSec + trimSec,
								endSec: s.endSec + trimSec,
							}))
						: segmentsRaw;

				let { regions, nextNumericId, nextZIndex } = captionSegmentsToAnnotationRegions(
					segments,
					nextAnnotationIdRef.current,
					nextAnnotationZIndexRef.current,
					{
						minWordsPerCaption: minW,
						maxWordsPerCaption: maxW,
						timestampGranularity: granularity,
					},
				);

				if (regions.length === 0 && segments.length > 0) {
					({ regions, nextNumericId, nextZIndex } = captionSegmentsToAnnotationRegions(
						segments,
						nextAnnotationIdRef.current,
						nextAnnotationZIndexRef.current,
						{
							minWordsPerCaption: 1,
							maxWordsPerCaption: Number.MAX_SAFE_INTEGER,
							timestampGranularity: granularity,
						},
					));
				}

				if (regions.length === 0) {
					toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
					toast.info(t("autoCaptions.noneHeard"));
					return;
				}

				pushState((prev) =>
					withSyncedHoldRegions(prev, {
						annotationRegions: [...prev.annotationRegions, ...regions],
					}),
				);
				nextAnnotationIdRef.current = nextNumericId;
				nextAnnotationZIndexRef.current = nextZIndex;

				toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
				const minutesTrunc = String(Math.round(MAX_CAPTION_AUDIO_SEC / 60));
				if (truncated) {
					toast.success(t("autoCaptions.done", { count: String(regions.length) }), {
						description: t("autoCaptions.truncated", { minutes: minutesTrunc }),
					});
				} else {
					toast.success(t("autoCaptions.done", { count: String(regions.length) }));
				}
			} catch (e) {
				console.error(e);
				toast.dismiss(AUTO_CAPTION_PROGRESS_TOAST_ID);
				const detail = e instanceof Error ? e.message : String(e);
				toast.error(t("autoCaptions.failed"), { description: detail });
			} finally {
				isAutoCaptioningRef.current = false;
				setIsAutoCaptioning(false);
			}
		},
		[videoPath, trimRegions, pushState, t],
	);

	const handleSaveDiagnostic = useCallback(async () => {
		const result = await window.electronAPI.saveDiagnostic({
			error: exportError ?? "Manual diagnostic export",
			projectState: editorState,
			logs: [],
		});
		if (result.success) {
			toast.success("Diagnostic file saved");
		} else if (!result.canceled) {
			toast.error("Failed to save diagnostic file");
		}
	}, [exportError, editorState]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="text-foreground">{t("loadingVideo")}</div>
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{error}</div>
					<button
						type="button"
						onClick={handleLoadProject}
						className="px-3 py-1.5 rounded-md bg-[#34B27B] text-white text-sm hover:bg-[#34B27B]/90"
					>
						{ts("project.load")}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-[#09090b] text-slate-200 overflow-hidden selection:bg-[#34B27B]/30">
			<Dialog open={showNewRecordingDialog} onOpenChange={setShowNewRecordingDialog}>
				<DialogContent
					className="sm:max-w-[425px]"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<DialogHeader>
						<DialogTitle>{t("newRecording.title")}</DialogTitle>
						<DialogDescription>{t("newRecording.description")}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<button
							type="button"
							onClick={() => setShowNewRecordingDialog(false)}
							className="px-4 py-2 rounded-md bg-white/10 text-white hover:bg-white/20 text-sm font-medium transition-colors"
						>
							{t("newRecording.cancel")}
						</button>
						<button
							type="button"
							onClick={handleNewRecordingConfirm}
							className="px-4 py-2 rounded-md bg-[#34B27B] text-white hover:bg-[#34B27B]/90 text-sm font-medium transition-colors"
						>
							{t("newRecording.confirm")}
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={showAutoCaptionsDialog} onOpenChange={setShowAutoCaptionsDialog}>
				<DialogContent
					className="sm:max-w-md"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<DialogHeader>
						<DialogTitle>{t("autoCaptions.dialogTitle")}</DialogTitle>
						<DialogDescription>{t("autoCaptions.dialogDescription")}</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-2">
						<div className="grid gap-2">
							<Label htmlFor="caption-min-words">{t("autoCaptions.minWords")}</Label>
							<Select
								value={String(captionWordsMin)}
								onValueChange={(v) => {
									const n = Number.parseInt(v, 10);
									setCaptionWordsMin(n);
									if (n > captionWordsMax) setCaptionWordsMax(n);
								}}
							>
								<SelectTrigger id="caption-min-words" className="h-9">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_WORD_CHOICES.map((n) => (
										<SelectItem key={`min-${n}`} value={String(n)}>
											{t("autoCaptions.wordsCount", { count: String(n) })}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="caption-max-words">{t("autoCaptions.maxWords")}</Label>
							<Select
								value={String(captionWordsMax)}
								onValueChange={(v) => {
									const n = Number.parseInt(v, 10);
									setCaptionWordsMax(n);
									if (n < captionWordsMin) setCaptionWordsMin(n);
								}}
							>
								<SelectTrigger id="caption-max-words" className="h-9">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CAPTION_WORD_CHOICES.map((n) => (
										<SelectItem key={`max-${n}`} value={String(n)}>
											{t("autoCaptions.wordsCount", { count: String(n) })}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<DialogFooter className="gap-2 sm:gap-0">
						<Button
							type="button"
							variant="outline"
							onClick={() => setShowAutoCaptionsDialog(false)}
							className="border-white/20 bg-transparent text-white hover:bg-white/10"
						>
							{t("autoCaptions.dialogCancel")}
						</Button>
						<Button
							type="button"
							disabled={isAutoCaptioning}
							onClick={() => {
								setShowAutoCaptionsDialog(false);
								void generateAutoCaptions(captionWordsMin, captionWordsMax);
							}}
							className="bg-[#34B27B] text-white hover:bg-[#34B27B]/90"
						>
							{t("autoCaptions.generate")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div
				className="h-11 flex-shrink-0 bg-[#070809]/85 backdrop-blur-xl border-b border-white/[0.07] flex items-center justify-between px-5 z-50 shadow-[0_1px_0_rgba(255,255,255,0.03)]"
				style={{ WebkitAppRegion: "drag" } as CSSProperties}
			>
				<div
					className="flex-1 flex items-center gap-1"
					style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
				>
					<div
						className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 ${isMac ? "ml-14" : "ml-2"}`}
					>
						<Languages size={14} />
						<select
							value={locale}
							onChange={(e) => setLocale(e.target.value as Locale)}
							className="bg-transparent text-[11px] font-medium outline-none cursor-pointer appearance-none pr-1"
							style={{ color: "inherit" }}
						>
							{availableLocales.map((loc) => (
								<option key={loc} value={loc} className="bg-[#09090b] text-white">
									{getLocaleName(loc)}
								</option>
							))}
						</select>
					</div>
					<button
						type="button"
						onClick={() => setShowNewRecordingDialog(true)}
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 text-[11px] font-medium"
					>
						<Video size={14} />
						{t("newRecording.title")}
					</button>
					<button
						type="button"
						onClick={handleLoadProject}
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 text-[11px] font-medium"
					>
						<FolderOpen size={14} />
						{ts("project.load")}
					</button>
					<button
						type="button"
						onClick={handleSaveProject}
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-all duration-150 text-[11px] font-medium"
					>
						<Save size={14} />
						{ts("project.save")}
					</button>
				</div>
			</div>

			{/* Empty state shown when no video is loaded */}
			{!videoPath && (
				<div className="flex-1 min-h-0 relative">
					<EditorEmptyState
						onVideoImported={(path) => {
							setVideoPath(toFileUrl(path));
							setVideoSourcePath(path);
							setWebcamVideoPath(null);
							setWebcamVideoSourcePath(null);
						}}
						onProjectOpened={async (project, path) => {
							const restored = await applyLoadedProject(project, path);
							if (!restored) {
								toast.error(t("project.invalidFormat"));
							}
						}}
					/>
				</div>
			)}

			{videoPath && (
				<div className="editor-workspace flex-1 min-h-0 relative">
					<PanelGroup direction="vertical" className="gap-3 min-h-0">
						{/* Top section: preview and contextual settings */}
						<Panel defaultSize={67} maxSize={76} minSize={46} className="min-h-[300px]">
							<div className="editor-main-deck h-full min-h-0">
								<div className="editor-preview-zone min-w-0 h-full">
									<div
										ref={playerContainerRef}
										className={
											isFullscreen
												? "fixed inset-0 z-[99999] w-full h-full flex flex-col items-center justify-center bg-[#09090b]"
												: "editor-preview-panel w-full h-full flex flex-col items-center justify-center overflow-hidden relative"
										}
									>
										{/* Video preview */}
										<div className="w-full min-h-0 flex justify-center items-center flex-auto px-4 pt-4">
											<div
												className="relative flex justify-center items-center w-auto h-full max-w-full box-border"
												style={{
													aspectRatio:
														aspectRatio === "native"
															? getNativeAspectRatioValue(
																	videoPlaybackRef.current?.video?.videoWidth ||
																		DEFAULT_SOURCE_DIMENSIONS.width,
																	videoPlaybackRef.current?.video?.videoHeight ||
																		DEFAULT_SOURCE_DIMENSIONS.height,
																	cropRegion,
																)
															: getAspectRatioValue(aspectRatio),
												}}
											>
												<VideoPlayback
													key={`${videoPath || "no-video"}:${webcamVideoPath || "no-webcam"}`}
													aspectRatio={aspectRatio}
													ref={videoPlaybackRef}
													videoPath={videoPath || ""}
													webcamVideoPath={webcamVideoPath || undefined}
													webcamLayoutPreset={webcamLayoutPreset}
													webcamMaskShape={webcamMaskShape}
													webcamMirrored={webcamMirrored}
													webcamReactiveZoom={webcamReactiveZoom}
													webcamSizePreset={webcamSizePreset}
													webcamPosition={webcamPosition}
													onWebcamPositionChange={(pos) => updateState({ webcamPosition: pos })}
													onWebcamPositionDragEnd={commitState}
													onDurationChange={setDuration}
													onTimeUpdate={handleTimeUpdate}
													currentTime={currentTime}
													onPlayStateChange={setIsPlaying}
													onError={setError}
													wallpaper={wallpaper}
													zoomRegions={zoomRegions}
													selectedZoomId={selectedZoomId}
													onSelectZoom={handleSelectZoom}
													onZoomFocusChange={handleZoomFocusChange}
													onZoomFocusDragEnd={commitState}
													isPlaying={isPlaying}
													showShadow={shadowIntensity > 0}
													shadowIntensity={shadowIntensity}
													showBlur={showBlur}
													motionBlurAmount={motionBlurAmount}
													borderRadius={borderRadius}
													padding={padding}
													cropRegion={cropRegion}
													cursorRecordingData={cursorRecordingData}
													trimRegions={trimRegions}
													speedRegions={speedRegions}
													holdRegions={holdRegions}
													holdCollections={holdCollections}
													annotationRegions={annotationOnlyRegions}
													audioAnnotationClips={audioAnnotationClips}
													selectedAnnotationId={selectedAnnotationId}
													selectedHoldSegmentKey={selectedHoldSegmentKey}
													onSelectAnnotation={handleSelectAnnotation}
													onSelectHoldSegment={handleSelectHoldSegment}
													onAnnotationPositionChange={handleAnnotationPositionChange}
													onAnnotationSizeChange={handleAnnotationSizeChange}
													onAnnotationImageScaleModeChange={handleAnnotationImageScaleModeChange}
													blurRegions={blurRegions}
													selectedBlurId={selectedBlurId}
													onSelectBlur={handleSelectBlur}
													onBlurPositionChange={handleAnnotationPositionChange}
													onBlurSizeChange={handleAnnotationSizeChange}
													onBlurDataChange={handleBlurDataPreviewChange}
													onBlurDataCommit={commitState}
													cursorTelemetry={cursorTelemetry}
													cursorClickTimestamps={cursorClickTimestamps}
													showCursor={effectiveShowCursor}
													cursorSize={cursorSize}
													cursorSmoothing={cursorSmoothing}
													cursorMotionBlur={cursorMotionBlur}
													cursorClickBounce={cursorClickBounce}
													cursorClipToBounds={cursorClipToBounds}
													cursorTheme={cursorTheme}
													isPreviewingZoom={isPreviewingZoom}
													playbackMode={playbackMode}
												/>
											</div>
										</div>
										{/* Playback controls */}
										<div className="w-full flex justify-center items-center gap-3 h-14 flex-shrink-0 px-4 py-2">
											<div className="w-full max-w-[760px]">
												<PlaybackControls
													isPlaying={isPlaying}
													currentTime={currentTime}
													duration={duration}
													isFullscreen={isFullscreen}
													onToggleFullscreen={toggleFullscreen}
													onTogglePlayPause={togglePlayPause}
													onSeek={handleSeek}
												/>
											</div>
											<AddPositionAnnotationMenu
												disabled={!videoPath || duration <= 0}
												onAdd={({ type, freeze }) =>
													handlePositionAnnotationAdded(type, { freeze })
												}
												onImportAudio={handleAudioImportRequest}
											/>
											<input
												ref={audioImportInputRef}
												type="file"
												accept=".mp3,.wav,audio/mpeg,audio/wav"
												className="hidden"
												onChange={handleAudioFileSelected}
											/>
										</div>
									</div>
								</div>

								<div className="editor-settings-rail min-w-0 h-full">
									<SettingsPanel
										selected={wallpaper}
										onWallpaperChange={(w) => pushState({ wallpaper: w })}
										selectedZoomDepth={
											selectedZoomId
												? zoomRegions.find((z) => z.id === selectedZoomId)?.depth
												: null
										}
										onZoomDepthChange={(depth) => selectedZoomId && handleZoomDepthChange(depth)}
										selectedZoomCustomScale={
											selectedZoomId
												? (zoomRegions.find((z) => z.id === selectedZoomId)?.customScale ?? null)
												: null
										}
										onZoomCustomScaleChange={handleZoomCustomScaleChange}
										onZoomCustomScaleCommit={handleZoomCustomScaleCommit}
										onZoomPreviewStart={() => setIsPreviewingZoom(true)}
										onZoomPreviewEnd={() => setIsPreviewingZoom(false)}
										selectedZoomFocusMode={
											selectedZoomId
												? (zoomRegions.find((z) => z.id === selectedZoomId)?.focusMode ?? "manual")
												: null
										}
										onZoomFocusModeChange={(mode) =>
											selectedZoomId && handleZoomFocusModeChange(mode)
										}
										focusModeLocked={autoFocusAll}
										selectedZoomFocus={
											selectedZoomId
												? (zoomRegions.find((z) => z.id === selectedZoomId)?.focus ?? null)
												: null
										}
										onZoomFocusCoordinateChange={(focus) =>
											selectedZoomId && handleZoomFocusChange(selectedZoomId, focus)
										}
										onZoomFocusCoordinateCommit={commitState}
										hasCursorTelemetry={cursorTelemetry.length > 0}
										selectedZoomId={selectedZoomId}
										onZoomDelete={handleZoomDelete}
										selectedZoomRotationPreset={
											selectedZoomId
												? (zoomRegions.find((z) => z.id === selectedZoomId)?.rotationPreset ?? null)
												: null
										}
										onZoomRotationPresetChange={handleZoomRotationPresetChange}
										selectedTrimId={selectedTrimId}
										onTrimDelete={handleTrimDelete}
										shadowIntensity={shadowIntensity}
										onShadowChange={(v) => updateState({ shadowIntensity: v })}
										onShadowCommit={commitState}
										showBlur={showBlur}
										onBlurChange={(v) => pushState({ showBlur: v })}
										showTrimWaveform={showTrimWaveform}
										onTrimWaveformChange={(v) => pushState({ showTrimWaveform: v })}
										motionBlurAmount={motionBlurAmount}
										onMotionBlurChange={(v) => updateState({ motionBlurAmount: v })}
										onMotionBlurCommit={commitState}
										borderRadius={borderRadius}
										onBorderRadiusChange={(v) => updateState({ borderRadius: v })}
										onBorderRadiusCommit={commitState}
										padding={padding}
										onPaddingChange={(v) => updateState({ padding: v })}
										onPaddingCommit={commitState}
										cropRegion={cropRegion}
										onCropChange={(r) => pushState({ cropRegion: r })}
										aspectRatio={aspectRatio}
										hasWebcam={Boolean(webcamVideoPath)}
										webcamLayoutPreset={webcamLayoutPreset}
										onWebcamLayoutPresetChange={(preset) =>
											pushState({
												webcamLayoutPreset: preset,
												webcamPosition: preset === "picture-in-picture" ? webcamPosition : null,
											})
										}
										webcamMaskShape={webcamMaskShape}
										onWebcamMaskShapeChange={(shape) => pushState({ webcamMaskShape: shape })}
										webcamMirrored={webcamMirrored}
										webcamReactiveZoom={webcamReactiveZoom}
										onWebcamMirroredChange={(mirrored) => pushState({ webcamMirrored: mirrored })}
										onWebcamReactiveZoomChange={(reactive) =>
											pushState({ webcamReactiveZoom: reactive })
										}
										webcamSizePreset={webcamSizePreset}
										onWebcamSizePresetChange={(v) => updateState({ webcamSizePreset: v })}
										onWebcamSizePresetCommit={commitState}
										videoElement={videoPlaybackRef.current?.video || null}
										exportQuality={exportQuality}
										onExportQualityChange={setExportQuality}
										exportFormat={exportFormat}
										onExportFormatChange={setExportFormat}
										gifFrameRate={gifFrameRate}
										onGifFrameRateChange={setGifFrameRate}
										gifLoop={gifLoop}
										onGifLoopChange={setGifLoop}
										gifSizePreset={gifSizePreset}
										onGifSizePresetChange={setGifSizePreset}
										gifOutputDimensions={calculateOutputDimensions(
											calculateEffectiveSourceDimensions(
												videoPlaybackRef.current?.video?.videoWidth ||
													DEFAULT_SOURCE_DIMENSIONS.width,
												videoPlaybackRef.current?.video?.videoHeight ||
													DEFAULT_SOURCE_DIMENSIONS.height,
												cropRegion,
											).width,
											calculateEffectiveSourceDimensions(
												videoPlaybackRef.current?.video?.videoWidth ||
													DEFAULT_SOURCE_DIMENSIONS.width,
												videoPlaybackRef.current?.video?.videoHeight ||
													DEFAULT_SOURCE_DIMENSIONS.height,
												cropRegion,
											).height,
											gifSizePreset,
											GIF_SIZE_PRESETS,
											aspectRatio === "native"
												? getNativeAspectRatioValue(
														videoPlaybackRef.current?.video?.videoWidth ||
															DEFAULT_SOURCE_DIMENSIONS.width,
														videoPlaybackRef.current?.video?.videoHeight ||
															DEFAULT_SOURCE_DIMENSIONS.height,
														cropRegion,
													)
												: getAspectRatioValue(aspectRatio),
										)}
										onExport={handleOpenExportDialog}
										onExportPanelOpen={() => {
											setSelectedZoomId(null);
											setSelectedTrimId(null);
											setSelectedSpeedId(null);
										}}
										selectedAnnotationId={selectedAnnotationId}
										annotationRegions={annotationOnlyRegions}
										holdCollections={holdCollections}
										selectedHoldSegmentKey={selectedHoldSegmentKey}
										onSelectHoldSegment={handleSelectHoldSegment}
										onHoldCollectionAppendSegment={handleHoldCollectionAppendSegment}
										onHoldSegmentDurationChange={handleHoldSegmentDurationChange}
										onHoldSegmentContentChange={handleHoldSegmentContentChange}
										onHoldSegmentTypeChange={handleHoldSegmentTypeChange}
										onHoldSegmentStyleChange={handleHoldSegmentStyleChange}
										onHoldSegmentFigureDataChange={handleHoldSegmentFigureDataChange}
										onHoldSegmentDelete={handleHoldSegmentDelete}
										holdRegions={holdRegions}
										onAnnotationContentChange={handleAnnotationContentChange}
										onAnnotationTypeChange={handleAnnotationTypeChange}
										onAnnotationStyleChange={handleAnnotationStyleChange}
										onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
										onAnnotationDuplicate={handleAnnotationDuplicate}
										onAnnotationDelete={handleAnnotationDelete}
										videoDurationMs={Math.round(duration * 1000)}
										onAnnotationDurationChange={handleAnnotationDurationChange}
										onAnnotationFreezeChange={handleAnnotationFreezeChange}
										selectedAudioAnnotationId={selectedAudioAnnotationId}
										audioAnnotationClips={audioAnnotationClips}
										onAudioAnnotationVolumeChange={handleAudioAnnotationVolumeChange}
										onAudioAnnotationDurationChange={handleAudioAnnotationDurationChange}
										onAudioAnnotationFreezeChange={handleAudioAnnotationFreezeChange}
										onAudioAnnotationReplace={handleAudioAnnotationReplace}
										onAudioAnnotationDelete={handleAudioAnnotationDelete}
										selectedBlurId={selectedBlurId}
										blurRegions={blurRegions}
										onBlurDataChange={handleBlurDataPanelChange}
										onBlurDataCommit={commitState}
										onBlurDelete={handleAnnotationDelete}
										selectedSpeedId={selectedSpeedId}
										selectedSpeedValue={
											selectedSpeedId
												? (speedRegions.find((r) => r.id === selectedSpeedId)?.speed ?? null)
												: null
										}
										onSpeedChange={handleSpeedChange}
										onSpeedDelete={handleSpeedDelete}
										unsavedExport={unsavedExport}
										onSaveUnsavedExport={handleSaveUnsavedExport}
										onSaveDiagnostic={handleSaveDiagnostic}
										showCursor={showCursor}
										onShowCursorChange={setShowCursor}
										cursorSize={cursorSize}
										onCursorSizeChange={setCursorSize}
										cursorSmoothing={cursorSmoothing}
										onCursorSmoothingChange={setCursorSmoothing}
										cursorMotionBlur={cursorMotionBlur}
										onCursorMotionBlurChange={setCursorMotionBlur}
										cursorClickBounce={cursorClickBounce}
										onCursorClickBounceChange={setCursorClickBounce}
										cursorClipToBounds={cursorClipToBounds}
										onCursorClipToBoundsChange={setCursorClipToBounds}
										cursorTheme={cursorTheme}
										onCursorThemeChange={setCursorTheme}
										hasCursorData={
											cursorTelemetry.length > 0 ||
											hasNativeCursorRecordingData(cursorRecordingData)
										}
										showCursorSettings={showCursorSettings}
										editorReadOnly={timelineReadOnly}
									/>
								</div>
							</div>
						</Panel>

						<PanelResizeHandle className="editor-resize-handle group">
							<div className="w-10 h-1 bg-white/20 rounded-full transition-colors group-hover:bg-[#34B27B]/70"></div>
						</PanelResizeHandle>

						{/* Full-width timeline */}
						<Panel defaultSize={33} maxSize={54} minSize={24} className="min-h-[210px]">
							<div className="editor-timeline-panel h-full overflow-hidden flex flex-col">
								<TimelineEditor
									videoDuration={duration}
									currentTime={currentTime}
									outputPlaybackTimeMs={outputPlaybackTimeMs}
									outputDurationMs={outputDurationMs}
									playbackMode={playbackMode}
									onPlaybackModeChange={handlePlaybackModeChange}
									timelineReadOnly={timelineReadOnly}
									holdRegions={holdRegions}
									holdCollections={holdCollections}
									selectedHoldSegmentKey={selectedHoldSegmentKey}
									onSelectHoldSegment={handleSelectHoldSegment}
									onHoldSegmentDurationChange={handleHoldSegmentDurationChange}
									onHoldSegmentPairDurationChange={handleHoldSegmentPairDurationChange}
									onHoldSegmentDelete={handleHoldSegmentDelete}
									onHoldCollectionTotalDurationChange={handleHoldCollectionTotalDurationChange}
									onSeek={handleTimelineSeek}
									zoomRegions={zoomRegions}
									onZoomAdded={handleZoomAdded}
									autoZoomEnabled={autoZoomEnabled}
									onToggleAutoZoom={handleToggleAutoZoom}
									autoFocusAll={autoFocusAll}
									onToggleAutoFocusAll={handleToggleAutoFocusAll}
									onZoomSpanChange={handleZoomSpanChange}
									onZoomDelete={handleZoomDelete}
									selectedZoomId={selectedZoomId}
									onSelectZoom={handleSelectZoom}
									trimRegions={trimRegions}
									onTrimAdded={handleTrimAdded}
									onTrimSpanChange={handleTrimSpanChange}
									onTrimDelete={handleTrimDelete}
									selectedTrimId={selectedTrimId}
									onSelectTrim={handleSelectTrim}
									speedRegions={speedRegions}
									onSpeedAdded={handleSpeedAdded}
									onSpeedSpanChange={handleSpeedSpanChange}
									onSpeedDelete={handleSpeedDelete}
									selectedSpeedId={selectedSpeedId}
									onSelectSpeed={handleSelectSpeed}
									annotationRegions={annotationOnlyRegions}
									onAnnotationAdded={handleAnnotationAdded}
									onAnnotationSpanChange={handleAnnotationSpanChange}
									onAnnotationDelete={handleAnnotationDelete}
									selectedAnnotationId={selectedAnnotationId}
									onSelectAnnotation={handleSelectAnnotation}
									audioAnnotationClips={audioAnnotationClips}
									onAudioAnnotationSpanChange={handleAudioAnnotationSpanChange}
									onAudioAnnotationDelete={handleAudioAnnotationDelete}
									selectedAudioAnnotationId={selectedAudioAnnotationId}
									onSelectAudioAnnotation={handleSelectAudioAnnotation}
									onImportAudio={handleAudioImportRequest}
									blurRegions={blurRegions}
									onBlurSpanChange={handleAnnotationSpanChange}
									onBlurDelete={handleAnnotationDelete}
									selectedBlurId={selectedBlurId}
									onSelectBlur={handleSelectBlur}
									aspectRatio={aspectRatio}
									onAspectRatioChange={(ar) =>
										pushState({
											aspectRatio: ar,
											webcamLayoutPreset:
												(isPortraitAspectRatio(ar) && webcamLayoutPreset === "dual-frame") ||
												(!isPortraitAspectRatio(ar) && webcamLayoutPreset === "vertical-stack")
													? "picture-in-picture"
													: webcamLayoutPreset,
										})
									}
									videoUrl={videoPath ?? undefined}
									showTrimWaveform={showTrimWaveform}
									captionsLabel={t("autoCaptions.button")}
									isGeneratingCaptions={isAutoCaptioning}
									onGenerateCaptions={() => {
										if (!videoPath) {
											toast.error(t("errors.noVideoLoaded"));
											return;
										}
										if (isAutoCaptioningRef.current) {
											toast.error(t("autoCaptions.busy"));
											return;
										}
										setShowAutoCaptionsDialog(true);
									}}
								/>
							</div>
						</Panel>
					</PanelGroup>
				</div>
			)}

			<ExportDialog
				isOpen={showExportDialog}
				onClose={() => setShowExportDialog(false)}
				progress={exportProgress}
				isExporting={isExporting}
				error={exportError}
				onCancel={handleCancelExport}
				exportFormat={exportFormat}
				exportedFilePath={exportedFilePath || undefined}
				onShowInFolder={
					exportedFilePath ? () => void handleShowExportedFile(exportedFilePath) : undefined
				}
			/>

			<UnsavedChangesDialog
				isOpen={showCloseConfirmDialog}
				onSaveAndClose={handleCloseConfirmSave}
				onDiscardAndClose={handleCloseConfirmDiscard}
				onCancel={handleCloseConfirmCancel}
			/>

			<UnsavedChangesDialog
				isOpen={confirmDialogVariant !== null}
				variant={confirmDialogVariant ?? "newProject"}
				onSaveAndClose={
					confirmDialogVariant === "loadProject"
						? handleLoadProjectConfirmSave
						: handleNewProjectConfirmSave
				}
				onDiscardAndClose={
					confirmDialogVariant === "loadProject"
						? handleLoadProjectConfirmDiscard
						: handleNewProjectConfirmDiscard
				}
				onCancel={() => setConfirmDialogVariant(null)}
			/>
		</div>
	);
}
