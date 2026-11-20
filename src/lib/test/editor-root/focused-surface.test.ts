// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFocusedSurface } from '#lib/components/editor-root/focused-surface.js';
import { parse } from '#lib/core/parser.js';
import type { BlockComponent } from '#lib/block-component.js';
import type { GapCaretPosition } from '#lib/selection/gap-caret.js';

// Miss-analysis: the entry points were tested only with a caret in a block, never at a gap.

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

	it('the command target carries the node kind and forwards to the block', () => {
		const runCommand = vi.fn(() => true);
		const isCommandActive = vi.fn(() => true);
		const h = harness({ runCommand, isCommandActive });
		h.surface.focus();
		const target = h.focused.commandTarget()!;
		expect(target.kind).toBe('paragraph');
		expect(target.runCommand?.('x' as never, 1)).toBe(true);
		expect(runCommand).toHaveBeenCalledWith('x', 1, undefined);
		expect(target.isCommandActive?.('x' as never)).toBe(true);
	});

	// A block with no command bodies of its own still moves: the dispatch runs its reorder
	// against the path, and every other built-in id declines for want of a `runCommand`.
	it('a block with no command bodies is a target that only carries its path', () => {
		const h = harness({ focusable: true });
		h.surface.focus();
		const target = h.focused.commandTarget()!;
		expect(target.runCommand).toBeUndefined();
		expect(target.getPath?.()).toEqual(h.focused.path());
	});
});
