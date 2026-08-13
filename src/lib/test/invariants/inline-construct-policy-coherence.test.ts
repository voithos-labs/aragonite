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

// Stand-in vocabularies, as everywhere else in this file: the real ones are what the schema
// suite's mount case runs the same predicate over.
const BUILTIN_COMMANDS = ['format.toggleStrong', 'format.toggleEmphasis', 'link.openCard'];

/** `builtinKinds` defaults to the whole known set, so a case saying nothing about plugin kinds
 *  reads as all-built-in. */
const check = (
	entries: InlineConstructPolicyEntry[],
	knownKinds: string[],
	builtinKinds: string[] = knownKinds
) =>
	checkInlineConstructPolicy(entries, known(knownKinds), known(builtinKinds), (id) =>
		BUILTIN_COMMANDS.includes(id)
	);

describe('checkInlineConstructPolicy (G1.31)', () => {
	it('fires when a row names a kind no vocabulary holds', () => {
		const violation = check([row({ kind: kind('emphais') })], []);
		expect(violation?.code).toBe('inline-construct-policy');
		expect(violation?.detail).toMatchObject({ kind: 'emphais', issue: 'unknown-kind' });
	});

	it('fires when a non-revealable kind claims a close-and-reopen split', () => {
		const violation = check(
			[row({ kind: kind('escape'), revealable: false, autoUnwrapOnEmpty: false })],
			['escape']
		);
		expect(violation?.detail).toMatchObject({ kind: 'escape', column: 'splitBehavior' });
	});

	it('fires when a non-revealable kind claims empty auto-unwrap', () => {
		const violation = check(
			[row({ kind: kind('hardLineBreak'), revealable: false, splitBehavior: 'plain' })],
			['hardLineBreak']
		);
		expect(violation?.detail).toMatchObject({ kind: 'hardLineBreak', column: 'autoUnwrapOnEmpty' });
	});

	it('accepts a non-revealable kind that stays atomic on both axes', () => {
		expect(
			check(
				[
					row({
						kind: kind('escape'),
						revealable: false,
						autoUnwrapOnEmpty: false,
						splitBehavior: 'plain'
					})
				],
				['escape']
			)
		).toBeNull();
	});

	it('accepts the marker-rewriting behaviors on a revealable kind', () => {
		expect(check([row()], ['emphasis'])).toBeNull();
	});

	// The mark column's two ties. Both were compile errors while `InlineMarkKind` was a closed
	// union and the vocabulary two hand-written tables; the check is what replaced that.
	it('fires when two mark rows share a nesting rank', () => {
		const mark = { nestingRank: 0, command: 'format.toggleStrong' };
		const violation = check(
			[
				row({ kind: kind('strong'), mark }),
				row({ kind: kind('emphasis'), mark: { ...mark, command: 'format.toggleEmphasis' } })
			],
			['strong', 'emphasis']
		);
		expect(violation?.detail).toMatchObject({ kinds: ['strong', 'emphasis'], nestingRank: 0 });
	});

	it('fires when two mark rows claim one command', () => {
		const violation = check(
			[
				row({ kind: kind('strong'), mark: { nestingRank: 0, command: 'format.toggleStrong' } }),
				row({ kind: kind('emphasis'), mark: { nestingRank: 1, command: 'format.toggleStrong' } })
			],
			['strong', 'emphasis']
		);
		expect(violation?.detail).toMatchObject({ command: 'format.toggleStrong' });
	});

	it('accepts distinct ranks and commands, and rows carrying no mark at all', () => {
		expect(
			check(
				[
					row({ kind: kind('strong'), mark: { nestingRank: 0, command: 'format.toggleStrong' } }),
					row({
						kind: kind('emphasis'),
						mark: { nestingRank: 1, command: 'format.toggleEmphasis' }
					}),
					row({ kind: kind('link') })
				],
				['strong', 'emphasis', 'link']
			)
		).toBeNull();
	});

	// A built-in id the mark table does not already claim ties with nothing, so only this rule
	// catches it — and the surfaces that consult the mark table disagree on where in their command
	// lookup it sits, so the shadow is one surface's and not the other's.
	it('fires when a plugin row’s mark claims a built-in command id', () => {
		const violation = check(
			[row({ kind: kind('spec-mark'), mark: { nestingRank: 9, command: 'link.openCard' } })],
			['strong', 'spec-mark'],
			['strong']
		);
		expect(violation?.message).toContain('link.openCard');
		expect(violation?.detail).toMatchObject({
			kind: 'spec-mark',
			command: 'link.openCard',
			issue: 'builtin-command'
		});
	});

	it('accepts a plugin row whose mark names a minted command', () => {
		expect(
			check(
				[row({ kind: kind('spec-mark'), mark: { nestingRank: 9, command: 'spec.toggleMark' } })],
				['strong', 'spec-mark'],
				['strong']
			)
		).toBeNull();
	});

	// The kind is read before its fields, so a typo reports itself rather than the
	// incidental incoherence a mistyped row usually also carries.
	it('reports the unknown kind ahead of that row’s own field gap', () => {
		const violation = check([row({ kind: kind('escaep'), revealable: false })], ['escape']);
		expect(violation?.detail).toMatchObject({ issue: 'unknown-kind' });
	});
});
