/**
 * G4.60 — every spread into a call's ARGUMENT LIST in shipped source is declared. A spread hands
 * the engine one argument per element, and a list past its limit raises "Maximum call stack size
 * exceeded" at the call, stranding the operation with nothing rendered (#246). A site declares
 * either the ceiling its count can't pass, or that the count is document-scaled — never a silent
 * skip. Array-literal spread (`[...x]`) has no argument list and is out of scope.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, lexicalClasses, type SourceFile } from './scan-source';

interface Declaration {
	/** `bounded`: a named ceiling. `gap`: the count follows the document, and the call can fail. */
	mode: 'bounded' | 'gap';
	reason: string;
}

const ALLOWLIST: Record<string, Declaration> = {
	'src/lib/components/blocks/table/table-menu-model.ts :: tableMenuItems': {
		mode: 'bounded',
		reason: 'the three menu groups are literal arrays of three, five and six items'
	},
	'src/lib/components/blocks/text/live-join-seam.ts :: cleanLiveJoinSeam': {
		mode: 'bounded',
		reason: 'a Math.min over the two readings the seam offers, deduplicated to one when they agree'
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
		reason: 'one INSERT_CHUNK per call, whatever the total the mutation doors hand it'
	},
	'src/lib/undo/manager.ts :: restoreStacks': {
		mode: 'bounded',
		reason: 'MAX_UNDO caps each restored history at two hundred entries'
	}
};

// ── The scan ─────────────────────────────────────────────────────────────────

const CODE = 0;

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'with']);

interface SpreadSite {
	key: string;
	line: number;
}

/** The innermost bracket still open at `at`, or null at the top level. */
function openerBefore(text: string, cls: Uint8Array, at: number): number | null {
	let depth = 0;
	for (let i = at - 1; i >= 0; i--) {
		if (cls[i] !== CODE) continue;
		const ch = text[i];
		if (ch === ')' || ch === ']' || ch === '}') depth++;
		else if (ch === '(' || ch === '[' || ch === '{') {
			if (depth === 0) return i;
			depth--;
		}
	}
	return null;
}

function matchingOpen(text: string, cls: Uint8Array, close: number): number | null {
	let depth = 0;
	for (let i = close; i >= 0; i--) {
		if (cls[i] !== CODE) continue;
		if (text[i] === ')') depth++;
		else if (text[i] === '(' && --depth === 0) return i;
	}
	return null;
}

function matchingClose(text: string, cls: Uint8Array, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (cls[i] !== CODE) continue;
		const ch = text[i];
		if (ch === '(') depth++;
		else if (ch === ')' && --depth === 0) return i;
	}
	return text.length;
}

const skipBack = (text: string, cls: Uint8Array, from: number): number => {
	let i = from;
	while (i >= 0 && (cls[i] !== CODE || /\s/.test(text[i]))) i--;
	return i;
};

const skipForward = (text: string, cls: Uint8Array, from: number): number => {
	let i = from;
	while (i < text.length && (cls[i] !== CODE || /\s/.test(text[i]))) i++;
	return i;
};

function identifierBefore(text: string, at: number): string {
	let start = at + 1;
	while (start > 0 && /[\w$]/.test(text[start - 1])) start--;
	return text.slice(start, at + 1);
}

/**
 * A parameter list rather than an argument list. A rest parameter names one array; it never
 * grows a call. The tells are the `function` keyword before, and a body or arrow after.
 */
function isParameterList(text: string, cls: Uint8Array, open: number): boolean {
	const before = skipBack(text, cls, open - 1);
	const name = identifierBefore(text, before);
	if (name === 'function') return true;
	if (identifierBefore(text, skipBack(text, cls, before - name.length)) === 'function') return true;

	let after = skipForward(text, cls, matchingClose(text, cls, open) + 1);
	if (text[after] === ':') {
		let depth = 0;
		for (after++; after < text.length; after++) {
			if (cls[after] !== CODE) continue;
			const ch = text[after];
			if (ch === '(' || ch === '[' || ch === '<') depth++;
			else if (ch === ')' || ch === ']' || ch === '>') depth--;
			else if (depth <= 0 && (ch === '{' || ch === ';' || ch === ',' || ch === '=')) break;
		}
	}
	return text.startsWith('=>', after) || text[after] === '{';
}

