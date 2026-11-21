// @vitest-environment jsdom
// A plugin mark: its runs pair like `~~` at their own length, its row edits like `**`, it nests by
// `after`, its toggle runs as Mod+B does, and its chord is the editor's to claim and rebind.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { builtin, definePlugin, mark, type Mark } from '#lib/plugin.js';
import { readInline } from '#lib/core/inline/scan/index.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { installInlines } from '#lib/schema/inline-type.js';
import {
	getInlineConstructPolicy,
	getInlineMarkPolicy
} from '#lib/schema/inline-construct-policy.js';
import type { AnyInlineKind } from '#lib/core/nodes.js';
import { expectBoundedGrowth, measureScanGrowth } from '../../harness/scan-growth';
import { takeDevWarnsOf } from '#lib/test/support/warn-gate.js';

beforeEach(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

const highlight = (over: Partial<Parameters<typeof mark>[0]> = {}) =>
	mark({
		name: 'highlight',
		label: 'Highlight',
		marker: '==',
		chord: 'Mod+Shift+h',
		tag: 'mark',
		class: 'md-mark-highlight',
		sample: '==hi==',
		...over
	});

function installed(marks: Mark[]) {
	const { inlines, release } = installInlines(
		[
			{
				name: 'hl',
				plugin: { name: 'hl', version: '1.0.0', editor: '*' },
				contribution: { inlines: marks }
			}
		],
		() => {}
	);
	const grammar = createEditorGrammar({ inlines: () => inlines });
	return { read: (raw: string) => readInline(raw, 0, raw.length, undefined, grammar), release };
}

const kinds = (nodes: { kind: string; children?: unknown[] }[]) => nodes.map((n) => n.kind);
const rank = (kind: string) => getInlineMarkPolicy(kind as AnyInlineKind)?.nestingRank;

describe('a plugin mark, read', () => {
	it('pairs ==a== at its own length, and nowhere else', () => {
		const { read } = installed([highlight()]);
		expect(read('x ==a== y')[1]).toMatchObject({ kind: 'hl/highlight', start: 2, end: 7 });
		expect(kinds(read('x =a= y'))).toEqual(['text']);
		expect(kinds(read('x ===a=== y'))).toEqual(['text']);
	});

	it('reads as text in an editor that lists no mark', () => {
		expect(kinds(installed([]).read('==a=='))).toEqual(['text']);
	});

	it('edits as ** does: its row while an editor runs it, gone once it stops', () => {
		const { release } = installed([highlight()]);
		expect(getInlineConstructPolicy('hl/highlight' as AnyInlineKind)).toMatchObject({
			edgeAffinity: 'left-sticky',
			autoUnwrapOnEmpty: true,
			splitBehavior: 'close-and-reopen',
			revealable: true,
			mark: { markerBytes: '==', command: 'hl/toggle-highlight' }
		});
		release();
		expect(getInlineConstructPolicy('hl/highlight' as AnyInlineKind)).toBeUndefined();
	});

	// G1.229: the readers take a kind, so a second editor's other row can't replace the first.
	it('warns when a second editor holds the mark with another row, and keeps the first', () => {
		installed([highlight()]);
		installed([highlight({ marker: '=' })]);
		expect(takeDevWarnsOf('inline-type-facts')).toHaveLength(1);
		expect(getInlineMarkPolicy('hl/highlight' as AnyInlineKind)?.markerBytes).toBe('==');
	});

	it('nests just outside code, or just inside the mark `after` names', () => {
		installed([
			highlight(),
			highlight({ name: 'under', marker: '++', after: builtin.inlines.emphasis })
		]);
		expect(rank('hl/highlight')).toBeGreaterThan(rank('strikethrough')!);
		expect(rank('hl/highlight')).toBeLessThan(rank('inlineCode')!);
		expect(rank('hl/under')).toBeGreaterThan(rank('emphasis')!);
		expect(rank('hl/under')).toBeLessThan(rank('strikethrough')!);
	});

	it.each([
		['a marker of two characters', { marker: '=+' }, 'one character, repeated'],
		['a character the editor reads', { marker: '**' }, "can't open a mark"],
		['a letter', { marker: 'xx' }, "can't open a mark"],
		['no chord', { chord: '' as never }, 'needs a chord']
	])('refuses %s', (_name, over, message) => {
		expect(() => highlight(over)).toThrow(message);
	});

	it('an unclosed = flood scans within a bounded growth ratio', () => {
		const { read } = installed([highlight()]);
		expectBoundedGrowth(measureScanGrowth((raw) => void read(raw), '==a ', [16, 64]));
	}, 300_000);
});

describe('a plugin mark in a mounted editor', () => {
	const plugin = (m: Mark) =>
		definePlugin({
			name: 'hl',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ inlines: [m] })
		});

	it('draws its text in its own element, its runs as markers', async () => {
		const editor = mountEditor({ source: 'a ==b== c\n', plugins: [plugin(highlight())] });
		await editor.settle();
		const host = blockHostAt(editor, [0]);
		expect(host.querySelector('mark.md-mark-highlight')?.textContent).toBe('b');
		expect([...host.querySelectorAll('.md-marker')].map((m) => m.textContent)).toEqual([
			'==',
			'=='
		]);
	});

	it('runs its toggle at the block, as Mod+B runs', async () => {
		const m = highlight();
		const editor = mountEditor({ source: 'a word here\n', plugins: [plugin(m)] });
		await editor.settle();
		selectRange(surfaceAt(editor, [0]), 2, 6);
		expect(editor.instance.run(m.toggle)).toBe(true);
		await editor.settle();
		expect(editor.source()).toBe('a ==word== here\n');
	});

	it('its chord is claimed, and a host rebinds it', async () => {
		const m = highlight();
		const key = (k: string) =>
			new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: true, bubbles: true });
		const bound = mountEditor({ source: 'a word\n', plugins: [plugin(m)] });
		await bound.settle();
		surfaceAt(bound, [0]).focus();
		expect(bound.instance.claims(key('h'))).toBe(true);
		const rebound = mountEditor({
			source: 'a word\n',
			plugins: [plugin(m)],
			keybindings: [{ chord: 'Mod+Shift+j', command: 'hl/toggle-highlight' as never }]
		});
		await rebound.settle();
		surfaceAt(rebound, [0]).focus();
		expect(rebound.instance.claims(key('j'))).toBe(true);
	});
});
