// Registers the title-line plugin kinds (callout, details) for the selection suites, after a
// reset, since a second registration of either would collide.

import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';

export function registerCalloutForTests(): void {
	__resetSchemaRegistriesForTests();
	registerCalloutKind();
}

export function registerChromePluginsForTests(): void {
	registerCalloutForTests();
	registerDetailsKind();
}
