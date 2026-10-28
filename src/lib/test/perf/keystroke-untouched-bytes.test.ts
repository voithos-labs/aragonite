// A keystroke never joins the bytes of a block it didn't write: a join builds a string as long as
// that block, so typing beside a large container would cost its size on every key.
// Miss-analysis: the keystroke cost rows counted parses and sibling reads, never a string join, so
// the last-line check joining the last block's blank lines to its bytes passed them all.
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';

const lines = (line: (i: number) => string) =>
	Array.from({ length: 50 }, (_, i) => line(i)).join('');

const CONTAINERS: { name: string; source: string }[] = [
	{ name: 'a list', source: lines((i) => `- item ${i}\n`) },
	{ name: 'a blockquote', source: lines((i) => `> line ${i}\n`) },
	{ name: 'a table', source: '| a | b |\n| - | - |\n' + lines((i) => `| r${i} | c |\n`) }
];

/** `bytes` with every method and read intact, counting each `+` or `==` that joins it. */
function countingJoins(bytes: string): { raw: string; joins: () => number } {
	let joins = 0;
	const raw = new Proxy(new String(bytes), {
		get(_target, key) {
			if (key === Symbol.toPrimitive)
				return (hint: string) => {
					if (hint === 'default') joins++;
					return bytes;
				};
			const value = (bytes as unknown as Record<PropertyKey, unknown>)[key];
			return typeof value === 'function' ? value.bind(bytes) : value;
		}
	});
	return { raw: raw as unknown as string, joins: () => joins };
}

/** Joins of the container's bytes during the second of two keystrokes in the paragraph above it. */
function joinsWhileTyping(container: string): number {
	const { deps } = makeEditorActionsDeps(`above\n\n${container}`);
	const controller = createUndoController(deps);
	let joins = () => 0;
	for (let n = 0; n < 2; n++) {
		if (n === 1) {
			const counted = countingJoins(deps.doc.children[1].raw);
			deps.doc.children[1].raw = counted.raw;
			joins = counted.joins;
		}
		const raw = deps.doc.children[0].raw;
		const write = legalizeWrite(
			documentBody(deps.doc),
			0,
			raw.replace('\n', 'Q\n'),
			'authored',
			defaultGrammarView
		);
		expect(controller.typeLeaf(docPathFrom([0]), write, 0).wrote).toBe(true);
	}
	return joins();
}

// The production keystroke: a dev build's checks read whole containers by design.
beforeEach(() => configureEditorEnv({ isDev: false }));
afterEach(() => resetEditorEnv());

describe('a keystroke never joins the bytes of a block it did not write', () => {
	for (const { name, source } of CONTAINERS) {
		it(`typing above ${name} that ends the document`, () => {
			expect(joinsWhileTyping(source)).toBe(0);
		});
	}
});
