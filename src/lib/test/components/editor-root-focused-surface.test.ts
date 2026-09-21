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

function harness(component: Partial<BlockComponent> = {}) {
	const root = document.createElement('div');
	const host = document.createElement('div');
	host.setAttribute('data-block-path', '[1]');
	const surface = document.createElement('div');
	surface.tabIndex = 0;
	host.append(surface);
	const outside = document.createElement('button');
	root.append(host);
	document.body.append(root, outside);
	const selection = { gapCaret: null as GapCaretPosition | null };
	const doc = parse('# a\n\nprose\n');
	const focused = createFocusedSurface({
		get editorEl() {
			return root;
		},
		selection,
		getDoc: () => doc,
		getBlockComponent: () => component as BlockComponent
	});
	return { surface, outside, selection, focused };
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
