import { describe, it, expect } from 'vitest';
import type { AnyInlineKind } from '../../core/nodes';
import {
	checkInlineConstructPolicy,
	type InlineConstructPolicyEntry
} from '../../invariants/registry';

const kind = (name: string) => name as AnyInlineKind;
const known = (names: string[]) => (k: AnyInlineKind) => names.includes(k);

const row = (over: Partial<InlineConstructPolicyEntry> = {}): InlineConstructPolicyEntry => ({
	kind: kind('emphasis'),
	revealable: true,
	autoUnwrapOnEmpty: true,
	splitBehavior: 'close-and-reopen',
	...over
});

describe('checkInlineConstructPolicy (G1.31)', () => {
	it('fires when a row names a kind no vocabulary holds', () => {
		const violation = checkInlineConstructPolicy([row({ kind: kind('emphais') })], known([]));
		expect(violation?.code).toBe('inline-construct-policy');
		expect(violation?.detail).toMatchObject({ kind: 'emphais', issue: 'unknown-kind' });
	});

	it('fires when a non-revealable kind claims a close-and-reopen split', () => {
		const violation = checkInlineConstructPolicy(
			[row({ kind: kind('escape'), revealable: false, autoUnwrapOnEmpty: false })],
			known(['escape'])
		);
		expect(violation?.detail).toMatchObject({ kind: 'escape', column: 'splitBehavior' });
	});

	it('fires when a non-revealable kind claims empty auto-unwrap', () => {
		const violation = checkInlineConstructPolicy(
			[row({ kind: kind('hardLineBreak'), revealable: false, splitBehavior: 'plain' })],
			known(['hardLineBreak'])
		);
		expect(violation?.detail).toMatchObject({ kind: 'hardLineBreak', column: 'autoUnwrapOnEmpty' });
	});

	it('accepts a non-revealable kind that stays atomic on both axes', () => {
		expect(
			checkInlineConstructPolicy(
				[
					row({
						kind: kind('escape'),
						revealable: false,
						autoUnwrapOnEmpty: false,
						splitBehavior: 'plain'
					})
				],
				known(['escape'])
			)
		).toBeNull();
	});

	it('accepts the marker-rewriting behaviors on a revealable kind', () => {
		expect(checkInlineConstructPolicy([row()], known(['emphasis']))).toBeNull();
	});

	// The mark column's two ties. Both were compile errors while `InlineMarkKind` was a closed
	// union and the vocabulary two hand-written tables; the check is what replaced that.
	it('fires when two mark rows share a nesting rank', () => {
		const mark = { nestingRank: 0, command: 'format.toggleStrong' };
		const violation = checkInlineConstructPolicy(
			[
				row({ kind: kind('strong'), mark }),
				row({ kind: kind('emphasis'), mark: { ...mark, command: 'format.toggleEmphasis' } })
			],
			known(['strong', 'emphasis'])
		);
		expect(violation?.detail).toMatchObject({ kinds: ['strong', 'emphasis'], nestingRank: 0 });
	});

	it('fires when two mark rows claim one command', () => {
		const violation = checkInlineConstructPolicy(
			[
				row({ kind: kind('strong'), mark: { nestingRank: 0, command: 'format.toggleStrong' } }),
				row({ kind: kind('emphasis'), mark: { nestingRank: 1, command: 'format.toggleStrong' } })
			],
			known(['strong', 'emphasis'])
		);
		expect(violation?.detail).toMatchObject({ command: 'format.toggleStrong' });
	});

	it('accepts distinct ranks and commands, and rows carrying no mark at all', () => {
		expect(
			checkInlineConstructPolicy(
				[
					row({ kind: kind('strong'), mark: { nestingRank: 0, command: 'format.toggleStrong' } }),
					row({
						kind: kind('emphasis'),
						mark: { nestingRank: 1, command: 'format.toggleEmphasis' }
					}),
					row({ kind: kind('link') })
				],
				known(['strong', 'emphasis', 'link'])
			)
		).toBeNull();
	});

	// The kind is read before its fields, so a typo reports itself rather than the
	// incidental incoherence a mistyped row usually also carries.
	it('reports the unknown kind ahead of that row’s own field gap', () => {
		const violation = checkInlineConstructPolicy(
			[row({ kind: kind('escaep'), revealable: false })],
			known(['escape'])
		);
		expect(violation?.detail).toMatchObject({ issue: 'unknown-kind' });
	});
});
