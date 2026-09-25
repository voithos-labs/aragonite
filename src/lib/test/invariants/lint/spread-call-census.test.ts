/**
 * G4.60, every spread into a call's argument list in shipped source is declared. A spread passes
 * one argument per element, and a list past the engine's limit throws "Maximum call stack size
 * exceeded" at the call, leaving the operation half done. A site declares either the ceiling its
 * count can't pass, or that the count grows with the document. Array-literal spread (`[...x]`)
 * has no argument list and is out of scope.
 */

import { describe, it, expect } from 'vitest';
import {
	collectEditorSources,
	enclosingFunction,
	isParameterList,
	LEXICAL_CLASSES,
	lexicalClasses,
	openerBefore,
	type SourceFile
} from './scan-source';

interface Declaration {
	/** `bounded`: a named ceiling. `gap`: the count follows the document, and the call can fail. */
	mode: 'bounded' | 'gap';
	reason: string;
}

const ALLOWLIST: Record<string, Declaration> = {
	'src/lib/components/blocks/text/live-join-seam.ts :: cleanLiveJoinSeam': {
		mode: 'bounded',
		reason: 'a Math.min over the two readings the join offers, deduplicated to one when they agree'
	},
	'src/lib/decorations/island-dom.ts :: applyReplace': {
		mode: 'bounded',
		reason: 'the tokens of one decoration’s own class attribute; no document axis scales it'
	},
	'src/lib/editor-actions/commit/undo-controller.ts :: mutate': {
		mode: 'bounded',
		reason:
			'one reclassification per ancestor container, and the parser folds nesting past MAX_NESTING_DEPTH into paragraph content'
	},
	'src/lib/selection/range-delete-ceremony.ts :: collectDeletionPlan': {
		mode: 'bounded',
		reason: 'the range’s own endpoints: every caller passes zero to two paths'
	},
	'src/lib/tree-operations/node-ops.ts :: splitNode': {
		mode: 'bounded',
		reason: 'one block’s split reparsed: each half is a block, and a first half past one warns'
	},
	'src/lib/tree-operations/node-ops.ts :: mergeWithNext': {
		mode: 'bounded',
		reason: 'the merged node alone; assertSingleNodeSink pins the array at length one'
	},
	'src/lib/tree-operations/paste/body-write.ts :: normalizeReplacementForBody': {
		mode: 'bounded',
		reason: 'one pasted node’s own reparse, appended per node rather than per replacement'
	},
	'src/lib/tree-operations/splice-many.ts :: spliceMany': {
		mode: 'bounded',
		reason: 'one INSERT_CHUNK per call, whatever the total the mutation entry points hand it'
	},
	'src/lib/undo/manager.ts :: restoreStacks': {
		mode: 'bounded',
		reason: 'MAX_UNDO caps each restored history at two hundred entries'
	}
};

// ── The scan ─────────────────────────────────────────────────────────────────

const CODE = LEXICAL_CLASSES.indexOf('code');

interface SpreadSite {
	key: string;
	line: number;
}

function spreadSites(file: SourceFile): SpreadSite[] {
	const { text } = file;
	const cls = lexicalClasses(text);
	const out: SpreadSite[] = [];
	for (let i = 0; i + 2 < text.length; i++) {
		if (!text.startsWith('...', i)) continue;
		if (cls[i] !== CODE || cls[i + 1] !== CODE || cls[i + 2] !== CODE) continue;
		const spread = i;
		i += 2;
		const open = openerBefore(text, spread, cls);
		if (open === null || text[open] !== '(') continue;
		if (isParameterList(text, open, cls)) continue;
		out.push({
			key: `${file.relPath} :: ${enclosingFunction(text, open, cls)}`,
			line: text.slice(0, spread).split('\n').length
		});
	}
	return out;
}

/** Both directions at once: sites nobody declared, and declarations nothing backs. */
function censusDiff(
	sites: SpreadSite[],
	allowlist: Record<string, Declaration>
): { undeclared: string[]; stale: string[] } {
	const found = new Map<string, number>();
	for (const site of sites) if (!found.has(site.key)) found.set(site.key, site.line);
	return {
		undeclared: [...found]
			.filter(([key]) => !(key in allowlist))
			.map(([key, line]) => `${key} (line ${line})`),
		stale: Object.keys(allowlist).filter((key) => !found.has(key))
	};
}

// ── The census ───────────────────────────────────────────────────────────────

describe('G4.60 spread-into-call census', () => {
	const sites = collectEditorSources().flatMap(spreadSites);

	it('inspected the shipped tree', () => {
		expect(sites.length).toBeGreaterThan(10);
	});

	it('every spread into an argument list is declared with its reason', () => {
		const { undeclared, stale } = censusDiff(sites, ALLOWLIST);
		expect(
			undeclared,
			'a spread hands the engine one argument per element, and a document-scaled count ' +
				'raises "Maximum call stack size exceeded": append in a loop, or declare the bound'
		).toEqual([]);
		expect(stale, 'a declared site that no longer spreads: drop the row').toEqual([]);
	});

	it('every declaration carries a reason', () => {
		expect(Object.entries(ALLOWLIST).filter(([, d]) => d.reason.trim() === '')).toEqual([]);
	});
});

// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────────

describe('G4.60 scan self-tests', () => {
	const scan = (code: string) => spreadSites({ relPath: 'f.ts', text: code, code });

	it('finds a spread in a call, and reads past an array-literal spread', () => {
		expect(scan('const f = () => {\n\ttarget.push(...items);\n};\n')).toEqual([
			{ key: 'f.ts :: f', line: 2 }
		]);
		expect(scan('const merged = [...a, ...b];\n')).toEqual([]);
		expect(scan('const merged = { ...a };\n')).toEqual([]);
	});

	it('reads no spread out of a string, a template or a regex', () => {
		expect(scan('log("push(...items)");\n')).toEqual([]);
		expect(scan('log(`push(...items)`);\n')).toEqual([]);
		expect(scan('const ellipsis = /f\\(\\.\\.\\.x\\)/;\n')).toEqual([]);
	});

	it('reads a rest parameter as a declaration, wherever it sits in the list', () => {
		expect(scan('export function removeAll(...removers: (() => void)[]): () => void {}\n')).toEqual(
			[]
		);
		expect(scan('const api = { moveFocus: (...args: unknown[]) => {} };\n')).toEqual([]);
		expect(scan('function appendAll(at: number, ...items: Node[]): void {}\n')).toEqual([]);
	});

	it('reds on an undeclared site, and on a declaration nothing backs', () => {
		const site = { key: 'src/lib/x.ts :: writeAll', line: 12 };
		const declared = { mode: 'bounded' as const, reason: 'two endpoints' };
		expect(censusDiff([site], {}).undeclared).toEqual(['src/lib/x.ts :: writeAll (line 12)']);
		expect(censusDiff([site], { [site.key]: declared }).undeclared).toEqual([]);
		expect(censusDiff([], { 'src/lib/gone.ts :: dropped': declared }).stale).toEqual([
			'src/lib/gone.ts :: dropped'
		]);
	});
});
