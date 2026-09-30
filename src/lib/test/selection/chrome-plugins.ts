// Registers the title-line plugin kinds (callout, details) for the selection suites.

import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';

export function registerCalloutForTests(): void {
	registerCalloutKind();
}

export function registerChromePluginsForTests(): void {
	registerCalloutForTests();
	registerDetailsKind();
}
