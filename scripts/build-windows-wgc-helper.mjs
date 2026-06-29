import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "electron", "native", "wgc-capture");
const BUILD_DIR = path.join(SOURCE_DIR, "build");
const COMPAT_LIB_DIR = path.join(BUILD_DIR, "compat-libs");
const BIN_DIR = path.join(ROOT, "electron", "native", "bin", "win32-x64");

function resolveVcVarsAll(candidate) {
	if (!candidate) return null;
	if (fs.existsSync(candidate) && candidate.toLowerCase().endsWith(".bat")) {
		return candidate;
	}
	const asFile = path.join(candidate, "vcvarsall.bat");
	if (fs.existsSync(asFile)) {
		return asFile;
	}
	return null;
}

function findVcVarsAll() {
	for (const candidate of [process.env.VCVARSALL, process.env.VSINSTALLDIR]) {
		const resolved = resolveVcVarsAll(candidate);
		if (resolved) {
			return resolved;
		}
	}

	const roots = [
		"D:\\software_install\\VisualStudio",
		"C:\\Program Files\\Microsoft Visual Studio\\2022\\Community",
		"C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional",
		"C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise",
		"C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools",
		"C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\Community",
		"C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools",
		"C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community",
		"C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Professional",
		"C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Enterprise",
	];

	for (const root of roots) {
		const resolved = resolveVcVarsAll(path.join(root, "VC", "Auxiliary", "Build"));
		if (resolved) {
			return resolved;
		}
	}

	return null;
}

function findCmakeExe(vcvarsAll) {
	if (process.env.CMAKE_EXE) {
		return process.env.CMAKE_EXE;
	}

	const vsRoot = path.resolve(path.dirname(vcvarsAll), "..", "..", "..");
	const bundled = path.join(
		vsRoot,
		"Common7",
		"IDE",
		"CommonExtensions",
		"Microsoft",
		"CMake",
		"CMake",
		"bin",
		"cmake.exe",
	);
	if (fs.existsSync(bundled)) {
		return bundled;
	}

	return "cmake";
}

function findWindowsSdkUmLibDir() {
	const sdkLibRoot = "C:\\Program Files (x86)\\Windows Kits\\10\\Lib";
	if (!fs.existsSync(sdkLibRoot)) {
		return null;
	}

	return fs
		.readdirSync(sdkLibRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(sdkLibRoot, entry.name, "um", "x64"))
		.filter((candidate) => fs.existsSync(path.join(candidate, "kernel32.lib")))
		.sort()
		.at(-1);
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: ROOT,
			stdio: "inherit",
			windowsHide: true,
			...options,
		});
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
			}
		});
	});
}

async function runInVsEnv(command) {
	const vcvarsAll = findVcVarsAll();
	if (!vcvarsAll) {
		throw new Error(
			"Could not find Visual Studio vcvarsall.bat. Install Visual Studio Build Tools with C++.",
		);
	}

	const sdkUmLibDir = findWindowsSdkUmLibDir();

	const cmdPath = path.join(os.tmpdir(), `openscreen-build-wgc-${process.pid}-${Date.now()}.cmd`);
	fs.writeFileSync(
		cmdPath,
		[
			"@echo off",
			`call "${vcvarsAll}" x64`,
			"if errorlevel 1 exit /b %errorlevel%",
			`if not exist "${COMPAT_LIB_DIR}" mkdir "${COMPAT_LIB_DIR}"`,
			`for %%L in (gdi32.lib gdiplus.lib winspool.lib shell32.lib oleaut32.lib uuid.lib comdlg32.lib advapi32.lib) do if not exist "%WindowsSdkDir%Lib\\%WindowsSDKLibVersion%um\\x64\\%%L" copy /Y "%WindowsSdkDir%Lib\\%WindowsSDKLibVersion%um\\x64\\kernel32.Lib" "${COMPAT_LIB_DIR}\\%%L" >nul`,
			"if errorlevel 1 exit /b %errorlevel%",
			`set "LIB=${sdkUmLibDir ? `${sdkUmLibDir};` : ""}%LIB%;${COMPAT_LIB_DIR}"`,
			command,
			"exit /b %errorlevel%",
			"",
		].join("\r\n"),
	);
	try {
		await run("cmd.exe", ["/d", "/c", cmdPath]);
	} finally {
		fs.rmSync(cmdPath, { force: true });
	}
}

if (process.platform !== "win32") {
	console.log("Skipping WGC helper build: Windows-only.");
	process.exit(0);
}

const vcvarsAll = findVcVarsAll();
if (!vcvarsAll) {
	throw new Error(
		"Could not find Visual Studio vcvarsall.bat. Install Visual Studio Build Tools with C++.",
	);
}

const cmakeExe = findCmakeExe(vcvarsAll);
console.log(`Using vcvarsall: ${vcvarsAll}`);
console.log(`Using cmake: ${cmakeExe}`);

fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });

await runInVsEnv(
	`"${cmakeExe}" -S "${SOURCE_DIR}" -B "${BUILD_DIR}" -G Ninja -DCMAKE_BUILD_TYPE=Release`,
);
await runInVsEnv(`"${cmakeExe}" --build "${BUILD_DIR}" --config Release`);

const outputPath = path.join(BUILD_DIR, "wgc-capture.exe");
if (!fs.existsSync(outputPath)) {
	throw new Error(`WGC helper build completed but ${outputPath} was not found.`);
}

const cursorSamplerOutputPath = path.join(BUILD_DIR, "cursor-sampler.exe");
if (!fs.existsSync(cursorSamplerOutputPath)) {
	throw new Error(`WGC helper build completed but ${cursorSamplerOutputPath} was not found.`);
}

fs.mkdirSync(BIN_DIR, { recursive: true });
const distributablePath = path.join(BIN_DIR, "wgc-capture.exe");
fs.copyFileSync(outputPath, distributablePath);

const cursorSamplerDistributablePath = path.join(BIN_DIR, "cursor-sampler.exe");
fs.copyFileSync(cursorSamplerOutputPath, cursorSamplerDistributablePath);

console.log(`Built ${outputPath}`);
console.log(`Copied ${distributablePath}`);
console.log(`Built ${cursorSamplerOutputPath}`);
console.log(`Copied ${cursorSamplerDistributablePath}`);
