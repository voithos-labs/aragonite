// @vitest-environment jsdom
// A hand-built DOM view publishes what the editor calls on it through `ctx.block.publish`, of the
// members a view may supply and nothing else, and a plain arrow pressed in it leaves the block.
// Miss-analysis: a handle read once at mount could take no members from a component that renders
// after it, and no row pressed an arrow inside a hand-built block.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import {
	defineBlockView,
	type BlockView,
	type BlockViewSpec,
	type HandBuiltBlock,
	type HandBuiltViewContext
} from '#lib/plugin.js';
import type { BlockComponent } from '#lib/block-component.js';
import { HAND_BUILT_MEMBERS, MEMBER_SOURCES } from '#lib/schema/block-view.js';
import { testContainer, testLeaf } from '#lib/test/harness/test-kinds.js';
import { markerLeafPlugin, newViewLog, loggedHandle } from './fixtures/dom-views';

type Lookup = { getBlockComponent(path: number[]): BlockComponent | null };

const SOURCE = 'intro\n\n@@ badge\n\noutro\n';
const BADGE = [1];

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

/** A badge holding a button and a text field; it publishes `members` from `mount`, or nothing. */
function badgeView(members: Partial<HandBuiltBlock> | null = {}, log = newViewLog()) {
	const contexts: HandBuiltViewContext[] = [];
	let button: HTMLButtonElement | null = null;
	const focus = vi.fn((_offset: number) => button?.focus());
	const view = defineBlockView({
		surface: 'none',
		mount(target, ctx) {
			contexts.push(ctx);
			button = document.createElement('button');
			button.textContent = 'badge';
			target.append(button, document.createElement('textarea'));
			if (members) {
				ctx.block.publish({
					focus,
					getCursorOffset: () => (target.contains(document.activeElement) ? 0 : null),
					focusable: true,
					...members
				});
			}
			return loggedHandle(log, target);
		}
	});
	return { view, focus, contexts, button: () => button! };
}

function mountBadge(view: BlockView): MountedEditor<Lookup> {
	return mountEditor<Lookup>({ source: SOURCE, plugins: [markerLeafPlugin(view)] });
}

const refAt = (editor: MountedEditor<Lookup>, path: number[]) =>
	editor.instance.__test.getBlockComponent(path)!;

const caretIn = (editor: MountedEditor<Lookup>, path: number[]) =>
	surfaceAt(editor, path).contains(document.activeElement);

