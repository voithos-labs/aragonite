// Erasing a setext underline inside a container leaves a tree a reload of its bytes agrees with.
// Miss-analysis: the rebuild tests fed parser-built trees, where a paragraph never ends in a blank
// line, so no test rebuilt a container whose last child's own bytes end in one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { registerFootnoteDefinition } from '$lib/plugins/footnotes/footnote-definition';
import { makeContainerHarness } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';

/** A container holding a setext title, its body lines prefixed, and the container's path. */
const CONTAINERS = [
	{ name: 'a list item', open: '- ', indent: '  ', path: [0, 0], sibling: '- b\n' },
	{ name: 'a quote', open: '> ', indent: '> ', path: [0], sibling: '> b\n' },
	{
		name: 'a list item in a quote',
		open: '> - ',
		indent: '>   ',
		path: [0, 0, 0],
		sibling: '> - b\n'
	},
	{ name: 'a footnote definition', open: '[^a]: ', indent: '    ', path: [0], sibling: '    b\n' }
];

beforeEach(() => {
	vi.useFakeTimers();
	registerFootnoteDefinition();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('erasing a setext underline inside a container', () => {
	for (const { name, open, indent, path, sibling } of CONTAINERS) {
		for (const underline of ['---', '===']) {
			for (const follower of ['', sibling]) {
				const label = `${underline} in ${name}${follower ? ' above a sibling' : ''}`;
				it(label, async () => {
					const source = `${open}Plan\n${indent}${underline}\n${follower}`;
					const h = makeContainerHarness(source, path);
					expect(nodeAt(h.deps.doc, [...path, 0])?.kind).toBe('setextHeading');

					for (let left = underline.length - 1; left >= 0; left--) {
						const caret = 5 + left;
						const text = `Plan\n${underline.slice(0, left)}\n`;
						await h.bundle.blockEdit.updateBlockContent(0, text, 'authored', caret + 1, caret);
					}

					expect(nodeAt(h.deps.doc, [...path, 0])?.kind).toBe('paragraph');
					expect(describeConvergence(h.deps.doc)).toBeNull();
					expect(serialize(h.deps.doc)).toContain(follower);
				});
			}
		}
	}
});
