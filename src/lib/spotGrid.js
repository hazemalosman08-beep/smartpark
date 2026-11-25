// Tile one reference spot size across the drawn boundaries — the same math the
// scan uses, so the preview and the scanned result line up exactly.
export function buildSpotGrid(spotBox, boundaries) {
  if (!spotBox || !boundaries?.length) return [];
  const sw = spotBox.w;
  const sh = spotBox.h;
  const cells = [];
  let rowIndex = 0;

  for (const area of boundaries) {
    const cols = Math.max(1, Math.floor(area.w / sw));
    const rows = Math.max(1, Math.floor(area.h / sh));
    const x0 = area.x + (area.w - cols * sw) / 2;
    const y0 = area.y + (area.h - rows * sh) / 2;

    for (let r = 0; r < rows; r++) {
      const letter = String.fromCharCode(65 + (rowIndex % 26));
      for (let c = 0; c < cols; c++) {
        if (cells.length >= 400) return cells;
        cells.push({
          row: letter,
          index: c + 1,
          status: "free",
          x: x0 + c * sw + sw / 2,
          y: y0 + r * sh + sh / 2,
          w: sw,
          h: sh,
        });
      }
      rowIndex++;
    }
  }
  return cells;
}