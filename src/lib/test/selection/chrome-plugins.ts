// Registers the title-line plugin kinds (callout, details) for the selection suites.

import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsPageWide } from '#lib/test/harness/registered-details.js';
import { testView } from '#lib/test/harness/test-view.js';

export function registerCalloutForTests(): void {
	registerCalloutKind(testView());
}

export function registerChromePluginsForTests(): void {
	registerCalloutForTests();
	registerDetailsPageWide();
}
