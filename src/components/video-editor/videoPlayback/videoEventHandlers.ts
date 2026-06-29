import type React from "react";
import { isOutputTimeInHold } from "@/lib/timelineMapping";
import type { HoldRegion, SpeedRegion, TrimRegion } from "../types";
import { createHoldPlaybackClock } from "./holdPlayback";
import { holdPlaybackLog } from "./holdPlaybackDebug";

// Keep "scrub mode" on for a brief tail after `seeked`: rapid drag-scrubbing fires
// `seeking`/`seeked` dozens of times a second and toggling effects each time would flicker.
const SCRUB_END_DEBOUNCE_MS = 150;

interface VideoEventHandlersParams {
	video: HTMLVideoElement;
	isSeekingRef: React.MutableRefObject<boolean>;
	isPlayingRef: React.MutableRefObject<boolean>;
	allowPlaybackRef: React.MutableRefObject<boolean>;
	currentTimeRef: React.MutableRefObject<number>;
	outputTimeRef: React.MutableRefObject<number>;
	holdSeekInProgressRef: React.MutableRefObject<boolean>;
	timeUpdateAnimationRef: React.MutableRefObject<number | null>;
	onPlayStateChange: (playing: boolean) => void;
	onTimeUpdate: (time: number, outputTimeMs?: number) => void;
	trimRegionsRef: React.MutableRefObject<TrimRegion[]>;
	speedRegionsRef: React.MutableRefObject<SpeedRegion[]>;
	holdRegionsRef: React.MutableRefObject<HoldRegion[]>;
	sourceDurationMsRef: React.MutableRefObject<number>;
	isScrubbingRef?: React.MutableRefObject<boolean>;
	scrubEndTimerRef?: React.MutableRefObject<number | null>;
	onScrubChange?: (scrubbing: boolean) => void;
	onAfterTimeUpdate?: () => void;
}

