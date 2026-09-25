import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { updateNodeContent } from '$lib/tree-operations';
import { checkStaleRaw } from '$lib/invariants/node-shape';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { fixtureGrammar } from '$lib/test/harness/fixture-grammar';

// Typing `> [!TIP]` reparses into a marker-only alert whose raw cannot account for the empty
// paragraph the editor adds for the caret; a blockquote's `>` line doubles as that blank body,
// an alert's marker line does not. The reparse has to rebuild the raw from that body, or the
// raw and the children disagree (G1.1).

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('github alert: empty-body backfill stays consistent', () => {
	it('reparsing a paragraph into a marker-only alert rebuilds raw for the backfilled body', () => {
		const doc = parse('para\n');
		updateNodeContent(doc, 0, '> [!TIP]', fixtureGrammar);

		const alert = doc.children[0];
		expect(alert.kind).toBe('githubAlert');
		expect(alert.children?.length).toBe(1);
		expect(alert.raw).toBe('> [!TIP]\n>\n');
		expect(checkStaleRaw(alert)).toBeNull();
	});
});