describe('a hand-built DOM view', () => {
	it('publishes its focus during mount, which the editor calls when the caret arrives', async () => {
		const { view, focus } = badgeView();
		const editor = mountBadge(view);
		await editor.settle();
		await pressKeyAt(editor, [0], 'intro'.length, { key: 'ArrowDown' });
		expect(focus).toHaveBeenCalled();
	});

	it('publishes only the members it hands over, of those a view may supply', async () => {
		const rects = () => [new DOMRect(0, 0, 1, 1)];
		const { view } = badgeView({
			measurePartialRects: rects,
			// Editor-internal: a view cannot publish it.
			...({ startDragAtPoint: () => true } as object)
		});
		const editor = mountBadge(view);
		await editor.settle();
		const ref = refAt(editor, BADGE);
		expect(ref.measurePartialRects?.(0, 1)).toEqual(rects());
		expect('startDragAtPoint' in ref).toBe(false);
		expect('parkCaret' in ref).toBe(false);
		expect(ref.focusable).toBe(true);
		expect(refAt(editor, BADGE)).toBe(ref);
	});

	it('reports editable from the kind’s registration', async () => {
		const { view } = badgeView();
		const editor = mountBadge(view);
		await editor.settle();
		expect(refAt(editor, BADGE).editable).toBe(true);
	});

	it.each([
		['before it publishes', null, false],
		['once it publishes null', {}, true]
	])('%s, takes no focus and arrows pass over it', async (_name, members, unpublish) => {
		const { view, contexts } = badgeView(members);
		const editor = mountBadge(view);
		await editor.settle();
		if (unpublish) contexts[0].block.publish(null);
		await editor.settle();
		const ref = refAt(editor, BADGE);
		expect(ref.focusable).toBe(false);
		expect(ref.getCursorOffset()).toBeNull();
		expect(() => ref.focus(0)).not.toThrow();
		await pressKeyAt(editor, [0], 'intro'.length, { key: 'ArrowDown' });
		await editor.settle();
		expect(caretIn(editor, [2])).toBe(true);
	});

	it('answers with a later publication in place of the first', async () => {
		const { view, focus, contexts } = badgeView();
		const editor = mountBadge(view);
		await editor.settle();
		const later = vi.fn();
		contexts[0].block.publish({ focus: later, getCursorOffset: () => null, focusable: true });
		await editor.settle();
		refAt(editor, BADGE).focus(0);
		expect(later).toHaveBeenCalledWith(0);
		expect(focus).not.toHaveBeenCalled();
	});

	it('keeps its ref when it publishes the same members again', async () => {
		const members = { focus() {}, getCursorOffset: () => null, focusable: true };
		const { view, contexts } = badgeView(members);
		const editor = mountBadge(view);
		await editor.settle();
		const ref = refAt(editor, BADGE);
		contexts[0].block.publish({ ...members });
		await editor.settle();
		expect(refAt(editor, BADGE)).toBe(ref);
	});

	it('publishes the new mount’s members once update returns false, never the old one’s', async () => {
		const first = vi.fn();
		const second = vi.fn();
		const stale = vi.fn();
		const contexts: HandBuiltViewContext[] = [];
		const view = defineBlockView({
			surface: 'none',
			mount(_target, ctx) {
				contexts.push(ctx);
				const focus = contexts.length === 1 ? first : second;
				ctx.block.publish({ focus, getCursorOffset: () => null, focusable: true });
				return { update: () => false };
			}
		});
		const editor = mountBadge(view);
		await editor.settle();
		editor.props.presentationMode = 'live';
		await editor.settle();
		// A framework root unmounts a microtask behind the new mount, and may publish on its way out.
		contexts[0].block.publish({ focus: stale, getCursorOffset: () => null, focusable: true });
		await editor.settle();
		refAt(editor, BADGE).focus(0);
		expect(contexts).toHaveLength(2);
		expect(second).toHaveBeenCalledWith(0);
		expect(first).not.toHaveBeenCalled();
		expect(stale).not.toHaveBeenCalled();
	});

	it.each([
		['ArrowDown', [2]],
		['ArrowRight', [2]],
		['ArrowUp', [0]],
		['ArrowLeft', [0]]
	])('leaves for the neighbour on %s pressed inside it', async (key, to) => {
		const { view, button } = badgeView();
		const editor = mountBadge(view);
		await editor.settle();
		refAt(editor, BADGE).focus(0);
		const press = await pressKey(button(), { key });
		await editor.settle();
		expect(press.defaultPrevented).toBe(true);
		expect(caretIn(editor, to)).toBe(true);
	});

	it.each([
		['an arrow the view took itself', 'button', {}],
		['an arrow in its own text field', 'textarea', {}],
		['a modified arrow', 'button', { shiftKey: true }]
	])('keeps %s', async (name, selector, modifiers) => {
		const { view, button } = badgeView();
		const editor = mountBadge(view);
		await editor.settle();
		const host = button().parentElement!;
		if (name === 'an arrow the view took itself') {
			button().addEventListener('keydown', (e) => e.preventDefault());
		}
		const at = host.querySelector<HTMLElement>(selector)!;
		at.focus();
		await pressKey(at, { key: 'ArrowDown', ...modifiers });
		await editor.settle();
		expect(document.activeElement).toBe(at);
	});

	it.each([
		[true, 1],
		[false, 0]
	])('with watchDocument %s, gets %i update for an edit to another block', async (watch, count) => {
		const log = newViewLog();
		const view = defineBlockView({
			surface: 'none',
			watchDocument: watch,
			mount: (target) => loggedHandle(log, target)
		});
		const editor = mountBadge(view);
		await editor.settle();
		typeInto(surfaceAt(editor, [0]), 'introX');
		await editor.settle();
		expect(log.updates).toHaveLength(count);
	});

	it('may publish exactly the members MEMBER_SOURCES gives to a view', () => {
		expect([...HAND_BUILT_MEMBERS].sort()).toEqual(
			Object.entries(MEMBER_SOURCES)
				.filter(([, source]) => source === 'view')
				.map(([key]) => key)
				.sort()
		);
	});
});

describe('registering a DOM view', () => {
	const leafSpec: BlockViewSpec = {
		surface: 'leaf',
		mount: () => ({})
	};

	it('refuses a leaf surface on a container kind', () => {
		expect(() =>
			testContainer(
				'dom-wrong-container',
				{ rebuildRaw: () => {} },
				// The test helper's type leaves the view to the leaf default; the registration takes one.
				{ view: defineBlockView(leafSpec) } as never
			)
		).toThrow(/is a container, but its view's surface is 'leaf'.*defineBlockView/);
	});

	it('refuses a container surface on a leaf kind', () => {
		expect(() =>
			testLeaf('dom-wrong-leaf', {
				view: defineBlockView({ surface: 'container', mount: () => ({}) })
			})
		).toThrow(/has no container group, but its view's surface is 'container'/);
	});

	it.each([
		['an unknown surface', { surface: 'popover', mount: () => ({}) }],
		['no surface', { mount: () => ({}) }],
		['a mount that is not a function', { surface: 'none', mount: 'draw' }]
	])('refuses %s', (_name, spec) => {
		expect(() => defineBlockView(spec as unknown as BlockViewSpec)).toThrow(/defineBlockView/);
	});
});
