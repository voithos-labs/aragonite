import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { checkOpaqueStaleRaw } from '../../invariants/node-shape';
import { admonitionsPlugin } from '$lib/plugins/admonitions';

// G1.12's divergence arm bails for a kind with no standalone recognizer. A
// directive container HAS one — the shared `:::` opener recognizes it on the
// kind's behalf — but registers no opener under its own kind, so an
// opener-registry-only probe exempted the entire directive tier: exactly the
// tier the plugin guide recommends authors use.
beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('checkOpaqueStaleRaw — the recognizer probe spans both registries', () => {
	it('fires when a directive container raw no longer reparses to its own kind', () => {
		const node = parse(':::note T\n\nbody\n\n:::\n').children[0];
		expect(node.kind).toBe('admonition');
		node.raw = ':::note T\n\nbefore\n:::\nafter\n\n:::\n';

		const violation = checkOpaqueStaleRaw(node);
		expect(violation?.code).toBe('opaque-stale-raw');
		expect(violation?.detail).toMatchObject({ reason: 'reparse-diverges' });
	});

	it('fires when a directive container raw reparses to a plain paragraph', () => {
		const node = parse(':::note T\n\nbody\n\n:::\n').children[0];
		node.raw = 'just a paragraph now\n';
		expect(checkOpaqueStaleRaw(node)?.code).toBe('opaque-stale-raw');
	});

	it('stays silent on a faithfully parsed directive container', () => {
		const node = parse(':::note T\n\nbody\n\n:::\n').children[0];
		expect(checkOpaqueStaleRaw(node)).toBeNull();
	});
});
