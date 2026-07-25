/**
 * G4.18 — settle-predicate vacuity. A `waitForSource*` predicate that is already
 * true on the document the test just loaded returns on its first poll, so it
 * synchronizes on nothing: the assertions after it race the commit, and a
 * regression in which the gesture under test silently no-ops satisfies the whole
 * chain. The 2026-07-24 review found four of these, two of which made the spec
 * written to catch a silent no-op pass under exactly that no-op.
 *
 * The rule: inside one `test()` body, a settle predicate must describe the
 * POST-operation shape — something no preceding `loadContent` document already
 * satisfies. Wait for the disappearance, or for the full expected document.
 *
 * Scope and its limits, stated so a reader knows what a green run proves:
 * - Only `loadContent(<literal>)` seeds the "already true" set; a fixture built
 *   by a helper call makes the test's document opaque, and the whole test is
 *   skipped rather than guessed at.
 * - The loaded document describes the live state only until a settle predicate
 *   that was NOT already true passes — that one observed a real transition, and
 *   everything after it is a state this scan cannot model. So checking stops at
 *   the first discriminating settle after each load. A chain whose every link is
 *   vacuous is reported whole, which is the shape that matters: the later links
 *   are vacuous *because* the first one was.
 * - `waitForSource` / `waitForSourceWith` take function predicates and are not
 *   analyzable; they are out of scope.
 * - Comment stripping is line-based (a whole line that starts with `//`), not
 *   general: spec fixtures carry markdown links, and `https://` inside a string
 *   would make a generic `//` scan blank the rest of the line.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SPEC_DIR = path.resolve('src/lib/e2e/tests');

// ── Source model ────────────────────────────────────────────────────────

interface SettleSite {
	spec: string;
	test: string;
	call: string;
	argument: string;
}

/** Whole-line comments only — see the header for why a general strip is wrong here. */
function stripCommentLines(text: string): string {
	return text
		.split('\n')
		.map((line) => {
			const trimmed = line.trimStart();
			const isComment =
				trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
			return isComment ? '' : line;
		})
		.join('\n');
}

/** Read a JS string or template literal at `i`. Interpolation makes it opaque. */
function readStringLiteral(text: string, i: number): { value: string; end: number } | null {
	const quote = text[i];
	if (quote !== "'" && quote !== '"' && quote !== '`') return null;
	let value = '';
	let j = i + 1;
	while (j < text.length) {
		const ch = text[j];
		if (ch === '\\') {
			const next = text[j + 1];
			const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r' };
			value += escapes[next] ?? next;
			j += 2;
			continue;
		}
		if (ch === quote) return { value, end: j + 1 };
		if (quote === '`' && ch === '$' && text[j + 1] === '{') return null;
		value += ch;
		j++;
	}
	return null;
}

/** Read a regex literal at `i`, returning the live RegExp. */
function readRegexLiteral(text: string, i: number): { value: RegExp; end: number } | null {
	if (text[i] !== '/') return null;
	let source = '';
	let j = i + 1;
	let inClass = false;
	while (j < text.length) {
		const ch = text[j];
		if (ch === '\\') {
			source += ch + text[j + 1];
			j += 2;
			continue;
		}
		if (ch === '\n') return null;
		if (ch === '[') inClass = true;
		else if (ch === ']') inClass = false;
		else if (ch === '/' && !inClass) {
			let flags = '';
			let k = j + 1;
			while (k < text.length && /[a-z]/.test(text[k])) flags += text[k++];
			try {
				return { value: new RegExp(source, flags), end: k };
			} catch {
				return null;
			}
		}
		source += ch;
		j++;
	}
	return null;
}

/**
 * Module-level `const NAME = '<literal>';` bindings, so fixtures named once resolve.
 * A concatenated fixture (`'row\n' + 'row\n'`) is skipped rather than truncated to
 * its first segment: a partial value would clear predicates that a later segment
 * satisfies, under-reporting the very thing this scan exists to find.
 */
function collectStringConstants(code: string): Map<string, string> {
	const constants = new Map<string, string>();
	const declaration = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
	let match: RegExpExecArray | null;
	while ((match = declaration.exec(code)) !== null) {
		const literal = readStringLiteral(code, match.index + match[0].length);
		if (literal && !isConcatenated(code, literal.end)) constants.set(match[1], literal.value);
	}
	return constants;
}

