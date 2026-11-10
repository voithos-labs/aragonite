// The document byte map agrees with the parser's own answer, in both directions: a marker character
// tried at every byte of a leaf's text lands at the offset `byteOfLeaf` gives that byte, and
// `leafAtByte` names that offset back, for every container kind the bundled plugins add.

import { it, expect } from 'vitest';
import fc from 'fast-check';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { displayLength } from '#lib/core/lines.js';
import type { NodeView } from '#lib/core/node-views.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { byteOfLeaf, leafAtByte } from '#lib/tree-operations/container-offsets.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { arbLawDocument } from '../range-laws/shapes';
import { bytePositions } from '../range-laws/positions';
import { measured } from '#lib/tree-operations/top-level-starts.js';

const EXTRA = [
	'> [!NOTE]\n> alpha\n> beta\n\nafter\n',
	':::note Title\nbody\n\nmore\n:::\n\nafter\n',
	'[^1]: a\n    b\n\n    c\n',
	'<details>\n<summary>S</summary>\n\nHidden\n\n</details>\n',
	'>\ta\n> > b\n',
	'- [ ] task\n  more\n\n  1. n\n',
	'| a | b |\n|---|---|\n| 1 |  |\n\nafter\n',
	// Miss-analysis: no fixture held a body line a container's own line ends with, a block with
	// mixed line endings, an empty body under a title, or a table row with no pipes.
	'> [!NOTE]\n> ]\n',
	'> [!NOTE]\n\nafter\n',
	'<details>\n<summary>S</summary>\r\n\nthree\r\n</details>\n\r\nafter\n',
	'| a | b |\n|---|---|\nplain\n\nafter\n'
];

const docs = () => [...EXTRA, ...fc.sample(arbLawDocument, { numRuns: 120, seed: 20261105 })];

it('every leaf offset the parser places is the byte the map gives it, and back', () => {
	installPlugins(SYNTAX_PLUGINS);
	const grammar = defaultGrammarView;
	const misses: string[] = [];
	for (const source of docs()) {
		const doc = readAsOpened(source, { grammar, scope: 'document' });
		for (const [key, byte] of bytePositions(source, grammar)) {
			const [pathText, offsetText] = key.split('@');
			const path = pathText.split('.').map(Number);
			const offset = Number(offsetText);
			const leaf = blockNodeAt(doc, path);
			// A blank paragraph's place is any byte of its blank lines, so the marker reads it anywhere;
			// past a leaf's text is its line ending, where no caret sits.
			if (!leaf || leaf.raw.trim() === '' || offset > displayLength(leaf.raw)) continue;
			const got = byteOfLeaf(measured(doc), path, offset);
			// Every byte of a line holding only spaces and tabs is one place to the marker.
			const between = got === null ? 'x' : source.slice(Math.min(got, byte), Math.max(got, byte));
			if (got !== byte && !/^[ \t\r]*$/.test(between)) {
				misses.push(`${JSON.stringify(source)} ${key}: byte ${got}, not ${byte}`);
			}
			const back = leafAtByte(measured(doc), byte);
			const backKey = back && `${back.path.join('.')}@${back.offset}`;
			if (backKey !== key && !/^[ \t\r]*$/.test(between)) {
				misses.push(`${JSON.stringify(source)} byte ${byte}: ${backKey}, not ${key}`);
			}
		}
	}
	expect(misses.slice(0, 15)).toEqual([]);
});

it('every leaf, blank ones too, sits at a byte in document order that names it back', () => {
	installPlugins(SYNTAX_PLUGINS);
	const misses: string[] = [];
	for (const source of docs()) {
		const doc = readAsOpened(source, { grammar: defaultGrammarView, scope: 'document' });
		let previous = 0;
		for (const path of leafPaths(doc)) {
			const leaf = blockNodeAt(doc, path)!;
			for (const offset of [0, displayLength(leaf.raw)]) {
				const byte = byteOfLeaf(measured(doc), path, offset);
				const back = byte === null ? null : leafAtByte(measured(doc), byte);
				// Where two leaves meet at one byte, the map may name either.
				const again = back && byteOfLeaf(measured(doc), back.path, back.offset);
				if (byte === null || byte < previous || again !== byte) {
					misses.push(`${JSON.stringify(source)} ${path.join('.')}@${offset}: byte ${byte}`);
				}
				previous = byte ?? previous;
			}
		}
	}
	expect(misses.slice(0, 15)).toEqual([]);
});

function leafPaths(parent: { children?: readonly NodeView[] }, path: number[] = []): number[][] {
	return (parent.children ?? []).flatMap((child, i) =>
		child.children?.length ? leafPaths(child, [...path, i]) : [[...path, i]]
	);
}
