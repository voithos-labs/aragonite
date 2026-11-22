// @vitest-environment jsdom
// Which blocks a block type's command runs on over a selection across blocks: the blocks the range
// covers as Tab over a range covers them, each covered leaf's outermost block whose type places it.
// Miss-analysis: the command walked the range with a read of its own, which held a container the
// range reached only the first byte of, and no row set that read beside Tab's.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	command,
	definePlugin,
	inline,
	lineBlock,
	markerPair,
	type Command,
	type PluginList
} from '#lib/plugin.js';
import { container } from '#lib/components/block-makers/container.js';
import { nodeOfBlock, type Block } from '#lib/schema/doc-view.js';
import { qualifiedName } from '#lib/schema/plugin-name.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import type { EditorSelection, SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { coversIndentBinding } from '#lib/selection/cross-block/range-indent.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

interface AlertData {
	type: string;
}

/** An alert container whose `Mod+7` runs `mark`, and a memo leaf whose menu row runs it too. */
function makeMarks() {
	const ran: Block[] = [];
	const mark = command<Block<never>>({
		id: 'mark',
		title: 'Mark',
		run: (_, b) => void ran.push(b)
	});
	const alert = container<AlertData>({
		name: 'alert',
		label: 'Alert',
		sample: '%> [!NOTE]\n%> x',
		insert: { none: 'a test block type' },
		lines: {
			shape: 'marked',
			first: '%> ',
			rest: '%> ',
			reads: /^%> ?/,
			lazy: true,
			head: {
				match: /^\[!(\w+)\]$/,
				data: (m: RegExpExecArray) => ({ type: m[1] }),
				write: (data: AlertData) => `[!${data.type}]`
			}
		},
		chords: { 'Mod+7': mark as unknown as Command<Block<AlertData>> }
	});
	const memo = lineBlock({
		name: 'memo',
		label: 'Memo',
		match: /^@@ (?<text>.*)$/,
		sample: '@@ x',
		insert: { none: 'a test block type' },
		actions: [{ label: 'Mark', command: mark }]
	});
	const plugin = definePlugin({
		name: 'marks',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [alert, memo] })
	});
	return { plugin, mark, ran };
}

const KINDS = new Set([qualifiedName('marks', 'alert'), qualifiedName('marks', 'memo')]);

// Top-level blocks: intro, two alerts, two memos, a list whose item holds an alert, an alert holding
// an alert, an alert holding a table, and a last paragraph.
const DOC = [
	'intro',
	'',
	'%> [!NOTE]',
	'%> one',
	'',
	'%> [!TIP]',
	'%> two',
	'',
	'@@ three',
	'',
	'@@ four',
	'',
	'- item',
	'',
	'  %> [!NOTE]',
	'  %> nested',
	'',
	'%> [!NOTE]',
	'%> %> [!TIP]',
	'%> %> deep',
	'',
	'%> [!NOTE]',
	'%> | a | b |',
	'%> | - | - |',
	'%> | c | d |',
	'',
	'after',
	''
].join('\n');

const at = (path: number[], offset: number): SelectionPoint => ({ path, offset });
const cell = (path: number[], offset: number): SelectionPoint => ({
	path,
	offset,
	cellCoordinate: true
});

const RANGES: [string, SelectionPoint, SelectionPoint, number[][]][] = [
	['ending mid-block', at([1, 0], 1), at([2, 0], 2), [[1], [2]]],
	["ending at a block's last byte", at([0], 2), at([1, 0], 3), [[1]]],
	["starting at a block's last byte", at([1, 0], 3), at([2, 0], 1), [[1], [2]]],
	["ending at the next container's first byte", at([1, 0], 0), at([2, 0], 0), [[1]]],
	['the same, made backwards', at([2, 0], 0), at([1, 0], 1), [[1]]],
	["ending at the next leaf's first byte", at([3], 4), at([4], 0), [[3]]],
	["reaching only a container's first byte", at([0], 2), at([1, 0], 0), []],
	['holding containers whole', at([0], 2), at([3], 2), [[1], [2], [3]]],
	[
		'ending in a container nested in a list item',
		at([4], 2),
		at([5, 0, 1, 0], 3),
		[[4], [5, 0, 1]]
	],
	['into an alert inside an alert', at([5, 0, 0], 1), at([6, 0, 0], 2), [[5, 0, 1], [6]]],
	['ending in a table cell', at([6, 0, 0], 1), cell([7, 0], 0), [[6], [7]]],
	['starting in a table cell', cell([7, 0], 3), at([8], 2), [[7]]]
];

const documentOf = (editor: MountedEditor) =>
	(editor.instance as unknown as { __test: { getDocument(): Document } }).__test.getDocument();

