import type { AudioAnnotationClip } from "@/components/video-editor/types";

const EXPORT_SAMPLE_RATE = 48_000;
const AUDIO_BITRATE = 320_000;

async function decodeArrayBuffer(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
	const context = new AudioContext();
	try {
		return await context.decodeAudioData(arrayBuffer.slice(0));
	} finally {
		await context.close();
	}
}

async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer | null> {
	if (blob.size <= 0) {
		return null;
	}
	try {
		return await decodeArrayBuffer(await blob.arrayBuffer());
	} catch (error) {
		console.warn("[audioAnnotationMixer] Failed to decode base audio blob:", error);
		return null;
	}
}

async function decodeAudioUrl(audioUrl: string): Promise<AudioBuffer | null> {
	try {
		const response = await fetch(audioUrl);
		if (!response.ok) {
			return null;
		}
		return await decodeArrayBuffer(await response.arrayBuffer());
	} catch (error) {
		console.warn("[audioAnnotationMixer] Failed to decode annotation clip:", error);
		return null;
	}
}

function getSupportedAudioMimeType(): string | undefined {
	const candidates = ["audio/webm;codecs=opus", "audio/webm"];
	return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

export async function audioBufferToWebmBlob(buffer: AudioBuffer): Promise<Blob> {
	const context = new AudioContext();
	const destination = context.createMediaStreamDestination();
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(destination);

	const mimeType = getSupportedAudioMimeType();
	const recorder = new MediaRecorder(
		destination.stream,
		mimeType
			? { mimeType, audioBitsPerSecond: AUDIO_BITRATE }
			: { audioBitsPerSecond: AUDIO_BITRATE },
	);
	const chunks: Blob[] = [];

	const recordedBlobPromise = new Promise<Blob>((resolve, reject) => {
		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				chunks.push(event.data);
			}
		};
		recorder.onerror = () => {
			reject(new Error("MediaRecorder failed while encoding mixed audio"));
		};
		recorder.onstop = () => {
			resolve(new Blob(chunks, { type: mimeType || chunks[0]?.type || "audio/webm" }));
		};
	});

	recorder.start();
	source.start();
	await new Promise<void>((resolve) => {
		source.onended = () => resolve();
	});
	recorder.stop();

	try {
		return await recordedBlobPromise;
	} finally {
		destination.stream.getTracks().forEach((track) => track.stop());
		source.disconnect();
		await context.close();
	}
}

export async function mixAudioAnnotationClips(
	baseBlob: Blob,
	clips: AudioAnnotationClip[],
	totalDurationSec: number,
): Promise<Blob> {
	if (clips.length === 0) {
		return baseBlob;
	}

	const frameCount = Math.max(1, Math.ceil(EXPORT_SAMPLE_RATE * totalDurationSec));
	const offline = new OfflineAudioContext(2, frameCount, EXPORT_SAMPLE_RATE);

	const baseBuffer = await decodeAudioBlob(baseBlob);
	if (baseBuffer) {
		const baseSource = offline.createBufferSource();
		baseSource.buffer = baseBuffer;
		baseSource.connect(offline.destination);
		baseSource.start(0, 0, Math.min(baseBuffer.duration, totalDurationSec));
	}

	for (const clip of clips) {
		const clipBuffer = await decodeAudioUrl(clip.audioUrl);
		if (!clipBuffer) {
			continue;
		}

		const startSec = clip.anchorMs / 1000;
		const playDurationSec = Math.min(
			clip.durationMs / 1000,
			clipBuffer.duration,
			Math.max(0, totalDurationSec - startSec),
		);
		if (playDurationSec <= 0 || startSec >= totalDurationSec) {
			continue;
		}

		const source = offline.createBufferSource();
		source.buffer = clipBuffer;
		const gain = offline.createGain();
		gain.gain.value = clip.volume ?? 1;
		source.connect(gain);
		gain.connect(offline.destination);
		source.start(startSec, 0, playDurationSec);
	}

	const rendered = await offline.startRendering();
	return audioBufferToWebmBlob(rendered);
}
