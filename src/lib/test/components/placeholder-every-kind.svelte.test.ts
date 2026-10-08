// @vitest-environment jsdom
// Every block kind the registries know either shows the `placeholder` hint when empty, proven by
// mounting it, or says why it is never asked, so a new kind cannot skip it.
import { describe, it, expect, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type BlockLookup,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { bundledPluginDirs } from '../invariants/lint/scan-source';
import { getAllRegisteredKinds } from '$lib/schema/block-kind-descriptor';
import type { EditorPluginEntry, PlaceholderBlock } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { detailsPlugin } from '$lib/plugins/details';
import { emojiPlugin } from '$lib/plugins/emoji';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
import { latexPlugin } from '$lib/plugins/latex';
import { mermaidPlugin } from '$lib/plugins/mermaid';
import { parrotPlugin } from '$lib/plugins/parrot';
import { slashCommandsPlugin } from '$lib/plugins/slash-commands';
import { tocPlugin } from '$lib/plugins/toc';

installLayoutStubs();
afterEach(destroyMountedEditors);

/** Every bundled plugin by its directory, so a plugin added on disk fails until it is listed. */
const BUNDLED: Record<string, () => EditorPluginEntry> = {
	admonitions: admonitionsPlugin,
	details: detailsPlugin,
	emoji: emojiPlugin,
	footnotes: footnotesPlugin,
	'highlight-occurrences': () => highlightOccurrencesPlugin(),
	latex: latexPlugin,
	mermaid: mermaidPlugin,
	parrot: parrotPlugin,
	'slash-commands': slashCommandsPlugin,
	toc: tocPlugin
};

/** A kind that can be empty: the source holding one empty block of it and that block's path, and
 *  for a block that shows its source only while edited, the caret offset that opens it. */
const EMPTY_FIXTURES: Record<string, { source: string; path: number[]; openAt?: number }> = {
	paragraph: { source: '\n', path: [0] },
	heading: { source: '# \n', path: [0] },
	fencedCode: { source: '```\n\n```\n', path: [0] },
	directiveLeaf: { source: '::spoiler\n', path: [0] },
	'admonition-title': { source: ':::note\n\nbody\n\n:::\n', path: [0, 0] },
	'details-summary': {
		source: '<details>\n<summary></summary>\n\nbody\n\n</details>\n',
		path: [0, 0]
	},
	mathBlock: { source: '$$\n\n$$\n', path: [0], openAt: 3 },
	mathFence: { source: '```math\n\n```\n', path: [0], openAt: 8 }
};

const CONTAINER = 'a container: its empty child blocks are asked under their own kinds';
const NO_BLANK_FORM = 'the grammar gives it no blank form: the bytes that open it are its content';

/** A kind that never shows the hint, and why. */
const NEVER_ASKED: Record<string, string> = {
	setextHeading: 'an underline under no text is not a setext heading',
	thematicBreak: 'all marker: nothing is typed into a divider',
	indentedCode: 'an indented code block starts at its first non-blank line',
	htmlBlock: NO_BLANK_FORM,
	linkReferenceDefinition: NO_BLANK_FORM,
	toc: NO_BLANK_FORM,
	parrot: NO_BLANK_FORM,
	unrecognized: 'no opener produces it, and it keeps the bytes it was given',
	table: 'its cells are not blocks and are not asked',
	tableRow: 'rendered inside its table, whose cells are not asked',
	tableCell: 'a cell is not a block and is not asked',
	blockquote: CONTAINER,
	list: CONTAINER,
	listItem: CONTAINER,
	directiveContainer: CONTAINER,
	admonition: CONTAINER,
	githubAlert: CONTAINER,
	details: CONTAINER,
	'footnote-def': CONTAINER,
	mermaid: 'edited in its own textarea, which is not the shared editable element'
};

function mountWithEveryPlugin(source: string): MountedEditor<BlockLookup> {
	return mountEditor<BlockLookup>({
		source,
		plugins: Object.values(BUNDLED).map((plugin) => plugin()),
		placeholder: (block: PlaceholderBlock) => block.kind
	});
}

describe('placeholder: every registered kind', () => {
	it('enrolls every bundled plugin directory', () => {
		expect(Object.keys(BUNDLED).sort()).toEqual(bundledPluginDirs());
	});

	it('names every registered kind once, as one that shows the hint or one never asked', () => {
		mountWithEveryPlugin('\n');
		const named = [...Object.keys(EMPTY_FIXTURES), ...Object.keys(NEVER_ASKED)];
		expect(new Set(named).size, 'a kind named in both tables').toBe(named.length);
		expect(
			[...getAllRegisteredKinds()].sort(),
			'a registered kind with no empty fixture and no reason it is never asked'
		).toEqual(named.sort());
	});

	it.each(Object.entries(EMPTY_FIXTURES))(
		'an empty %s block shows the hint its kind asked for',
		async (kind, { source, path, openAt }) => {
			const editor = mountWithEveryPlugin(source);
			if (openAt !== undefined) {
				editor.instance.__test.getBlockComponent(path).focus?.(openAt);
				await editor.settle();
			}
			const el = surfaceAt(editor, path);
			expect(el.getAttribute('data-placeholder')).toBe(kind);
			expect(el.getAttribute('aria-placeholder')).toBe(kind);
		}
	);
});
