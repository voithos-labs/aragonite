/**
 * A `Scrollport` (the scroll container) over plain numbers. Windowing reads only these five
 * values, and jsdom reports zero geometry for all of them, so a mounted list needs this stub to
 * observe anything at all.
 */
import { withRelativeScroll, type Scrollport } from '../../cursor/scrollport';

export interface StubScrollportOpts {
	viewportHeight: number;
	/** The space above the scroll container's own box. Nonzero wherever the editor is not itself
	 *  the scroller: a page-scrolled shell puts its own header in front of the editor. */
	viewportTop?: number;
	contentWidth?: number;
	/** The browser's own clamp, which a plain property cannot model: a scroll past the
	 *  content end is refused, so an anchor can never hold a target beyond it. */
	maxScrollTop?: number;
	/** Round each write to a whole pixel and report the rounded value back, as a real scroller
	 *  does at device-pixel ratio 1: the other half of what a plain property cannot model. */
	snapsToPixel?: boolean;
}

export function stubScrollport(opts: StubScrollportOpts): Scrollport {
	const {
		viewportHeight,
		viewportTop = 0,
		contentWidth = 800,
		maxScrollTop = Infinity,
		snapsToPixel = false
	} = opts;
	let scrollTop = 0;
	return withRelativeScroll({
		viewportTop: () => viewportTop,
		viewportHeight: () => viewportHeight,
		contentWidth: () => contentWidth,
		scrollTop: () => scrollTop,
		setScrollTop: (value) => {
			const clamped = Math.max(0, Math.min(value, maxScrollTop));
			scrollTop = snapsToPixel ? Math.round(clamped) : clamped;
		},
		subscribe: () => () => {}
	});
}

/** This list's element as windowing reads it: a rect top that moves with the scroll, since the
 *  list travels with the content, offset by whatever sits above it. */
export function stubListEl(port: Scrollport, height: number, chromeAbove = 0): HTMLElement {
	return {
		clientWidth: 800,
		getBoundingClientRect: () => ({
			top: port.viewportTop() + chromeAbove - port.scrollTop(),
			height
		})
	} as unknown as HTMLElement;
}
