/**
 * A `Scrollport` over plain numbers. Windowing reads only these five values, and jsdom reports
 * zero geometry for every one of them, so a mounted scope needs the port stubbed to observe
 * anything at all.
 */
import type { Scrollport } from '../../cursor/scrollport';

export interface StubScrollportOpts {
	viewportHeight: number;
	/** Chrome above the port's own box. Nonzero wherever the editor is not itself the
	 *  scroller: a page-scrolled shell puts its own header in front of the editor. */
	viewportTop?: number;
	contentWidth?: number;
	/** The browser's own clamp, which a plain property cannot model: a scroll past the
	 *  content end is refused, so an anchor can never hold a target beyond it. */
	maxScrollTop?: number;
}

export function stubScrollport(opts: StubScrollportOpts): Scrollport {
	const { viewportHeight, viewportTop = 0, contentWidth = 800, maxScrollTop = Infinity } = opts;
	let scrollTop = 0;
	return {
		viewportTop: () => viewportTop,
		viewportHeight: () => viewportHeight,
		contentWidth: () => contentWidth,
		scrollTop: () => scrollTop,
		setScrollTop: (value) => {
			scrollTop = Math.max(0, Math.min(value, maxScrollTop));
		},
		subscribe: () => () => {}
	};
}

/** This scope's list element as windowing reads it: a rect top that moves with the scroll,
 *  since the list travels WITH the content, offset by whatever sits above it. */
export function stubListEl(port: Scrollport, height: number, chromeAbove = 0): HTMLElement {
	return {
		clientWidth: 800,
		getBoundingClientRect: () => ({
			top: port.viewportTop() + chromeAbove - port.scrollTop(),
			height
		})
	} as unknown as HTMLElement;
}
