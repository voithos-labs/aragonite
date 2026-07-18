import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from '$lib';
import { declaredPluginKind } from '$lib/plugin';
import { resetPluginPlatformForTests, runKindConformance } from '$lib/testing';
import { footnotesPlugin } from '../../../../routes/test/plugins/footnotes/footnotes-plugin';
import { FOOTNOTE_DEF_KIND } from '../../../../routes/test/plugins/footnotes/constants';

describe('footnote definition conformance', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('passes the headless closure battery for its declared cells', async () => {
		const report = await runKindConformance(declaredPluginKind(FOOTNOTE_DEF_KIND));
		expect(report).toBeDefined();
	});
});
