/**
 * G4.20: every line the editor writes takes the document's line ending. The fallback of
 * `core/lines.ts :: trailingLineEnding` is a required argument, so the type holds the ending
 * choice; these scans hold what the type cannot see, a line split that leaves a CRLF line's `\r`
 * on its text, and a newline literal written into a node's bytes.
 * `invariants/crlf-edit-mirror.test.ts` checks the outcome for every gesture it lists.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, literalSpans, rawAssignments } from './scan-source';
import { describeFileRules, except } from './file-rule';

// ── Classification ───────────────────────────────────────────────────────────

/** Every string and template literal in `code`, as `{ start, text }` with `text` including its quotes. */
function stringLiterals(code: string): Array<{ start: number; text: string }> {
	return literalSpans(code)
		.filter((span) => span.kind !== 'regex')
		.map((span) => ({ start: span.start, text: code.slice(span.start, span.end) }));
}

/** A newline escape inside a source string literal: the two characters `\` and `n`. */
const LITERAL_NEWLINE = /\\n/;
/**
 * The literal reaches the emitted bytes rather than only being read (a `split` separator, an
 * `endsWith` check, an `??` default). A literal moved into a variable first slips past; the
 * CRLF-mirror test covers that case.
 */
const EMITTED_BEFORE = /(?:\+|\braw\s*\+?=)\s*$/;
const EMITTED_AFTER = /^\s*\+/;

/** Newline-bearing string literals in `body` that reach the emitted bytes. */
function emittedNewlineLiterals(body: string): string[] {
	return stringLiterals(body)
		.filter((lit) => LITERAL_NEWLINE.test(lit.text))
		.filter(
			(lit) =>
				EMITTED_BEFORE.test(body.slice(0, lit.start)) ||
				EMITTED_AFTER.test(body.slice(lit.start + lit.text.length))
		)
		.map((lit) => lit.text);
}

// ── What the rule covers ─────────────────────────────────────────────────────

/**
 * Writes that legitimately put a newline literal into a node's bytes. The count is part of the
 * entry because an allowlist per file would let the next write in unnoticed.
 */
const RAW_LITERAL_ALLOWLIST: Record<string, { count: number; why: string }> = {
	'src/lib/selection/range-delete-ceremony.ts': {
		count: 1,
		why: 'pre-rebuild placeholder, not emitted bytes: the cleared chrome is re-derived by rebuildUnsharedChain immediately after, which re-emits the opener line with the source ending (a CRLF quote-out yields ">\\r\\n"; the branch is covered by the CRLF-mirror check)'
	},
	'src/lib/testing/container-conformance.ts': {
		count: 2,
		why: "the published conformance kit authors synthetic marker leaves it then rebuilds from; the bytes are the kit's own fixture, not a re-emission of a consumer document"
	}
};

const DOMAIN_RULE =
	'a write to <node>.raw takes its own ending, else the document one — ' +
	'`trailingLineEnding(node.raw, documentLineEnding(doc))`, never a newline literal. A literal downgrades a ' +
	'CRLF-authored block to LF and breaks byte round-trip. Legitimately-literal writes ' +
	'join RAW_LITERAL_ALLOWLIST with a reason AND their count';

// ── Every write to a node's bytes ────────────────────────────────────────────

describe('G4.20 node.raw write ending provenance', () => {
	const assignments = rawAssignments(collectEditorSources());

	it('no write to <node>.raw creates a newline literal into the bytes', () => {
		const violations = assignments
			.filter((a) => emittedNewlineLiterals(a.statement).length > 0)
			.filter((a) => !(a.relPath in RAW_LITERAL_ALLOWLIST))
			.map((a) => `${a.relPath}: ${a.statement.trim()}`);
		expect(violations, DOMAIN_RULE).toEqual([]);
	});

	it('each allowlisted file holds exactly the literal writes its entry accounts for', () => {
		for (const [relPath, entry] of Object.entries(RAW_LITERAL_ALLOWLIST)) {
			const found = assignments
				.filter((a) => a.relPath === relPath)
				.filter((a) => emittedNewlineLiterals(a.statement).length > 0);
			expect(
				found.length,
				`${relPath} holds ${found.length} literal raw writes, allowlisted for ${entry.count}: ${entry.why}`
			).toBe(entry.count);
		}
	});

	it('the assignment scan reached the real writers (not vacuous)', () => {
		expect(assignments.length).toBeGreaterThanOrEqual(10);
		expect(assignments.some((a) => a.relPath.endsWith('container-rebuilders.ts'))).toBe(true);
	});
});

// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────────

