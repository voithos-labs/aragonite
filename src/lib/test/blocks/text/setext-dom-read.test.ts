// @vitest-environment jsdom
//
// A setext heading's DOM holds only its title: no mode draws the underline. A write from the text
// the block reads back carries the underline, unless the title's last line is empty.
// Miss-analysis: prose blocks had no mount-level typing tests, the shape property's retype writes
// the stored bytes back and never reads the DOM, and no typing case erased the title.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import { installLayoutStubs, mountEditor, surfaceAt, type MountedEditor } from '../editor-mount';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';
import { installMathInline } from './math-widget-fixture';
import { settleEditor } from '$lib/test/harness/settle';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

/** Replace the heading's rendered text and fire the input the browser would. */
async function typeInto(el: HTMLElement, text: string): Promise<void> {
	el.focus();
	el.textContent = text;
	el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
	await mounted!.settle();
}

describe('typing into a setext heading keeps its underline', () => {
	it.each([
		['a --- underline', 'Plan\n---\n', 'Plans\n---\n'],
		['a === underline', 'Plan\n===\n', 'Plans\n===\n'],
		['a long underline', 'Plan\n----------\n', 'Plans\n----------\n'],
		['CRLF endings', 'Plan\r\n===\r\n', 'Plans\r\n===\r\n'],
		['a two-line title', 'Plan\nB\n---\n', 'Plan\nBs\n---\n']
	])('%s', async (_label, source, typed) => {
		mounted = mountEditor({ source });
		const el = surfaceAt(mounted, [0]);
		expect(el.textContent).not.toMatch(/[-=]{3}/);

		await typeInto(el, typed.slice(0, typed.search(/\r?\n[-=]+\r?\n$/)));

		expect(mounted.source()).toBe(typed);
	});
});

describe('erasing a setext title drops its underline', () => {
	it.each([
		['a === underline', 'Plan\n===\n', '', '\n'],
		['a --- underline', 'Plan\n---\n', '', '\n'],
		['a long underline', 'Plan\n----------\n', '', '\n'],
		['CRLF endings', 'Plan\r\n===\r\n', '', '\r\n'],
		['a title left as a space', 'Plan\n===\n', ' ', ' \n'],
		['the last line of a two-line title', 'Plan\nmore\n---\n', 'Plan\n', 'Plan\n\n']
	])('%s', async (_label, source, left, written) => {
		mounted = mountEditor({ source });

		await typeInto(surfaceAt(mounted, [0]), left);

		expect(mounted.source()).toBe(written);
		expect(mounted.target.textContent).not.toMatch(/[-=]{3}/);
		expect(mounted.target.querySelector('hr')).toBeNull();
	});
});

describe('a widget source shown in a setext heading closes with the underline', () => {
	installMathInline();

	function mountMathHeading() {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const doc = parse('$x$\n---\n');
		const blockEdit = makeStubBlockEdit();
		const instance = mount(TextEditableBlock, {
			target,
			props: { node: doc.children[0], index: 0, myPath: [0] },
			context: editorMountContext({ blockEdit, doc: { doc: () => doc } })
		});
		flushSync();
		const el = target.querySelector('.text-editable-block') as HTMLElement;
		return { instance, blockEdit, el };
	}

	it('an edited source writes the underline back', async () => {
		const { instance, blockEdit, el } = mountMathHeading();
		expect(instance.enterEdgeWidget('start')).toBe(true);
		await settleEditor();
		const source = Array.from(el.childNodes).find((c) => c.nodeType === Node.TEXT_NODE);
		source!.textContent = '$y$';

		instance.runCommand('block.split');
		await settleEditor();

		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(
			0,
			'$y$\n---\n',
			expect.any(Number),
			expect.any(Number)
		);
		await unmount(instance);
	});

	it('an untouched source closes without a write', async () => {
		const { instance, blockEdit } = mountMathHeading();
		expect(instance.enterEdgeWidget('start')).toBe(true);
		await settleEditor();

		instance.runCommand('block.split');
		await settleEditor();

		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
		await unmount(instance);
	});
});
