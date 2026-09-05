/**
 * G4.20 — trailing-line-ending reconstruction parity across keystroke-commit sites
 * (`docs/contributing/rules.md` § The bug shape to fear): a site that reads a block's
 * text back rebuilds the ending as `trailingLineEnding(<node>.raw)`, never a literal
 * newline, which downgrades a CRLF block and breaks round-trip. Reconstruction stays a
 * call-site duty because a block at EOF may legitimately lack an ending. Five arms, all
 * matching literal shapes — `invariants/crlf-edit-mirror.test.ts` is the outcome oracle
 * for the rest. The scan excludes `test/`, so this file's own examples aren't inspected.
 */

import { describe, it, expect } from 'vitest';
import {
	balancedRegion,
	callArguments,
	collectEditorSources,
	rawAssignments,
	type SourceFile
} from './scan-source';

// ── Source extraction ────────────────────────────────────────────────────────

/** The content (2nd) argument of every `updateBlockContent(` call in `code`. */
function contentArgs(code: string): string[] {
	const out: string[] = [];
	const re = /updateBlockContent\s*\(/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(code)) !== null) {
		const region = balancedRegion(code, code.indexOf('(', m.index));
		if (region === null) continue;
		const args = callArguments(region.slice(1, -1));
		if (args.length >= 2) out.push(args[1]);
	}
	return out;
}

/** Every string literal in `code`, as `{ start, text }` with `text` including its quotes. */
function stringLiterals(code: string): Array<{ start: number; text: string }> {
	const out: Array<{ start: number; text: string }> = [];
	for (let i = 0; i < code.length; i++) {
		const quote = code[i];
		if (quote !== "'" && quote !== '"' && quote !== '`') continue;
		const start = i++;
		while (i < code.length && code[i] !== quote) i += code[i] === '\\' ? 2 : 1;
		out.push({ start, text: code.slice(start, i + 1) });
	}
	return out;
}

interface CommitFunnel {
	relPath: string;
	body: string;
}

interface RebuilderBody {
	relPath: string;
	name: string;
	body: string;
}

/** Every `function rebuild<Kind>Raw(…) { … }` body across the editor sources. */
function containerRebuilders(sources: SourceFile[]): RebuilderBody[] {
	const out: RebuilderBody[] = [];
	for (const f of sources) {
		const re = /function\s+(rebuild\w*Raw)\s*\(/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(f.code)) !== null) {
			const parenIdx = f.code.indexOf('(', m.index);
			const params = balancedRegion(f.code, parenIdx);
			if (params === null) continue;
			const braceIdx = f.code.indexOf('{', parenIdx + params.length);
			const body = braceIdx === -1 ? null : balancedRegion(f.code, braceIdx);
			if (body === null) continue;
			out.push({ relPath: f.relPath, name: m[1], body });
		}
	}
	return out;
}

/** Every `commitInput: (…) => { … }` body that reaches `updateBlockContent`. */
function commitInputFunnels(sources: SourceFile[]): CommitFunnel[] {
	const out: CommitFunnel[] = [];
	for (const f of sources) {
		const re = /commitInput\s*:\s*\([^)]*\)\s*=>\s*{/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(f.code)) !== null) {
			const body = balancedRegion(f.code, f.code.indexOf('{', m.index));
			if (body !== null && /\bupdateBlockContent\s*\(/.test(body)) {
				out.push({ relPath: f.relPath, body });
			}
		}
	}
	return out;
}

// ── Classification ───────────────────────────────────────────────────────────

