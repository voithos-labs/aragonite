// @vitest-environment jsdom
// A block removed whole (the block menu's Delete, a focused block's keys) leaves what a range over
// its whole span leaves, except a prose leaf, which goes with its line, and a block ending its
// parent, which takes the separator above it. Miss-analysis: the two removals had separate homes,
// so nothing held the places they may differ to the cases they should differ for.
import { describe, expect, it } from 'vitest';
import {
	getAllRegisteredKinds,
	getBlockKindDescriptor
} from '#lib/schema/block-kind-descriptor.js';
import {
	removalOf,
	wholeBlocksRemovalOf,
	type RemovalGesture
} from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import { ownTrailingLineEnding } from '#lib/core/lines.js';
import { checkHost, testReading } from './test-host';

/** Every registered kind with a fixture, bundled plugins installed, read once inside a test. */
function fixtures(): [string, string][] {
	testReading();
	return getAllRegisteredKinds().flatMap((kind) => {
		const fixture = getBlockKindDescriptor(kind).conformanceFixture;
		return fixture ? [[kind, fixture] as [string, string]] : [];
	});
}

describe('a block removed whole against a range over its whole span', () => {
	it('differs for a prose leaf alone, which goes with its line', () => {
		const host = checkHost();
		const out: string[] = [];
		for (const [kind, fixture] of fixtures()) {
			const source = `above\n\n${fixture.replace(/\r?\n$/, '')}\n\nbelow\n`;
			const block = host.layout(host.read(source)).block([1])!;
			const raw = source.slice(block.from, block.to);
			const range = { from: block.from, to: block.to - ownTrailingLineEnding(raw).length };
			const prose = host.facts(block.type).joins === 'text';
			const whole = wholeBlocksRemovalOf(source, range, 'command', 'source', host).source;
			const text = removalOf(source, range, 'delete', 'source', host).source;
			if (prose ? whole === text || whole !== 'above\n\nbelow\n' : whole !== text)
				out.push(`${kind}: whole ${JSON.stringify(whole)}, range ${JSON.stringify(text)}`);
		}
		expect(out).toEqual([]);
	});

	// Miss-analysis: the range rule keeps every byte before the range, which no block removal did.
	it('as the last block, takes the separator above it, so the block above ends as it did', () => {
		const host = checkHost();
		const out: string[] = [];
		for (const [kind, fixture] of fixtures()) {
			const source = `above\n\n${fixture}`;
			const blocks = host.read(source).children;
			if (blocks.length !== 2) continue;
			const block = host.layout(host.read(source)).block([1])!;
			const ending = ownTrailingLineEnding(source);
			const range = { from: block.from, to: source.length - ending.length };
			const whole = wholeBlocksRemovalOf(source, range, 'command', 'source', host).source;
			const text = removalOf(source, range, 'delete', 'source', host).source;
			if (whole !== `above${ending}` || whole === text)
				out.push(`${kind}: whole ${JSON.stringify(whole)}, range ${JSON.stringify(text)}`);
		}
		expect(out).toEqual([]);
	});

	// Miss-analysis: the pair a removed block leaves had rows on the structural route only.
	it.each([
		['a rule stays apart from the paragraph above', 'a\n# h\n---\n', [1], 'a\n\n---\n'],
		['inside a quote too', '> a\n> # h\n> ---\n', [0, 1], '> a\n>\n> ---\n'],
		['prose folds into the paragraph above', 'a\n# h\nb\n', [1], 'a\nb\n'],
		[
			'a table stays apart from the quote it ended',
			'> a\n> # h\n| A |\n| - |\n',
			[0, 1],
			'> a\n\n| A |\n| - |\n'
		],
		[
			'and from the list item it ended',
			'- a\n- b\n\n  # h\n| A |\n| - |\n',
			[0, 1, 1],
			'- a\n- b\n\n| A |\n| - |\n'
		],
		['prose folds into the quote it ended', '> a\n> # h\ntext\n', [0, 1], '> a\ntext\n'],
		[
			'a table stays apart from the inner quote it ended',
			'> > a\n> > # h\n> | A |\n> | - |\n',
			[0, 0, 1],
			'> > a\n>\n> | A |\n> | - |\n'
		],
		[
			'an ordered list numbered on still interrupts the paragraph',
			'a\n1. x\n2. y\n',
			[1, 0],
			'a\n1. y\n'
		]
	])('leaves the pair around it the join question’s blank line: %s', (_, source, path, left) => {
		const host = checkHost();
		const block = host.layout(host.read(source)).block(path)!;
		const range = { from: block.from, to: block.to - 1 };
		expect(wholeBlocksRemovalOf(source, range, 'command', 'source', host).source).toBe(left);
	});

	it('takes a paragraph with its line and one blank line beside it', () => {
		const host = checkHost();
		const source = 'a\n\nalpha\n\nb\n';
		expect(wholeBlocksRemovalOf(source, { from: 3, to: 8 }, 'command', 'source', host).source).toBe(
			'a\n\nb\n'
		);
	});
});

