import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWindow, ipcMain, screen } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const HEADLESS = process.env["HEADLESS"] === "true";

// Asset base URL for renderer (wallpapers, etc.). Packaged: extraResources copies
// public/wallpapers to resources/wallpapers. Unpackaged: <appRoot>/public/.
const ASSET_BASE_DIR = process.defaultApp
	? path.join(__dirname, "..", "public")
	: process.resourcesPath;
const ASSET_BASE_URL_ARG = `--asset-base-url=${pathToFileURL(`${ASSET_BASE_DIR}${path.sep}`).toString()}`;

let hudOverlayWindow: BrowserWindow | null = null;
let hudSettingsWindow: BrowserWindow | null = null;

export type HudSettingsAnchor = {
	anchorCenterX?: number;
	anchorTopY?: number;
	gap?: number;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

const DEFAULT_HUD_SETTINGS_WIDTH = 288;
const DEFAULT_HUD_SETTINGS_HEIGHT = 420;
const MIN_HUD_SETTINGS_WIDTH = 240;
const MIN_HUD_SETTINGS_HEIGHT = 280;
const MAX_HUD_SETTINGS_WIDTH = 480;
const MAX_HUD_SETTINGS_HEIGHT = 600;

function clampHudSettingsSize(width: number, height: number) {
	return {
		width: Math.max(MIN_HUD_SETTINGS_WIDTH, Math.min(MAX_HUD_SETTINGS_WIDTH, Math.round(width))),
		height: Math.max(
			MIN_HUD_SETTINGS_HEIGHT,
			Math.min(MAX_HUD_SETTINGS_HEIGHT, Math.round(height)),
		),
	};
}

function notifyHudSettingsClosed() {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.webContents.send("hud-settings-closed");
	}
}

function positionHudSettingsWindow(
	win: BrowserWindow,
	placement: HudSettingsAnchor,
	size: { width: number; height: number },
) {
	const { width, height } = clampHudSettingsSize(size.width, size.height);

	if (Number.isFinite(placement.x) && Number.isFinite(placement.y)) {
		const { workArea } = screen.getDisplayNearestPoint({
			x: placement.x as number,
			y: placement.y as number,
		});
		const clamped = clampHudOverlayToWorkArea(
			{
				x: Math.round(placement.x as number),
				y: Math.round(placement.y as number),
				width,
				height,
			},
			workArea,
		);
		win.setBounds(clamped);
		return;
	}

	if (!Number.isFinite(placement.anchorCenterX) || !Number.isFinite(placement.anchorTopY)) {
		return;
	}

	const anchor = {
		anchorCenterX: placement.anchorCenterX as number,
		anchorTopY: placement.anchorTopY as number,
		gap: Number.isFinite(placement.gap) ? Math.max(0, placement.gap ?? 8) : 8,
	};
	const { workArea } = screen.getDisplayNearestPoint({
		x: anchor.anchorCenterX,
		y: anchor.anchorTopY,
	});
	const clamped = clampHudOverlayToWorkArea(
		{
			x: Math.round(anchor.anchorCenterX - width / 2),
			y: Math.round(anchor.anchorTopY - anchor.gap - height),
			width,
			height,
		},
		workArea,
	);
	win.setBounds(clamped);
}

export function getHudSettingsWindow(): BrowserWindow | null {
	if (hudSettingsWindow && !hudSettingsWindow.isDestroyed()) {
		return hudSettingsWindow;
	}
	return null;
}

export function closeHudSettingsWindow() {
	if (hudSettingsWindow && !hudSettingsWindow.isDestroyed()) {
		hudSettingsWindow.close();
		return;
	}
	hudSettingsWindow = null;
	notifyHudSettingsClosed();
}

function clampHudOverlayToWorkArea(
	bounds: Electron.Rectangle,
	workArea: Electron.Rectangle,
): Electron.Rectangle {
	const width = Math.min(Math.max(1, bounds.width), workArea.width);
	const height = Math.min(Math.max(1, bounds.height), workArea.height);
	const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width));
	const y = Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height));

	return {
		x: Math.round(x),
		y: Math.round(y),
		width: Math.round(width),
		height: Math.round(height),
	};
}

ipcMain.on("hud-overlay-hide", () => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.minimize();
	}
	closeHudSettingsWindow();
});

ipcMain.on("hud-overlay-ignore-mouse-events", (_event, ignore: boolean) => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
	}
});

ipcMain.on("hud-overlay-move-by", (_event, deltaX: number, deltaY: number) => {
	if (
		!hudOverlayWindow ||
		hudOverlayWindow.isDestroyed() ||
		!Number.isFinite(deltaX) ||
		!Number.isFinite(deltaY)
	) {
		return;
	}

	const bounds = hudOverlayWindow.getBounds();
	const { workArea } = screen.getDisplayMatching(bounds);
	const clamped = clampHudOverlayToWorkArea(
		{
			x: bounds.x + deltaX,
			y: bounds.y + deltaY,
			width: bounds.width,
			height: bounds.height,
		},
		workArea,
	);
	hudOverlayWindow.setPosition(clamped.x, clamped.y, false);
});

