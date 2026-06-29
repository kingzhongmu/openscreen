#include "window_utils.h"

#include <dwmapi.h>

#include <algorithm>

bool getExtendedFrameBounds(HWND window, RECT& bounds) {
	if (!window || !IsWindow(window)) {
		return false;
	}

	RECT empty{};
	SetRectEmpty(&empty);
	bounds = empty;
	if (SUCCEEDED(DwmGetWindowAttribute(
			window,
			DWMWA_EXTENDED_FRAME_BOUNDS,
			&bounds,
			sizeof(bounds)))) {
		return bounds.right > bounds.left && bounds.bottom > bounds.top;
	}

	if (!GetWindowRect(window, &bounds)) {
		return false;
	}
	return bounds.right > bounds.left && bounds.bottom > bounds.top;
}

namespace {

RECT emptyRect() {
	RECT rect{};
	SetRectEmpty(&rect);
	return rect;
}

RECT unionRect(const RECT& a, const RECT& b) {
	if (IsRectEmpty(&a)) {
		return b;
	}
	if (IsRectEmpty(&b)) {
		return a;
	}

	RECT result{};
	result.left = std::min(a.left, b.left);
	result.top = std::min(a.top, b.top);
	result.right = std::max(a.right, b.right);
	result.bottom = std::max(a.bottom, b.bottom);
	return result;
}

void clampRectToMonitor(RECT& rect, const RECT& monitorRect) {
	rect.left = std::max(rect.left, monitorRect.left);
	rect.top = std::max(rect.top, monitorRect.top);
	rect.right = std::min(rect.right, monitorRect.right);
	rect.bottom = std::min(rect.bottom, monitorRect.bottom);
}

bool isSameWindow(HWND left, HWND right) {
	return left != nullptr && right != nullptr && left == right;
}

bool isOwnedPopupWindow(HWND candidate, HWND target) {
	if (!IsWindow(candidate) || !IsWindow(target) || isSameWindow(candidate, target)) {
		return false;
	}
	if (!IsWindowVisible(candidate)) {
		return false;
	}

	for (HWND owner = GetWindow(candidate, GW_OWNER); owner != nullptr;
		 owner = GetWindow(owner, GW_OWNER)) {
		if (owner == target) {
			return true;
		}
	}

	return false;
}

struct OwnedWindowEnumContext {
	HWND target = nullptr;
	RECT unionRect = emptyRect();
};

BOOL CALLBACK enumOwnedPopupWindows(HWND hwnd, LPARAM userData) {
	auto* context = reinterpret_cast<OwnedWindowEnumContext*>(userData);
	if (!isOwnedPopupWindow(hwnd, context->target)) {
		return TRUE;
	}

	RECT bounds{};
	if (!getExtendedFrameBounds(hwnd, bounds)) {
		return TRUE;
	}

	context->unionRect = unionRect(context->unionRect, bounds);
	return TRUE;
}

int evenDimension(int value) {
	return (std::max(2, value) / 2) * 2;
}

void applyPadding(RECT& rect, const WindowCapturePadding& padding, const RECT& monitorRect) {
	if (padding.top <= 0 && padding.right <= 0 && padding.bottom <= 0 && padding.left <= 0) {
		return;
	}

	rect.left -= padding.left;
	rect.top -= padding.top;
	rect.right += padding.right;
	rect.bottom += padding.bottom;
	clampRectToMonitor(rect, monitorRect);
}

} // namespace

void ensurePerMonitorDpiAwareness() {
	if (IsValidDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) {
		SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
		return;
	}
	if (IsValidDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE)) {
		SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE);
	}
}

HMONITOR findMonitorForWindow(HWND window) {
	if (!window || !IsWindow(window)) {
		return nullptr;
	}
	return MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
}

