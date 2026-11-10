// @vitest-environment jsdom
// The range-edit laws over the core's answers (G4.311), on documents drawn from a seed: 120 in the
// commit gate, the full 600 with `RANGE_EDIT_FULL=1`. Live mode's in-block writes read text the way
// a page shows it, hence jsdom. HTML blocks have a draw of their own (`html-laws.test.ts`).

import { describe, expect, it } from 'vitest';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { leavesLiteralBlock, readOf } from './expected';
import { lawInputs } from './inputs';
import { describeLaws } from './law-suite';
import { rangeOf, unmark } from './named-rows';
import { checkHost } from './test-host';

const DOCUMENTS = process.env.RANGE_EDIT_FULL === '1' ? 600 : 120;
const SEED = freshOrFixedSeed(20261105);

describeLaws('the range-edit laws', DOCUMENTS, (grammar) => lawInputs(DOCUMENTS, SEED, grammar));

// Miss-analysis: the exception read a nested block's bytes with its container's markers on, and no
// row held a fenced block whole from its first byte, which plain text carries back.
describe('law 3 skips a range from a code block’s text out past its closing line', () => {
	it.each([
		{ name: 'through its closing line', source: '```\nco⟦de\n```⟧\n\nafter\n', mode: 'source' },
		{ name: 'inside a quote', source: '> ```\n> co⟦de\n> ```⟧\n\nafter\n', mode: 'source' },
		{ name: 'live, from its hidden opening fence', source: '⟦```\ncode\n```⟧\n', mode: 'live' },
		{ name: 'not a block held whole', source: '- ⟦```\n  x\n  ```⟧', mode: 'source', held: true }
	] as const)('$name', ({ source: marked, mode, ...row }) => {
		const host = checkHost();
		const { from, to } = rangeOf(marked);
		const skips = leavesLiteralBlock(readOf(host, unmark(marked)), from, to, host, mode);
		expect(skips).toBe(!('held' in row));
	});
});
