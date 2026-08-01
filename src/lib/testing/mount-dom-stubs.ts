/**
 * The browser APIs a mounted editor calls that jsdom does not implement. Each is installed
 * only when absent, so the call is inert in a real browser and cannot clobber a runner that
 * already supplies one. Runner-agnostic: no test-runner import, plain globals.
 */

interface StubbableGlobals {
	ResizeObserver?: unknown;
}

class NoopResizeObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

/**
 * Install the jsdom gaps a mounted editor hits — the block-height `ResizeObserver` and the
 * reveal's `scrollIntoView`. Call it once before the first mount; pair it with
 * `scrollMode="host"` so windowing keeps every block mounted under a zero-height viewport.
 */
export function installEditorDomStubsForTests(): void {
	const globals = globalThis as StubbableGlobals;
	globals.ResizeObserver ??= NoopResizeObserver;
	if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
		Element.prototype.scrollIntoView = () => {};
	}
}
