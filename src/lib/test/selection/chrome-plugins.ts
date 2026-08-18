// Chrome-plugin registration for the selection suites. registerChromeLeaf (inside the kind
// registrations) registers a paste surface; the schema reset alone leaves it orphaned, so both
// registries reset before re-registering (a re-register would collide).

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
