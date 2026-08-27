/**
 * Every splice settles its separators through the funnel, so no module writes a sibling's
 * `leadingTrivia` by hand (syntax-tree.md § Blank lines). The failure mode is silent: byte
 * round-trip stays green while the document reloads to a different block count. Name-level set
 * equality with a reason per exemption, so splice site N+1 fails at birth rather than at the
 * next audit.
 */

import { describe, it, expect } from 'vitest';
import {
	balancedBlock,
	collectEditorSources,
	readEditorFile,
	stripComments,
	type SourceFile
} from './scan-source';

/**
 * Files that may assign an existing node's `leadingTrivia`. A mint's own `leadingTrivia:`
 * property is a fresh node, not a separator anybody was relying on, and is not a write.
 */
const TRIVIA_WRITERS: Record<string, string> = {
	'src/lib/tree-operations/node-ops.ts': 'the settle doors and the two funnel entries live here',
	'src/lib/tree-operations/reorder.ts':
		'trivia is positional, so a rotation carries each slot’s line rather than its node’s',
	'src/lib/tree-operations/blockquote.ts':
		'head normalization inside a built subtree: a body head separates from nothing',
	'src/lib/tree-operations/list/list-builders.ts':
		'same head normalization, per assembled half and per split-built trailing half',
	'src/lib/tree-operations/list/sublist-separator.ts':
		'the settle door for an empty-marker sublist, whose line no splice window can infer: the write lands on the list, the edit two levels below it',
	'src/lib/tree-operations/list/item-partition.ts':
		'same head normalization, per promoted item and lifted body, at the partition U1 and the item exit share',
	'src/lib/tree-operations/list/unwrap-merge.ts':
		'same head normalization, on the shrunk list’s new head item',
	'src/lib/tree-operations/list/exit-replacement.ts':
		'the exit paragraph’s own line: a minted block between two halves owes one on both sides, which no splice probe can infer',
	'src/lib/tree-operations/paste/list-break-out.ts': 'head normalization inside the built halves',
	'src/lib/tree-operations/paste/paste-replacement.ts':
		'positional: the before/after slots around an inline paste each answer for their own line',
	'src/lib/editor-actions/list-context.ts': 'head normalization of a split item’s second half'
};

/** Files that may name a settle door rather than reaching it through the funnel. */
const HAND_SETTLE_CALLERS: Record<string, string> = {
	'src/lib/tree-operations/node-ops.ts': 'defines them, and the funnel entries beside them',
	'src/lib/tree-operations/index.ts': 're-exports the two the gap-caret mint still needs',
	'src/lib/tree-operations/list/sublist-separator.ts': 'defines the empty-marker sublist door',
	'src/lib/tree-operations/unshare.ts':
		'the chain rebuild is where a list rebuilt down to an empty marker becomes visible',
	'src/lib/editor-actions/block-edit-core.ts':
		'the gap-caret paragraph is a block of its own on both sides, which a splice window cannot say',
	'src/lib/editor-actions/list-context.ts': 'the nesting mint writes the sublist it just built',
	'src/lib/selection/range-delete.ts':
		'its same-block arm writes bytes rather than splicing, so it settles as the content door does'
};

const writesTrivia = (file: SourceFile): boolean =>
	/\.leadingTrivia\s*\+?=(?!=)/.test(stripComments(file.text));

const namesHandSettle = (file: SourceFile): boolean =>
	/(?<![\w'"])(clearRedundantSeparator|dropDoubledSeparator|restoreSeparatorOnFill|restoreSeparatorAfterBlank|settleSeparatorOnBlank|settleSublistSeparator)\b/.test(
		stripComments(file.text)
	);

function census(
	sources: SourceFile[],
	matches: (file: SourceFile) => boolean,
	allowed: Record<string, string>
): void {
	expect(
		sources
			.filter(matches)
			.map((f) => f.relPath)
			.sort()
	).toEqual(Object.keys(allowed).sort());
}

describe('separator-write-door census', () => {
	const sources = collectEditorSources();

	it('the files writing a sibling leadingTrivia are the declared ones', () => {
		census(sources, writesTrivia, TRIVIA_WRITERS);
	});

	it('the files calling a settle door by hand are the declared ones', () => {
		census(sources, namesHandSettle, HAND_SETTLE_CALLERS);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the trivia matcher sees both write forms and skips mints, reads and comments', () => {
		const probe = (text: string) => writesTrivia({ relPath: 'x', text, code: '' });
		expect(probe("node.leadingTrivia = '';")).toBe(true);
		expect(probe('children[i].leadingTrivia += lineEnding;')).toBe(true);
		expect(probe("{ kind: 'paragraph', leadingTrivia: '', raw }")).toBe(false);
		expect(probe("if (node.leadingTrivia === '') return;")).toBe(false);
		expect(probe("// node.leadingTrivia = '' would strand the follower")).toBe(false);
	});

	it('the hand-settle matcher sees a call and an import, and skips prose', () => {
		const probe = (text: string) => namesHandSettle({ relPath: 'x', text, code: '' });
		expect(probe('restoreSeparatorOnFill(parent, i + 1, sharing);')).toBe(true);
		expect(probe("import { dropDoubledSeparator } from '../tree-operations';")).toBe(true);
		expect(probe('// dropDoubledSeparator is the run-level twin')).toBe(false);
	});

	it('an undeclared file writing leadingTrivia fails the set equality', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/tree-operations/rogue.ts',
			text: "children[at].leadingTrivia = '\\n';",
			code: ''
		};
		const writers = [...sources, rogue].filter(writesTrivia).map((f) => f.relPath);
		expect(writers.sort()).not.toEqual(Object.keys(TRIVIA_WRITERS).sort());
	});
});

