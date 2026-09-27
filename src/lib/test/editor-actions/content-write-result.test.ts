// What `updateBlockContent` hands back before and after the write lands: whether the reading-mode
// check admitted it, whether bytes landed, and whether the block keeps its own caret.
// Miss-analysis: the write returned its caret before asking the check, and every caller parked it;
// only each route's own reading-mode check kept a refused write from parking a caret.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { installPlugins } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { GITHUB_ALERT } from '$lib/plugins/admonitions/kinds';
import type { ContentWrite } from '$lib/action-contracts';
import { serialize } from '$lib/core/serializer';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import { fixtureReading } from '../harness/fixture-grammar';
import { makeNestedHarness, makeTopHarness } from '../harness/editor-actions';
import { takeDevWarns } from '../support/warn-gate';

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

function readingWrites(): number {
	return takeDevWarns().filter((w) => w.tag === READING_WRITE_TAG).length;
}

describe('a keystroke refused in reading mode', () => {
	it('at the document root: not admitted, no caret, resolves false', async () => {
		const h = makeTopHarness('one\n', { reading: fixtureReading({}, 'reading') });
		const write = h.actions.updateBlockContent(0, 'onex\n', 'authored', 3, 4);
		expect(write.admitted).toBe(false);
		expect('caret' in write).toBe(false);
		expect(await write).toBe(false);
		expect(serialize(h.deps.doc)).toBe('one\n');
		expect(readingWrites()).toBe(1);
	});

	it('inside a container: not admitted, no caret, resolves false', async () => {
		const h = makeNestedHarness('> quoted\n', { index: 0, presentationMode: 'reading' });
		const write = h.bundle.blockEdit.updateBlockContent(0, 'quotedx\n', 'authored', 6, 7);
		expect(write.admitted).toBe(false);
		expect('caret' in write).toBe(false);
		expect(await write).toBe(false);
		expect(serialize(h.deps.doc)).toBe('> quoted\n');
		expect(readingWrites()).toBe(1);
	});

	it('has no caret to read until the write is narrowed to an admitted one', () => {
		const caretOf = (write: ContentWrite): number | null => {
			// @ts-expect-error a refused write has no caret
			void write.caret;
			return write.admitted ? write.caret : null;
		};
		expect(caretOf).toBeTypeOf('function');
	});
});

describe('whether an admitted keystroke keeps the block’s caret', () => {
	it('keeps it for a same-kind write in place, which resolves true', async () => {
		const h = makeTopHarness('one\n');
		const commit = vi.spyOn(h.controller, 'commitStructural');
		const write = h.actions.updateBlockContent(0, 'onex\n', 'authored', 3, 4);
		expect(write.admitted && write.keepsCaret).toBe(true);
		expect(await write).toBe(true);
		expect(commit).not.toHaveBeenCalled();
	});

	it('gives it up for a keystroke that changes the kind, which commits', async () => {
		const h = makeTopHarness('one\n');
		const commit = vi.spyOn(h.controller, 'commitStructural');
		const write = h.actions.updateBlockContent(0, '# one\n', 'authored', 0, 2);
		expect(write.admitted && !write.keepsCaret).toBe(true);
		expect(await write).toBe(true);
		expect(commit).toHaveBeenCalledOnce();
		expect(h.deps.doc.children[0].kind).toBe('heading');
	});

	it('gives it up for a write in place that merges the block into the list above', async () => {
		const h = makeTopHarness('- a\n\nb\n');
		const commit = vi.spyOn(h.controller, 'commitStructural');
		const write = h.actions.updateBlockContent(1, '  b\n', 'authored', 0, 2);
		expect(write.admitted && !write.keepsCaret).toBe(true);
		expect(await write).toBe(true);
		expect(commit).not.toHaveBeenCalled();
		expect(h.deps.doc.children.map((c) => c.kind)).toEqual(['list']);
	});

	it('gives it up for a write in place that changes its container’s kind', async () => {
		const h = makeNestedHarness('> quoted\n', { index: 0 });
		const commit = vi.spyOn(h.controller, 'commitContainerStructural');
		const write = h.bundle.blockEdit.updateBlockContent(0, '[!TIP]\n', 'authored', 0, 6);
		expect(write.admitted && !write.keepsCaret).toBe(true);
		expect(await write).toBe(true);
		expect(commit).not.toHaveBeenCalled();
		expect(h.deps.doc.children[0].kind).toBe(GITHUB_ALERT);
	});
});