/** Content arg ending in `+ trailingLineEnding(...)` — the sanctioned reconstruction. */
const RECONSTRUCTS_COMPLIANT = /\+\s*trailingLineEnding\s*\([\s\S]*\)\s*$/;
/** Content arg ending in `+ '\n'` / `"\n"` / `'\r\n'` — a literal-newline reconstruction. */
const RECONSTRUCTS_LITERAL = /\+\s*(['"`])(?:\\r)?\\n\1\s*$/;
const HAS_TRAILING_APPEND = /\btrailingLineEnding\s*\(/;

/** A newline escape inside a source string literal — the two characters `\` `n`. */
const LITERAL_NEWLINE = /\\n/;
/**
 * The literal reaches the emitted bytes rather than only being READ (a `split` separator,
 * an `endsWith` probe, an `??` default). A literal hoisted into a variable first slips
 * past, as in Arm 1; the CRLF-mirror oracle covers the hoist.
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

/** Funnels that legitimately append nothing, with the reason each is exempt. */
const COMMITINPUT_ALLOWLIST: Record<string, string> = {
	'src/lib/components/blocks/table/TableCellBlock.svelte':
		'a GFM table cell holds no raw newline; commitInput commits the escaped cell text as-is'
};

// ── Arm 4 support: the seam's exclusivity ────────────────────────────────────

/**
 * `x.endsWith('\r\n') ? '\r\n' : '\n'` written out longhand — `trailingLineEnding`'s
 * body. The `\\r` here matches the two source characters backslash-r.
 */
const INLINE_ENDING_TERNARY = /endsWith\s*\(\s*['"]\\r\\n['"]\s*\)\s*\?/;

/** The one home for the expression; every other site calls it. */
const LINE_ENDING_SEAM = 'src/lib/core/lines.ts';

const TERNARY_RULE =
	`the \`endsWith('\\r\\n') ? … : …\` ending ternary belongs to ${LINE_ENDING_SEAM} alone — ` +
	'call `trailingLineEnding(raw)`. Twelve inline copies of it were the source contributors ' +
	'copied from, and copy #13 dropped the CRLF arm four separate times';

/** `raw.slice(displayLength(raw))` — `ownTrailingLineEnding`'s body, the ending a block's own
 *  bytes carry rather than the one the document uses. */
const INLINE_OWN_ENDING_SLICE = /\.slice\s*\(\s*displayLength\s*\(/;

const OWN_ENDING_RULE =
	`the \`.slice(displayLength(raw))\` ending complement belongs to ${LINE_ENDING_SEAM} alone — ` +
	'call `ownTrailingLineEnding(raw)`. It answers the other half of the same question, so a ' +
	'copy of it is the ternary copies again with the seam one call further away';

// ── Arm 5 support: the rule's domain ─────────────────────────────────────────

/**
 * Writes that legitimately mint a newline literal into a node's bytes. The count is part
 * of the entry because a file-granular allowlist lets write N+1 in unnoticed.
 */
const RAW_LITERAL_ALLOWLIST: Record<string, { count: number; why: string }> = {
	'src/lib/selection/range-delete-ceremony.ts': {
		count: 1,
		why: 'pre-rebuild placeholder, not emitted bytes: the cleared chrome is re-derived by rebuildUnsharedChain immediately after, which re-emits the opener line with the source ending (a CRLF quote-out yields ">\\r\\n"; the branch is covered by the CRLF-mirror oracle)'
	},
	'src/lib/testing/container-conformance.ts': {
		count: 2,
		why: "the published conformance kit authors synthetic marker leaves it then rebuilds from; the bytes are the kit's own fixture, not a re-emission of a consumer document"
	}
};

const DOMAIN_RULE =
	'a write to <node>.raw must derive its ending from the bytes it is re-emitting — ' +
	'`trailingLineEnding(node.raw)`, never a newline literal. A literal downgrades a ' +
	'CRLF-authored block to LF and breaks byte round-trip. Legitimately-literal writes ' +
	'join RAW_LITERAL_ALLOWLIST with a reason AND their count';

// ── Arm 1: reconstruction form ───────────────────────────────────────────────

describe('G4.20 trailing-line-ending reconstruction parity', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('no updateBlockContent content argument reconstructs the ending with a newline literal', () => {
		const violations = sources.flatMap((f) =>
			contentArgs(f.code)
				.filter((arg) => RECONSTRUCTS_LITERAL.test(arg))
				.map((arg) => ({ relPath: f.relPath, arg }))
		);
		expect(violations).toEqual([]);
	});

	it('found the compliant reconstruction sites (the scan is live, not vacuous)', () => {
		const compliant = sources.flatMap((f) =>
			contentArgs(f.code).filter((arg) => RECONSTRUCTS_COMPLIANT.test(arg))
		);
		expect(compliant.length).toBeGreaterThanOrEqual(5);
	});
});

// ── Arm 2: commitInput funnel coverage ───────────────────────────────────────

describe('G4.20 commitInput funnel coverage', () => {
	const sources = collectEditorSources();

	it('every commitInput funnel appends trailingLineEnding (table cells excepted)', () => {
		const missing = commitInputFunnels(sources)
			.filter((fn) => !(fn.relPath in COMMITINPUT_ALLOWLIST))
			.filter((fn) => !HAS_TRAILING_APPEND.test(fn.body))
			.map((fn) => fn.relPath);
		expect(missing).toEqual([]);
	});

	it('the funnel scan found real editable surfaces', () => {
		expect(commitInputFunnels(sources).length).toBeGreaterThanOrEqual(3);
	});

	it('each allowlist entry still names a funnel that appends nothing (no dead entry)', () => {
		const byPath = new Map(commitInputFunnels(sources).map((fn) => [fn.relPath, fn]));
		for (const relPath of Object.keys(COMMITINPUT_ALLOWLIST)) {
			const fn = byPath.get(relPath);
			expect(fn, `allowlisted commitInput funnel not found: ${relPath}`).toBeDefined();
			expect(HAS_TRAILING_APPEND.test(fn!.body), `allowlist stale for ${relPath}`).toBe(false);
		}
	});
});

// ── Arm 3: container rebuilders ──────────────────────────────────────────────

describe('G4.20 container rebuildRaw ending provenance', () => {
	const rebuilders = containerRebuilders(collectEditorSources());

	it('no rebuildRaw emits a newline literal into the bytes it re-derives', () => {
		const violations = rebuilders.flatMap((fn) =>
			emittedNewlineLiterals(fn.body).map((lit) => `${fn.relPath} ${fn.name}: ${lit}`)
		);
		expect(violations).toEqual([]);
	});

	it('the rebuilder scan found the built-in containers (not vacuous)', () => {
		const names = rebuilders.map((fn) => fn.name);
		expect(names).toEqual(
			expect.arrayContaining(['rebuildBlockquoteRaw', 'rebuildListItemRaw', 'rebuildTableRaw'])
		);
	});
});

// ── Arm 4: the seam has no inline copies ─────────────────────────────────────

describe('G4.20 trailing-line-ending seam exclusivity', () => {
	const sources = collectEditorSources();

	it('no file outside core/lines.ts writes the ending ternary longhand', () => {
		const copies = sources
			.filter((f) => f.relPath !== LINE_ENDING_SEAM)
			.filter((f) => INLINE_ENDING_TERNARY.test(f.code))
			.map((f) => f.relPath);
		expect(copies, TERNARY_RULE).toEqual([]);
	});

	it('no file outside core/lines.ts writes the ending complement longhand', () => {
		const copies = sources
			.filter((f) => f.relPath !== LINE_ENDING_SEAM)
			.filter((f) => INLINE_OWN_ENDING_SLICE.test(f.code))
			.map((f) => f.relPath);
		expect(copies, OWN_ENDING_RULE).toEqual([]);
	});

	it('the seam still holds both expressions the rules redirect to', () => {
		const seam = sources.find((f) => f.relPath === LINE_ENDING_SEAM);
		expect(seam, `line-ending seam not found: ${LINE_ENDING_SEAM}`).toBeDefined();
		expect(INLINE_ENDING_TERNARY.test(seam!.code)).toBe(true);
		expect(INLINE_OWN_ENDING_SLICE.test(seam!.code)).toBe(true);
		expect(seam!.code).toContain('export function trailingLineEnding');
		expect(seam!.code).toContain('export function ownTrailingLineEnding');
	});
});

// ── Arm 5: the rule's domain — every write to a node's bytes ─────────────────

describe('G4.20 node.raw write ending provenance', () => {
	const assignments = rawAssignments(collectEditorSources());

	it('no write to <node>.raw mints a newline literal into the bytes', () => {
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
				`${relPath} holds ${found.length} literal raw writes, allowlisted for ${entry.count} — ${entry.why}`
			).toBe(entry.count);
		}
	});

	it('the assignment scan reached the real writers (not vacuous)', () => {
		expect(assignments.length).toBeGreaterThanOrEqual(10);
		expect(assignments.some((a) => a.relPath.endsWith('container-rebuilders.ts'))).toBe(true);
	});
});

// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────────

describe('G4.20 — extractor and matcher self-tests', () => {
	// `'\\n'` in this file is the four source characters ' \ n ' — a backslash-n
	// literal, never an actual line break.
	const violating = "updateBlockContent(index, text + '\\n', preEdit)";
	const compliant = 'updateBlockContent(index, text + trailingLineEnding(node.raw), preEdit)';
	const passthrough = 'updateBlockContent(index, newRaw, preEdit)';

	it('extracts the content argument across nested calls', () => {
		expect(contentArgs(compliant)).toEqual(['text + trailingLineEnding(node.raw)']);
		expect(contentArgs('updateBlockContent(i, f(a, b) + trailingLineEnding(n.raw), o)')).toEqual([
			'f(a, b) + trailingLineEnding(n.raw)'
		]);
		expect(contentArgs(passthrough)).toEqual(['newRaw']);
	});

	it('flags a literal-newline reconstruction and passes the trailingLineEnding form', () => {
		const bad = contentArgs(violating)[0];
		expect(RECONSTRUCTS_LITERAL.test(bad)).toBe(true);
		expect(RECONSTRUCTS_COMPLIANT.test(bad)).toBe(false);

		const good = contentArgs(compliant)[0];
		expect(RECONSTRUCTS_COMPLIANT.test(good)).toBe(true);
		expect(RECONSTRUCTS_LITERAL.test(good)).toBe(false);

		expect(RECONSTRUCTS_LITERAL.test("x + '\\r\\n'")).toBe(true);
	});

	it('leaves a raw pass-through commit out of both arms', () => {
		const arg = contentArgs(passthrough)[0];
		expect(RECONSTRUCTS_LITERAL.test(arg)).toBe(false);
		expect(RECONSTRUCTS_COMPLIANT.test(arg)).toBe(false);
	});

	it('funnel scan flags a missing append, passes the compliant form, ignores non-committing bodies', () => {
		const one = (src: string) => commitInputFunnels([{ relPath: 'x', text: src, code: src }]);

		const missing = one(
			'const s = { commitInput: (text, pre) => { u.updateBlockContent(i, text, pre); } };'
		);
		expect(missing.length).toBe(1);
		expect(HAS_TRAILING_APPEND.test(missing[0].body)).toBe(false);

		const present = one(
			'const s = { commitInput: (text, pre) => { u.updateBlockContent(i, text + trailingLineEnding(node.raw), pre); } };'
		);
		expect(present.length).toBe(1);
		expect(HAS_TRAILING_APPEND.test(present[0].body)).toBe(true);

		// A commitInput that never reaches updateBlockContent is not a funnel.
		expect(one('const s = { commitInput: (text) => { return other(text); } };')).toEqual([]);
	});

	it('rebuilder scan reads the body past a destructured parameter list', () => {
		const src = 'function rebuildXRaw({ a }: P, e = t(a)): void { node.raw = a + e; }';
		const found = containerRebuilders([{ relPath: 'x', text: src, code: src }]);
		expect(found.map((fn) => fn.name)).toEqual(['rebuildXRaw']);
		expect(found[0].body).toBe('{ node.raw = a + e; }');
	});

	// Miss-analysis: the private region walk skipped strings but not regex literals, and its cases
	// only ever fed it strings, so the body it truncated at a regex brace was never read back.
	it('rebuilder scan reads the body past a brace inside a regex literal', () => {
		const src = 'function rebuildXRaw(n: P): void { node.raw = a.replace(/}/g, b) + e; }';
		const found = containerRebuilders([{ relPath: 'x', text: src, code: src }]);
		expect(found[0].body).toBe('{ node.raw = a.replace(/}/g, b) + e; }');
	});

	it('ternary matcher flags the longhand copy and passes the seam call', () => {
		// Built by concatenation so this file does not itself contain the banned shape.
		const longhand = "const e = raw.endsWith('\\r\\n')" + " ? '\\r\\n' : '\\n';";
		expect(INLINE_ENDING_TERNARY.test(longhand)).toBe(true);
		expect(INLINE_ENDING_TERNARY.test('const e = trailingLineEnding(node.raw);')).toBe(false);
		// A bare CRLF probe is a legitimate read; only the ending ternary is banned.
		expect(INLINE_ENDING_TERNARY.test("if (raw.endsWith('\\r\\n')) return raw.length - 2;")).toBe(
			false
		);
	});

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
		// The shape a long concatenation is actually formatted as — and the arm's
		// whole subject. Stopping at the first newline truncated it to `.raw =`.
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

	it('domain arm flags a literal raw write and passes a derived one', () => {
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
