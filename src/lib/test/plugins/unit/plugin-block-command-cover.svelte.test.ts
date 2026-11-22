// @vitest-environment jsdom
// Which blocks a block type's command runs on over a selection across blocks: the blocks the range
// covers as Tab over a range covers them, each covered leaf's outermost block whose type places it.
// Miss-analysis: the command walked the range with a read of its own, which held a container the
// range reached only the first byte of, and no row set that read beside Tab's.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { command, definePlugin, lineBlock, type Command } from '#lib/plugin.js';
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

describe('a placed command over a selection across blocks', () => {
	it.each(RANGES)('runs on the blocks Tab covers, %s', async (_, anchor, focus, covered) => {
		const { plugin, mark, ran } = makeMarks();
		const editor = mountEditor({ source: DOC, plugins: [plugin] });
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
		expect(ranOn).toEqual(covered);
		expect(ranOn).toEqual(tabCovers(doc, selection));
	});
});
