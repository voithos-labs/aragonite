import { declarePluginKind } from 'aragonite/plugin';
import type { BlockKindDescriptor } from 'aragonite/plugin';

// Type-level proof the frozen authoring surface resolves from outside the repo.
// Not called at runtime — WS-B builds the real callout registration.
export const _probe = (): { kind: string; describe: (d: BlockKindDescriptor) => string } => ({
	kind: declarePluginKind('probe-kind'),
	describe: (d) => d.mergeRole
});
