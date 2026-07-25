import { declarePluginKind } from 'aragonite/plugin';
import type { BlockKindDescriptor } from 'aragonite/plugin';

// Type-level proof the frozen authoring surface resolves from outside the repo.
// Not called at runtime — the runtime callout registration lives in
// src/plugins/callout; this file only proves the types resolve.
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

// Type-level proof the `aragonite/testing` subpath resolves from outside the repo —
// the seam a third-party plugin's own suite installs against, so a break here breaks
// every external author at once. Type-only by necessity, not convenience: the barrel
// is test-process-only (`resetPluginPlatformForTests` throws outside a detected test
// env), so a runtime import would pull a test seam into an app bundle.
//
// One entry per re-export cluster, because each pulls a different declaration file:
// the failure this guards is the barrel reaching into `src/lib/test/**`, and a single
// probe would only prove the cluster it happens to name.
export type TestingSurfaceProbe = {
	reset: typeof import('aragonite/testing').resetPluginPlatformForTests;
	containerConformance: typeof import('aragonite/testing').runContainerConformance;
	kindConformance: typeof import('aragonite/testing').runKindConformance;
};
