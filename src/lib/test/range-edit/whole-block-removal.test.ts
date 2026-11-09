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
import { removalOf, wholeBlocksRemovalOf } from '#lib/range-edit/edit-range.js';
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
			for (const gesture of ['backspace', 'delete'] as const) {
				const whole = wholeBlocksRemovalOf(source, range, gesture, 'source', host).source;
				const text = removalOf(source, range, gesture, 'source', host).source;
				if (prose ? whole === text || whole !== 'above\n\nbelow\n' : whole !== text)
					out.push(
						`${kind} ${gesture}: whole ${JSON.stringify(whole)}, range ${JSON.stringify(text)}`
					);
			}
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
			const whole = wholeBlocksRemovalOf(source, range, 'delete', 'source', host).source;
			const text = removalOf(source, range, 'delete', 'source', host).source;
			if (whole !== `above${ending}` || whole === text)
				out.push(`${kind}: whole ${JSON.stringify(whole)}, range ${JSON.stringify(text)}`);
		}
		expect(out).toEqual([]);
	});

	it('takes a paragraph with its line and one blank line beside it', () => {
		const host = checkHost();
		const source = 'a\n\nalpha\n\nb\n';
		const got = wholeBlocksRemovalOf(source, { from: 3, to: 8 }, 'backspace', 'source', host);
		expect(got).toEqual({ source: 'a\n\nb\n', caret: { at: 1, holds: 'text' } });
	});
});
