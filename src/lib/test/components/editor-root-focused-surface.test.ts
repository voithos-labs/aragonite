// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFocusedSurface } from '$lib/components/editor-root-focused-surface';
import { parse } from '$lib/core/parser';
import type { BlockComponent } from '$lib/block-component';
import type { GapCaretPosition } from '$lib/selection/gap-caret';

// Miss-analysis: the public entry points were tested through a mounted editor with a caret in
// a block, so nothing named what they answer for a gap caret, a focus outside the root, or a
// block that runs no commands.

beforeEach(() => {
	document.body.replaceChildren();
});

/** A focusable surface inside a block host at `path`. */
function surfaceAt(path: number[]): { host: HTMLElement; surface: HTMLElement } {
	const host = document.createElement('div');
	host.setAttribute('data-block-path', JSON.stringify(path));
	const surface = document.createElement('div');
	surface.tabIndex = 0;
	host.append(surface);
	return { host, surface };
}

function harness(component: Partial<BlockComponent> = {}) {
	const root = document.createElement('div');
	const { host, surface } = surfaceAt([1]);
	// The paragraph a `below` insert creates, which takes focus the way a new block does.
	const created = surfaceAt([2]);
	const nested = surfaceAt([1, 0]);
	host.append(nested.host);
	const outside = document.createElement('button');
	root.append(host, created.host);
	document.body.append(root, outside);
	const selection = { gapCaret: null as GapCaretPosition | null };
	const doc = parse('# a\n\nprose\n');
	let reading = false;
	const calls: string[] = [];
	const insertParagraph = vi.fn(async (boundary: number) => {
		calls.push(`paragraph at ${boundary}`);
		created.surface.focus();
	});
	const focused = createFocusedSurface({
		get editorEl() {
			return root;
		},
		selection,
		getDoc: () => doc,
		getBlockComponent: (path) => {
			const insertMarkdown = component.insertMarkdown;
			return {
				...component,
				insertMarkdown: insertMarkdown
					? (md: string) => (
							calls.push(`insert ${md.trim()} at ${JSON.stringify(path)}`),
							insertMarkdown(md)
						)
					: undefined
			} as BlockComponent;
		},
		isReading: () => reading,
		insertParagraph
	});
	return {
		surface,
		nestedSurface: nested.surface,
		outside,
		selection,
		focused,
		calls,
		insertParagraph,
		setReading: (next: boolean) => (reading = next)
	};
}

describe('editor-root focused surface', () => {
	it('resolves the block whose surface holds focus', () => {
		const h = harness();
		h.surface.focus();
		expect(h.focused.path()).toEqual([1]);
	});

	it('declines a gap caret and a focus outside the root', () => {
		const h = harness();
		h.surface.focus();
		h.selection.gapCaret = { parentPath: [], index: 1 } as GapCaretPosition;
		expect(h.focused.path()).toBeNull();
		h.selection.gapCaret = null;
		h.outside.focus();
		expect(h.focused.path()).toBeNull();
	});

	it('insertMarkdown routes to the focused surface and reports its answer', () => {
		const insertMarkdown = vi.fn(() => true);
		const h = harness({ insertMarkdown });
		expect(h.focused.insertMarkdown('- ')).toBe(false);
		h.surface.focus();
		expect(h.focused.insertMarkdown('- ')).toBe(true);
		expect(insertMarkdown).toHaveBeenCalledWith('- ');
	});

	it('insertMarkdown below makes a paragraph after the focused block, then inserts there', async () => {
		const h = harness({ insertMarkdown: () => true });
		h.surface.focus();
		expect(h.focused.insertMarkdown('> ', { placement: 'below' })).toBe(true);
		await vi.waitFor(() => expect(h.calls).toEqual(['paragraph at 2', 'insert > at [2]']));
	});

	it('insertMarkdown below from a nested block goes after its top-level block', async () => {
		const h = harness({ insertMarkdown: () => true });
		h.nestedSurface.focus();
		expect(h.focused.insertMarkdown('> ', { placement: 'below' })).toBe(true);
		await vi.waitFor(() => expect(h.calls).toEqual(['paragraph at 2', 'insert > at [2]']));
	});

	it('insertMarkdown below declines with no caret and in reading mode, making nothing', () => {
		const h = harness({ insertMarkdown: () => true });
		expect(h.focused.insertMarkdown('> ', { placement: 'below' })).toBe(false);
		h.surface.focus();
		h.setReading(true);
		expect(h.focused.insertMarkdown('> ', { placement: 'below' })).toBe(false);
		expect(h.insertParagraph).not.toHaveBeenCalled();
	});

	it('the command target carries the node kind and forwards to the block', () => {
		const runCommand = vi.fn(() => true);
		const isCommandActive = vi.fn(() => true);
		const h = harness({ runCommand, isCommandActive });
		h.surface.focus();
		const target = h.focused.commandTarget()!;
		expect(target.kind).toBe('paragraph');
		expect(target.runCommand('x' as never, 1)).toBe(true);
		expect(runCommand).toHaveBeenCalledWith('x', 1);
		expect(target.isCommandActive?.('x' as never)).toBe(true);
	});

	it('a block with no command surface is no target', () => {
		const h = harness({ insertMarkdown: () => true });
		h.surface.focus();
		expect(h.focused.commandTarget()).toBeNull();
	});
});
