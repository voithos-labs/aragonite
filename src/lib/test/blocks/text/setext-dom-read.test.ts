// @vitest-environment jsdom
//
// A setext heading's DOM holds only its title: no mode draws the underline. Every write that
// starts from the text the block reads back from its DOM must still carry the underline.
// Miss-analysis: cells and code blocks had mount-level typing tests and prose blocks had none,
// and the shape property's retype gesture wrote the stored raw back rather than the DOM's text.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { parse } from '$lib/core/parser';
import { installLayoutStubs, mountEditor, surfaceAt, type MountedEditor } from '../editor-mount';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { editorMountContext } from '../../harness/mount-context';
import { installMathInline } from './math-widget-fixture';

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

describe('a widget source shown in a setext heading folds back with the underline', () => {
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

	const flush = () => new Promise((resolve) => setTimeout(resolve));

	it('an edited source writes the underline back', async () => {
		const { instance, blockEdit, el } = mountMathHeading();
		expect(instance.enterEdgeWidget('start')).toBe(true);
		await flush();
		const source = Array.from(el.childNodes).find((c) => c.nodeType === Node.TEXT_NODE);
		source!.textContent = '$y$';

		instance.runCommand('block.split');
		await flush();

		expect(blockEdit.updateBlockContent).toHaveBeenCalledWith(
			0,
			'$y$\n---\n',
			expect.any(Number),
			expect.any(Number)
		);
		await unmount(instance);
	});

	it('an untouched source folds without a write', async () => {
		const { instance, blockEdit } = mountMathHeading();
		expect(instance.enterEdgeWidget('start')).toBe(true);
		await flush();

		instance.runCommand('block.split');
		await flush();

		expect(blockEdit.updateBlockContent).not.toHaveBeenCalled();
		await unmount(instance);
	});
});
