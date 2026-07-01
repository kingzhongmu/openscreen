import { Trash2, Upload, Volume2 } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import {
	ACCEPTED_AUDIO_ANNOTATION_EXTENSIONS,
	getAudioFileDurationMs,
	getMaxBgmClipDurationMs,
	isAcceptedAudioAnnotationFile,
} from "@/lib/audioAnnotation";
import { resolveImportedAudioReference } from "@/lib/audioAnnotationPersistence";
import {
	formatAnnotationClockMs,
	MAX_POSITION_ANNOTATION_DURATION_MS,
	MIN_POSITION_ANNOTATION_DURATION_MS,
} from "./positionAnnotation";
import type { AudioAnnotationClip } from "./types";

interface AudioAnnotationSettingsPanelProps {
	clip: AudioAnnotationClip;
	variant?: "narration" | "bgm";
	videoDurationMs?: number;
	holdRegions?: import("./types").HoldRegion[];
	onVolumeChange: (volume: number) => void;
	onDurationChange?: (durationMs: number) => void;
	onFreezeDuringAnnotationChange?: (enabled: boolean) => void;
	onReplaceAudio?: (
		audioUrl: string,
		fileName: string,
		sourceDurationMs: number,
		sourceFilePath?: string,
	) => void;
	onDelete: () => void;
}

export function AudioAnnotationSettingsPanel({
	clip,
	variant = "narration",
	videoDurationMs,
	holdRegions = [],
	onVolumeChange,
	onDurationChange,
	onFreezeDuringAnnotationChange,
	onReplaceAudio,
	onDelete,
}: AudioAnnotationSettingsPanelProps) {
	const t = useScopedT("settings");
	const copyKey = variant === "bgm" ? "bgm" : "audioAnnotation";
	const fileInputRef = useRef<HTMLInputElement>(null);

	const maxDurationMs =
		variant === "bgm" && videoDurationMs
			? getMaxBgmClipDurationMs(clip.anchorMs, videoDurationMs, holdRegions, clip.sourceDurationMs)
			: videoDurationMs
				? Math.max(MIN_POSITION_ANNOTATION_DURATION_MS, videoDurationMs - clip.anchorMs)
				: MAX_POSITION_ANNOTATION_DURATION_MS;
	const sliderMaxMs =
		variant === "bgm"
			? maxDurationMs
			: Math.min(maxDurationMs, MAX_POSITION_ANNOTATION_DURATION_MS);

	const handleReplaceFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file || !onReplaceAudio) {
			return;
		}
		if (!isAcceptedAudioAnnotationFile(file)) {
			toast.error(t("audioAnnotation.invalidFileType"));
			return;
		}

		try {
			const { audioUrl, sourceFilePath } = resolveImportedAudioReference(file);
			const sourceDurationMs = await getAudioFileDurationMs(audioUrl);
			onReplaceAudio(audioUrl, file.name, sourceDurationMs, sourceFilePath);
		} catch {
			toast.error(t("audioAnnotation.failedToLoad"));
		}
	};

	return (
		<div className="min-w-0 p-4 flex flex-col h-full overflow-y-auto custom-scrollbar">
			<div className="mb-4">
				<span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
					{t(`${copyKey}.active`)}
				</span>
				<div className="mt-1 text-xl font-semibold text-slate-100">{t(`${copyKey}.title`)}</div>
			</div>

			<div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 space-y-3">
				<div className="flex items-center justify-between gap-3">
					<div>
						<div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
							{t("annotation.anchorTime")}
						</div>
						<div className="mt-1 text-sm font-semibold tabular-nums text-slate-100">
							{formatAnnotationClockMs(clip.anchorMs)}
						</div>
					</div>
					<div className="text-right">
						<div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
							{t("annotation.duration")}
						</div>
						<div className="mt-1 text-sm font-semibold tabular-nums text-[#a78bfa]">
							{(clip.durationMs / 1000).toFixed(1)}s
						</div>
					</div>
				</div>
				{onDurationChange && (
					<div>
						<Slider
							value={[Math.min(clip.durationMs, sliderMaxMs)]}
							min={MIN_POSITION_ANNOTATION_DURATION_MS}
							max={sliderMaxMs}
							step={100}
							onValueChange={([value]) => onDurationChange(value)}
							className="py-1"
						/>
					</div>
				)}
			</div>

			{onFreezeDuringAnnotationChange && (
				<div className="mb-4 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 space-y-3">
					<div className="flex items-center justify-between gap-3">
						<div>
							<div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
								{t("annotation.freezeDuringAnnotation")}
							</div>
							<div className="mt-1 text-xs text-slate-400">
								{t("audioAnnotation.freezeDuringAnnotationHint")}
							</div>
						</div>
						<Switch
							checked={Boolean(clip.freezeDuringAnnotation)}
							onCheckedChange={onFreezeDuringAnnotationChange}
						/>
					</div>
				</div>
			)}

			<div className="mb-4 space-y-2">
				<div className="text-xs font-medium text-slate-200">{t(`${copyKey}.fileName`)}</div>
				<div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 truncate">
					{clip.fileName || t(`${copyKey}.untitled`)}
				</div>
				{onReplaceAudio && (
					<>
						<input
							ref={fileInputRef}
							type="file"
							accept={ACCEPTED_AUDIO_ANNOTATION_EXTENSIONS.join(",")}
							className="hidden"
							onChange={handleReplaceFile}
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="w-full border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
							onClick={() => fileInputRef.current?.click()}
						>
							<Upload className="w-4 h-4 mr-2" />
							{t(`${copyKey}.replaceFile`)}
						</Button>
					</>
				)}
			</div>

			<div className="mb-6 space-y-2">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2 text-xs font-medium text-slate-200">
						<Volume2 className="w-4 h-4" />
						{t(`${copyKey}.volume`)}
					</div>
					<span className="text-xs tabular-nums text-slate-400">
						{Math.round((clip.volume ?? 1) * 100)}%
					</span>
				</div>
				<Slider
					value={[Math.round((clip.volume ?? 1) * 100)]}
					min={0}
					max={100}
					step={1}
					onValueChange={([value]) => onVolumeChange(value / 100)}
				/>
			</div>

			<Button type="button" variant="destructive" size="sm" className="mt-auto" onClick={onDelete}>
				<Trash2 className="w-4 h-4 mr-2" />
				{t(`${copyKey}.delete`)}
			</Button>
		</div>
	);
}
