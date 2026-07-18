// Vitest setup: register the built-in block-kind descriptors before any test
// runs. In production the mount path (components/built-in-blocks.ts) and the
// headless inline surface (core/inline) each anchor this registration; unit
// tests exercise internal modules (tree-operations, schema, invariants) in
// isolation, below both anchors, so the platform is bootstrapped here instead.
// Register-once makes a redundant load from a test's own import graph a no-op.
import '$lib/schema/built-in-descriptors';
