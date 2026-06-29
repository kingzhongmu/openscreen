#pragma once

#include <Windows.h>
#include <d3d11.h>

struct WindowCapturePadding {
	int top = 0;
	int right = 0;
	int bottom = 0;
	int left = 0;
};

struct MonitorCropState {
	bool enabled = false;
	HMONITOR monitor = nullptr;
	RECT monitorRect{};
	RECT captureRect{};
	HWND window = nullptr;
	WindowCapturePadding padding{};
	int outputWidth = 0;
	int outputHeight = 0;
};

void ensurePerMonitorDpiAwareness();

HMONITOR findMonitorForWindow(HWND window);

bool getExtendedFrameBounds(HWND window, RECT& bounds);

bool computeWindowCaptureRect(HWND window, const WindowCapturePadding& padding, RECT& bounds);

bool initializeWindowMonitorCrop(HWND window, const WindowCapturePadding& padding, MonitorCropState& state);

bool initializeDisplayMonitorCrop(HMONITOR monitor, bool excludeTaskbar, MonitorCropState& state);

bool computeMonitorCropBox(
	const MonitorCropState& state,
	const D3D11_TEXTURE2D_DESC& monitorTextureDesc,
	D3D11_BOX& srcBox);
