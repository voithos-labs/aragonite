// The fixed inputs the behavior differential runs: small documents typed into at every offset, the
// keys pressed there, the first-party plugins whose syntax the documents use, and the long
// documents (the showcase, the changelog) cut into adjacent block pairs.

import { createHash } from 'node:crypto';
import type { CstNode } from '#lib/core/nodes.js';
import type { EditorPlugin } from '#lib/plugin.js';
import { parse } from '#lib/core/parser.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { detailsPlugin } from '#lib/plugins/details/index.js';
import { emojiPlugin } from '#lib/plugins/emoji/index.js';
import { footnotesPlugin } from '#lib/plugins/footnotes/index.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import { tocPlugin } from '#lib/plugins/toc/index.js';
import { MULTI_SEEDS } from '#lib/e2e/simulation/multi-seeds.js';
import SHOWCASE_DOCUMENT from '../../../../examples/showcase/showcase-content.md?raw';
import { CHANGELOG_FAMILIES } from '../../../routes/changelog/changelog-content';

/** The bundled plugins that add syntax and render without a network or a canvas, so `$x$`,
 *  `:::note`, `[^1]` and `[[toc]]` read the way the showcase reads them. */
export const SYNTAX_PLUGINS: readonly EditorPlugin[] = [
	admonitionsPlugin(),
	detailsPlugin(),
	tocPlugin(),
	footnotesPlugin(),
	emojiPlugin(),
	latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) })
];

/** One document per block kind, container and inline construct, short enough that every offset
 *  times every key stays cheap. Ids name rows, so renaming one renames its rows. */
export const SMALL_DOCUMENTS: Readonly<Record<string, string>> = {
	empty: '\n',
	paragraph: 'plain text\n',
	'two-paragraphs': 'one\n\ntwo\n',
	'soft-break': 'one\ntwo\n',
	'hard-break': 'a  \nb\n',
	heading: '# Title\n',
	'heading-then-text': '## Head\nbody\n',
	setext: 'Title\n===\n',
	emphasis: 'a *em* **b**\n',
	'code-span': 'x `y` z\n',
	link: '[a](b) c\n',
	image: '![a](b)\n',
	strikethrough: '~~s~~ t\n',
	autolink: '<http://a.b>\n',
	bullets: '- a\n- b\n',
	ordered: '1. a\n2. b\n',
	tasks: '- [ ] a\n- [x] b\n',
	'nested-list': '- a\n  - b\n',
	quote: '> a\n> b\n',
	'quote-list': '> - a\n',
	fence: '```js\nx\n```\n',
	'thematic-break': 'a\n\n---\n\nb\n',
	table: '| a | b |\n|---|---|\n| 1 | 2 |\n',
	math: 'a $x$ b\n',
	'math-block': '$$\nx\n$$\n',
	alert: '> [!NOTE]\n> a\n',
	directive: ':::note\na\n:::\n',
	footnote: 'a[^1]\n\n[^1]: b\n'
};

/** Blocks touching with no blank line between, both orders where both read as two blocks: the
 *  long documents keep a blank line between blocks, so no row of theirs reaches a merge rule. */
export const FLUSH_JOIN_DOCUMENTS: Readonly<Record<string, string>> = {
	'flush paragraph-heading': 'a\n# h\n',
	'flush paragraph-list': 'a\n- b\n',
	'flush heading-list': '# h\n- a\n',
	'flush paragraph-quote': 'a\n> b\n',
	'flush heading-quote': '# h\n> q\n',
	'flush quote-heading': '> q\n# h\n',
	'flush list-quote': '- a\n> q\n',
	'flush quote-list': '> q\n- a\n',
	'flush paragraph-fence': 'a\n```\nx\n```\n',
	'flush fence-paragraph': '```\nx\n```\nb\n',
	'flush list-fence': '- a\n```\nx\n```\n',
	'flush heading-table': '# h\n| A |\n| - |\n',
	'flush table-heading': '| A |\n| - |\n# h\n',
	'flush prose-heading-prose': 'a\n# h\nb\n',
	'flush quote-heading-prose': '> q\n# h\np\n',
	'flush prose-heading-rule': 'a\n# h\n---\n',
	'flush prose-heading-table': 'x\n# h\n| A | B |\n| - | - |\n'
};

