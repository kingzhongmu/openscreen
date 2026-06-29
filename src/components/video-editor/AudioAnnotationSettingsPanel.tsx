import { Trash2, Upload, Volume2 } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useScopedT } from "@/contexts/I18nContext";
import {
	ACCEPTED_AUDIO_ANNOTATION_EXTENSIONS,
	getAudioFileDurationMs,
	isAcceptedAudioAnnotationFile,
} from "@/lib/audioAnnotation";
import {
	formatAnnotationClockMs,
	MAX_POSITION_ANNOTATION_DURATION_MS,
	MIN_POSITION_ANNOTATION_DURATION_MS,
} from "./positionAnnotation";
import type { AudioAnnotationClip } from "./types";

interface AudioAnnotationSettingsPanelProps {
	clip: AudioAnnotationClip;
	videoDurationMs?: number;
	onVolumeChange: (volume: number) => void;
	onDurationChange?: (durationMs: number) => void;
	onReplaceAudio?: (audioUrl: string, fileName: string, sourceDurationMs: number) => void;
	onDelete: () => void;
}

export function AudioAnnotationSettingsPanel({
	clip,
	videoDurationMs,
	onVolumeChange,
	onDurationChange,
	onReplaceAudio,
	onDelete,
}: AudioAnnotationSettingsPanelProps) {
	const t = useScopedT("settings");
	const fileInputRef = useRef<HTMLInputElement>(null);

	const maxDurationMs = videoDurationMs
		? Math.max(MIN_POSITION_ANNOTATION_DURATION_MS, videoDurationMs - clip.anchorMs)
		: MAX_POSITION_ANNOTATION_DURATION_MS;

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
			const audioUrl = URL.createObjectURL(file);
			const sourceDurationMs = await getAudioFileDurationMs(audioUrl);
			onReplaceAudio(audioUrl, file.name, sourceDurationMs);
		} catch {
			toast.error(t("audioAnnotation.failedToLoad"));
		}
	};

	return (
		<div className="min-w-0 p-4 flex flex-col h-full overflow-y-auto custom-scrollbar">
			<div className="mb-4">
				<span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
					{t("audioAnnotation.active")}
				</span>
				<div className="mt-1 text-xl font-semibold text-slate-100">
					{t("audioAnnotation.title")}
				</div>
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
							value={[Math.min(clip.durationMs, maxDurationMs)]}
							min={MIN_POSITION_ANNOTATION_DURATION_MS}
							max={Math.min(maxDurationMs, MAX_POSITION_ANNOTATION_DURATION_MS)}
							step={100}
							onValueChange={([value]) => onDurationChange(value)}
							className="py-1"
						/>
					</div>
				)}
			</div>

			<div className="mb-4 space-y-2">
				<div className="text-xs font-medium text-slate-200">{t("audioAnnotation.fileName")}</div>
				<div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 truncate">
					{clip.fileName || t("audioAnnotation.untitled")}
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
							{t("audioAnnotation.replaceFile")}
						</Button>
					</>
				)}
			</div>

			<div className="mb-6 space-y-2">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2 text-xs font-medium text-slate-200">
						<Volume2 className="w-4 h-4" />
						{t("audioAnnotation.volume")}
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
				{t("audioAnnotation.delete")}
			</Button>
		</div>
	);
}
