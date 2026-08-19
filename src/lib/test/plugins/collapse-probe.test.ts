import { describe, it, expect, beforeEach } from 'vitest';
import { composeCollapseProbe } from '$lib/editor-actions/plugin/container';
import { getPluginMetadata, setPluginMetadata, type CstNode } from '$lib/core/nodes';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { takeDevWarns } from '$lib/test/support/warn-gate';

// The dogfood details declaration shape without its rendering: a `reservedChrome`
// collapse probe reading an `open` metadata flag.
function registerCollapsible(): ReturnType<typeof declarePluginKind> {
	const chrome = declarePluginKind('collapse-probe-chrome');
	const kind = declarePluginKind('collapse-probe-container');
	registerBlockKind(kind, {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		closure: testClosure,
		// The probe never commits, so an inert strip contract + noop rebuild satisfy
		// the group's required pairing.
		container: {
			contract: 'strip',
			rebuildRaw: () => {},
			reservedChrome: {
				kind: chrome,
				isCollapsed: (n) => !getPluginMetadata<{ open: boolean }>(n)?.open
			}
		}
	});
	return kind;
}

function containerNode(kind: ReturnType<typeof declarePluginKind>, open: boolean): CstNode {
	const node: CstNode = { kind, leadingTrivia: '', raw: '' };
	setPluginMetadata(node, { open });
	return node;
}

describe('composeCollapseProbe', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

	it('derives from the descriptor probe when no explicit dep is supplied', () => {
		const kind = registerCollapsible();
		const probeCollapsed = composeCollapseProbe(undefined, () => containerNode(kind, false));
		const probeOpen = composeCollapseProbe(undefined, () => containerNode(kind, true));

		expect(probeCollapsed()).toBe(true); // open:false -> collapsed
		expect(probeOpen()).toBe(false);
	});

	it('uses an explicit dep that agrees with the descriptor probe, without warning', () => {
		const kind = registerCollapsible();
		const node = containerNode(kind, false); // descriptor probe -> collapsed

		const probe = composeCollapseProbe(
			() => true,
			() => node
		); // explicit agrees

		expect(probe()).toBe(true);
		expect(takeDevWarns()).toEqual([]);
	});

	it('dev-warns when the explicit dep disagrees with the descriptor probe', () => {
		const kind = registerCollapsible();
		const node = containerNode(kind, false); // descriptor probe -> collapsed (true)

		const probe = composeCollapseProbe(
			() => false,
			() => node,
			() => 'source'
		); // explicit disagrees

		expect(probe()).toBe(false); // the explicit dep still wins the value
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].tag).toBe('plugin-container');
		expect(fires[0].message).toMatch(/disagrees/);
		expect(fires[0].message).toMatch(/collapse-probe-container/);
	});

	// Reading mode is the ONE place a view/document divergence is legitimate, because a
	// reader's flip writes no bytes by construction. Without the carve-out the
	// affordance dev-warns for as long as the reader leaves the section open.
	it('allows a reading-mode view divergence without warning', () => {
		const kind = registerCollapsible();
		const node = containerNode(kind, false); // the document says collapsed

		const probe = composeCollapseProbe(
			() => false, // the reader transiently opened it
			() => node,
			() => 'reading'
		);

		expect(probe()).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});

	// Scoped to reading, not "any mode with a getter": a preview mode edits, so a
	// divergence there is still the half-collapsed hybrid the cross-check catches.
	it('still warns in a live preview mode', () => {
		const kind = registerCollapsible();
		const node = containerNode(kind, false);

		const probe = composeCollapseProbe(
			() => false,
			() => node,
			() => 'preview-block'
		);

		expect(probe()).toBe(false);
		expect(takeDevWarns()).toHaveLength(1);
	});
});
