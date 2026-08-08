/**
 * Sibling-path parity for the split seam's presentation mode, the twin of the two grammar
 * threads: `splitNode` rebalances a construct's bytes only in live mode, so a caller that
 * answers `undefined` silently ships byte-literal splits with delimiters on screen. Every
 * crossing is required-nullable, so the type already stops an omission; what it cannot stop is
 * a caller answering `undefined` because threading was inconvenient. Exempt: the published
 * container-conformance kit, which is headless and has no mode to source.
 */

import { describe, it, expect } from 'vitest';
import { balancedCall, collectEditorSources, lastArgument, stripComments } from './scan-source';

const CONFORMANCE_KIT = 'src/lib/testing/container-conformance.ts';

/** Split sinks, by the names their callers import them under. */
const SPLIT_CALLS = ['splitNode', 'performSplit'] as const;

/** Bundle factories whose deps object carries the mode down to those sinks. */
const MODE_BEARING_FACTORIES = ['createStandardNestedActions', 'createListContext'] as const;

interface ModelessCall {
	relPath: string;
	call: string;
}

/** Split calls whose trailing mode argument is the literal `undefined`. */
function findModelessSplits(relPath: string, rawText: string): ModelessCall[] {
	const code = stripComments(rawText);
	const hits: ModelessCall[] = [];
	for (const sink of SPLIT_CALLS) {
		const callRe = new RegExp(`(?<![\\w.])${sink}\\s*\\(`, 'g');
		let m: RegExpExecArray | null;
		while ((m = callRe.exec(code)) !== null) {
			if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
			const call = balancedCall(code, m.index + m[0].length);
			if (call === null) continue;
			if (lastArgument(call) === 'undefined') hits.push({ relPath, call });
		}
	}
	return hits;
}

/** Factory calls that omit `getPresentationMode` or answer it with the literal `undefined`. */
function findModelessBundles(relPath: string, rawText: string): ModelessCall[] {
	const code = stripComments(rawText);
	const hits: ModelessCall[] = [];
	for (const factory of MODE_BEARING_FACTORIES) {
		const callRe = new RegExp(`(?<![\\w.])${factory}\\s*\\(`, 'g');
		let m: RegExpExecArray | null;
		while ((m = callRe.exec(code)) !== null) {
			if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
			const call = balancedCall(code, m.index + m[0].length);
			if (call === null) continue;
			if (!/\bgetPresentationMode\s*[,:}]/.test(call)) hits.push({ relPath, call });
			else if (/\bgetPresentationMode\s*:\s*undefined\b/.test(call)) hits.push({ relPath, call });
		}
	}
	return hits;
}

describe('live-split mode-thread source-scan', () => {
	const sources = collectEditorSources().filter((f) => f.relPath !== CONFORMANCE_KIT);

	it('found the split sinks and the bundle factories to validate', () => {
		const splitSites = sources.filter((f) =>
			SPLIT_CALLS.some((sink) => new RegExp(`(?<![\\w.])${sink}\\s*\\(`).test(f.code))
		);
		const bundleSites = sources.filter((f) =>
			MODE_BEARING_FACTORIES.some((factory) => new RegExp(`${factory}\\s*\\(`).test(f.code))
		);
		// The shared block-edit core, the list mid-item split, and the declaration.
		expect(splitSites.length).toBeGreaterThan(2);
		// Four built-in containers, the plugin container factory, the list context, declarations.
		expect(bundleSites.length).toBeGreaterThan(5);
	});

	it('every split sink is told which mode the bytes are being cut in', () => {
		expect(sources.flatMap((f) => findModelessSplits(f.relPath, f.text))).toEqual([]);
	});

	it('every mode-bearing bundle threads a real getter', () => {
		expect(sources.flatMap((f) => findModelessBundles(f.relPath, f.text))).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matcher flags a split that answers undefined', () => {
		const bad = 'splitNode(parent, i, offset, undefined);';
		expect(findModelessSplits('synthetic.ts', bad)).toEqual([
			{ relPath: 'synthetic.ts', call: 'parent, i, offset, undefined' }
		]);
	});

	it('matcher accepts a threaded mode, including a nested call expression', () => {
		const good =
			'splitNode(parent, i, offset, mode);\nperformSplit(p, i, o, deps.getPresentationMode?.());';
		expect(findModelessSplits('synthetic.ts', good)).toEqual([]);
	});

	it('matcher ignores the declaration and tokens in comments', () => {
		const decl =
			'export function splitNode(parent, blockIndex, offset, presentationMode) {}\n' +
			'// performSplit(p, i, o, undefined) would be wrong';
		expect(findModelessSplits('synthetic.ts', decl)).toEqual([]);
	});

	it('matcher flags a bundle that omits the getter and one that nulls it', () => {
		const omitted = 'createStandardNestedActions(state, { scope, stickyColumn, parent });';
		const nulled = 'createListContext({ scope, controller, getPresentationMode: undefined });';
		expect(findModelessBundles('synthetic.ts', omitted)).toHaveLength(1);
		expect(findModelessBundles('synthetic.ts', nulled)).toHaveLength(1);
	});

	it('matcher accepts a bundle threading the getter by shorthand or by key', () => {
		const good =
			'createStandardNestedActions(state, { scope, getPresentationMode, parent });\n' +
			'createListContext({ scope, getPresentationMode: policies.presentationMode });';
		expect(findModelessBundles('synthetic.ts', good)).toEqual([]);
	});
});
