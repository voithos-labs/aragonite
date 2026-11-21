// @vitest-environment jsdom
// A plugin value's paste rewrites in a mounted editor: the block a rewrite reads, a paste that lands
// as text, the editor's own entry, and a rewrite that throws.
// Miss-analysis: paste rewrites were process-wide text transforms, and no row read a pasted block the
// way a plugin reads it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/plugin.js';
import { container } from '#lib/components/block-makers/container.js';
import { rewrite, type PasteRewrite } from '#lib/schema/paste-rewrite.js';
import { OWN_CLIPBOARD_TYPE } from '#lib/browser/clipboard.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { PluginError } from '#lib/schema/plugin-unit.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

interface AlertData {
	type: string;
}

/** An alerts plugin whose one rewrite answers with `into`, recording every block it reads. */
function makeAlerts(into: (block: Block<AlertData>) => string | null) {
	const read: Block<AlertData>[] = [];
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
		}
	});
	const rewrites: PasteRewrite<unknown>[] = [
		rewrite({ from: alert, into: (block) => (read.push(block), into(block)) })
	];
	const plugin = definePlugin({
		name: 'alerts',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [alert], rewrites })
	});
	return { plugin, read };
}

async function mounted(into: (block: Block<AlertData>) => string | null) {
	const errors: PluginError[] = [];
	const alerts = makeAlerts(into);
	const editor = mountEditor({
		source: 'intro\n\nafter\n',
		plugins: [alerts.plugin],
		onError: (error: PluginError) => errors.push(error)
	});
	await editor.settle();
	return { editor, errors, ...alerts };
}

/** Pastes `text` at the end of the first paragraph, carrying `own` as the editor's own entry. */
async function pasteAfterIntro(
	editor: Awaited<ReturnType<typeof mounted>>['editor'],
	text: string,
	own?: string
) {
	const surface = surfaceAt(editor, [0]);
	placeCaret(surface, 5);
	const event = new Event('paste', { bubbles: true, cancelable: true });
	const types = own ? ['text/plain', OWN_CLIPBOARD_TYPE] : ['text/plain'];
	Object.defineProperty(event, 'clipboardData', {
		value: {
			types,
			getData: (type: string) =>
				type === 'text/plain' ? text : type === OWN_CLIPBOARD_TYPE ? (own ?? '') : '',
			files: [],
			items: []
		}
	});
	surface.dispatchEvent(event);
	await editor.settle();
}

describe('a paste rewrite in a mounted editor', () => {
	it('reads the pasted block with its data, children and clipboard positions, and writes its answer', async () => {
		const { editor, read } = await mounted(() => 'REWRITTEN');
		await pasteAfterIntro(editor, 'x\n\n%> [!TIP]\n%> pasted\n');
		expect(editor.source()).toContain('REWRITTEN');
		expect(editor.source()).not.toContain('[!TIP]');
		expect(read).toHaveLength(1);
		const [block] = read;
		expect(block.data.type).toBe('TIP');
		expect(block.children.map((child) => child.text)).toEqual(['pasted\n']);
		expect([block.from, block.to]).toEqual([3, 23]);
	});

	it('asks nothing for one line pasted after text, which lands as text', async () => {
		const { editor, read } = await mounted(() => 'REWRITTEN');
		await pasteAfterIntro(editor, '%> [!TIP]');
		expect(editor.source()).toBe('intro%> [!TIP]\n\nafter\n');
		expect(read).toEqual([]);
	});

	it("asks nothing for a paste carrying the editor's own entry", async () => {
		const { editor, read } = await mounted(() => 'REWRITTEN');
		await pasteAfterIntro(editor, '%> [!TIP]\n%> pasted\n', 'an entry that fits nowhere');
		expect(editor.source()).toContain('%> [!TIP]\n%> pasted\n');
		expect(read).toEqual([]);
	});

	it('reports a rewrite that throws as `rewrite paste`, and lands the block as pasted', async () => {
		const { editor, errors } = await mounted(() => {
			throw new Error('boom');
		});
		await pasteAfterIntro(editor, '%> [!TIP]\n%> pasted\n');
		expect(editor.source()).toContain('%> [!TIP]\n%> pasted\n');
		expect(errors.map(({ plugin, doing }) => [plugin, doing])).toEqual([
			['alerts', 'rewrite paste']
		]);
	});
});