// Resize the HUD to fit its rendered content. Anchored by its bottom-centre so it
// stays where the user dragged it while only growing/shrinking, which lets the
// vertical tray layout grow tall instead of scrolling inside a fixed window.
ipcMain.on("hud-overlay-set-size", (_event, width: number, height: number) => {
	if (
		!hudOverlayWindow ||
		hudOverlayWindow.isDestroyed() ||
		!Number.isFinite(width) ||
		!Number.isFinite(height)
	) {
		return;
	}

	const bounds = hudOverlayWindow.getBounds();

	// Clamp to the work area of the display the HUD sits on; on a short screen the
	// vertical layout can exceed the display, where the bar's own overflow scroll takes over.
	const { workArea } = screen.getDisplayMatching(bounds);
	const nextWidth = Math.min(workArea.width, Math.max(1, Math.round(width)));
	const nextHeight = Math.min(workArea.height, Math.max(1, Math.round(height)));

	const centerX = bounds.x + bounds.width / 2;
	const bottomY = bounds.y + bounds.height;

	const clamped = clampHudOverlayToWorkArea(
		{
			x: Math.round(centerX - nextWidth / 2),
			y: Math.round(bottomY - nextHeight),
			width: nextWidth,
			height: nextHeight,
		},
		workArea,
	);

	if (
		bounds.x === clamped.x &&
		bounds.y === clamped.y &&
		bounds.width === clamped.width &&
		bounds.height === clamped.height
	) {
		return;
	}

	hudOverlayWindow.setBounds(clamped);
});

ipcMain.handle("hud-settings-toggle", async (_, anchor: HudSettingsAnchor) => {
	const existing = getHudSettingsWindow();
	if (existing?.isVisible()) {
		closeHudSettingsWindow();
		return { opened: false };
	}

	if (!anchor) {
		return { opened: false };
	}

	const hasSavedPosition = Number.isFinite(anchor.x) && Number.isFinite(anchor.y);
	const hasHudAnchor = Number.isFinite(anchor.anchorCenterX) && Number.isFinite(anchor.anchorTopY);
	if (!hasSavedPosition && !hasHudAnchor) {
		return { opened: false };
	}

	let win = getHudSettingsWindow();
	if (!win) {
		win = createHudSettingsWindow();
	}

	if (win.webContents.isLoading()) {
		await new Promise<void>((resolve) => {
			win?.once("ready-to-show", resolve);
		});
	}

	positionHudSettingsWindow(win, anchor, {
		width: Number.isFinite(anchor.width) ? anchor.width : DEFAULT_HUD_SETTINGS_WIDTH,
		height: Number.isFinite(anchor.height) ? anchor.height : DEFAULT_HUD_SETTINGS_HEIGHT,
	});

	if (!win.isVisible()) {
		win.show();
	}
	win.focus();

	return { opened: true };
});

ipcMain.on("hud-settings-close", () => {
	closeHudSettingsWindow();
});

ipcMain.on("hud-settings-move-by", (_event, deltaX: number, deltaY: number) => {
	const win = getHudSettingsWindow();
	if (!win || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
		return;
	}

	const bounds = win.getBounds();
	const { workArea } = screen.getDisplayMatching(bounds);
	const clamped = clampHudOverlayToWorkArea(
		{
			x: bounds.x + deltaX,
			y: bounds.y + deltaY,
			width: bounds.width,
			height: bounds.height,
		},
		workArea,
	);
	win.setPosition(clamped.x, clamped.y, false);
});

ipcMain.on("hud-settings-set-size", (_, width: number, height: number) => {
	const win = getHudSettingsWindow();
	if (!win || !Number.isFinite(width) || !Number.isFinite(height)) {
		return;
	}

	const bounds = win.getBounds();
	const { width: nextWidth, height: nextHeight } = clampHudSettingsSize(width, height);
	const { workArea } = screen.getDisplayMatching(bounds);
	const clamped = clampHudOverlayToWorkArea(
		{
			x: bounds.x,
			y: bounds.y,
			width: nextWidth,
			height: nextHeight,
		},
		workArea,
	);
	win.setBounds(clamped);
});

ipcMain.on(
	"hud-settings-sync",
	(_event, payload: { trayLayout?: "horizontal" | "vertical"; locale?: string }) => {
		if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
			hudOverlayWindow.webContents.send("hud-settings-sync", payload);
		}
	},
);

/**
 * Frameless transparent HUD overlay, always-on-top, centred at the bottom of the
 * primary display. Follows the user across macOS Spaces so it isn't lost on switch.
 */
