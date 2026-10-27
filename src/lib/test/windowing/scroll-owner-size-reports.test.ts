// @vitest-environment jsdom
// Miss-analysis (#798): no test let a block grow before the browser's size report and then
// scrolled, so no row caught a scroll read off the page while the height tables lagged it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stubScrollOwner, stubScrollport } from '../harness/stub-scrollport';

const TARGET = [3];
const GROWN = 420;

beforeEach(() => {
	// A size observer that never reports: the growth is laid out, and its report never comes.
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
	vi.stubGlobal('requestAnimationFrame', () => 0);
	vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

/** An owner over one watched block above the target, whose height has grown to `GROWN` with no
 *  report yet. `events` records what its watcher heard and each owner write, in order. */
function setUp() {
	const events: string[] = [];
	const port = stubScrollport({ viewportHeight: 100 });
	const { setScrollTop, scrollBy } = port;
	port.setScrollTop = (value) => {
		events.push('write');
		setScrollTop(value);
	};
	port.scrollBy = (delta) => {
		events.push('write');
		scrollBy(delta);
	};
	const target = document.createElement('div');
	target.getBoundingClientRect = () => ({ top: 500, bottom: 520, height: 20 }) as DOMRect;
	target.scrollIntoView = () => events.push('write');
	const grown = document.body.appendChild(document.createElement('div'));
	grown.getBoundingClientRect = () => ({ width: 600, height: GROWN }) as DOMRect;
	const owner = stubScrollOwner(port, { getBlockBoxByPath: () => target });
	owner.resolveTargetsWith({
		resolve: () => ({ top: 1000, height: 20 }),
		holdForRound: () => null,
		mountTop: () => 2000,
		pathAt: () => null,
		syncScrollTop: () => {}
	});
	owner.watchSize(grown, (height) => events.push(`heard ${height}`));
	return { owner, events, userScroll: setScrollTop };
}

// Every owner write that can read the page goes through one entry, so each route runs here.
const ROUTES: { name: string; run(h: ReturnType<typeof setUp>): Promise<unknown> }[] = [
	{
		name: 'a placement',
		run: ({ owner }) => owner.place(TARGET, { block: 'nearest', hold: true }).scroll()
	},
	{
		name: 'showing a rect',
		run: async ({ owner }) => owner.showRect(() => new DOMRect(0, 300, 10, 20))
	},
	{ name: 'scrolling to mount', run: async ({ owner }) => owner.scrollToMount(TARGET) },
	{
		name: 'putting a kept position back',
		async run({ owner, userScroll }) {
			const restore = owner.keep();
			userScroll(50);
			await restore();
		}
	}
];

describe('scroll owner: a write takes the size reports the browser has not sent yet', () => {
	for (const route of ROUTES) {
		it(`${route.name} hands the grown height over once, before it writes`, async () => {
			const h = setUp();
			await route.run(h);
			expect(h.events, 'the route wrote a scroll').toContain('write');
			expect(h.events.filter((e) => e === `heard ${GROWN}`)).toHaveLength(1);
			expect(h.events.indexOf(`heard ${GROWN}`)).toBeLessThan(h.events.indexOf('write'));
		});
	}
});
