import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { updateNodeContent } from '$lib/tree-operations';
import { checkStaleRaw } from '$lib/invariants/node-shape';
import { admonitionsPlugin } from '$lib/plugins/admonitions';

// Typing `> [!TIP]` reparses a paragraph into a marker-only (empty) alert. The editor
// backfills a focus paragraph, but the typed raw (`> [!TIP]`, no body line) can't
// account for it — unlike a blockquote, whose `>` line doubles as the blank body. So
// the reparse must rebuild the alert's raw from the backfilled body, or G1.1 fires.
// Miss-analysis: the empty-container backfill path had no marker-consuming container
// to expose it (every prior plugin container carries chrome or required content).

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
