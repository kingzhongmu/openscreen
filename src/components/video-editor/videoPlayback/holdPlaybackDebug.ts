const STORAGE_KEY = "openscreen:hold-debug";

export function isHoldPlaybackDebugEnabled(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === "0") {
		return false;
	}
	if (stored === "1") {
		return true;
	}
	if (
		(window as Window & { __OPENSCREEN_HOLD_DEBUG__?: boolean }).__OPENSCREEN_HOLD_DEBUG__ === true
	) {
		return true;
	}
	return import.meta.env.DEV;
}

export function enableHoldPlaybackDebug(): void {
	localStorage.setItem(STORAGE_KEY, "1");
	console.info("[HoldPlayback] debug enabled — reload the page, then reproduce the issue.");
}

export function disableHoldPlaybackDebug(): void {
	localStorage.setItem(STORAGE_KEY, "0");
	console.info("[HoldPlayback] debug disabled.");
}

let lastTickLogAt = 0;
let lastLoggedSourceMs = -1;
let lastLoggedInHold: boolean | null = null;

export function holdPlaybackLog(
	category: string,
	data: Record<string, unknown>,
	options?: { throttleMs?: number; always?: boolean },
): void {
	if (!isHoldPlaybackDebugEnabled()) {
		return;
	}

	const throttleMs = options?.throttleMs ?? 0;
	const now = performance.now();

	if (category === "tick" && !options?.always) {
		const sourceMs = typeof data.sourceMs === "number" ? data.sourceMs : -1;
		const inHold = data.inHoldOutput === true;
		const sourceJumped = Math.abs(sourceMs - lastLoggedSourceMs) > 250;
		const holdChanged = inHold !== lastLoggedInHold;

		if (!sourceJumped && !holdChanged && now - lastTickLogAt < (throttleMs || 400)) {
			return;
		}

		lastTickLogAt = now;
		lastLoggedSourceMs = sourceMs;
		lastLoggedInHold = inHold;
	}

	console.log(`[HoldPlayback:${category}]`, data);
}

if (typeof window !== "undefined") {
	(window as Window & { __holdPlaybackDebug?: unknown }).__holdPlaybackDebug = {
		enable: enableHoldPlaybackDebug,
		disable: disableHoldPlaybackDebug,
		enabled: isHoldPlaybackDebugEnabled,
	};
}

if (typeof window !== "undefined" && import.meta.env.DEV) {
	console.info(
		"[HoldPlayback] dev debug logging is ON by default. Filter console by `HoldPlayback`. Disable: localStorage.setItem('openscreen:hold-debug','0') or __holdPlaybackDebug.disable()",
	);
}
