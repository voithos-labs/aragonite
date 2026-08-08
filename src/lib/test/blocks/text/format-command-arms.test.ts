// @vitest-environment jsdom
//
// Each format command needs an arm on this block: an id with none is a dead key, and the chord
// falls through to the browser's own contenteditable bold. The arm is also what carries the
// content range in — a toggle over a heading must reach `getContentRange`, not the whole raw.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import type { CommandId } from '$lib/schema/commands';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';

function mountHeading() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const doc = parse('## Head\n');
	const blockEdit = makeStubBlockEdit();

	const instance = mount(TextEditableBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({ blockEdit, doc: { doc: () => doc } })
	});
	flushSync();

	const el = target.querySelector('.text-editable-block') as HTMLElement;
	el.focus();
	return { instance, blockEdit, el };
}

let mounted: ReturnType<typeof mountHeading>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('format command arms on a prose block', () => {
	it.each([
		['format.toggleStrong', '## **Head**\n'],
		['format.toggleEmphasis', '## *Head*\n'],
		['format.toggleStrikethrough', '## ~~Head~~\n'],
		['format.toggleCode', '## `Head`\n']
	])('%s wraps the heading content, never its prefix', (id, expected) => {
		mounted = mountHeading();

		// A selection that overhangs the `## `, the way Mod+A inside the block leaves one.
		mounted.instance.setSelection(0, 7);
		expect(mounted.instance.runCommand(id as CommandId)).toBe(true);

		expect(mounted.blockEdit.updateBlockContent).toHaveBeenCalledWith(0, expected, 3);
	});
});
