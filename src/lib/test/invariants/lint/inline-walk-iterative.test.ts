/**
 * G4.56 — every walk over an inline tree or its rendered DOM is iterative. Inline nesting depth is
 * input-controlled, so a per-level call frame overflows the stack and strands the block in the
 * fallback it cannot heal: the renderer knew that and four walks one call later did not (#200).
 * Scope is `core/inline/`, `cursor/`, `ambient/` and the live gesture seams under
 * `components/blocks/text/`, whose join-seam rebuild routes through the same pre-order (#226).
 */

import { describe, it, expect } from 'vitest';
import {
	balancedBlock,
	balancedCall,
	callsAnywhere,
	collectEditorSources,
	EDITOR_SRC
} from './scan-source';

/** Library-internal: the rule binds the walks over aragonite's own tree, which no plugin owns. */
const SCOPE = [
	'src/lib/core/inline/',
	'src/lib/cursor/',
	'src/lib/ambient/',
	'src/lib/components/blocks/text/'
];

/** Keyed by the `path :: name` a hit reads as, which addresses ONE walk because the assertion
 *  below fails a scoped file that spells two walkers alike. A walk that recurses is a stack
 *  overflow waiting for a deep enough document: empty by design, and an entry states one. */
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
	let at = parenIndex + 1 + params.length;
	while (at < code.length && code[at] !== '{' && code[at] !== ';') at++;
	return code[at] === '{' ? balancedBlock(code, at + 1) : null;
}

/** Every named function-like in `code` that reads a node's children, with its body. */
function walkerDeclarations(code: string): Declaration[] {
	const out: Declaration[] = [];
	const re = new RegExp(DECLARATION);
	let match: RegExpExecArray | null;
	while ((match = re.exec(code)) !== null) {
		const name = match[1] ?? match[2];
		const body = bodyAfterParams(code, re.lastIndex - 1);
		if (name && body !== null && TOUCHES_CHILDREN.test(body)) out.push({ name, body });
	}
	return out;
}

/**
 * Declarations on a call cycle — a self-call is the one-cycle, so both shapes fall out of one
 * pass. Reachability is per DECLARATION and a call reaches EVERY declaration bearing the name:
 * which one the source means is not decidable here, and over-flagging is the safe direction.
 */
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
	return declarations.filter((_, index) => reach[index].has(index));
}

const recursiveWalkNames = (code: string): string[] =>
	recursiveDeclarations(walkerDeclarations(code)).map((declaration) => declaration.name);

/** Walker names a file spells more than once. An EXCEPTIONS key is a path and a name, so a repeat
 *  would exempt a walk nobody stated — and a detector keyed by name would hide one behind the
 *  other. */
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
 *  spells as `visit`: the guard must report the first and leave the second alone. */
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

describe('G4.56 inline-tree and rendered-DOM walks are iterative', () => {
	const sources = collectEditorSources(EDITOR_SRC).filter((file) =>
		SCOPE.some((dir) => file.relPath.startsWith(dir))
	);

	it('inspected every scoped directory', () => {
		for (const dir of SCOPE) {
			expect(sources.filter((file) => file.relPath.startsWith(dir)).length).toBeGreaterThan(0);
		}
	});

	it('reads both walk seams out of the scoped sources', () => {
		const seams = [
			['src/lib/core/inline/walk.ts', 'inlineDescendants'],
			['src/lib/cursor/dom-walk.ts', 'domDescendants']
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