/** Whether a `+` follows the literal that just ended at `end`. */
function isConcatenated(code: string, end: number): boolean {
	let i = end;
	while (i < code.length && /\s/.test(code[i])) i++;
	return code[i] === '+';
}

/**
 * Resolve a call's first argument to a string, a regex, or `undefined` when it is
 * an expression this scan cannot evaluate.
 */
function readArgument(
	code: string,
	openParen: number,
	constants: Map<string, string>
): { text: string; string?: string; regex?: RegExp } | undefined {
	let i = openParen + 1;
	while (i < code.length && /\s/.test(code[i])) i++;
	const asString = readStringLiteral(code, i);
	if (asString) {
		if (isConcatenated(code, asString.end)) return undefined;
		return { text: JSON.stringify(asString.value), string: asString.value };
	}
	const asRegex = readRegexLiteral(code, i);
	if (asRegex) return { text: String(asRegex.value), regex: asRegex.value };
	const identifier = /^[A-Za-z_$][\w$]*/.exec(code.slice(i));
	if (identifier && constants.has(identifier[0])) {
		return { text: identifier[0], string: constants.get(identifier[0]) };
	}
	return undefined;
}

/**
 * Split a spec into `test()` / `beforeEach()` segments. A segment runs to the next
 * declaration, which is what "earlier in the same test body" means for this scan;
 * the most recent preceding `beforeEach` contributes its loads as ambient.
 */
interface Segment {
	kind: 'test' | 'beforeEach';
	name: string;
	start: number;
	end: number;
}

function splitSegments(code: string): Segment[] {
	const declaration = /(?:^|[\s.;{}])(test|test\.skip|beforeEach|test\.beforeEach)\s*\(/g;
	const found: { kind: 'test' | 'beforeEach'; name: string; start: number }[] = [];
	let match: RegExpExecArray | null;
	while ((match = declaration.exec(code)) !== null) {
		const openParen = declaration.lastIndex - 1;
		const kind = match[1].includes('beforeEach') ? 'beforeEach' : 'test';
		const argument = readArgument(code, openParen, new Map());
		found.push({ kind, name: argument?.string ?? '(unnamed)', start: openParen });
	}
	return found.map((segment, index) => ({
		...segment,
		end: index + 1 < found.length ? found[index + 1].start : code.length
	}));
}

const SETTLE_CALLS = [
	'waitForSourceContains',
	'waitForSourceNotContains',
	'waitForSourceMatches',
	'waitForSourceEquals'
] as const;

// Settles this scan cannot evaluate but which still mark a transition: after one,
// the loaded document no longer describes the live state.
const OPAQUE_SETTLES = [
	'waitForSourceWith',
	'waitForSource',
	'waitForBlockCount',
	'waitForBlockHostCount',
	'waitForListItemCount',
	'waitForCrossBlock'
] as const;

/**
 * A predicate is vacuous when a document loaded earlier in the same test already
 * satisfies it. `NotContains` inverts: it is vacuous when NO loaded document ever
 * carried the forbidden text, so its disappearance was never observable.
 */
export function isVacuous(
	call: string,
	argument: { string?: string; regex?: RegExp },
	loaded: string[]
): boolean {
	if (loaded.length === 0) return false;
	switch (call) {
		case 'waitForSourceContains':
			return argument.string !== undefined && loaded.some((doc) => doc.includes(argument.string!));
		case 'waitForSourceNotContains':
			return argument.string !== undefined && !loaded.some((doc) => doc.includes(argument.string!));
		case 'waitForSourceMatches':
			return argument.regex !== undefined && loaded.some((doc) => argument.regex!.test(doc));
		case 'waitForSourceEquals':
			return (
				argument.string !== undefined &&
				loaded.some((doc) => doc.replace(/\s+$/, '') === argument.string!.replace(/\s+$/, ''))
			);
		default:
			return false;
	}
}

function specPaths(): string[] {
	const found: string[] = [];
	function walk(dir: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.spec.ts')) found.push(full);
		}
	}
	walk(SPEC_DIR);
	return found.sort();
}