/**
 * The `(` of the parameter list a `{` closes over, or null where the brace opens a plain block
 * or an object literal. Only a return type and an arrow may sit between the two.
 */
function parameterListOf(text: string, cls: Uint8Array, brace: number): number | null {
	let depth = 0;
	let between = '';
	for (let i = brace - 1; i >= 0; i--) {
		if (cls[i] !== CODE) continue;
		const ch = text[i];
		if (depth === 0) {
			if (ch === ')') {
				const gap = between.replace(/\s|=>/g, '');
				return gap === '' || gap.startsWith(':') ? matchingOpen(text, cls, i) : null;
			}
			if (ch === ';' || ch === '{' || ch === '}' || ch === '(' || ch === '[') return null;
		}
		if (ch === ')' || ch === ']' || ch === '}') depth++;
		else if (ch === '(' || ch === '[' || ch === '{') depth--;
		between = ch + between;
	}
	return null;
}

/** The `:` of a declaration's type annotation, so `const f: Cleaner = (x) => …` reads as `f`. */
function annotationColonBefore(text: string, cls: Uint8Array, assign: number): number {
	let depth = 0;
	for (let i = assign - 1; i >= 0; i--) {
		if (cls[i] !== CODE) continue;
		const ch = text[i];
		if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth++;
		else if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth--;
		else if (depth === 0 && ch === ':') return i;
		if (depth === 0 && (ch === ';' || ch === ',' || ch === '{' || ch === '}')) break;
	}
	return assign;
}

/** Back over a type-parameter list, so `function pick<T>(…)` names `pick` and not the module. */
function skipTypeParameters(text: string, cls: Uint8Array, at: number): number {
	if (text[at] !== '>') return at;
	let depth = 0;
	for (let i = at; i >= 0; i--) {
		if (cls[i] !== CODE) continue;
		if (text[i] === '>') depth++;
		else if (text[i] === '<' && --depth === 0) return skipBack(text, cls, i - 1);
	}
	return at;
}

/** The nearest enclosing named function, walking out through blocks and anonymous scopes. */
function enclosingName(text: string, cls: Uint8Array, at: number): string {
	let from = at;
	for (let hop = 0; hop < 24; hop++) {
		const open = openerBefore(text, cls, from);
		if (open === null) return '<module>';
		from = open;
		if (text[open] !== '{') continue;
		const paren = parameterListOf(text, cls, open);
		if (paren === null) continue;
		const before = skipTypeParameters(text, cls, skipBack(text, cls, paren - 1));
		const direct = identifierBefore(text, before);
		if (CONTROL_KEYWORDS.has(direct)) continue;
		if (direct !== '' && direct !== 'function') return direct;
		const anchor = direct === '' ? before : skipBack(text, cls, before - direct.length);
		if (text[anchor] !== '=' && text[anchor] !== ':') continue;
		const declared = text[anchor] === ':' ? anchor : annotationColonBefore(text, cls, anchor);
		const named = identifierBefore(text, skipBack(text, cls, declared - 1));
		if (named !== '') return named;
	}
	return '<module>';
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
		const open = openerBefore(text, cls, spread);
		if (open === null || text[open] !== '(') continue;
		if (isParameterList(text, cls, open)) continue;
		out.push({
			key: `${file.relPath} :: ${enclosingName(text, cls, open)}`,
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

	it('names the enclosing function past a return type, a declared type and a type parameter', () => {
		expect(scan('function menu(a: T): Item[] {\n\titems.push(...group());\n}\n')[0].key).toBe(
			'f.ts :: menu'
		);
		expect(scan('function pick<T>(a: T[]): void {\n\tsink(...a);\n}\n')[0].key).toBe(
			'f.ts :: pick'
		);
		expect(scan('const clean: Cleaner = (j) => {\n\tMath.min(...c);\n};\n')[0].key).toBe(
			'f.ts :: clean'
		);
		expect(scan('function outer() {\n\tfor (const x of y) {\n\t\tp(...z);\n\t}\n}\n')[0].key).toBe(
			'f.ts :: outer'
		);
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