export interface Key {
	/** The key's name in a row. */
	name: string;
	init: KeyboardEventInit;
}

const press = (key: string, extra: KeyboardEventInit = {}, name = key): Key => ({
	name,
	init: { key, ...extra }
});

/** The printable keys are the markers a keystroke most often turns into structure. */
export const KEYS: readonly Key[] = [
	press('a'),
	press(' ', {}, 'Space'),
	press('*'),
	press('`'),
	press('$'),
	press('#'),
	press('>'),
	press('-'),
	press('['),
	press('Enter'),
	press('Enter', { shiftKey: true }, 'Shift+Enter'),
	press('Backspace'),
	press('Delete'),
	press('Tab')
];

/** A moved block meets new neighbours, which keys typed inside a block never give it. */
export const MOVE_KEYS: readonly Key[] = [
	press('ArrowUp', { altKey: true }, 'Alt+ArrowUp'),
	press('ArrowDown', { altKey: true }, 'Alt+ArrowDown')
];

/** The simulation's own seeds lead, then a fixed run, so the sequences replay byte for byte. */
export const SEQUENCE_SEEDS: readonly number[] = [...MULTI_SEEDS, ...range(100, 115)];
export const SEQUENCE_STEPS = 25;

/** A key pressed at a leaf's offset, the leaf named by its CST path. */
export interface ScriptedKey {
	path: number[];
	offset: number;
	key: string;
}

/** The shortest key runs an undo defect was found with, kept by name so no seed or corpus change
 *  drops them. */
export const SCRIPTED_SEQUENCES: Readonly<Record<string, { source: string; keys: ScriptedKey[] }>> =
	{
		'type-then-delete': {
			source: 'ab\n',
			keys: [
				{ path: [0], offset: 1, key: 'Enter' },
				{ path: [1], offset: 0, key: 'a' },
				{ path: [1], offset: 1, key: 'Backspace' }
			]
		},
		'empty-heading-undo': {
			source: '#\n\nb\n',
			keys: [
				{ path: [1], offset: 1, key: 'c' },
				{ path: [0], offset: 1, key: 'x' }
			]
		}
	};

// ── Long documents ───────────────────────────────────────────────────────────

export interface LongDocument {
	id: string;
	source: string;
}

/** The documents the showcase page and the changelog page mount, read through the pages' own
 *  imports. The newest changelog family is left out: its entry gains lines at every landing. */
export const LONG_DOCUMENTS: readonly LongDocument[] = [
	{ id: 'showcase', source: SHOWCASE_DOCUMENT },
	...CHANGELOG_FAMILIES.slice(1).map((family) => ({
		id: `changelog/${family.id}`,
		source: family.document
	}))
];

/** Each distinct pair of adjacent top-level blocks as a document, since jsdom mounts only a window
 *  of a long one. Named by a hash of its bytes, so an edit elsewhere renames no pair. */
export function blockPairs(doc: LongDocument): { id: string; source: string }[] {
	const blocks: CstNode[] = parse(doc.source).children;
	const pairs = new Map<string, string>();
	blocks.slice(1).forEach((second, i) => {
		const source = blocks[i].raw + second.leadingTrivia + second.raw;
		const hash = createHash('sha1').update(source).digest('hex').slice(0, 8);
		pairs.set(`${doc.id} ${hash}`, source);
	});
	return [...pairs].map(([id, source]) => ({ id, source }));
}

function range(from: number, to: number): number[] {
	return Array.from({ length: to - from }, (_, i) => from + i);
}
