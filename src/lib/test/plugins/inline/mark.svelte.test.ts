// @vitest-environment jsdom
// A plugin mark: its runs pair like `~~` at their own length, its row edits like `**`, it nests by
// `after`, its toggle runs as Mod+B does, and its chord is the editor's to claim and rebind.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	selectRange,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { builtin, definePlugin, mark, type Mark } from '#lib/plugin.js';
import { readInline } from '#lib/core/inline/scan/index.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { installInlines } from '#lib/schema/inline-type.js';
import {
	getInlineConstructPolicy,
	getInlineMarkPolicy,
	holdInlineConstructPolicy
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

	it('reads the same row whatever order an editor lists it in', () => {
		const under = () => highlight({ name: 'under', marker: '++', after: builtin.inlines.emphasis });
		installed([highlight()]);
		installed([under(), highlight()]);
		expect(takeDevWarnsOf('inline-type-facts')).toEqual([]);
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

	// Miss-analysis: the nesting rows named built-in marks only, so none asked for a plugin mark
	// named before it was listed, or for a chain of two.
	it('nests inside the plugin mark `after` names, whichever is listed first', () => {
		const outer = highlight();
		const inner = highlight({ name: 'under', marker: '++', after: outer });
		installed([inner, outer]);
		expect(rank('hl/under')).toBeGreaterThan(rank('hl/highlight')!);
		installed([outer, inner]);
		expect(takeDevWarnsOf('inline-type-facts')).toEqual([]);
	});

	it('keeps a chain of marks between the built-in marks it started from', () => {
		const one = highlight();
		const two = highlight({ name: 'two', marker: '++', after: one });
		const three = highlight({ name: 'three', marker: '%%', after: two });
		installed([three, one, two]);
		expect(rank('hl/two')).toBeGreaterThan(rank('hl/highlight')!);
		expect(rank('hl/three')).toBeGreaterThan(rank('hl/two')!);
		expect(rank('hl/three')).toBeLessThan(rank('inlineCode')!);
	});

	it.each([
		['a marker of two characters', { marker: '=+' }, 'one character, once or twice'],
		['a run of three', { marker: '===' }, 'one character, once or twice'],
		['a character the editor reads', { marker: '**' }, "can't open a mark"],
		['a letter', { marker: 'xx' }, "can't open a mark"],
		['no chord', { chord: '' as never }, 'needs a chord']
	])('refuses %s', (_name, over, message) => {
		expect(() => highlight(over)).toThrow(message);
	});

	it('an unclosed = flood scans within a bounded growth ratio', () => {
		const { read } = installed([highlight()]);
		// Closers only, so every run searches back for an opener the per-length floor must bound.
		expectBoundedGrowth(measureScanGrowth((raw) => void read(raw), 'a== ', [16, 64]));
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

	const WORDS = 'a word here\n';

	it('is dead in an editor whose plugins list no mark', async () => {
		const m = highlight();
		const listing = mountEditor({ source: WORDS, plugins: [plugin(m)] });
		const other = mountEditor({ source: WORDS, plugins: [] });
		await listing.settle();
		await other.settle();
		selectRange(surfaceAt(other, [0]), 2, 6);
		expect(other.instance.can('hl/toggle-highlight')).toBe(false);
		expect(other.instance.run('hl/toggle-highlight')).toBe(false);
		await other.settle();
		expect(other.source()).toBe(WORDS);
		expect(takeDevWarnsOf('commands')).toHaveLength(1);
	});

	// Miss-analysis: the toggle's route was pinned by what it ran, never by what a key that names no
	// mark paid to ask it: each command lookup listed and sorted every mark row first.
	it('a key that toggles no mark lists no mark row', async () => {
		let listed = 0;
		const release = holdInlineConstructPolicy('probe/counted' as AnyInlineKind, {
			edgeAffinity: 'left-sticky',
			autoUnwrapOnEmpty: true,
			splitBehavior: 'close-and-reopen',
			revealable: true,
			// Every listing of the mark rows reads each row's mark.
			get mark() {
				listed++;
				return undefined;
			}
		});
		const editor = mountEditor({ source: 'plain words\n', plugins: [plugin(highlight())] });
		await editor.settle();
		const el = surfaceAt(editor, [0]);
		configureEditorEnv({ isDev: false });
		try {
			for (const key of ['Backspace', 'Tab', 'ArrowLeft']) {
				placeCaret(el, 5);
				listed = 0;
				await pressHardwareKey(el, { key });
				expect(listed, key).toBe(0);
			}
		} finally {
			resetEditorEnv();
			release();
		}
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
