#pragma once

#include <Windows.h>
#include <d3d11.h>

struct WindowCaptureState {
	HWND window = nullptr;
	HMONITOR monitor = nullptr;
	RECT monitorRect{};
	int outputWidth = 0;
	int outputHeight = 0;
};

void ensurePerMonitorDpiAwareness();

HMONITOR findMonitorForWindow(HWND window);

bool getExtendedFrameBounds(HWND window, RECT& bounds);

bool computeWindowCaptureRect(HWND window, RECT& bounds);

bool initializeWindowCaptureState(HWND window, WindowCaptureState& state);

bool computeMonitorRelativeCropBox(
	const WindowCaptureState& state,
	const D3D11_TEXTURE2D_DESC& monitorTextureDesc,
	D3D11_BOX& srcBox);