// ── The retire parity, inside the doors’ own file ─────────────────────────

/**
 * A settle door rewrites bytes the owner's child spans describe, so it retires them
 * (`schema/child-spans.ts`). The censuses above fix which FILES may write a separator; this one
 * fixes which functions inside the doors’ own file may, and every one of them answers for the
 * retire. Door N+1 is born failing this rather than waiting for a sweep case to reach it.
 */
const DOORS_FILE = 'tree-operations/node-ops.ts';

/** Every `function name(` body in `code`, braces balanced. */
function functionBodies(code: string): { name: string; body: string }[] {
	const out: { name: string; body: string }[] = [];
	const re = /function\s+(\w+)\s*\(/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(code)) !== null) {
		const brace = code.indexOf('{', re.lastIndex);
		const body = brace === -1 ? null : balancedBlock(code, brace + 1);
		if (body !== null) out.push({ name: match[1], body });
	}
	return out;
}

/** A write to a sibling’s separating line, or to a wrap slot the spans do not cover. */
const WRITES_SEPARATOR_BYTES = /(?:\.leadingTrivia|slots\.inner(?:Prefix|Suffix))\s*\+?=(?!=)/;

describe('every separator door retires the child spans it invalidates', () => {
	const doors = functionBodies(readEditorFile(DOORS_FILE).code).filter((fn) =>
		WRITES_SEPARATOR_BYTES.test(fn.body)
	);

	/**
	 * Every settle door by name: each retires FIRST, before its own guards. A retire that has
	 * slid below an early return is a door that stops retiring on the paths that take it.
	 */
	const DOORS = [
		'clearRedundantSeparator',
		'dropDoubledSeparator',
		'restoreSeparatorOnFill',
		'restoreSeparatorAfterBlank',
		'settleSeparatorOnBlank',
		'releaseWrapPeel',
		'materializeTailSuffix',
		'handDownVacatedSeparator'
	];

	it('every named door retires the spans first, one red per door', () => {
		const bodies = new Map(
			functionBodies(readEditorFile(DOORS_FILE).code).map((fn) => [fn.name, fn.body])
		);
		const forgot = DOORS.filter(
			(name) => !/^\s*retireChildSpans\s*\(/.test(bodies.get(name) ?? '')
		);
		expect(
			forgot,
			'a settle door stopped retiring the child spans it invalidates, or retires past a guard'
		).toEqual([]);
		expect(DOORS.filter((name) => !bodies.has(name))).toEqual([]);
	});

	it('found the doors (not vacuous)', () => {
		expect(doors.map((fn) => fn.name).sort()).toEqual(
			expect.arrayContaining([
				'clearRedundantSeparator',
				'dropDoubledSeparator',
				'mintSeparator',
				'settleSeparatorOnBlank'
			])
		);
	});

	/**
	 * Writers that answer for the spans some other way, each with the reason. Two are reached
	 * only from doors that retire before dispatching; the rest write a MINT’s own line, or write
	 * one inside a splice that moves the child count, which refuses the next region rewrite.
	 */
	const ANSWERED_ELSEWHERE: Record<string, string> = {
		mintSeparator: 'reached only from the three doors that retire first',
		absorbWrapPrefix: 'reached only from clearRedundantSeparator, which retires first',
		installMergedLeaf: 'writes the survivor’s line inside a merge splice; the count moves',
		absorbSeamReading: 'writes a fresh block’s line, then splices; the count moves',
		absorbFragmentPeel: 'the follower’s line inside that same absorb, ahead of its splice',
		deleteNode: 'hands the vacated line down inside the delete splice; the count moves',
		writeParsedContent: 'carries the target’s line onto its own fresh reparse',
		reclassifyContainer: 'carries the line onto the replacement, byte for byte',
		normalizeReplacementTrivia: 'the same carry, for a replacement built elsewhere'
	};

	it('each one calls the retire, or is answered for elsewhere', () => {
		const missing = doors
			.filter((fn) => !(fn.name in ANSWERED_ELSEWHERE))
			.filter((fn) => !/(?<![\w.])retireChildSpans\s*\(/.test(fn.body))
			.map((fn) => fn.name);
		expect(
			missing,
			'a settle door writes separator bytes without retiring the spans that describe them'
		).toEqual([]);
	});

	it('no entry outlives the writer it excuses', () => {
		const names = new Set(doors.map((fn) => fn.name));
		expect(Object.keys(ANSWERED_ELSEWHERE).filter((name) => !names.has(name))).toEqual([]);
	});

	it('the matcher sees both write forms and skips a read', () => {
		const probe = (body: string) => WRITES_SEPARATOR_BYTES.test(body);
		expect(probe("owned.leadingTrivia = '';")).toBe(true);
		expect(probe('slots.innerSuffix = ending;')).toBe(true);
		expect(probe("if (node.leadingTrivia === '') return;")).toBe(false);
	});
});
