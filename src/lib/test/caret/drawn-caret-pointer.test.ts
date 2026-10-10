// @vitest-environment jsdom
// Whether an editor draws its caret: the `caret` prop decides, and `auto` follows the primary
// pointer (drawing on a fine one, leaving a coarse one or a page with no media queries native).
// Forced colors are the target's call (`drawn-caret-target.test.ts`).
import { afterEach, describe, expect, it } from 'vitest';
import { caretMedia, drawsCaret } from '#lib/caret/drawn-caret.svelte.js';

type MatchMedia = (query: string) => MediaQueryList;

function installMedia(matching: string[]): void {
	const matchMedia: MatchMedia = (query) =>
		({
			matches: matching.includes(query),
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {}
		}) as unknown as MediaQueryList;
	(window as unknown as { matchMedia?: MatchMedia }).matchMedia = matchMedia;
}

afterEach(() => {
	delete (window as unknown as { matchMedia?: MatchMedia }).matchMedia;
});

const MEDIA = [
	['a fine pointer', () => installMedia(['(pointer: fine)'])],
	['a coarse pointer', () => installMedia([])],
	['no media queries at all', () => {}]
] as const;

describe.each(MEDIA)('on %s', (pointer, install) => {
	const fine = pointer === 'a fine pointer';

	it(`auto ${fine ? 'draws' : 'leaves the native caret'}`, () => {
		install();
		expect(drawsCaret('auto', caretMedia())).toBe(fine);
	});

	it('native never draws', () => {
		install();
		expect(drawsCaret('native', caretMedia())).toBe(false);
	});

	it('drawn always draws', () => {
		install();
		expect(drawsCaret('drawn', caretMedia())).toBe(true);
	});
});
