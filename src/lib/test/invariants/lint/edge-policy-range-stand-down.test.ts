/**
 * Every branch of the caret-edge dispatch asks whether a range is held, through `heldRange()` and
 * nothing else. A branch that never asks reads the range's start as its caret and answers for the
 * construct beside a selection the user meant to replace; one that asks the document-wide DOM
 * selection instead answers about a range another block holds.
 */
import { describe, it, expect } from 'vitest';
import { balancedRegion, readEditorFile } from './scan-source';

const DISPATCH = 'components/blocks/text/edge-policy-dispatch.ts';

/** One spelling, and it reads this block's own raw offsets. */
const ASKS_ABOUT_A_RANGE = /\bheldRange\s*\(/;

/** Branches whose claim is written inline rather than as a named handler, and why each is exempt. */
const INLINE_CLAIMS: Record<string, string> = {
	'reading-mode': 'a mode cut, not a caret question: it ends the walk for every arm below it'
};

interface Arm {
	id: string;
	handler: string | null;
}

/** The `arms` manifest as declared: each entry's id and the handler its `claims` names. */
function armsOf(code: string): Arm[] {
	const declared = code.indexOf('const arms: readonly DispatchArm[] =');
	const manifest = balancedRegion(code, code.indexOf('[', code.indexOf('=', declared)));
	if (manifest === null) throw new Error('`arms` manifest not found in the dispatch');
	const out: Arm[] = [];
	const entry = /id:\s*'([^']+)'[\s\S]*?claims:\s*(?:(\w+)|\(\))/g;
	let match: RegExpExecArray | null;
	while ((match = entry.exec(manifest)) !== null) {
		out.push({ id: match[1], handler: match[2] ?? null });
	}
	// A `claims` shape the pattern does not read would drop that branch and the one after it.
	const declaredIds = (manifest.match(/\bid:\s*'/g) ?? []).length;
	if (out.length !== declaredIds) {
		throw new Error(
			`branch census read ${out.length} of ${declaredIds} branches: a claims shape it cannot parse`
		);
	}
	return out;
}

/** One closure-level declaration's source, up to the next one. Brace-matching would have to tell
 *  a `{ start; end }` return type from a body; the sibling declaration is the simpler boundary. */
function sourceOfFunction(code: string, name: string): string {
	const declared = code.indexOf(`function ${name}(`);
	if (declared < 0) throw new Error(`no declaration for ${name}`);
	const rest = code.slice(declared + 1);
	const next = rest.search(/\n\t(?:function |return )/);
	return next < 0 ? rest : rest.slice(0, next);
}

describe('every caret-edge branch asks whether a range is held', () => {
	const { code } = readEditorFile(DISPATCH);
	const arms = armsOf(code);

	it('read the branch manifest', () => {
		expect(arms.length).toBeGreaterThan(5);
		expect(arms.map((arm) => arm.id)).toContain('cst-widget');
	});

	it('each named branch reads the range, and each inline one is declared', () => {
		const silent = arms
			.filter((arm) =>
				arm.handler === null
					? !(arm.id in INLINE_CLAIMS)
					: !ASKS_ABOUT_A_RANGE.test(sourceOfFunction(code, arm.handler))
			)
			.map((arm) => arm.id);
		expect(
			silent,
			'a branch reads the range start as its caret without asking whether a range is held: call ' +
				'heldRange(), or declare it in INLINE_CLAIMS with why'
		).toEqual([]);
	});

	// One read, so a branch cannot grow a second idea of what "a range" is.
	it('the raw selection is read in exactly one place', () => {
		expect(code.match(/deps\.getRawSelection\s*\(/g)).toHaveLength(1);
		expect(sourceOfFunction(code, 'heldRange')).toContain('deps.getRawSelection(');
	});

	// The DOM selection is the whole document's, so a branch reading it stands down for a range
	// another block holds and answers as a caret for one this block's offsets call empty.
	it('the dispatch never reads the document-wide DOM selection', () => {
		expect(code).not.toMatch(/\bhasSelection\b/);
	});

	// ── Mutation tests ───────────────────────────────────────────────────────

	it('a branch whose body asks nothing is caught', () => {
		const rogue = 'function handleRogue(e, caretOffset) { return caretOffset === 0; }';
		expect(ASKS_ABOUT_A_RANGE.test(sourceOfFunction(rogue, 'handleRogue'))).toBe(false);
	});

	it('the scan reads each branch’s own body, not its neighbour’s', () => {
		const pair =
			'\tfunction handleSilent(e) {\n\t\treturn false;\n\t}\n' +
			'\tfunction handleAsking(e) {\n\t\treturn heldRange() !== null;\n\t}\n';
		expect(ASKS_ABOUT_A_RANGE.test(sourceOfFunction(pair, 'handleSilent'))).toBe(false);
		expect(ASKS_ABOUT_A_RANGE.test(sourceOfFunction(pair, 'handleAsking'))).toBe(true);
	});

	it('only the raw read satisfies the scan, and a mention in a name does not', () => {
		expect(ASKS_ABOUT_A_RANGE.test('const r = heldRange();')).toBe(true);
		expect(ASKS_ABOUT_A_RANGE.test('if (!hasSelectionHelper()) return false;')).toBe(false);
		expect(ASKS_ABOUT_A_RANGE.test('const heldRangeStart = 0;')).toBe(false);
	});
});
