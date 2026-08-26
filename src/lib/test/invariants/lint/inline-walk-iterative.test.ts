/**
 * G4.56 — every walk over an inline tree or its rendered DOM is iterative. Inline nesting depth is
 * input-controlled, so a per-level call frame overflows the stack and strands the block in the
 * fallback it cannot heal: the renderer knew that and four walks one call later did not (#200).
 * Scope is `core/inline/`, `cursor/`, `ambient/`; #226 widens it to `components/blocks/text/`,
 * whose join-seam rebuild is the one shape a pre-order cannot carry and the exception it will get.
 */

import { describe, it, expect } from 'vitest';
import {
	balancedBlock,
	balancedCall,
	callsAnywhere,
	collectEditorSources,
	EDITOR_SRC,
	type SourceFile
} from './scan-source';

/** Library-internal: the rule binds the walks over aragonite's own tree, which no plugin owns. */
const SCOPE = ['src/lib/core/inline/', 'src/lib/cursor/', 'src/lib/ambient/'];

/** A walk that recurses is a stack overflow waiting for a deep enough document; empty by design. */
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

/** Names on a call cycle — a self-call is the one-cycle, so both shapes fall out of one pass. */
function recursiveNames(declarations: Declaration[]): string[] {
	const reach = new Map<string, Set<string>>();
	for (const declaration of declarations) {
		const calls = declarations
			.filter((other) => callsAnywhere(declaration.body, other.name))
			.map((other) => other.name);
		reach.set(declaration.name, new Set(calls));
	}
	let grew = true;
	while (grew) {
		grew = false;
		for (const targets of reach.values()) {
			for (const target of [...targets]) {
				for (const next of reach.get(target) ?? []) {
					if (!targets.has(next)) {
						targets.add(next);
						grew = true;
					}
				}
			}
		}
	}
	return [...reach].filter(([name, targets]) => targets.has(name)).map(([name]) => name);
}

const recursiveWalks = (file: SourceFile): string[] =>
	recursiveNames(walkerDeclarations(file.code));

describe('G4.56 inline-tree and rendered-DOM walks are iterative', () => {
	const sources = collectEditorSources(EDITOR_SRC).filter((file) =>
		SCOPE.some((dir) => file.relPath.startsWith(dir))
	);

	it('inspected every scoped directory', () => {
		for (const dir of SCOPE) {
			expect(sources.filter((file) => file.relPath.startsWith(dir)).length).toBeGreaterThan(0);
		}
	});

	it('reads a walker declaration out of a scoped file', () => {
		const seam = sources.find((file) => file.relPath === 'src/lib/core/inline/walk.ts');
		expect(walkerDeclarations(seam!.code).map((d) => d.name)).toContain('inlineDescendants');
	});

	it('no walk over children or childNodes recurses', () => {
		const hits = sources
			.flatMap((file) => recursiveWalks(file).map((name) => `${file.relPath} :: ${name}`))
			.filter((hit) => !(hit.split(' :: ')[0] in EXCEPTIONS))
			.sort();

		expect(
			hits,
			'a per-level call frame over an input-controlled depth overflows the stack: take an ' +
				'explicit stack (reversed push keeps pop order source order), or route an inline-tree ' +
				'walk through core/inline/walk.ts :: inlineDescendants'
		).toEqual([]);
	});
});
