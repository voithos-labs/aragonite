import { beforeEach, describe, expect, it } from 'vitest';
import {
	declarePluginKind,
	isDirectiveRegistered,
	registerDirective,
	type CstNode
} from '$lib/plugin';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
// The reset function is test-only, deliberately kept off the public barrel.

const PROBE = declarePluginKind('probe-note');

describe('isDirectiveRegistered (public probe)', () => {
	beforeEach(() => __resetSchemaRegistriesForTests());

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
