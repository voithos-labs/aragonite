// @vitest-environment jsdom
// A line block's `draw` run by the editor's draw host: the editor makes the text element and the
// drawing only places it, both commit models write as they promise, a box takes and gives back the
// caret, and `ctx.render` caches per bytes and theme.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import type { LineBlockSpec } from '#lib/schema/block-shapes.js';
import type { BoxDrawContext, TextDrawContext } from '#lib/schema/drawing.js';
import { POINTER_GESTURE_ATTR } from '#lib/selection/pointer-gesture.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

const SOURCE = 'intro\n\n%%note abcd\n\noutro\n';
const NOTE = [1];

/** A plugin with one `%%note` line block drawn by `draw`. */
function notes(spec: Partial<LineBlockSpec<never>>) {
	return definePlugin({
		name: 'notes',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				lineBlock({
					name: 'note',
					label: 'Note',
					match: /^%%note(?: (?<text>.*))?$/,
					sample: '%%note hi',
					insert: { none: 'a test block type' },
					...spec
				} as LineBlockSpec<never>)
			]
		})
	});
}

/** A drawing that puts a badge before the editor's text element. */
function badged(log: string[] = []) {
	return (block: { text: string }, ctx: TextDrawContext) => {
		const dom = document.createElement('figure');
		const badge = document.createElement('span');
		badge.className = 'badge';
		badge.textContent = 'NOTE';
		dom.append(badge, ctx.source);
		log.push(`draw ${block.text.trim()}`);
		return {
			dom,
			update: (next: { text: string }, now: TextDrawContext) =>
				void log.push(`update ${next.text.trim()} focused=${now.focused}`),
			destroy: () => void log.push('destroy')
		};
	};
}

describe('an always-editable drawn line (edit: text)', () => {
	it("draws around the editor's text element, which holds the block's text", async () => {
		const editor = mountEditor({
			source: SOURCE,
			plugins: [notes({ edit: 'text', draw: badged() })]
		});
		await editor.settle();
		expect(blockHostAt(editor, NOTE).querySelector('.badge')?.textContent).toBe('NOTE');
		const el = surfaceAt(editor, NOTE);
		expect(el.textContent).toBe('%%note abcd');
		expect(el.getAttribute('contenteditable')).toBe('true');
	});

	it('writes every keystroke, and its update follows each one', async () => {
		const log: string[] = [];
		const editor = mountEditor({
			source: SOURCE,
			plugins: [notes({ edit: 'text', draw: badged(log) })]
		});
		await editor.settle();
		typeInto(surfaceAt(editor, NOTE), '%%note abcdX');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abcdX'));
		expect(log).toContain('update %%note abcdX focused=true');
	});

	it('is inert in reading mode', async () => {
		const editor = mountEditor({
			source: SOURCE,
			presentationMode: 'reading',
			plugins: [notes({ edit: 'text', draw: badged() })]
		});
		await editor.settle();
		expect(surfaceAt(editor, NOTE).getAttribute('contenteditable')).toBe('false');
	});
});

describe('a drawn line shown as a picture until the caret comes in (edit: source)', () => {
	it('hides its text element while folded', async () => {
		const editor = mountEditor({ source: SOURCE, plugins: [notes({ draw: badged() })] });
		await editor.settle();
		const source = blockHostAt(editor, NOTE).querySelector<HTMLElement>('figure > div');
		expect(source?.hidden).toBe(true);
	});
});

describe('a drawing', () => {
	it('that leaves the text element out fails the dev check', async () => {
		const editor = mountEditor({
			source: SOURCE,
			plugins: [notes({ edit: 'text', draw: () => ({ dom: document.createElement('div') }) })]
		});
		await editor.settle();
		expect(takeDevWarns().map((w) => w.tag)).toContain('invariant:dom-view-content');
	});

	it("that throws shows the block's source with a notice", async () => {
		const editor = mountEditor({
			source: SOURCE,
			plugins: [
				notes({
					draw: () => {
						throw new Error('boom');
					}
				})
			]
		});
		await editor.settle();
		const host = blockHostAt(editor, NOTE);
		expect(host.querySelector('[data-failed-block] pre')?.textContent).toBe('%%note abcd\n');
	});

	it('is destroyed when its block goes', async () => {
		const log: string[] = [];
		const editor = mountEditor({
			source: SOURCE,
			plugins: [notes({ edit: 'text', draw: badged(log) })]
		});
		await editor.settle();
		typeInto(surfaceAt(editor, NOTE), 'plain now');
		await editor.settle();
		expect(log).toContain('destroy');
	});

	it("keeps a press it claims from the editor's own press handling, for that press", async () => {
		let seen = 'unset';
		const editor = mountEditor({
			source: SOURCE,
			plugins: [
				notes({
					edit: 'text',
					draw: (_block, ctx) => {
						const dom = document.createElement('div');
						const pan = document.createElement('canvas');
						dom.append(pan, ctx.source);
						return { dom, keep: (e) => e.target === pan };
					}
				})
			]
		});
		await editor.settle();
		const pan = blockHostAt(editor, NOTE).querySelector('canvas')!;
		pan.addEventListener('pointerdown', () => {
			seen = pan.closest(`[${POINTER_GESTURE_ATTR}]`) ? 'kept' : 'not kept';
		});
		pan.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(seen).toBe('kept');
		await Promise.resolve();
		expect(pan.closest(`[${POINTER_GESTURE_ATTR}]`)).toBeNull();
	});
});

