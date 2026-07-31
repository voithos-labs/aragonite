// Vitest setup. Unit tests exercise internal modules below both production anchors
// of built-in registration (components/built-in-blocks.ts and core/inline), so the
// platform is bootstrapped here; register-once makes a redundant load a no-op.
import { registerBuiltInDescriptors } from '$lib/schema/built-in-descriptors';

registerBuiltInDescriptors();
