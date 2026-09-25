/**
 * G4.22: inside one `test()` body, a settle predicate must describe the state after the
 * operation, something no `loadContent` document earlier in that body already satisfies. A
 * predicate already true returns on its first poll and waits for nothing, so a gesture that
 * silently does nothing passes it. A green run proves less than it looks: only a literal
 * `loadContent` argument counts, checking stops at the first predicate that could tell the
 * two states apart, and function predicates are out of scope.
 */
import { describe, it, expect } from 'vitest';
import {
	collectFiles,
	regexLiteralAt,
	readSource,
	stringLiteralAt
} from '../../test/invariants/lint/scan-source';

const SPEC_DIR = 'src/lib/e2e/tests';

// ── Source model ────────────────────────────────────────────────────────

interface SettleSite {
	spec: string;
	test: string;
	call: string;
	argument: string;
}

/**
 * A fixture built by concatenation is skipped rather than cut down to its first piece: a
 * partial value would clear predicates a later piece satisfies, under-reporting the very
 * thing this scan exists to find.
 */
function collectStringConstants(code: string): Map<string, string> {
	const constants = new Map<string, string>();
	const declaration = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
	let match: RegExpExecArray | null;
	while ((match = declaration.exec(code)) !== null) {
		const literal = stringLiteralAt(code, match.index + match[0].length);
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

/** `undefined` means an expression this scan cannot evaluate, not an absent argument. */
function readArgument(
	code: string,
	openParen: number,
	constants: Map<string, string>
): { text: string; string?: string; regex?: RegExp } | undefined {
	let i = openParen + 1;
	while (i < code.length && /\s/.test(code[i])) i++;
	const asString = stringLiteralAt(code, i);
	if (asString) {
		if (isConcatenated(code, asString.end)) return undefined;
		return { text: JSON.stringify(asString.value), string: asString.value };
	}
	const asRegex = regexLiteralAt(code, i);
	if (asRegex) return { text: String(asRegex.value), regex: asRegex.value };
	const identifier = /^[A-Za-z_$][\w$]*/.exec(code.slice(i));
	if (identifier && constants.has(identifier[0])) {
		return { text: identifier[0], string: constants.get(identifier[0]) };
	}
	return undefined;
}

/**
 * A segment runs to the next declaration, which is what "earlier in the same test body" means
 * here; the nearest `beforeEach` above it contributes its loads too.
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

// Waits this scan cannot evaluate but which still mark a change: after one, the loaded
// document no longer describes the live state.
const OPAQUE_SETTLES = [
	'waitForSourceWith',
	'waitForSource',
	'waitForBlockCount',
	'waitForBlockHostCount',
	'waitForListItemCount',
	'waitForCrossBlock'
] as const;

/**
 * `NotContains` reads the other way round: it waits for nothing when no loaded document ever
 * held the forbidden text, so its disappearance could never be seen.
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

/** Every settle call in the tree, split into the ones that wait for nothing and the rest. */
function scanSettleSites(): { vacuous: SettleSite[]; total: number } {
	const vacuous: SettleSite[] = [];
	let total = 0;
	for (const spec of collectFiles(SPEC_DIR, { extensions: ['.spec.ts'] })) {
		const { code } = readSource(spec);
		const constants = collectStringConstants(code);
		const segments = splitSegments(code);
		let ambient: string[] | null = [];

		for (const segment of segments) {
			const body = code.slice(segment.start, segment.end);
			// A load whose argument this scan cannot evaluate leaves the document unknown,
			// and guessing would report predicates that are fine, so the segment opts out.
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
				// A wait this scan cannot evaluate (a function predicate, a DOM-count or
				// cross-block wait) still saw a change, so the loaded document stops
				// describing the live state from there on.
				if (event.kind === 'opaque') {
					stateIsKnown = false;
					continue;
				}
				const argument = readArgument(body, event.index, constants);
				if (event.kind === 'load') {
					// A load replaces the document; keeping the old one too would let a stale
					// fixture clear a predicate that the live document would not.
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

describe('G4.22 settle-predicate vacuity', () => {
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

describe('G4.22 settle-predicate vacuity: classifier self-tests', () => {
	const table = '| A | B | C | D |\n| --- | --- | --- | --- |\n';

	it('flags a substring of the loaded document and clears the post-op shape', () => {
		expect(isVacuous('waitForSourceContains', { string: '| B | C | D |' }, [table])).toBe(true);
		expect(isVacuous('waitForSourceContains', { string: '| B |  | C |' }, [table])).toBe(false);
	});

	it('inverts for NotContains: vacuous when the text was never present', () => {
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
