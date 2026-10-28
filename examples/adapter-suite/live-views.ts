// How many framework-drawn plugin views are mounted right now, kept on the page's root element so a
// spec can see a view's teardown ran. A view calls `viewMounted` once mounted, and what it returns
// once unmounted.
export const LIVE_VIEWS_ATTR = 'data-live-views';

export function viewMounted(): () => void {
	bump(1);
	return () => bump(-1);
}

function bump(by: number): void {
	const root = document.documentElement;
	root.setAttribute(LIVE_VIEWS_ATTR, String(Number(root.getAttribute(LIVE_VIEWS_ATTR) ?? 0) + by));
}
