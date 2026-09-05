// @vitest-environment jsdom
//
// `editor.getBlockKindAt` through a real mount, reached from the barrel the way a host reaches it:
// the read that replaces probing the rendered DOM for a block's class.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { AnyBlockKind, EditorInstance } from '$lib';
import { installLayoutStubs, mountEditor, type MountedEditor } from './editor-mount';

beforeAll(() => installLayoutStubs());

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
	document.body.innerHTML = '';
});

const SOURCE = '# Title\n\n> quoted line\n\n| a | b |\n| --- | --- |\n| c | d |\n';

/** The read as a consumer types it: the barrel's handle, the barrel's kind vocabulary. */
function kindReader(): (path: number[]) => AnyBlockKind | null {
	mounted = mountEditor({ source: SOURCE });
	const editor: EditorInstance = mounted.instance;
	return (path) => editor.getBlockKindAt(path);
}

describe('the kind-at-path read', () => {
	it('answers the kind at every depth the document has', () => {
		const kindAt = kindReader();

		expect(kindAt([0])).toBe('heading');
		expect(kindAt([1])).toBe('blockquote');
		expect(kindAt([1, 0])).toBe('paragraph');
		expect(kindAt([2])).toBe('table');
		expect(kindAt([2, 0])).toBe('tableRow');
		expect(kindAt([2, 0, 0])).toBe('tableCell');
	});

	it('answers null for a path addressing no block, the document root included', () => {
		const kindAt = kindReader();

		// The root is the document, not a block.
		expect(kindAt([])).toBeNull();
		expect(kindAt([9])).toBeNull();
		expect(kindAt([0, 0])).toBeNull();
		expect(kindAt([2, 0, 9])).toBeNull();
		expect(kindAt([-1])).toBeNull();
	});

	// The reason the read exists: a host excluding tables from a selection-anchored affordance
	// asks the path it already holds, instead of a document-global DOM class probe.
	it('discriminates a table endpoint from a prose one by path alone', () => {
		const kindAt = kindReader();
		const insideTable = (path: number[]) =>
			path.some((_, i) => kindAt(path.slice(0, i + 1)) === 'table');

		expect(insideTable([2, 0, 0])).toBe(true);
		expect(insideTable([1, 0])).toBe(false);
	});
});
