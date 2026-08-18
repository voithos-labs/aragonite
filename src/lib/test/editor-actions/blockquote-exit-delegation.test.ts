import { describe, it, expect, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { createContainerExitOverrides } from '$lib/editor-actions/container-exit-overrides';
import { makeStubBlockEdit, makeStubFocus } from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';

// The exit is ONE parent-scope replaceBlock, so its event path and undo entry belong to
// that commit. What is the override's own is the delegation: the trimmed quote plus the
// minted gap, caret on the gap, input untouched.

function overridesOver(node: CstNode, parentBlockEdit: ReturnType<typeof makeStubBlockEdit>) {
	return createContainerExitOverrides({
		scope: {
			get index() {
				return 0;
			},
			get node() {
				return node;
			},
			get path() {
				return [1, 0];
			}
		},
		parentBlockEdit
	})({
		blockEdit: makeStubBlockEdit(),
		focus: makeStubFocus(),
		containerEdit: {} as never
	});
}

describe('blockquote exit delegates one parent replaceBlock', () => {
	it('hands the parent the trimmed quote and the minted gap', async () => {
		// The shape the first Enter leaves: content, the separator line, then the blank
		// block it made — a single blank inner line would be trivia, not a child.
		const quote = parse('> a\n>\n>\n').children[0];
		const parentBlockEdit = makeStubBlockEdit();

		await overridesOver(quote, parentBlockEdit).blockEdit!.splitBlock!(1, 0);

		expect(parentBlockEdit.replaceBlock).toHaveBeenCalledTimes(1);
		const [index, replacement, focus] = vi.mocked(parentBlockEdit.replaceBlock).mock.calls[0];
		expect(index).toBe(0);
		expect(replacement.map((n: CstNode) => n.raw)).toEqual(['> a\n', '\n']);
		expect(replacement[1]).toMatchObject({ kind: 'paragraph', leadingTrivia: '\n' });
		expect(focus).toEqual({ replacementIndex: 1, offset: 0 });
		// The replacement is fresh clones, so the live quote is untouched until the commit.
		expect(quote.raw).toBe('> a\n>\n>\n');
		expect(quote.children).toHaveLength(2);
	});

	it('leaves a non-trailing Enter to the default split', async () => {
		const quote = parse('> a\n>\n>\n').children[0];
		const parentBlockEdit = makeStubBlockEdit();
		const defaults = { blockEdit: makeStubBlockEdit(), focus: makeStubFocus() };

		const overrides = createContainerExitOverrides({
			scope: {
				get index() {
					return 0;
				},
				get node() {
					return quote;
				},
				get path() {
					return [1, 0];
				}
			},
			parentBlockEdit
		})({ ...defaults, containerEdit: {} as never });

		await overrides.blockEdit!.splitBlock!(0, 1);

		expect(parentBlockEdit.replaceBlock).not.toHaveBeenCalled();
		expect(defaults.blockEdit.splitBlock).toHaveBeenCalledWith(0, 1);
	});
});