// ── Where the caret lands ────────────────────────────────────────────────────

/** The caret the block at `path` removed whole leaves, by `gesture`, as `[byte, holds]`. */
function caretAfter(
	source: string,
	path: number[],
	gesture: RemovalGesture,
	mode: Mode = 'source'
) {
	const host = checkHost();
	const block = host.layout(host.read(source)).block(path)!;
	const range = {
		from: block.from,
		to: block.to - ownTrailingLineEnding(source.slice(block.from, block.to)).length
	};
	const { caret } = wholeBlocksRemovalOf(source, range, gesture, mode, host);
	return [caret.at, caret.holds];
}

// Miss-analysis: the landing was the editor's own until the core's caret replaced it, so no core
// row held the caret beside a removed block to the side its gesture points.
describe('a block removed whole leaves the caret on the side its gesture points', () => {
	it('Backspace and a command key at the block above’s end, Delete and a cut at the start below', () => {
		const out: string[] = [];
		for (const mode of ['source', 'live'] as const) {
			for (const [kind, fixture] of fixtures()) {
				const source = `above\n\n${fixture.replace(/\r?\n$/, '')}\n\nbelow\n`;
				for (const gesture of ['backspace', 'command', 'delete', 'cut'] as const) {
					const want = gesture === 'backspace' || gesture === 'command' ? 5 : 7;
					const [at, holds] = caretAfter(source, [1], gesture, mode);
					if (at !== want || holds !== 'text')
						out.push(`${mode} ${kind} ${gesture}: ${at} ${holds}`);
				}
			}
		}
		expect(out).toEqual([]);
	});

	it.each([
		['the parent’s last block, after the text above', 'a\n\n---', [1], 'backspace', 1],
		[
			'the end of a code block’s body, not its closing line',
			'```\ncode\n```\n\n---\n\nb\n',
			[1],
			'backspace',
			8
		],
		[
			'the start of a code block’s body, not its opening line',
			'a\n\n---\n\n```\ncode\n```\n',
			[1],
			'delete',
			7
		],
		[
			'the start of the block after the quote it ended',
			'> a\n>\n> ---\n\nb\n',
			[0, 1],
			'delete',
			5
		],
		['the start of a list item’s text, past its marker', 'a\n\n---\n\n- b\n', [1], 'delete', 5],
		['the first block’s next, where none comes before', 'a\n\nb\n', [0], 'backspace', 0],
		['the block before, where none comes after', 'a\n\nb\n', [1], 'delete', 1],
		['the end of the item before an empty item', '- a\n- \n- c\n', [0, 1], 'backspace', 3],
		['an emptied document’s one place', 'a\n', [0], 'backspace', 0],
		[
			'a cut’s at the code block’s first byte, where a paste puts the cut back',
			'a\n\n---\n\n```\ncode\n```\n',
			[1],
			'cut',
			3
		],
		[
			'past a setext underline, which source mode shows',
			'Title\n===\n\n---\n\nb\n',
			[1],
			'backspace',
			9
		],
		[
			'where the heading was, when the line below folds up',
			'> a\n> # h\nb\n',
			[0, 1],
			'backspace',
			3
		],
		[
			'and before a CRLF pair there, never between its bytes',
			'> a\r\n> # h\r\nb\r\n',
			[0, 1],
			'backspace',
			3
		]
	] satisfies [string, string, number[], RemovalGesture, number][])(
		'lands at %s',
		(_, source, path, gesture, at) => {
			expect(caretAfter(source, path, gesture)).toEqual([at, 'text']);
		}
	);

	it('on a rule above, held whole', () => {
		expect(caretAfter('---\n\n```\nx\n```\n\nb\n', [1], 'backspace')).toEqual([0, 'block']);
	});
});
