// @vitest-environment jsdom
// Whether an editor draws its caret: the `caret` prop decides, and `auto` follows the primary
// pointer, drawing on a fine one and leaving a coarse one, or a page with no media queries, native.
import { afterEach, describe, expect, it } from 'vitest';
import { drawsCaret, finePointerQuery } from '#lib/caret/drawn-caret.svelte.js';

type MatchMedia = (query: string) => MediaQueryList;

function installPointer(fine: boolean): void {
	const matchMedia: MatchMedia = (query) =>
		({
			matches: query === '(pointer: fine)' ? fine : false,
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {}
		}) as unknown as MediaQueryList;
	(window as unknown as { matchMedia?: MatchMedia }).matchMedia = matchMedia;
}

afterEach(() => {
	delete (window as unknown as { matchMedia?: MatchMedia }).matchMedia;
});

const POINTERS = [
	['a fine pointer', () => installPointer(true)],
	['a coarse pointer', () => installPointer(false)],
	['no media queries at all', () => {}]
] as const;

describe.each(POINTERS)('on %s', (pointer, install) => {
	const fine = pointer === 'a fine pointer';

	it(`auto ${fine ? 'draws' : 'leaves the native caret'}`, () => {
		install();
		expect(drawsCaret('auto', finePointerQuery())).toBe(fine);
	});

	it('native never draws', () => {
		install();
		expect(drawsCaret('native', finePointerQuery())).toBe(false);
	});

	it('drawn always draws', () => {
		install();
		expect(drawsCaret('drawn', finePointerQuery())).toBe(true);
	});
});
