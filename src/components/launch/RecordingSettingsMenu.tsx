import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { loadUserPreferences } from "@/lib/userPreferences";
import styles from "./LaunchWindow.module.css";

const ICON_SIZE = 20;
const HUD_SETTINGS_GAP = 8;

type RecordingSettingsMenuProps = {
	recording: boolean;
	hudIconBtnClasses: string;
	hudBarRef: React.RefObject<HTMLDivElement | null>;
};

export function RecordingSettingsMenu({
	recording,
	hudIconBtnClasses,
	hudBarRef,
}: RecordingSettingsMenuProps) {
	const t = useScopedT("launch");
	const [isOpen, setIsOpen] = useState(false);

	useEffect(() => {
		return window.electronAPI?.onHudSettingsClosed?.(() => {
			setIsOpen(false);
		});
	}, []);

	const getOpenPlacement = useCallback(() => {
		const prefs = loadUserPreferences();
		const size = prefs.hudSettingsPanelSize;

		if (prefs.hudSettingsPanelPosition) {
			return {
				x: prefs.hudSettingsPanelPosition.x,
				y: prefs.hudSettingsPanelPosition.y,
				width: size.width,
				height: size.height,
			};
		}

		const bar = hudBarRef.current;
		if (!bar) return null;
		const rect = bar.getBoundingClientRect();
		return {
			anchorCenterX: window.screenX + rect.left + rect.width / 2,
			anchorTopY: window.screenY + rect.top,
			gap: HUD_SETTINGS_GAP,
			width: size.width,
			height: size.height,
		};
	}, [hudBarRef]);

	const handleToggle = async () => {
		if (recording) return;
		const placement = getOpenPlacement();
		if (!placement || !window.electronAPI?.toggleHudSettings) return;
		const result = await window.electronAPI.toggleHudSettings(placement);
		setIsOpen(result.opened);
	};

	useEffect(() => {
		if (recording) {
			window.electronAPI?.closeHudSettings?.();
			setIsOpen(false);
		}
	}, [recording]);

	return (
		<div className={`${styles.languageMenuContainer} ${styles.electronNoDrag}`}>
			<button
				type="button"
				data-testid="launch-recording-settings-button"
				aria-label={t("recordingSettings.title")}
				aria-expanded={isOpen}
				aria-haspopup="dialog"
				disabled={recording}
				onClick={handleToggle}
				title={t("recordingSettings.title")}
				className={`${hudIconBtnClasses} ${styles.electronNoDrag}`}
			>
				<Settings2 size={ICON_SIZE} className={recording ? "text-white/30" : "text-white/60"} />
			</button>
		</div>
	);
}
