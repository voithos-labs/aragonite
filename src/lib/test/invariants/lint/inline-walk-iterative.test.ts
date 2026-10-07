/**
 * Every traversal over an inline tree or its rendered DOM is iterative (G4.56): inline nesting
 * depth comes from the input, so one call frame per level overflows the stack and strands the
 * block in a fallback it cannot recover from. The scan covers `core/inline/`, `cursor/`, `ambient/`
 * and the live gesture code in `components/blocks/text/`, whose join rebuild walks the same way.
 */

import { describe, it, expect } from 'vitest';
import {
	balancedBlock,
	balancedCall,
	callsAnywhere,
	collectEditorSources,
	EDITOR_SRC,
	walkCode
} from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';

/** Library-internal: the rule binds traversals over aragonite's own tree, which no plugin owns. */
const SCOPE = [SOURCE_DIR.inline, SOURCE_DIR.cursor, SOURCE_DIR.ambient, SOURCE_DIR.textBlock];

/** Keyed by `path :: name`, one traversal each, so a file spelling two walkers alike fails below.
 *  Empty by design: a recursive walk overflows on a deep enough document, so an entry says why. */
const EXCEPTIONS: Record<string, string> = {};

const TOUCHES_CHILDREN = /\.(children|childNodes)\b/;

const DECLARATION =
	/(?:function\s*\*?\s*(\w+)\s*|(?:const|let)\s+(\w+)\s*(?::[^=;{]*)?=\s*(?:async\s+)?(?:function\s*\*?\s*)?)\(/g;

interface Declaration {
	name: string;
	body: string;
}

/** The brace-matched body of the declaration whose parameter list opens at `parenIndex`. */
function bodyAfterParams(code: string, parenIndex: number): string | null {
	const params = balancedCall(code, parenIndex + 1);
	if (params === null) return null;
	const at = walkCode(code, parenIndex + 1 + params.length, (ch) => ch === '{' || ch === ';');
	return code[at] === '{' ? balancedBlock(code, at + 1) : null;
}

/** Every named function-like in `code`, with its body. */
function declarationsIn(code: string): Declaration[] {
	const out: Declaration[] = [];
	const re = new RegExp(DECLARATION);
	let match: RegExpExecArray | null;
	while ((match = re.exec(code)) !== null) {
		const name = match[1] ?? match[2];
		const body = bodyAfterParams(code, re.lastIndex - 1);
		if (name && body !== null) out.push({ name, body });
	}
	return out;
}

const readsChildren = (declaration: Declaration): boolean =>
	TOUCHES_CHILDREN.test(declaration.body);

/** The declarations in `code` that read a node's children. */
const walkerDeclarations = (code: string): Declaration[] =>
	declarationsIn(code).filter(readsChildren);

/** Children readers on a call cycle, a self-call being a cycle of one. The cycle may pass through
 *  helpers that read no children, and a call reaches every declaration with its name. */
function recursiveDeclarations(declarations: Declaration[]): Declaration[] {
	const reach = declarations.map(
		(declaration) =>
			new Set(
				declarations.flatMap((other, index) =>
					callsAnywhere(declaration.body, other.name) ? [index] : []
				)
			)
	);
	let grew = true;
	while (grew) {
		grew = false;
		for (const targets of reach) {
			for (const target of [...targets]) {
				for (const next of reach[target]) {
					if (!targets.has(next)) {
						targets.add(next);
						grew = true;
					}
				}
			}
		}
	}
	return declarations.filter(
		(declaration, index) => reach[index].has(index) && readsChildren(declaration)
	);
}

const recursiveWalkNames = (code: string): string[] =>
	recursiveDeclarations(declarationsIn(code)).map((declaration) => declaration.name);

/** Walker names a file spells more than once: an `EXCEPTIONS` key is a path and a name, so a
 *  repeat would exempt a traversal nobody stated. */
function repeatedWalkerNames(code: string): string[] {
	const seen = new Set<string>();
	const repeats = new Set<string>();
	for (const { name } of walkerDeclarations(code)) {
		if (seen.has(name)) repeats.add(name);
		seen.add(name);
	}
	return [...repeats];
}

/** A recursive walker and an iterative one under one name, the shape `components/blocks/text/`
 *  spells as `visit`: the check reports the first and leaves the second alone. */
const TWO_WALKERS_ALIKE = `
function visit(nodes) {
	for (const node of nodes) if (node.children) visit(node.children);
}
function visit(nodes) {
	const stack = [...nodes];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node.children) stack.push(...node.children);
	}
}
`;

// Miss-analysis: the cycle check saw only children readers, so a walk recursing through a helper
// that reads none passed it.
const HELPER_CYCLES = `
function visit(node) {
	pushChildren(node);
}
function pushChildren(node) {
	for (const child of node.children) visit(child);
}
function render(node) {
	for (const child of node.childNodes) step(child);
}
function step(child) {
	render(child);
}
`;

/** Mutual recursion over no children, and an iterative walk handing each node to a helper. */
const NO_WALK_CYCLE = `
function parseList(text) {
	return text.startsWith('(') ? parseItem(text.slice(1)) : [];
}
function parseItem(text) {
	return parseList(text);
}
function collect(root) {
	const stack = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		record(node);
		if (node.children) stack.push(...node.children);
	}
}
function record(node) {
	seen.add(node);
}
`;

describe('G4.56 inline-tree and rendered-DOM walks are iterative', () => {
	const sources = collectEditorSources(EDITOR_SRC).filter((file) =>
		SCOPE.some((dir) => file.relPath.startsWith(dir))
	);

	it('inspected every scoped directory', () => {
		for (const dir of SCOPE) {
			expect(sources.filter((file) => file.relPath.startsWith(dir)).length).toBeGreaterThan(0);
		}
	});

	it('reads both walk boundaries out of the scoped sources', () => {
		const seams = [
			[SOURCE.inlineWalk, 'inlineDescendants'],
			[SOURCE.domWalk, 'domDescendants']
		];
		for (const [relPath, name] of seams) {
			const seam = sources.find((file) => file.relPath === relPath);
			expect(walkerDeclarations(seam!.code).map((d) => d.name)).toContain(name);
		}
	});

	it('reports the recursive half of two walkers spelled alike', () => {
		expect(walkerDeclarations(TWO_WALKERS_ALIKE)).toHaveLength(2);
		expect(recursiveWalkNames(TWO_WALKERS_ALIKE)).toEqual(['visit']);
		expect(repeatedWalkerNames(TWO_WALKERS_ALIKE)).toEqual(['visit']);
	});

	it('reports a walk that recurses through a helper, whichever side reads the children', () => {
		expect(recursiveWalkNames(HELPER_CYCLES).sort()).toEqual(['pushChildren', 'render']);
		expect(recursiveWalkNames(NO_WALK_CYCLE)).toEqual([]);
	});

	it('no scoped file spells two walkers alike', () => {
		const hits = sources.flatMap((file) =>
			repeatedWalkerNames(file.code).map((name) => `${file.relPath} :: ${name}`)
		);

		expect(
			hits,
			'an exception is keyed by path and name, so two walkers under one name leave the map ' +
				'unable to address either: rename one for what it walks'
		).toEqual([]);
	});

	it('no walk over children or childNodes recurses', () => {
		const hits = sources
			.flatMap((file) => recursiveWalkNames(file.code).map((name) => `${file.relPath} :: ${name}`))
			.filter((hit) => !(hit in EXCEPTIONS))
			.sort();

		expect(
			hits,
			'a per-level call frame over an input-controlled depth overflows the stack: take an ' +
				'explicit stack (reversed push keeps pop order source order), or route an inline-tree ' +
				'walk through core/inline/walk.ts :: inlineDescendants'
		).toEqual([]);
	});
});
