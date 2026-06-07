/**
 * G4.1 — `createBlockListState` must be fed a live getter/closure, never a
 * by-value node. A by-value argument snapshots the node at factory-call time
 * and misses undo's deep-clone reassignment (see editor.md § Reactive State
 * Plumbing). Scans every editor source call site.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments } from './scan-source';

interface ByValueCall {
	relPath: string;
	argument: string;
}

/**
 * Flag `createBlockListState(<arg>)` calls whose first argument is a bare
 * identifier rather than a getter/closure. Skips the declaration
 * (`function createBlockListState`) — only call sites count.
 */
function findByValueCalls(relPath: string, rawText: string): ByValueCall[] {
	const code = stripComments(rawText);
	const hits: ByValueCall[] = [];
	const callRe = /createBlockListState\s*\(/g;
	let m: RegExpExecArray | null;
	while ((m = callRe.exec(code)) !== null) {
		const before = code.slice(Math.max(0, m.index - 12), m.index);
		if (/function\s+$/.test(before)) continue;

		const argument = firstArgument(code, m.index + m[0].length);
		if (argument === null) continue;
		if (!isGetterOrClosure(argument)) {
			hits.push({ relPath, argument });
		}
	}
	return hits;
}

function firstArgument(code: string, openParenIndex: number): string | null {
	let depth = 1;
	let i = openParenIndex;
	while (i < code.length) {
		const ch = code[i];
		if (ch === '(') depth++;
		else if (ch === ')') {
			depth--;
			if (depth === 0) break;
		} else if (ch === ',' && depth === 1) break;
		i++;
	}
	return code.slice(openParenIndex, i).trim() || null;
}

function isGetterOrClosure(arg: string): boolean {
	return arg.includes('=>') || /\bget\b/.test(arg) || arg.startsWith('{');
}

describe('G4.1 createBlockListState getters-only source-scan', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('found at least one createBlockListState call site to validate', () => {
		const callSites = sources.filter((f) => /createBlockListState\s*\(/.test(f.code));
		expect(callSites.length).toBeGreaterThan(0);
	});

	it('every call site passes a getter/closure, never a by-value node', () => {
		const violations = sources.flatMap((f) => findByValueCalls(f.relPath, f.text));
		expect(violations).toEqual([]);
	});

	// ── Matcher self-test (non-vacuity) ─────────────────────────────────────

	it('matcher flags a by-value call', () => {
		const bad = 'const s = createBlockListState(node);';
		expect(findByValueCalls('synthetic.ts', bad)).toEqual([
			{ relPath: 'synthetic.ts', argument: 'node' }
		]);
	});

	it('matcher accepts inline closure and getter-property forms', () => {
		const good = 'createBlockListState(() => node)\ncreateBlockListState({ get node() { return n; } })';
		expect(findByValueCalls('synthetic.ts', good)).toEqual([]);
	});

	// A bare identifier is rejected even when it names a getter function: the
	// scan sees only the call shape, so the inline-closure form is required to
	// keep the guard decidable. All production call sites use `() => node`.
	it('matcher flags a bare identifier even if it could be a function', () => {
		const ambiguous = 'createBlockListState(getNode)';
		expect(findByValueCalls('synthetic.ts', ambiguous)).toEqual([
			{ relPath: 'synthetic.ts', argument: 'getNode' }
		]);
	});

	it('matcher ignores the declaration and import lines', () => {
		const decl =
			"import { createBlockListState } from './x';\n" +
			'export function createBlockListState(getNode: () => CstNode) {}';
		expect(findByValueCalls('synthetic.ts', decl)).toEqual([]);
	});

	it('matcher ignores tokens inside comments', () => {
		const commented = '// createBlockListState(node) would be wrong\nconst x = 1;';
		expect(findByValueCalls('synthetic.ts', commented)).toEqual([]);
	});
});
