/**
 * Checks that a plugin was defined by the copy of the editor installing it. A plugin package that
 * resolved its own copy of the core registers into that copy's registries, which this editor
 * never reads, so its blocks parse as plain Markdown with no error anywhere.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

/** One loaded copy of the editor's code, told apart by identity. */
export interface CoreCopy {
	readonly version: string;
}

export function checkDefinedByThisCopy(
	pluginName: string,
	definedBy: CoreCopy | undefined,
	thisCopy: CoreCopy
): InvariantViolation | null {
	if (definedBy === undefined || definedBy === thisCopy) return null;
	return {
		code: 'plugin-second-core-copy',
		message:
			`plugin '${pluginName}' was defined by another copy of @voithos-labs/aragonite ` +
			`(${definedBy.version}) than the editor runs (${thisCopy.version}), so what it registers ` +
			"lands in registries this editor never reads. Install one copy: a plugin package peers the editor's exact version."
	};
}
