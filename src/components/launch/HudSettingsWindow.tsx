import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import type { Locale } from "@/i18n/config";
import { getAvailableLocales, getLocaleName } from "@/i18n/loader";
import {
	type HudSettingsPanelSize,
	loadUserPreferences,
	MAX_HUD_SETTINGS_PANEL_HEIGHT,
	MAX_HUD_SETTINGS_PANEL_WIDTH,
	MAX_WINDOW_CAPTURE_PADDING_PX,
	MIN_HUD_SETTINGS_PANEL_HEIGHT,
	MIN_HUD_SETTINGS_PANEL_WIDTH,
	saveUserPreferences,
	type WindowCapturePadding,
} from "@/lib/userPreferences";
import styles from "./LaunchWindow.module.css";

type PaddingSide = keyof WindowCapturePadding;

const PADDING_SIDES: PaddingSide[] = ["top", "right", "bottom", "left"];

function clampPanelSize(size: HudSettingsPanelSize): HudSettingsPanelSize {
	return {
		width: Math.max(
			MIN_HUD_SETTINGS_PANEL_WIDTH,
			Math.min(MAX_HUD_SETTINGS_PANEL_WIDTH, Math.round(size.width)),
		),
		height: Math.max(
			MIN_HUD_SETTINGS_PANEL_HEIGHT,
			Math.min(MAX_HUD_SETTINGS_PANEL_HEIGHT, Math.round(size.height)),
		),
	};
}