describe('ctx.render', () => {
	function rendered(produce: (theme: string) => Node | Promise<Node>) {
		return notes({
			edit: 'text',
			draw: (_block, ctx) => {
				const dom = document.createElement('div');
				const out = document.createElement('output');
				dom.append(out, ctx.source);
				ctx.render(out, produce);
				return { dom, update: () => ctx.render(out, produce) };
			}
		});
	}

	it('renders once per bytes and theme, and again when the bytes change', async () => {
		const produce = vi.fn((theme: string) => document.createTextNode(`drawn in ${theme}`));
		const editor = mountEditor({ source: SOURCE, plugins: [rendered(produce)] });
		await editor.settle();
		expect(blockHostAt(editor, NOTE).querySelector('output')?.textContent).toMatch(/^drawn in /);
		editor.props.presentationMode = 'live';
		await editor.settle();
		expect(produce).toHaveBeenCalledTimes(1);
		typeInto(surfaceAt(editor, NOTE), '%%note abcdX');
		await editor.settle();
		expect(produce).toHaveBeenCalledTimes(2);
	});

	it('shows the source and the error when the renderer throws', async () => {
		const editor = mountEditor({
			source: SOURCE,
			plugins: [
				rendered(() => {
					throw new Error('no renderer');
				})
			]
		});
		await editor.settle();
		expect(blockHostAt(editor, NOTE).querySelector('output')?.textContent).toBe(
			'%%note abcd\n\nno renderer'
		);
	});

	it('fills in what a promise settles to', async () => {
		let settle!: (node: Node) => void;
		const editor = mountEditor({
			source: SOURCE,
			plugins: [rendered(() => new Promise<Node>((resolve) => (settle = resolve)))]
		});
		await editor.settle();
		settle(document.createTextNode('late'));
		await editor.settle();
		expect(blockHostAt(editor, NOTE).querySelector('output')?.textContent).toBe('late');
	});
});

describe('a box (edit: box)', () => {
	/** A box drawing a field of its own, entered and left through `focus` and `ctx.leave`. */
	function fielded(log: string[]) {
		return notes({
			edit: 'box',
			draw: (_block, ctx: BoxDrawContext) => {
				const dom = document.createElement('div');
				const field = document.createElement('textarea');
				dom.append(field);
				field.addEventListener('keydown', (e) => {
					if (e.key === 'ArrowUp') ctx.leave('start');
				});
				return {
					dom,
					focus: {
						enter: (at) => {
							log.push(JSON.stringify(at));
							field.focus();
						},
						offset: () => (document.activeElement === field ? field.selectionStart : null)
					}
				};
			}
		});
	}

	it('takes the caret from the block above and gives it back through ctx.leave', async () => {
		const log: string[] = [];
		const editor = mountEditor({ source: SOURCE, plugins: [fielded(log)] });
		await editor.settle();
		const intro = surfaceAt(editor, [0]);
		placeCaret(intro, 5);
		await pressKey(intro, { key: 'ArrowRight' });
		await editor.settle();
		const field = blockHostAt(editor, NOTE).querySelector('textarea')!;
		expect(document.activeElement).toBe(field);
		expect(log).toEqual([JSON.stringify({ edge: 'start', x: null })]);

		await pressKey(field, { key: 'ArrowUp' });
		await editor.settle();
		expect(document.activeElement).toBe(surfaceAt(editor, [0]));
	});

	// Miss-analysis: every box with a field of its own declared `focus`, so none typed into one without.
	it('leaves a key typed in a field of its own to the field, without `focus`', async () => {
		const plugin = notes({
			edit: 'box',
			draw: () => {
				const dom = document.createElement('div');
				dom.append(document.createElement('textarea'));
				return { dom };
			}
		});
		const editor = mountEditor({ source: SOURCE, plugins: [plugin] });
		await editor.settle();
		const field = blockHostAt(editor, NOTE).querySelector('textarea')!;
		field.focus();
		await pressKey(field, { key: 'x' });
		await editor.settle();
		expect(editor.source()).toBe(SOURCE);
	});
});
