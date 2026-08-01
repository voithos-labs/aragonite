/**
 * G4.24 — the code surface commits its display through one door. A fenced block's write
 * rule cannot be carried per gesture: the reconciliation that grows the fence past a body
 * line the parser would read as its closer has to run on EVERY display commit, and two
 * gestures split the block by rewriting bytes without adding a character. So
 * `commitDisplay` is the block's only `updateBlockContent` call site, and this fails the
 * day another gesture writes around it. Scoped to the one file because it is the CARET
 * half; byte sinks reaching a code block without this surface answer to G4.28.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CODE_BLOCK = path.resolve('src/lib/components/blocks/code/CodeBlock.svelte');
const CALL = 'blockEdit.updateBlockContent(';

/** The `commitDisplay` body, by brace matching from its declaration. */
function commitDisplayBody(source: string): string {
	const start = source.indexOf('function commitDisplay(');
	expect(start, 'commitDisplay is gone — the funnel it names is the rule').toBeGreaterThan(-1);
	const open = source.indexOf('{', start);
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === '{') depth++;
		else if (source[i] === '}' && --depth === 0) return source.slice(open, i);
	}
	throw new Error('unbalanced braces in commitDisplay');
}

describe('G4.24 code-surface commit funnel', () => {
	const source = readFileSync(CODE_BLOCK, 'utf8');

	it('CodeBlock holds exactly one updateBlockContent call', () => {
		const calls = source.split(CALL).length - 1;
		expect(
			calls,
			'every display commit goes through commitDisplay, which is where the fence write seam runs'
		).toBe(1);
	});

	it('that call is the funnel’s own', () => {
		expect(commitDisplayBody(source)).toContain(CALL);
	});

	// Non-vacuity: the count arm is what catches a new gesture, so prove it can.
	it('counts a planted second call site', () => {
		const planted = `${source}\nfunction rogue() { ${CALL}0, 'x'); }\n`;
		expect(planted.split(CALL).length - 1).toBe(2);
	});
});
