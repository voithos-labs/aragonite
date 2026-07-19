import { beforeEach, describe, expect, it } from 'vitest';
import {
	declarePluginKind,
	isDirectiveRegistered,
	registerDirective,
	type CstNode
} from '$lib/plugin';
// The reset affordance is a test-only seam, deliberately kept off the public barrel.
import { __resetDirectiveRegistryForTests } from '$lib/core/directive/registry';

const PROBE = declarePluginKind('probe-note');

describe('isDirectiveRegistered (public probe)', () => {
	beforeEach(() => __resetDirectiveRegistryForTests());

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
