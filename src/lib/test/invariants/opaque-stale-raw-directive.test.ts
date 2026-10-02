import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins, parse } from '$lib';
import { checkOpaqueStaleRaw } from '../../invariants/node-shape';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { defaultGrammarView } from '$lib/schema/block-openers';

// The stale-raw mismatch branch (G1.12) gives up for a kind with no standalone recognizer. A
// directive container has one, since the shared `:::` opener recognizes it on the kind's behalf,
// though it registers no opener of its own, so the opener registry alone cannot exempt it.
beforeEach(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('checkOpaqueStaleRaw: the recognizer probe spans both registries', () => {
	it('fires when a directive container raw no longer reparses to its own kind', () => {
		const node = parse(':::note T\n\nbody\n\n:::\n').children[0];
		expect(node.kind).toBe('admonition');
		node.raw = ':::note T\n\nbefore\n:::\nafter\n\n:::\n';

		const violation = checkOpaqueStaleRaw(node, defaultGrammarView);
		expect(violation?.code).toBe('opaque-stale-raw');
		expect(violation?.detail).toMatchObject({ reason: 'reparse-diverges' });
	});

	it('fires when a directive container raw reparses to a plain paragraph', () => {
		const node = parse(':::note T\n\nbody\n\n:::\n').children[0];
		node.raw = 'just a paragraph now\n';
		expect(checkOpaqueStaleRaw(node, defaultGrammarView)?.code).toBe('opaque-stale-raw');
	});

	it('stays silent on a faithfully parsed directive container', () => {
		const node = parse(':::note T\n\nbody\n\n:::\n').children[0];
		expect(checkOpaqueStaleRaw(node, defaultGrammarView)).toBeNull();
	});
});
