import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { composeCollapseProbe } from '../../editor-actions/plugin/container';
import { getPluginMetadata, setPluginMetadata, type CstNode } from '../../core/nodes';
import { declarePluginKind } from '../../schema/plugin-kind';
import { registerBlockKind } from '../../schema/block-kind-descriptor';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { configureEditorEnv, resetEditorEnv } from '../../env';

// A collapsible container kind whose declared `reservedChrome.isCollapsed` probe
// reads an `open` metadata flag — the dogfood details declaration shape without
// its rendering.
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
	afterEach(() => resetEditorEnv());

	it('derives from the descriptor probe when no explicit dep is supplied', () => {
		const kind = registerCollapsible();
		const probeCollapsed = composeCollapseProbe(undefined, () => containerNode(kind, false));
		const probeOpen = composeCollapseProbe(undefined, () => containerNode(kind, true));

		expect(probeCollapsed()).toBe(true); // open:false -> collapsed
		expect(probeOpen()).toBe(false);
	});

	it('uses an explicit dep that agrees with the descriptor probe, without warning', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false });
		const kind = registerCollapsible();
		const node = containerNode(kind, false); // descriptor probe -> collapsed

		const probe = composeCollapseProbe(
			() => true,
			() => node
		); // explicit agrees

		expect(probe()).toBe(true);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('dev-warns when the explicit dep disagrees with the descriptor probe', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false });
		const kind = registerCollapsible();
		const node = containerNode(kind, false); // descriptor probe -> collapsed (true)

		const probe = composeCollapseProbe(
			() => false,
			() => node,
			() => 'source'
		); // explicit disagrees

		expect(probe()).toBe(false); // the explicit dep still wins the value
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toMatch(/plugin-container/);
		expect(warnSpy.mock.calls[0][0]).toMatch(/disagrees/);
		expect(warnSpy.mock.calls[0][0]).toMatch(/collapse-probe-container/);
		warnSpy.mockRestore();
	});

	// Reading mode is the ONE place a view/document divergence is legitimate: a reader
	// may open a collapsed container transiently, and that flip writes no bytes by
	// construction. The cross-check has to allow it, or the affordance dev-warns on
	// every read for as long as the reader leaves the section open.
	it('allows a reading-mode view divergence without warning', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false });
		const kind = registerCollapsible();
		const node = containerNode(kind, false); // the document says collapsed

		const probe = composeCollapseProbe(
			() => false, // the reader transiently opened it
			() => node,
			() => 'reading'
		);

		expect(probe()).toBe(false);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	// The carve-out is scoped to reading, not to "any mode with a getter": the live
	// preview modes edit, so a divergence there is still the half-collapsed hybrid the
	// cross-check exists to catch.
	it('still warns in a live preview mode', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false });
		const kind = registerCollapsible();
		const node = containerNode(kind, false);

		const probe = composeCollapseProbe(
			() => false,
			() => node,
			() => 'preview-block'
		);

		expect(probe()).toBe(false);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		warnSpy.mockRestore();
	});
});