describe('G4.20: extractor and matcher self-tests', () => {
	it('raw-assignment scan extracts the statement and skips comparisons', () => {
		const one = (src: string) => rawAssignments([{ relPath: 'x', text: src, code: src }]);

		expect(one("node.raw = '| ' + cells + ' |\\n';")[0].statement).toBe(
			".raw = '| ' + cells + ' |\\n'"
		);
		expect(one("node.raw += '\\n';")[0].statement).toBe(".raw += '\\n'");
		// Comparisons are reads, not writes.
		expect(one("if (node.raw === '\\n') return;")).toEqual([]);
		expect(one("if (node.raw !== '\\n') return;")).toEqual([]);
	});

	it('reads a right-hand side Prettier wrapped onto its own line', () => {
		// The shape a long concatenation is actually formatted as, and the whole subject of
		// this check. Stopping at the first newline truncated it to `.raw =`.
		const wrapped = "node.raw =\n\tmeta.indent +\n\tmeta.body +\n\t'|\\n';";
		const found = rawAssignments([{ relPath: 'x', text: wrapped, code: wrapped }]);
		expect(found).toHaveLength(1);
		expect(emittedNewlineLiterals(found[0].statement)).toEqual(["'|\\n'"]);

		// A wrapped RHS ending in a derived value stays clean.
		const derived = 'node.raw =\n\tmeta.indent +\n\tmeta.closerRaw;';
		const ok = rawAssignments([{ relPath: 'x', text: derived, code: derived }]);
		expect(emittedNewlineLiterals(ok[0].statement)).toEqual([]);
	});

	it('a blank line ends the statement rather than running into the next one', () => {
		const src = "node.raw = head;\n\nconst other = '\\n';";
		const found = rawAssignments([{ relPath: 'x', text: src, code: src }]);
		expect(emittedNewlineLiterals(found[0].statement)).toEqual([]);
	});

	it('domain branch flags a literal raw write and passes a derived one', () => {
		const flagged = (src: string) =>
			rawAssignments([{ relPath: 'x', text: src, code: src }]).filter(
				(a) => emittedNewlineLiterals(a.statement).length > 0
			).length;

		expect(flagged("node.raw = marker + '\\n';")).toBe(1);
		expect(flagged("node.raw += '\\n';")).toBe(1);
		expect(flagged("endBlock.raw = head + '\\r\\n';")).toBe(1);
		expect(flagged('node.raw = head + trailingLineEnding(node.raw);')).toBe(0);
		expect(flagged("node.raw = lines.join('\\n');")).toBe(0);
	});

	it('rebuilder classifier flags emitted newline literals and passes read-only ones', () => {
		expect(emittedNewlineLiterals("node.raw = '| ' + cells + ' |\\n';")).toEqual(["' |\\n'"]);
		expect(emittedNewlineLiterals("node.raw = '\\r\\n';")).toEqual(["'\\r\\n'"]);
		expect(emittedNewlineLiterals("node.raw = '\\n' + body;")).toEqual(["'\\n'"]);

		expect(emittedNewlineLiterals("const e = meta?.lineEnding ?? '\\n';")).toEqual([]);
		expect(emittedNewlineLiterals("const parts = inner.split('\\n');")).toEqual([]);
		expect(emittedNewlineLiterals("if (node.raw.endsWith('\\n')) return;")).toEqual([]);
		expect(emittedNewlineLiterals("if (line === '\\r\\n') return;")).toEqual([]);
		expect(emittedNewlineLiterals('node.raw = head + trailingLineEnding(node.raw);')).toEqual([]);
	});
});

// ── Line splits ──────────────────────────────────────────────────────────────

/** `.split('\n')` or `.split(/\r?\n/)`: a split that leaves a CRLF line's `\r` on its text, or
 *  drops each line's ending. */
const LINE_SPLIT = /\.split\(\s*(?:(['"`])\\n\1|\/\\r\?\\n\/)\s*\)/;

describeFileRules(
	[
		{
			id: 'G4.20 per-line work reads each line without its ending',
			population: except('src/lib/core/lines.ts'),
			matches: LINE_SPLIT,
			allowed: {
				'src/lib/debug/dump-tree.ts': "a debug dump prints each line's bytes, a `\\r` included",
				'src/lib/plugins/parrot/ParrotBlock.svelte': 'splits a constant animation frame',
				'src/lib/tree-operations/table-grid-clipboard.ts':
					'splits clipboard text normalized to LF on the same line'
			},
			reason:
				'split a block into lines with `displayLines` (or `splitLines`) from `core/lines.ts`: ' +
				"`split('\\n')` leaves a CRLF line's `\\r` on its text, where a line match misreads it",
			hits: ["const lines = raw.split('\\n');", 'const lines = text.split(/\\r?\\n/);'],
			misses: [
				'const lines = displayLines(raw);',
				"const cells = row.split('|');",
				"const at = raw.indexOf('\\n');"
			]
		}
	],
	collectEditorSources()
);
