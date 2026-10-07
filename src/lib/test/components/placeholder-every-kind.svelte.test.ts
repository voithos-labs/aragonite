// @vitest-environment jsdom
// Every block kind the registries know either shows the `placeholder` hint when empty, proven by
// mounting it, or says why it is never an empty editable block, so a new kind cannot skip it.
import { describe, it, expect, afterEach } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';
import { bundledPluginDirs } from '../invariants/lint/scan-source';
import { getAllRegisteredKinds } from '$lib/schema/block-kind-descriptor';
import type { EditorPluginEntry } from '$lib';
import type { PlaceholderBlock } from '$lib/editor-props';
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

/** Every bundled plugin, keyed by its directory, so a plugin added on disk fails until it is here. */
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

/** A kind that can be empty: the source holding one empty block of it, and that block's path. */
const EMPTY_FIXTURES: Record<string, { source: string; path: number[] }> = {
	paragraph: { source: '\n', path: [0] },
	heading: { source: '# \n', path: [0] },
	fencedCode: { source: '```\n\n```\n', path: [0] },
	directiveLeaf: { source: '::spoiler\n', path: [0] },
	'admonition-title': { source: ':::note\n\nbody\n\n:::\n', path: [0, 0] },
	'details-summary': {
		source: '<details>\n<summary></summary>\n\nbody\n\n</details>\n',
		path: [0, 0]
	}
};

const CONTAINER = 'a container: its empty child blocks are asked under their own kinds';
const ALL_CONTENT = 'its content range is all of its bytes, and no parse gives it none';

/** A kind with no empty editable state, and why. */
const NEVER_EMPTY: Record<string, string> = {
	setextHeading: 'an underline under no text is not a setext heading',
	thematicBreak: 'all marker: nothing is typed into a divider',
	indentedCode: ALL_CONTENT,
	htmlBlock: ALL_CONTENT,
	linkReferenceDefinition: ALL_CONTENT,
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
	mathBlock: ALL_CONTENT,
	mathFence: ALL_CONTENT,
	mermaid: ALL_CONTENT,
	toc: ALL_CONTENT,
	parrot: ALL_CONTENT
};

function mountWithEveryPlugin(source: string): MountedEditor {
	return mountEditor({
		source,
		plugins: Object.values(BUNDLED).map((plugin) => plugin()),
		placeholder: (block: PlaceholderBlock) => block.kind
	});
}

describe('placeholder: every registered kind', () => {
	it('enrolls every bundled plugin directory', () => {
		expect(Object.keys(BUNDLED).sort()).toEqual(bundledPluginDirs());
	});

	it('names every registered kind once, as one that shows the hint or one never empty', () => {
		mountWithEveryPlugin('\n');
		const named = [...Object.keys(EMPTY_FIXTURES), ...Object.keys(NEVER_EMPTY)];
		expect(new Set(named).size, 'a kind named in both tables').toBe(named.length);
		expect(
			[...getAllRegisteredKinds()].sort(),
			'a registered kind with no empty fixture and no never-empty reason'
		).toEqual(named.sort());
	});

	it.each(Object.entries(EMPTY_FIXTURES))(
		'an empty %s block shows the hint its kind asked for',
		(kind, { source, path }) => {
			const editor = mountWithEveryPlugin(source);
			const el = surfaceAt(editor, path);
			expect(el.getAttribute('data-placeholder')).toBe(kind);
			expect(el.getAttribute('aria-placeholder')).toBe(kind);
		}
	);
});