/** Every settle site in the tree, partitioned into vacuous and discriminating. */
function scanSettleSites(): { vacuous: SettleSite[]; total: number } {
	const vacuous: SettleSite[] = [];
	let total = 0;
	const repoRoot = path.resolve('.');

	for (const file of specPaths()) {
		const code = stripCommentLines(readFileSync(file, 'utf8'));
		const spec = path.relative(repoRoot, file).split(path.sep).join('/');
		const constants = collectStringConstants(code);
		const segments = splitSegments(code);
		let ambient: string[] | null = [];

		for (const segment of segments) {
			const body = code.slice(segment.start, segment.end);
			// A load whose argument this scan can't evaluate makes the document
			// unknown; guessing would manufacture false positives, so the segment
			// opts out entirely.
			let loaded: string[] | null = segment.kind === 'test' ? [...(ambient ?? [])] : [];
			if (segment.kind === 'test' && ambient === null) loaded = null;

			const events: { index: number; kind: 'load' | 'settle' | 'opaque'; call: string }[] = [];
			const calls = new RegExp(
				`(loadContent|${SETTLE_CALLS.join('|')}|${OPAQUE_SETTLES.join('|')})\\s*\\(`,
				'g'
			);
			let match: RegExpExecArray | null;
			while ((match = calls.exec(body)) !== null) {
				const call = match[1];
				const kind =
					call === 'loadContent'
						? 'load'
						: (SETTLE_CALLS as readonly string[]).includes(call)
							? 'settle'
							: 'opaque';
				events.push({ index: calls.lastIndex - 1, kind, call });
			}

			let stateIsKnown = true;
			for (const event of events) {
				// A settle this scan cannot evaluate (a function predicate, a DOM-count or
				// cross-block wait) still observed a transition, so the loaded document
				// stops describing the live state from there on.
				if (event.kind === 'opaque') {
					stateIsKnown = false;
					continue;
				}
				const argument = readArgument(body, event.index, constants);
				if (event.kind === 'load') {
					// A load REPLACES the document; unioning would let a stale fixture clear
					// a predicate that discriminates against the live one.
					loaded = argument?.string === undefined ? null : [argument.string];
					stateIsKnown = true;
					continue;
				}
				total++;
				if (loaded === null || argument === undefined || !stateIsKnown) continue;
				if (isVacuous(event.call, argument, loaded)) {
					vacuous.push({ spec, test: segment.name, call: event.call, argument: argument.text });
				} else {
					stateIsKnown = false;
				}
			}

			if (segment.kind === 'beforeEach') ambient = loaded;
		}
	}
	return { vacuous, total };
}

// ── The gate ────────────────────────────────────────────────────────────

describe('G4.18 settle-predicate vacuity', () => {
	const { vacuous, total } = scanSettleSites();

	// Non-vacuity: the scan proves something only if it actually resolved sites.
	it('resolved settle predicates to analyze', () => {
		expect(total).toBeGreaterThan(100);
	});

	it('no settle predicate is already true on the document its test loaded', () => {
		const report = vacuous
			.map((site) => `${site.spec}\n    ${site.test}\n    ${site.call}(${site.argument})`)
			.join('\n');
		expect(
			vacuous,
			`settle predicates that return on the first poll (they synchronize on nothing, so the assertions after them race the commit and a silent no-op passes):\n${report}`
		).toEqual([]);
	});
});

describe('G4.18 settle-predicate vacuity — classifier self-tests', () => {
	const table = '| A | B | C | D |\n| --- | --- | --- | --- |\n';

	it('flags a substring of the loaded document and clears the post-op shape', () => {
		expect(isVacuous('waitForSourceContains', { string: '| B | C | D |' }, [table])).toBe(true);
		expect(isVacuous('waitForSourceContains', { string: '| B |  | C |' }, [table])).toBe(false);
	});

	it('inverts for NotContains — vacuous when the text was never present', () => {
		expect(isVacuous('waitForSourceNotContains', { string: '| A |' }, [table])).toBe(false);
		expect(isVacuous('waitForSourceNotContains', { string: '| Z |' }, [table])).toBe(true);
	});

	it('evaluates regex predicates against the loaded document', () => {
		expect(isVacuous('waitForSourceMatches', { regex: /^\| A \| B/m }, [table])).toBe(true);
		expect(isVacuous('waitForSourceMatches', { regex: /^- first$/m }, [table])).toBe(false);
	});

	it('compares waitForSourceEquals on trailing-whitespace-normalized forms', () => {
		expect(isVacuous('waitForSourceEquals', { string: table }, [table + '\n'])).toBe(true);
		expect(isVacuous('waitForSourceEquals', { string: '| A |\n' }, [table])).toBe(false);
	});

	it('reports nothing when the test loaded no analyzable document', () => {
		expect(isVacuous('waitForSourceContains', { string: 'anything' }, [])).toBe(false);
	});
});
