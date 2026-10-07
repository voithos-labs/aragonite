// @vitest-environment jsdom
// Where a per-block span meets bytes the single-block toggle cannot mark soundly: an edge landing
// on whitespace, and a write whose delimiters form no construct. The span split and the direction
// rule are `./format-range.test.ts`.
// Miss-analysis: every partial span there started and ended on a word boundary, never a space.
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { beforeEach, describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import {
	applyCrossBlockFormat,
	planCrossBlockFormat
} from '#lib/selection/cross-block/format-range.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { registerChromePluginsForTests } from '../chrome-plugins';
import { makeKeydownEnv, press } from './keydown-env';
import { documentBody } from '#lib/tree-operations/node-primitives.js';

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });

/** Plan and write in one go, so the assertions read as the document the user would see. */
function toggle(
	source: string,
	start: SelectionPoint,
	end: SelectionPoint,
	mode?: 'source' | 'live'
): string | null {
	const doc = parse(source);
	const plan = planCrossBlockFormat(
		doc,
		coverRange(doc, start, end),
		'strong',
		fixtureReading({}, mode)
	);
	if (!plan) return null;
	applyCrossBlockFormat(documentBody(doc), plan, createSharingState(), defaultGrammarView);
	return serialize(doc);
}

describe('a span whose edge lands on whitespace', () => {
	const HEAD = { source: 'alpha\n\nbeta gamma\n', start: at([0], 0), end: at([1], 5) };
	const TAIL = { source: 'alpha beta\n\ngamma\n', start: at([0], 5), end: at([1], 5) };

	// Markdown opens and closes a run against a word, never a space, so an untrimmed edge yields
	// delimiters that form no construct — which a marker-painting mode would write anyway.
	for (const mode of [undefined, 'live'] as const) {
		const label = mode ?? 'source';

		it(`marks the word, not the space, on a head span: ${label}`, () => {
			expect(toggle(HEAD.source, HEAD.start, HEAD.end, mode)).toBe('**alpha**\n\n**beta** gamma\n');
		});

		it(`marks the word, not the space, on a tail span: ${label}`, () => {
			expect(toggle(TAIL.source, TAIL.start, TAIL.end, mode)).toBe('alpha **beta**\n\n**gamma**\n');
		});
	}

	// The trim moves the restored range too: its endpoints come off the toggle's own selection, so
	// they land inside the marked run rather than around the space the span gave up.
	it('restores the range inside the marked run, not around the trimmed space', () => {
		const head = planCrossBlockFormat(
			parse(HEAD.source),
			coverRange(parse(HEAD.source), HEAD.start, HEAD.end),
			'strong',
			fixtureReading()
		)!;
		expect(head.endOffset).toBe('**beta**'.length);

		const tail = planCrossBlockFormat(
			parse(TAIL.source),
			coverRange(parse(TAIL.source), TAIL.start, TAIL.end),
			'strong',
			fixtureReading()
		)!;
		expect(tail.startOffset).toBe('alpha '.length);
	});

	// A second keystroke that does nothing is the visible symptom: bytes that form no construct
	// read as unmarked, so the range never toggles back.
	it('leaves bytes a second press unwraps, rather than a dead key', () => {
		const once = toggle(HEAD.source, HEAD.start, HEAD.end)!;
		expect(toggle(once, at([0], 0), at([1], '**beta**'.length))).toBe('alpha\n\nbeta gamma\n');
	});
});

// Where the mode paints delimiters the wrap is unverified, so only the coverage re-read after the
// write refuses a span that formed no construct, keeping a second press from piling them up.
describe('a write that formed no construct', () => {
	// `**alpha***` — the block's own trailing `*` joins the closing run and the pair never closes.
	const TRAILING_MARKER = 'alpha*\n\nbeta\n';

	it('is dropped, while the blocks that did form one are still marked', () => {
		expect(toggle(TRAILING_MARKER, at([0], 0), at([1], 4))).toBe('alpha*\n\n**beta**\n');
	});

	it('leaves a second press with nothing to add, rather than another layer', () => {
		const once = toggle(TRAILING_MARKER, at([0], 0), at([1], 4))!;
		expect(toggle(once, at([0], 0), at([1], '**beta**'.length))).toBeNull();
	});
});

// Miss-analysis: the closed-details rows only ran a range past the details, so format's own
// visit of the stored pair never met an endpoint on a title row that takes the details whole.
describe('a range reaching a closed details’ title row', () => {
	beforeEach(registerChromePluginsForTests);

	const CLOSED = '<details>\n<summary>Sum</summary>\n\nHidden\n\n</details>\n';

	async function bold(source: string, anchor: SelectionPoint, focus: SelectionPoint) {
		const env = makeKeydownEnv(source);
		env.selection.enterCrossBlock(anchor, focus);
		await env.keydown.handleKeyDown(press('b', { ctrlKey: true }));
		return serialize(env.deps.doc);
	}

	// The title row takes no inline marks, so only the body shows the difference.
	it('formats the hidden body when the range ends on the title', async () => {
		expect(await bold('above\n\n' + CLOSED, at([0], 0), at([1, 0], 2))).toBe(
			'**above**\n\n<details>\n<summary>Sum</summary>\n\n**Hidden**\n\n</details>\n'
		);
	});

	it('formats the hidden body when the range starts on the title', async () => {
		expect(await bold('head\n\n' + CLOSED + '\nbelow\n', at([1, 0], 1), at([2], 3))).toBe(
			'head\n\n<details>\n<summary>Sum</summary>\n\n**Hidden**\n\n</details>\n\n**bel**ow\n'
		);
	});

	// The range held the open details by ending on its last byte, and the marks moved that byte.
	it('restores the end of a range that held a details whole on the new last byte', () => {
		const doc = parse('above\n\n<details open>\n<summary>Sum</summary>\n\nShown\n\n</details>\n');
		const range = coverRange(doc, at([0], 0), at([1, 1], 5));
		expect(rangeCoverage(doc, range).wholeRoots).toEqual([[1]]);
		const plan = planCrossBlockFormat(doc, range, 'strong', fixtureReading())!;
		expect(plan.endOffset).toBe('**Shown**'.length);
	});
});
