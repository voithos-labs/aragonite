import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { updateNodeContent } from '$lib/tree-operations';
import { checkStaleRaw } from '$lib/invariants/node-shape';
import { admonitionsPlugin } from '$lib/plugins/admonitions';

// Typing `> [!TIP]` reparses into a marker-only alert whose raw cannot account for the
// focus paragraph the editor backfills — unlike a blockquote, whose `>` line doubles as
// the blank body. The reparse must rebuild the raw from that body, or G1.1 fires.

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('github alert — empty-body backfill stays consistent', () => {
	it('reparsing a paragraph into a marker-only alert rebuilds raw for the backfilled body', () => {
		const doc = parse('para\n');
		updateNodeContent(doc, 0, '> [!TIP]');

		const alert = doc.children[0];
		expect(alert.kind).toBe('githubAlert');
		expect(alert.children?.length).toBe(1);
		expect(alert.raw).toBe('> [!TIP]\n>\n');
		expect(checkStaleRaw(alert)).toBeNull();
	});
});
