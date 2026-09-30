import { beforeEach, describe, expect, it } from 'vitest';
import type { PluginBlockKind } from '$lib/core/nodes';
import {
	declarePluginKind,
	isDirectiveRegistered,
	registerDirective,
	type CstNode
} from '$lib/plugin';

// The reset function is test-only, deliberately kept off the public barrel.

let PROBE: PluginBlockKind;
beforeEach(() => {
	PROBE = declarePluginKind('probe-note');
});

describe('isDirectiveRegistered (public probe)', () => {
	it('is reachable through the plugin barrel and reflects registration state', () => {
		expect(isDirectiveRegistered('container', 'probe-note')).toBe(false);
		registerDirective('container', 'probe-note', {
			kind: PROBE,
			fromDirective: (parsed) =>
				({ kind: PROBE, leadingTrivia: parsed.leadingTrivia, raw: parsed.raw }) as CstNode
		});
		expect(isDirectiveRegistered('container', 'probe-note')).toBe(true);
	});
});