export function createVideoEventHandlers(params: VideoEventHandlersParams) {
	const {
		video,
		isSeekingRef,
		isPlayingRef,
		allowPlaybackRef,
		currentTimeRef,
		outputTimeRef,
		holdSeekInProgressRef,
		timeUpdateAnimationRef,
		onPlayStateChange,
		onTimeUpdate,
		trimRegionsRef,
		speedRegionsRef,
		holdRegionsRef,
		sourceDurationMsRef,
		isScrubbingRef,
		scrubEndTimerRef,
		onScrubChange,
		onAfterTimeUpdate,
	} = params;

	let holdClock: ReturnType<typeof createHoldPlaybackClock> | null = null;
	let holdClockKey = "";

	const clearScrubEndTimer = () => {
		if (scrubEndTimerRef && scrubEndTimerRef.current !== null) {
			window.clearTimeout(scrubEndTimerRef.current);
			scrubEndTimerRef.current = null;
		}
	};

	const emitTime = (timeValue: number, outputTimeMs?: number) => {
		currentTimeRef.current = timeValue * 1000;
		if (outputTimeMs !== undefined) {
			outputTimeRef.current = outputTimeMs;
		} else {
			outputTimeRef.current = timeValue * 1000;
		}
		onTimeUpdate(timeValue, outputTimeMs);
		onAfterTimeUpdate?.();
	};

	const findActiveTrimRegion = (currentTimeMs: number): TrimRegion | null => {
		const trimRegions = trimRegionsRef.current;
		return (
			trimRegions.find(
				(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
			) || null
		);
	};

	const findActiveSpeedRegion = (currentTimeMs: number): SpeedRegion | null => {
		return (
			speedRegionsRef.current.find(
				(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
			) || null
		);
	};

	const hasHoldRegions = () => holdRegionsRef.current.length > 0;

	const resolveSourceMsForClockReset = () => {
		const fromVideo =
			Number.isFinite(video.currentTime) && video.currentTime >= 0
				? Math.round(video.currentTime * 1000)
				: null;
		return fromVideo ?? currentTimeRef.current;
	};

	const ensureHoldClock = () => {
		if (!hasHoldRegions()) {
			holdClock = null;
			holdClockKey = "";
			return null;
		}
		const sourceDurationMs = Math.max(
			sourceDurationMsRef.current,
			Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 1000) : 0,
		);
		const nextKey = JSON.stringify({
			holds: holdRegionsRef.current,
			sourceDurationMs,
		});
		if (!holdClock || holdClockKey !== nextKey) {
			const resetSourceMs = resolveSourceMsForClockReset();
			holdClockKey = nextKey;
			holdClock = createHoldPlaybackClock(holdRegionsRef.current, sourceDurationMs);
			holdClock.resetFromSource(resetSourceMs);
			holdPlaybackLog("clock-created", {
				resetSourceMs,
				currentTimeRefMs: currentTimeRef.current,
				videoCurrentTimeMs: Math.round(video.currentTime * 1000),
				sourceDurationMs,
				maxOutputMs: holdClock.getMaxOutputMs(),
				holdRegions: holdRegionsRef.current,
			});
		}
		return holdClock;
	};

	const seekVideoToSourceMs = (sourceMs: number) => {
		const sourceSec = sourceMs / 1000;
		const deltaSec = Math.abs(video.currentTime - sourceSec);
		if (deltaSec <= 0.001) {
			holdPlaybackLog(
				"seek-skipped",
				{ sourceMs, videoCurrentTimeMs: Math.round(video.currentTime * 1000), deltaSec },
				{ throttleMs: 400 },
			);
			return;
		}
		holdSeekInProgressRef.current = true;
		holdPlaybackLog("seek", {
			fromMs: Math.round(video.currentTime * 1000),
			toMs: sourceMs,
			deltaSec,
		});
		video.currentTime = sourceSec;
	};

	const clearHoldSeekFlag = () => {
		holdSeekInProgressRef.current = false;
	};

	const applySourceTimeToVideo = (sourceMs: number, outputMs?: number) => {
		const clampedSourceMs = Math.max(0, sourceMs);
		const sourceSec = clampedSourceMs / 1000;
		const activeTrimRegion = findActiveTrimRegion(clampedSourceMs);

		if (activeTrimRegion && !video.paused && !video.ended) {
			const skipToTime = activeTrimRegion.endMs / 1000;
			if (skipToTime >= video.duration) {
				video.pause();
				return;
			}
			seekVideoToSourceMs(activeTrimRegion.endMs);
			emitTime(skipToTime, holdClock?.getOutputTimeMs());
			return;
		}

		const activeSpeedRegion = findActiveSpeedRegion(clampedSourceMs);
		const resolvedOutputMs = outputMs ?? holdClock?.getOutputTimeMs() ?? clampedSourceMs;
		const inHoldOutput =
			hasHoldRegions() && isOutputTimeInHold(resolvedOutputMs, holdRegionsRef.current);

		// Only freeze native advancement during hold segments. playbackRate=0 for the
		// entire timeline prevents intermediate seeks from updating decoded frames.
		video.playbackRate = inHoldOutput ? 0 : activeSpeedRegion ? activeSpeedRegion.speed : 1;

		seekVideoToSourceMs(clampedSourceMs);
		emitTime(sourceSec, resolvedOutputMs);

		holdPlaybackLog(
			"tick",
			{
				sourceMs: Math.round(clampedSourceMs),
				rawSourceMs: Math.round(sourceMs),
				outputMs: Math.round(resolvedOutputMs),
				inHoldOutput,
				playbackRate: video.playbackRate,
				videoCurrentTimeMs: Math.round(video.currentTime * 1000),
				paused: video.paused,
				readyState: video.readyState,
			},
			{ throttleMs: 400 },
		);
	};

	function updateTime() {
		if (!video) return;

		if (hasHoldRegions()) {
			const clock = ensureHoldClock();
			if (!clock) {
				return;
			}

			const tick = clock.tick(performance.now());
			applySourceTimeToVideo(tick.sourceMs, tick.outputMs);

			if (tick.finished) {
				holdPlaybackLog("finished", {
					outputMs: Math.round(tick.outputMs),
					sourceMs: Math.round(tick.sourceMs),
				});
				video.pause();
				return;
			}
		} else {
			const currentTimeMs = video.currentTime * 1000;
			const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

			if (activeTrimRegion && !video.paused && !video.ended) {
				const skipToTime = activeTrimRegion.endMs / 1000;

				if (skipToTime >= video.duration) {
					video.pause();
				} else {
					video.currentTime = skipToTime;
					emitTime(skipToTime);
				}
			} else {
				const activeSpeedRegion = findActiveSpeedRegion(currentTimeMs);
				video.playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
				emitTime(video.currentTime);
			}
		}

		if (!video.paused && !video.ended) {
			timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
		}
	}

	const handlePlay = () => {
		if (isSeekingRef.current) {
			holdPlaybackLog("play-blocked", { reason: "isSeeking" });
			video.pause();
			return;
		}

		if (!allowPlaybackRef.current) {
			holdPlaybackLog("play-blocked", { reason: "allowPlayback=false" });
			video.pause();
			return;
		}

		if (hasHoldRegions()) {
			const clock = ensureHoldClock();
			const resetSourceMs = resolveSourceMsForClockReset();
			clock?.resetFromSource(resetSourceMs);
			holdPlaybackLog("play", {
				resetSourceMs,
				currentTimeRefMs: currentTimeRef.current,
				videoCurrentTimeMs: Math.round(video.currentTime * 1000),
				outputMs: clock?.getOutputTimeMs(),
				maxOutputMs: clock?.getMaxOutputMs(),
				holdRegions: holdRegionsRef.current,
				allowPlayback: allowPlaybackRef.current,
				isSeeking: isSeekingRef.current,
			});
		}

		isPlayingRef.current = true;
		onPlayStateChange(true);
		if (timeUpdateAnimationRef.current) {
			cancelAnimationFrame(timeUpdateAnimationRef.current);
		}
		timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
	};

	const handlePause = () => {
		isPlayingRef.current = false;
		if (hasHoldRegions()) {
			const activeSpeedRegion = findActiveSpeedRegion(video.currentTime * 1000);
			video.playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
			holdPlaybackLog("pause", {
				videoCurrentTimeMs: Math.round(video.currentTime * 1000),
				outputMs: holdClock?.getOutputTimeMs(),
			});
		}
		onPlayStateChange(false);
		if (timeUpdateAnimationRef.current) {
			cancelAnimationFrame(timeUpdateAnimationRef.current);
			timeUpdateAnimationRef.current = null;
		}
		emitTime(video.currentTime, holdClock?.getOutputTimeMs());
	};

	const handleSeeked = () => {
		const wasHoldSeek = holdSeekInProgressRef.current;
		clearHoldSeekFlag();
		isSeekingRef.current = false;

		if (isScrubbingRef && scrubEndTimerRef) {
			clearScrubEndTimer();
			scrubEndTimerRef.current = window.setTimeout(() => {
				isScrubbingRef.current = false;
				scrubEndTimerRef.current = null;
				onScrubChange?.(false);
			}, SCRUB_END_DEBOUNCE_MS);
		}

		if (hasHoldRegions() && !wasHoldSeek) {
			const clock = ensureHoldClock();
			const resetSourceMs = resolveSourceMsForClockReset();
			clock?.resetFromSource(resetSourceMs);
			holdPlaybackLog("seeked", {
				wasHoldSeek,
				resetSourceMs,
				videoCurrentTimeMs: Math.round(video.currentTime * 1000),
				currentTimeRefMs: currentTimeRef.current,
				outputMs: clock?.getOutputTimeMs(),
				isPlaying: isPlayingRef.current,
			});
		}

		const currentTimeMs = video.currentTime * 1000;
		const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

		if (activeTrimRegion && isPlayingRef.current && !video.paused) {
			const skipToTime = activeTrimRegion.endMs / 1000;

			if (skipToTime >= video.duration) {
				video.pause();
			} else {
				video.currentTime = skipToTime;
				emitTime(skipToTime, holdClock?.getOutputTimeMs());
			}
		} else {
			if (!isPlayingRef.current && !video.paused) {
				video.pause();
			}
			emitTime(video.currentTime, holdClock?.getOutputTimeMs());
		}
	};

	const handleSeeking = () => {
		if (holdSeekInProgressRef.current) {
			holdPlaybackLog("seeking-ignored", {
				videoCurrentTimeMs: Math.round(video.currentTime * 1000),
			});
			return;
		}

		isSeekingRef.current = true;

		if (isScrubbingRef) {
			clearScrubEndTimer();
			if (!isScrubbingRef.current) {
				isScrubbingRef.current = true;
				onScrubChange?.(true);
			}
		}

		if (!isPlayingRef.current && !video.paused) {
			video.pause();
		}

		if (hasHoldRegions()) {
			const clock = ensureHoldClock();
			const resetSourceMs = resolveSourceMsForClockReset();
			clock?.resetFromSource(resetSourceMs);
			holdPlaybackLog("seeking", {
				resetSourceMs,
				videoCurrentTimeMs: Math.round(video.currentTime * 1000),
				currentTimeRefMs: currentTimeRef.current,
				outputMs: clock?.getOutputTimeMs(),
				isPlaying: isPlayingRef.current,
			});
		}

		emitTime(video.currentTime, holdClock?.getOutputTimeMs());
	};

	return {
		handlePlay,
		handlePause,
		handleSeeked,
		handleSeeking,
	};
}