bool computeWindowCaptureRect(HWND window, const WindowCapturePadding& padding, RECT& bounds) {
	if (!window || !IsWindow(window) || IsIconic(window)) {
		return false;
	}

	if (!getExtendedFrameBounds(window, bounds)) {
		return false;
	}

	OwnedWindowEnumContext context{};
	context.target = window;
	context.unionRect = bounds;
	EnumWindows(enumOwnedPopupWindows, reinterpret_cast<LPARAM>(&context));
	bounds = context.unionRect;

	const HMONITOR monitor = findMonitorForWindow(window);
	if (!monitor) {
		return false;
	}

	MONITORINFO monitorInfo{};
	monitorInfo.cbSize = sizeof(monitorInfo);
	if (!GetMonitorInfo(monitor, &monitorInfo)) {
		return false;
	}

	applyPadding(bounds, padding, monitorInfo.rcMonitor);
	return bounds.right > bounds.left && bounds.bottom > bounds.top;
}

bool initializeWindowMonitorCrop(HWND window, const WindowCapturePadding& padding, MonitorCropState& state) {
	state = {};
	if (!window || !IsWindow(window)) {
		return false;
	}

	ensurePerMonitorDpiAwareness();

	RECT captureRect{};
	if (!computeWindowCaptureRect(window, padding, captureRect)) {
		return false;
	}

	const HMONITOR monitor = findMonitorForWindow(window);
	if (!monitor) {
		return false;
	}

	MONITORINFO monitorInfo{};
	monitorInfo.cbSize = sizeof(monitorInfo);
	if (!GetMonitorInfo(monitor, &monitorInfo)) {
		return false;
	}

	state.enabled = true;
	state.window = window;
	state.monitor = monitor;
	state.monitorRect = monitorInfo.rcMonitor;
	state.captureRect = captureRect;
	state.padding = padding;
	state.outputWidth = evenDimension(captureRect.right - captureRect.left);
	state.outputHeight = evenDimension(captureRect.bottom - captureRect.top);
	return state.outputWidth > 0 && state.outputHeight > 0;
}

bool initializeDisplayMonitorCrop(HMONITOR monitor, bool excludeTaskbar, MonitorCropState& state) {
	state = {};
	if (!monitor || !excludeTaskbar) {
		return false;
	}

	ensurePerMonitorDpiAwareness();

	MONITORINFO monitorInfo{};
	monitorInfo.cbSize = sizeof(monitorInfo);
	if (!GetMonitorInfo(monitor, &monitorInfo)) {
		return false;
	}

	const RECT captureRect = monitorInfo.rcWork;
	if (captureRect.right <= captureRect.left || captureRect.bottom <= captureRect.top) {
		return false;
	}

	state.enabled = true;
	state.monitor = monitor;
	state.monitorRect = monitorInfo.rcMonitor;
	state.captureRect = captureRect;
	state.outputWidth = evenDimension(captureRect.right - captureRect.left);
	state.outputHeight = evenDimension(captureRect.bottom - captureRect.top);
	return state.outputWidth > 0 && state.outputHeight > 0;
}

bool computeMonitorCropBox(
	const MonitorCropState& state,
	const D3D11_TEXTURE2D_DESC& monitorTextureDesc,
	D3D11_BOX& srcBox) {
	if (!state.enabled || state.outputWidth <= 0 || state.outputHeight <= 0) {
		return false;
	}

	RECT captureRect = state.captureRect;
	if (state.window) {
		if (!computeWindowCaptureRect(state.window, state.padding, captureRect)) {
			return false;
		}
	}

	const LONG srcLeft = captureRect.left - state.monitorRect.left;
	const LONG srcTop = captureRect.top - state.monitorRect.top;
	const LONG maxLeft = std::max<LONG>(
		0,
		static_cast<LONG>(monitorTextureDesc.Width) - state.outputWidth);
	const LONG maxTop = std::max<LONG>(
		0,
		static_cast<LONG>(monitorTextureDesc.Height) - state.outputHeight);

	srcBox.left = std::clamp(srcLeft, 0L, maxLeft);
	srcBox.top = std::clamp(srcTop, 0L, maxTop);
	srcBox.right = srcBox.left + state.outputWidth;
	srcBox.bottom = srcBox.top + state.outputHeight;
	srcBox.front = 0;
	srcBox.back = 1;
	return true;
}
