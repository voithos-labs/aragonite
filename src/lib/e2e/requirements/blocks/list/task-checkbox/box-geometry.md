# Block: List — Task Checkbox (painted box geometry)

The rendered box is a pseudo-element centred by layout, sized to whole CSS pixels, so it
rasterises as a true square on a scaled desktop display. The lane runs at device scale 1.5,
where a translate-centred box once came out a few pixels shorter than wide.

## Rendering

- at 14, 16 and 17px type-scale roots (`--editor-font-size`), the box's computed width equals
  its height, is a whole number of pixels, and carries no transform
- the box beside a loaded `- [ ] # beta` is the same size as the box beside `- [ ] plain`, and
  stays that size at every heading level: the marker is the item's own chrome, drawn at the
  item's text size rather than the first child's
  - Miss-analysis: the checkbox specs all seed a paragraph first child, where the item's text
    size and the child's are the same number, so nothing measured the box against a child that
    scales its own text
  - Miss-analysis: `rendering.md` pins what the box paints, never its measured shape, and
    the harness's scale-1 lane hid a fractional-edge defect only a scaled display shows;
    this lane measures at the scale that showed it

## User interactions

- hovering an open box in a rendered mode tints the box alone, not the line-height-tall
  slot around it
