# Feature: Keyboard Navigation — After Structural Ops

Cross-feature: navigation after structural operations (split / merge / delete) shifts indices, so container-block navigation must remain correct after the op.

## Cross-feature: navigation after structural operations

- ArrowDown through a container (blockquote) after splitBlock lands in the correct next block, not one past it
- ArrowDown exiting a list after splitBlock lands in the correct next block, not one past it
- ArrowDown after M1 list merge near a container traverses to the correct next block
- ArrowDown after cross-container merge into a blockquote traverses to the correct next block