/** Each node's path, by identity. */
function pathsIn(doc: Document): Map<unknown, number[]> {
	const paths = new Map<unknown, number[]>();
	const walk = (node: CstNode, path: number[]) => {
		paths.set(node, path);
		node.children?.forEach((child, i) => walk(child, [...path, i]));
	};
	doc.children.forEach((node, i) => walk(node, [i]));
	return paths;
}

/** The blocks of `KINDS` Tab over `selection` reaches, read through Tab's own walk: it asks after
 *  every block holding a leaf it covers, so the outermost one asked of each kind is the answer. */
function tabCovers(doc: Document, { anchor, focus }: EditorSelection): number[][] {
	const asked = new Set<unknown>();
	const coverage = rangeCoverage(doc, coverRange(doc, anchor, focus));
	coversIndentBinding(doc, coverage, (node) => {
		asked.add(node);
		return null;
	});
	const found: number[][] = [];
	const walk = (node: CstNode, path: number[]) => {
		if (asked.has(node) && KINDS.has(node.kind)) return void found.push(path);
		node.children?.forEach((child, i) => walk(child, [...path, i]));
	};
	doc.children.forEach((node, i) => walk(node, [i]));
	return found;
}

/** An inline widget (`[[w]]`) and a marker pair (`{>>a}` to `{<<a}`), neither drawing its bytes. */
const inlines = definePlugin({
	name: 'hidden',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		inlines: [
			inline({
				name: 'ref',
				label: 'Ref',
				prefix: '[[',
				match: /\[\[(\w+)\]\]/,
				read: (m) => m[1],
				sample: '[[w]]',
				widget: { delete: 'whole', arrows: 'over', click: 'none' },
				draw(target) {
					target.textContent = '*';
					return {};
				}
			}),
			markerPair({
				name: 'anchor',
				label: 'Anchor',
				open: { prefix: '{>>', match: /\{>>(\w+)\}/, read: (m) => m[1] },
				close: { prefix: '{<<', match: /\{<<(\w+)\}/, read: (m) => m[1] },
				key: (id) => id,
				sample: '{>>a}x{<<a}'
			})
		]
	})
});

// A paragraph ending with a widget, an alert opening with a pair's side, an alert opening with a
// widget and ending with the other side, and a last paragraph.
const HIDDEN_DOC =
	'intro [[w]]\n\n%> [!NOTE]\n%> {>>a}one\n\n%> [!TIP]\n%> [[w]] two{<<a}\n\nafter\n';

const HIDDEN_RANGES: [string, SelectionPoint, SelectionPoint, number[][]][] = [
	['ending before a side opening a container', at([0], 2), at([1, 0], 0), []],
	['ending just past that side', at([0], 2), at([1, 0], 5), [[1]]],
	['ending before a widget opening a container', at([1, 0], 6), at([2, 0], 0), [[1]]],
	['ending just past that widget', at([1, 0], 6), at([2, 0], 5), [[1], [2]]],
	['starting after a side closing a container', at([2, 0], 14), at([3], 2), [[2]]],
	['starting just before that side', at([2, 0], 9), at([3], 2), [[2]]],
	['starting after a widget ending a paragraph', at([0], 11), at([1, 0], 6), [[1]]]
];

async function ranOver(
	source: string,
	plugins: PluginList,
	anchor: SelectionPoint,
	focus: SelectionPoint
) {
	const { plugin, mark, ran } = makeMarks();
	const editor = mountEditor({ source, plugins: [plugin, ...plugins] });
	await editor.settle();
	await editor.instance.setSelection({ anchor, focus });
	await editor.settle();
	const selection = editor.instance.getSelection()!;
	editor.instance.run(mark);
	await editor.settle();
	const doc = documentOf(editor);
	const paths = pathsIn(doc);
	// Runs go last block first.
	const ranOn = ran.map((block) => paths.get(nodeOfBlock(block))).reverse();
	const sides = [...editor.target.querySelectorAll('.md-marker')].map((m) => m.textContent);
	return { ranOn, tab: tabCovers(doc, selection), sides, text: editor.target.textContent };
}

describe('a placed command over a selection across blocks', () => {
	it.each(RANGES)('runs on the blocks Tab covers, %s', async (_, anchor, focus, covered) => {
		const { ranOn, tab } = await ranOver(DOC, [], anchor, focus);
		expect(ranOn).toEqual(covered);
		expect(ranOn).toEqual(tab);
	});

	it.each(HIDDEN_RANGES)(
		'runs on the blocks Tab covers beside bytes drawn as nothing, %s',
		async (_, anchor, focus, covered) => {
			const { ranOn, tab, sides, text } = await ranOver(HIDDEN_DOC, [inlines], anchor, focus);
			// Both constructs were read: the widget draws `*` and each side is a marker.
			expect([sides, text]).toEqual([['{>>a}', '{<<a}'], expect.stringContaining('intro *')]);
			expect(ranOn).toEqual(covered);
			expect(ranOn).toEqual(tab);
		}
	);
});