export function createHudOverlayWindow(): BrowserWindow {
	const primaryDisplay = screen.getPrimaryDisplay();
	const { workArea } = primaryDisplay;

	const windowWidth = 600;
	const windowHeight = 160;

	const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2);
	const y = Math.floor(workArea.y + workArea.height - windowHeight - 5);

	const win = new BrowserWindow({
		width: windowWidth,
		height: windowHeight,
		// Min/max are intentionally loose: the renderer resizes to fit content via
		// "hud-overlay-set-size" (above), needed for the vertical tray to grow taller.
		minWidth: 120,
		minHeight: 80,
		x: x,
		y: y,
		frame: false,
		transparent: true,
		// Fully-transparent ARGB backing. Without this macOS draws the window as a
		// rounded glass panel with a border around the HUD content.
		backgroundColor: "#00000000",
		// Don't let macOS mask the window into a rounded rect; the HUD bar provides
		// its own rounding and the window itself must be invisible.
		roundedCorners: false,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false, // shown via ready-to-show to avoid black rectangle flash
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});
	win.setIgnoreMouseEvents(true, { forward: true });

	// Follow the user across macOS Spaces, else the HUD stays pinned to the Space
	// it was first opened on.
	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}

	// Show only once painted to avoid the black rectangle flash when a transparent
	// window is shown before its first paint.
	win.once("ready-to-show", () => {
		if (!HEADLESS) win.show();
	});

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
	});

	hudOverlayWindow = win;

	win.on("closed", () => {
		if (hudOverlayWindow === win) {
			hudOverlayWindow = null;
		}
		closeHudSettingsWindow();
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=hud-overlay");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "hud-overlay" },
		});
	}

	return win;
}

/**
 * Frameless HUD settings panel as its own window. Position is controlled by the main
 * process so it stays anchored above the HUD bar and follows HUD drags.
 */
export function createHudSettingsWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: DEFAULT_HUD_SETTINGS_WIDTH,
		height: DEFAULT_HUD_SETTINGS_HEIGHT,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		roundedCorners: false,
		resizable: false,
		movable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}

	win.once("ready-to-show", () => {
		if (!HEADLESS) win.show();
	});

	win.on("closed", () => {
		if (hudSettingsWindow === win) {
			hudSettingsWindow = null;
			notifyHudSettingsClosed();
		}
	});

	hudSettingsWindow = win;

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(`${VITE_DEV_SERVER_URL}?windowType=hud-settings`);
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "hud-settings" },
		});
	}

	return win;
}

/**
 * Main editor window. Starts maximised with a hidden title bar on macOS; not
 * always-on-top and appears in the taskbar/dock.
 */
export function createEditorWindow(): BrowserWindow {
	const isMac = process.platform === "darwin";

	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 800,
		minHeight: 600,
		...(isMac && {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 12, y: 12 },
		}),
		transparent: false,
		resizable: true,
		alwaysOnTop: false,
		skipTaskbar: false,
		title: "OpenScreen",
		backgroundColor: "#09090b",
		show: false, // shown via ready-to-show to avoid white flash on first load
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: false,
			backgroundThrottling: false,
		},
	});

	win.maximize();

	// Show only once painted to avoid a white flash on cold Vite start.
	win.once("ready-to-show", () => {
		if (!HEADLESS) win.show();
	});

	// Inject dark background before any React paint so the sub-titlebar area never
	// flashes white on a cold Vite load.
	win.webContents.on("dom-ready", () => {
		win.webContents.insertCSS("html, body, #root { background: #09090b !important; }").catch(() => {
			// Best-effort cosmetic; ignore if the page is mid-teardown.
		});
	});

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=editor");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "editor" },
		});
	}

	return win;
}

/**
 * Floating source-selector window for picking a screen or window to record.
 * Frameless, transparent, and follows the user across macOS Spaces.
 */
export function createSourceSelectorWindow(): BrowserWindow {
	const { width, height } = screen.getPrimaryDisplay().workAreaSize;

	const win = new BrowserWindow({
		width: 620,
		height: 420,
		minHeight: 350,
		maxHeight: 500,
		x: Math.round((width - 620) / 2),
		y: Math.round((height - 420) / 2),
		frame: false,
		resizable: false,
		alwaysOnTop: true,
		transparent: true,
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	// Follow the user across macOS Spaces so the selector appears on the active
	// desktop regardless of where the HUD was opened.
	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=source-selector");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "source-selector" },
		});
	}

	return win;
}

/**
 * Centered transparent countdown overlay that sits above the HUD during
 * recording pre-roll.
 */
export function createCountdownOverlayWindow(): BrowserWindow {
	const { workArea } = screen.getPrimaryDisplay();
	const overlayWidth = 420;
	const overlayHeight = 260;

	const win = new BrowserWindow({
		width: overlayWidth,
		height: overlayHeight,
		minWidth: overlayWidth,
		maxWidth: overlayWidth,
		minHeight: overlayHeight,
		maxHeight: overlayHeight,
		x: Math.round(workArea.x + (workArea.width - overlayWidth) / 2),
		y: Math.round(workArea.y + (workArea.height - overlayHeight) / 2),
		frame: false,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		focusable: false,
		transparent: true,
		backgroundColor: "#00000000",
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			additionalArguments: [ASSET_BASE_URL_ARG],
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	win.setIgnoreMouseEvents(true);

	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	}

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=countdown-overlay");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "countdown-overlay" },
		});
	}

	return win;
}
