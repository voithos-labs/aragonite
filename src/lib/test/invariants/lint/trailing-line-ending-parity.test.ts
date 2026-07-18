/**
 * G4.20 — trailing-line-ending reconstruction parity across keystroke-commit
 * sites (`docs/contributing/culture.md` § The bug shape to fear). A keystroke-commit
 * site reads a block's edited text back — from the DOM, or from a
 * `trimTrailingLineEnding(node.raw)` view of it — stripping the block's trailing
 * line ending in the process, then commits the result via `updateBlockContent`. It
 * must reconstruct that ending as `trailingLineEnding(<node>.raw)`, never a bare
 * newline string literal: a literal downgrades a CRLF block's trailing bytes to LF
 * and breaks `serialize(parse(source)) === source`.
 *
 * Why a lint and not a seam: a normalize inside `updateBlockContent` would be wrong.
 * A block at EOF may legitimately lack a trailing newline, and structural/paste
 * callers pass already-raw-shaped text that must not be rewritten — so reconstructing
 * the ending is deliberately a call-site responsibility, and the parity rule is the
 * correct rung.
 *
 * Two arms, because a site can drop the ending two ways:
 *  - Wrong reconstruction — a content argument appends a string-literal newline
 *    instead of `trailingLineEnding(...)`. Caught structurally at the call site.
 *    The scan reads the content argument's TAIL only, so a newline hoisted into a
 *    variable first (`const c = x + '\n'; updateBlockContent(i, c)`) slips past
 *    this arm — Arm 2 still covers any such hoist inside a `commitInput` funnel.
 *    Mid-content newline literals (e.g. electric-indent splicing a new inner line)
 *    are out of scope by design: only the reconstructed trailing ending is at issue.
 *  - Missing reconstruction — a new editable surface whose `commitInput` funnel omits
 *    the append entirely. Caught by requiring every `commitInput` that reaches
 *    `updateBlockContent` to carry `trailingLineEnding(`; a GFM table cell holds no
 *    raw newline, so it is the one allowlisted funnel that appends nothing.
 *
 * The scan excludes `test/`, so this file's own synthetic examples aren't inspected.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, type SourceFile } from './scan-source';

// ── Source extraction ────────────────────────────────────────────────────────

/** From the bracket at `openIdx`, the balanced `(...)`/`{...}` region; strings skipped. */
function balancedRegion(code: string, openIdx: number): string {
	const open = code[openIdx];
	const close = open === '(' ? ')' : '}';
	let depth = 0;
	let quote: string | null = null;
	for (let i = openIdx; i < code.length; i++) {
		const c = code[i];
		if (quote) {
			if (c === '\\') i++;
			else if (c === quote) quote = null;
			continue;
		}
		if (c === "'" || c === '"' || c === '`') quote = c;
		else if (c === open) depth++;
		else if (c === close && --depth === 0) return code.slice(openIdx, i + 1);
	}
	return code.slice(openIdx);
}

/** Split a call's argument list (no surrounding parens) on top-level commas. */
function splitTopLevelArgs(argList: string): string[] {
	const args: string[] = [];
	let depth = 0;
	let quote: string | null = null;
	let cur = '';
	for (let i = 0; i < argList.length; i++) {
		const c = argList[i];
		if (quote) {
			cur += c;
			if (c === '\\') cur += argList[++i] ?? '';
			else if (c === quote) quote = null;
			continue;
		}
		if (c === "'" || c === '"' || c === '`') quote = c;
		else if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') depth--;
		if (c === ',' && depth === 0) {
			args.push(cur);
			cur = '';
			continue;
		}
		cur += c;
	}
	if (cur.trim().length > 0) args.push(cur);
	return args.map((a) => a.trim());
}

/** The content (2nd) argument of every `updateBlockContent(` call in `code`. */
function contentArgs(code: string): string[] {
	const out: string[] = [];
	const re = /updateBlockContent\s*\(/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(code)) !== null) {
		const region = balancedRegion(code, code.indexOf('(', m.index));
		const args = splitTopLevelArgs(region.slice(1, -1));
		if (args.length >= 2) out.push(args[1]);
	}
	return out;
}

interface CommitFunnel {
	relPath: string;
	body: string;
}

/** Every `commitInput: (…) => { … }` body that reaches `updateBlockContent`. */
function commitInputFunnels(sources: SourceFile[]): CommitFunnel[] {
	const out: CommitFunnel[] = [];
	for (const f of sources) {
		const re = /commitInput\s*:\s*\([^)]*\)\s*=>\s*{/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(f.code)) !== null) {
			const body = balancedRegion(f.code, f.code.indexOf('{', m.index));
			if (/\bupdateBlockContent\s*\(/.test(body)) out.push({ relPath: f.relPath, body });
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

/** Funnels that legitimately append nothing, with the reason each is exempt. */
const COMMITINPUT_ALLOWLIST: Record<string, string> = {
	'src/lib/components/blocks/table/TableCellBlock.svelte':
		'a GFM table cell holds no raw newline; commitInput commits the escaped cell text as-is'
};

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

		expect(RECONSTRUCTS_LITERAL.test("x + '\\r\\n'")).toBe(true); // CRLF literal also caught
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
});
