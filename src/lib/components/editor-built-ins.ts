/**
 * The editor's own registrations (built-in blocks, code languages), run before an editor mounts.
 * They run as no plugin, so each belongs to the editor and survives the test reset even when a
 * plugin's setup is the first thing to reach them.
 */
import { registerAsCore } from '../schema/plugin-install';
import { registerBuiltInBlocks } from './built-in-blocks';
import { bootstrapCodeLanguages } from './blocks/code/code-bootstrap';

export function registerEditorBuiltIns(): void {
	registerAsCore(() => {
		registerBuiltInBlocks();
		bootstrapCodeLanguages();
	});
}
