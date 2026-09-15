// Registers the title-line plugin kinds (callout, details) for the selection suites.
// `registerChromeLeaf` inside the kind registrations also registers a paste target; the schema
// reset alone leaves it orphaned, so both registries reset first (a second registration would
// collide).

import { __resetPasteSurfacesForTests } from '../../tree-operations/paste-surfaces';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';

export function registerCalloutForTests(): void {
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerCalloutKind();
}

export function registerChromePluginsForTests(): void {
	registerCalloutForTests();
	registerDetailsKind();
}
