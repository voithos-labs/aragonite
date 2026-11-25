/**
 * The details package's own block type registered through the process-wide registrars, for the
 * suites that read with the page's grammar (`parse(source)`, `installPlugins`): its reading,
 * writing, drawing and fold are the package's, only where it is installed differs. Its kinds are `details`
 * and `details.title`; an editor listing the `details` plugin names them `details/details`.
 */
import { definePlugin, type EditorPlugin } from '#lib/plugin.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import { makingOf } from '#lib/schema/block-type.js';
import { installPluginList } from '#lib/schema/plugin-unit.js';
import {
	registerBlockKind,
	type BlockKindRegistration
} from '#lib/schema/block-kind-descriptor.js';
import { details } from '#packages/details/src/index.js';

export const DETAILS = 'details';
export const DETAILS_SUMMARY = 'details.title';

/** Registers the type and its title row; once per process, as any registration. */
export function registerDetailsPageWide(): void {
	const [unit] = installPluginList([details], ({ cause }) => {
		throw cause;
	});
	// A contribution no editor installed, so its type keeps its local name.
	const making = makingOf(unit.contribution.blocks![0])!;
	const kind = declarePluginKind(making.local);
	const [opener] = making.openers(kind);
	registerBlockKind(kind, {
		...making.registration,
		view: making.view,
		opener
	} as BlockKindRegistration);
	for (const row of making.rows?.(kind) ?? []) {
		registerBlockKind(row.kind, { ...row.registration, view: row.view } as BlockKindRegistration);
	}
}

/** The same as a `setup` plugin, for a list `installPlugins` or an editor's `plugins` takes. */
export function registeredDetails(): EditorPlugin {
	return definePlugin({ name: 'registered-details', setup: registerDetailsPageWide });
}
