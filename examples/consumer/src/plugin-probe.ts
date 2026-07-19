import { declarePluginKind } from 'aragonite/plugin';
import type { BlockKindDescriptor } from 'aragonite/plugin';

// Type-level proof the frozen authoring surface resolves from outside the repo.
// Not called at runtime — WS-B builds the real callout registration.
export const _probe = (): { kind: string; describe: (d: BlockKindDescriptor) => string } => ({
	kind: declarePluginKind('probe-kind'),
	describe: (d) => d.mergeRole
});

// Type-level proof the mermaid renderer subpath resolves from outside the repo. A
// runtime import would pull renderer.ts's dynamic `import('mermaid')` into the
// consumer bundle, but the consumer wires no mermaid engine (see routes/plugins) —
// so this stays a type-only import: erased at build, never bundled.
export type MermaidRendererProbe =
	typeof import('aragonite/plugins/mermaid/renderer').mermaidRenderer;