/** Standalone HUD settings window content. */
export function HudSettingsWindow() {
	const t = useScopedT("launch");
	const availableLocales = getAvailableLocales();
	const { locale, setLocale, resolveSystemLocaleSuggestion } = useI18n();
	const [trayLayout, setTrayLayout] = useState<"horizontal" | "vertical">(
		() => loadUserPreferences().trayLayout,
	);
	const panelSizeRef = useRef<HudSettingsPanelSize>(
		clampPanelSize(loadUserPreferences().hudSettingsPanelSize),
	);
	const [excludeTaskbar, setExcludeTaskbar] = useState(
		() => loadUserPreferences().excludeTaskbarWhenRecordingDisplay,
	);
	const [windowPadding, setWindowPadding] = useState<WindowCapturePadding>(
		() => loadUserPreferences().windowCapturePadding,
	);

	const syncToHud = useCallback(
		(payload: { trayLayout?: "horizontal" | "vertical"; locale?: string }) => {
			window.electronAPI?.notifyHudSettingsSync?.(payload);
		},
		[],
	);

	const updatePanelSize = useCallback((next: HudSettingsPanelSize) => {
		const clamped = clampPanelSize(next);
		panelSizeRef.current = clamped;
		window.electronAPI?.setHudSettingsSize?.(clamped.width, clamped.height);
	}, []);

	const handleClose = () => {
		window.electronAPI?.closeHudSettings?.();
	};

	const persistWindowPosition = useCallback(() => {
		saveUserPreferences({
			hudSettingsPanelPosition: {
				x: window.screenX,
				y: window.screenY,
			},
		});
	}, []);

	const handleTitleBarPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if ((event.target as HTMLElement).closest("button")) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);

			const lastPosition = { x: event.screenX, y: event.screenY };

			const handlePointerMove = (moveEvent: PointerEvent) => {
				const deltaX = moveEvent.screenX - lastPosition.x;
				const deltaY = moveEvent.screenY - lastPosition.y;
				lastPosition.x = moveEvent.screenX;
				lastPosition.y = moveEvent.screenY;
				window.electronAPI?.moveHudSettingsBy?.(deltaX, deltaY);
			};

			const handlePointerUp = () => {
				persistWindowPosition();
				window.removeEventListener("pointermove", handlePointerMove);
				window.removeEventListener("pointerup", handlePointerUp);
				window.removeEventListener("pointercancel", handlePointerUp);
			};

			window.addEventListener("pointermove", handlePointerMove);
			window.addEventListener("pointerup", handlePointerUp);
			window.addEventListener("pointercancel", handlePointerUp);
		},
		[persistWindowPosition],
	);

	const persistExcludeTaskbar = useCallback((next: boolean) => {
		setExcludeTaskbar(next);
		saveUserPreferences({ excludeTaskbarWhenRecordingDisplay: next });
	}, []);

	const persistWindowPaddingSide = useCallback((side: PaddingSide, next: number) => {
		const clamped = Math.max(0, Math.min(MAX_WINDOW_CAPTURE_PADDING_PX, Math.round(next)));
		setWindowPadding((current) => {
			const updated = { ...current, [side]: clamped };
			saveUserPreferences({ windowCapturePadding: updated });
			return updated;
		});
	}, []);

	const persistTrayLayout = useCallback(
		(useVertical: boolean) => {
			const nextLayout = useVertical ? "vertical" : "horizontal";
			setTrayLayout(nextLayout);
			saveUserPreferences({ trayLayout: nextLayout });
			syncToHud({ trayLayout: nextLayout });
		},
		[syncToHud],
	);

	const handleLocaleChange = useCallback(
		(nextLocale: string) => {
			setLocale(nextLocale as Locale);
			resolveSystemLocaleSuggestion();
			syncToHud({ locale: nextLocale });
		},
		[resolveSystemLocaleSuggestion, setLocale, syncToHud],
	);

	const handleResizePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);

			const startX = event.screenX;
			const startY = event.screenY;
			const startSize = panelSizeRef.current;

			const handlePointerMove = (moveEvent: PointerEvent) => {
				updatePanelSize({
					width: startSize.width + (moveEvent.screenX - startX),
					height: startSize.height + (moveEvent.screenY - startY),
				});
			};

			const handlePointerUp = () => {
				saveUserPreferences({ hudSettingsPanelSize: panelSizeRef.current });
				window.removeEventListener("pointermove", handlePointerMove);
				window.removeEventListener("pointerup", handlePointerUp);
				window.removeEventListener("pointercancel", handlePointerUp);
			};

			window.addEventListener("pointermove", handlePointerMove);
			window.addEventListener("pointerup", handlePointerUp);
			window.addEventListener("pointercancel", handlePointerUp);
		},
		[updatePanelSize],
	);

	useEffect(() => {
		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				window.electronAPI?.closeHudSettings?.();
			}
		};
		window.addEventListener("keydown", handleEscape);
		return () => window.removeEventListener("keydown", handleEscape);
	}, []);

	return (
		<div
			className={`${styles.settingsWindowRoot} ${styles.electronNoDrag}`}
			data-hud-interactive="true"
		>
			<div className={styles.settingsMenuTitleBar} onPointerDown={handleTitleBarPointerDown}>
				<span className={styles.settingsMenuTitle}>{t("recordingSettings.title")}</span>
				<button
					type="button"
					className={styles.settingsMenuCloseBtn}
					aria-label={t("recordingSettings.close")}
					data-testid="launch-settings-close-button"
					onClick={handleClose}
				>
					<X size={14} />
				</button>
			</div>

			<div className={`${styles.settingsMenuBody} ${styles.languageMenuScroll}`}>
				<div className={styles.settingsMenuRow}>
					<div className={styles.settingsMenuCopy}>
						<div className={styles.settingsMenuLabel}>
							{t("recordingSettings.trayLayout.label")}
						</div>
						<div className={styles.settingsMenuDescription}>
							{t("recordingSettings.trayLayout.description")}
						</div>
					</div>
					<Switch
						data-testid="launch-tray-layout-switch"
						checked={trayLayout === "vertical"}
						onCheckedChange={persistTrayLayout}
						aria-label={t("recordingSettings.trayLayout.label")}
					/>
				</div>

				<div className={styles.settingsMenuField}>
					<label className={styles.settingsMenuLabel} htmlFor="launch-language-select">
						{t("recordingSettings.language.label")}
					</label>
					<select
						id="launch-language-select"
						data-testid="launch-language-select"
						value={locale}
						onChange={(event) => handleLocaleChange(event.target.value)}
						className={styles.settingsMenuSelect}
					>
						{availableLocales.map((loc) => (
							<option key={loc} value={loc} data-testid={`launch-language-option-${loc}`}>
								{getLocaleName(loc)}
							</option>
						))}
					</select>
				</div>

				<div className={styles.settingsMenuSectionLabel}>
					{t("recordingSettings.captureSection")}
				</div>

				<div className={styles.settingsMenuRow}>
					<div className={styles.settingsMenuCopy}>
						<div className={styles.settingsMenuLabel}>
							{t("recordingSettings.excludeTaskbar.label")}
						</div>
						<div className={styles.settingsMenuDescription}>
							{t("recordingSettings.excludeTaskbar.description")}
						</div>
					</div>
					<Switch
						checked={excludeTaskbar}
						onCheckedChange={persistExcludeTaskbar}
						aria-label={t("recordingSettings.excludeTaskbar.label")}
					/>
				</div>

				<div className={styles.settingsMenuField}>
					<div className={styles.settingsMenuLabel}>
						{t("recordingSettings.windowPadding.label")}
					</div>
					<div className={styles.settingsMenuDescription}>
						{t("recordingSettings.windowPadding.description")}
					</div>
					<div className={styles.settingsMenuPaddingGrid}>
						{PADDING_SIDES.map((side) => (
							<label key={side} className={styles.settingsMenuPaddingCell}>
								<span className={styles.settingsMenuPaddingSideLabel}>
									{t(`recordingSettings.windowPadding.${side}`)}
								</span>
								<div className={styles.settingsMenuInputRow}>
									<input
										id={`window-capture-padding-${side}`}
										type="number"
										min={0}
										max={MAX_WINDOW_CAPTURE_PADDING_PX}
										step={1}
										value={windowPadding[side]}
										onChange={(event) => {
											const next = Number(event.target.value);
											if (Number.isFinite(next)) {
												persistWindowPaddingSide(side, next);
											}
										}}
										className={styles.settingsMenuInput}
									/>
									<span className={styles.settingsMenuUnit}>
										{t("recordingSettings.windowPadding.unit")}
									</span>
								</div>
							</label>
						))}
					</div>
				</div>

				<div className={styles.settingsMenuHint}>{t("recordingSettings.nativeOnlyHint")}</div>
			</div>

			<div
				className={styles.settingsMenuResizeHandle}
				aria-hidden="true"
				onPointerDown={handleResizePointerDown}
			/>
		</div>
	);
}
