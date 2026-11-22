// The same check `aragonite-plugin-check` and a plugin listing run over your published package.
import { expect, it } from 'vitest';
import { check } from '@voithos-labs/aragonite/testing';
import suite from '../src/conformance';

it('the parrot passes every check', async () => {
	const report = await check(suite.plugin, suite);
	expect(report.plugin).toBe('parrot');
});
