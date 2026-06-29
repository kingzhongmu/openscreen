// Populates `caption-assets/` so the packaged app can transcribe offline (under file://)
// instead of fetching the Whisper model from HuggingFace and the onnxruntime wasm from a CDN.
//
//   caption-assets/
//     models/Xenova/whisper-tiny/...   ← HuggingFace or ModelScope (see CAPTION_MODEL_MIRROR)
//     ort/ort-wasm*.wasm               ← copied from @xenova/transformers/dist
//
// Idempotent: existing non-empty files are left alone, so re-runs and CI cache hits are no-ops.
// `caption-assets/` is gitignored and shipped via electron-builder `extraResources`.

import { createWriteStream } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "caption-assets");
const MODEL_ID = "Xenova/whisper-tiny";
const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const MS_BASE = `https://modelscope.cn/api/v1/models/${MODEL_ID}/repo?Revision=master&FilePath=`;

/** @typedef {"huggingface" | "modelscope"} CaptionModelMirror */

/**
 * Which host to pull Whisper assets from.
 * - huggingface: HuggingFace Hub only
 * - modelscope: ModelScope (魔搭) only — https://www.modelscope.cn/models/Xenova/whisper-tiny
 * - auto (default): try ModelScope first, then HuggingFace
 */
const CAPTION_MODEL_MIRROR = (process.env.CAPTION_MODEL_MIRROR ?? "auto").toLowerCase();

// Small config/tokenizer/preprocessor files plus the quantized ONNX the ASR pipeline loads by
// default (encoder + merged decoder). Grab every metadata file so transformers never requests
// one we forgot to bundle.
const MODEL_FILES = [
	"config.json",
	"generation_config.json",
	"preprocessor_config.json",
	"tokenizer.json",
	"tokenizer_config.json",
	"added_tokens.json",
	"special_tokens_map.json",
	"normalizer.json",
	"merges.txt",
	"vocab.json",
	"quantize_config.json",
	"onnx/encoder_model_quantized.onnx",
	"onnx/decoder_model_merged_quantized.onnx",
];

async function exists(filePath) {
	try {
		const s = await stat(filePath);
		return s.isFile() && s.size > 0;
	} catch {
		return false;
	}
}

const MAX_ATTEMPTS = 6;
// HuggingFace rate-limits (429) when the parallel CI matrix builds all hit it at once; also retry the
// usual transient server errors.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt, retryAfter) {
	// Honor Retry-After when the server sends it (seconds or an HTTP date).
	if (retryAfter) {
		const secs = Number(retryAfter);
		if (Number.isFinite(secs)) return Math.min(60_000, secs * 1000);
		const at = Date.parse(retryAfter);
		if (!Number.isNaN(at)) return Math.min(60_000, Math.max(0, at - Date.now()));
	}
	// Exponential backoff with jitter: ~2s, 4s, 8s, 16s, 32s, capped at 60s.
	return Math.min(60_000, 2000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 1000);
}

async function fetchWithRetry(url) {
	let lastErr;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const res = await fetch(url, { headers: { "user-agent": "openscreen-build" } });
			if (res.ok && res.body) return res;
			if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
				const wait = backoffMs(attempt, res.headers.get("retry-after"));
				console.log(
					`  … HTTP ${res.status}, retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(wait / 1000)}s`,
				);
				await sleep(wait);
				continue;
			}
			throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`);
		} catch (err) {
			lastErr = err;
			const isHttp = err instanceof Error && err.message.startsWith("Failed to download");
			if (isHttp || attempt >= MAX_ATTEMPTS) throw err;
			// Network/DNS error: back off and retry.
			const wait = backoffMs(attempt, null);
			console.log(
				`  … ${err.message}, retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(wait / 1000)}s`,
			);
			await sleep(wait);
		}
	}
	throw lastErr;
}

/** @returns {CaptionModelMirror[]} */
function mirrorOrder() {
	if (CAPTION_MODEL_MIRROR === "modelscope") return ["modelscope"];
	if (CAPTION_MODEL_MIRROR === "huggingface") return ["huggingface"];
	if (CAPTION_MODEL_MIRROR === "auto") return ["modelscope", "huggingface"];
	throw new Error(
		`Invalid CAPTION_MODEL_MIRROR="${process.env.CAPTION_MODEL_MIRROR}". Use modelscope, huggingface, or auto.`,
	);
}

/** @param {CaptionModelMirror} mirror @param {string} rel */
function modelFileUrl(mirror, rel) {
	if (mirror === "modelscope") {
		return `${MS_BASE}${encodeURIComponent(rel)}`;
	}
	return `${HF_BASE}/${rel}`;
}

async function copyOrtWasm() {
	const distDir = path.join(ROOT, "node_modules", "@xenova", "transformers", "dist");
	// Non-threaded variants only: the worker runs ORT with numThreads=1 (no SharedArrayBuffer
	// under file://), so the threaded wasm is never loaded. Saves ~20MB.
	const wasm = ["ort-wasm.wasm", "ort-wasm-simd.wasm"];
	const ortOut = path.join(OUT, "ort");
	await mkdir(ortOut, { recursive: true });
	for (const name of wasm) {
		const src = path.join(distDir, name);
		const dest = path.join(ortOut, name);
		if (!(await exists(src))) {
			throw new Error(`Missing ${src} — is @xenova/transformers installed? Run npm ci first.`);
		}
		if (await exists(dest)) {
			console.log(`  ✓ cached  ort/${name}`);
			continue;
		}
		await copyFile(src, dest);
		console.log(`  + copied ort/${name}`);
	}
}

async function downloadModelFile(rel, dest) {
	if (await exists(dest)) {
		console.log(`  ✓ cached  ${path.relative(OUT, dest)}`);
		return;
	}

	const mirrors = mirrorOrder();
	let lastErr;
	for (const mirror of mirrors) {
		const url = modelFileUrl(mirror, rel);
		try {
			await mkdir(path.dirname(dest), { recursive: true });
			const res = await fetchWithRetry(url);
			const tmp = `${dest}.partial`;
			await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
			const { rename } = await import("node:fs/promises");
			await rename(tmp, dest);
			const mb = ((await stat(dest)).size / 1_000_000).toFixed(1);
			const label = mirror === "modelscope" ? "ModelScope" : "HuggingFace";
			console.log(`  ↓ ${path.relative(OUT, dest)} (${mb} MB, ${label})`);
			return;
		} catch (err) {
			lastErr = err;
			console.log(`  … ${mirror} failed for ${rel}: ${err instanceof Error ? err.message : err}`);
		}
	}
	throw lastErr ?? new Error(`Failed to download ${rel}`);
}

async function main() {
	const mirrors = mirrorOrder();
	const mirrorLabel =
		mirrors.length === 1
			? mirrors[0] === "modelscope"
				? "ModelScope"
				: "HuggingFace"
			: "ModelScope → HuggingFace";
	console.log(`Fetching caption assets → ${path.relative(ROOT, OUT)}/ (${mirrorLabel})`);
	console.log("ONNX Runtime wasm:");
	await copyOrtWasm();
	console.log(`Whisper model (${MODEL_ID}):`);
	const modelDir = path.join(OUT, "models", ...MODEL_ID.split("/"));
	for (const rel of MODEL_FILES) {
		await downloadModelFile(rel, path.join(modelDir, rel));
	}
	console.log("Caption assets ready.");
}

main().catch((err) => {
	console.error(`\nfetch-caption-model failed: ${err.message}`);
	process.exit(1);
});
