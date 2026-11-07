// The same check `aragonite-plugin-check` and a plugin listing run over your published package.
import { expect, it } from 'vitest';
import { runPluginConformance } from '@voithos-labs/aragonite/testing';
import suite from '../src/conformance';

it('the parrot passes the conformance kits', async () => {
	const report = await runPluginConformance(suite);
	expect(report.kinds.map((k) => k.kind)).toEqual(['parrot']);
});
