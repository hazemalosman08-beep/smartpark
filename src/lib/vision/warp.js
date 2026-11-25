// Re-project the camera picture onto the top-down plan, so the plan's backdrop
// is the real lot. With a ground calibration (lot corners) the picture is
// un-tilted with the same homography the tracker uses.

export async function warpFrameToPlan(url, lot, maxSide = 1100) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const { bounds } = lot;
  const scale = maxSide / Math.max(bounds.w, bounds.h);
  const outW = Math.max(1, Math.round(bounds.w * scale));
  const outH = Math.max(1, Math.round(bounds.h * scale));

  const src = document.createElement("canvas");
  src.width = img.naturalWidth;
  src.height = img.naturalHeight;
  const sctx = src.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const sdata = sctx.getImageData(0, 0, src.width, src.height).data;

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d");
  const odata = octx.createImageData(outW, outH);
  const sw = src.width, sh = src.height;
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      // plan pixel -> lot units -> camera percent -> source pixel
      const p = lot.toCamera({ x: bounds.x + (x + 0.5) / scale, y: bounds.y + (y + 0.5) / scale });
      const sx = Math.floor((p.x / 100) * sw), sy = Math.floor((p.y / 100) * sh);
      const o = (y * outW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh || !Number.isFinite(sx)) { odata.data[o + 3] = 0; continue; }
      const i = (sy * sw + sx) * 4;
      odata.data[o] = sdata[i];
      odata.data[o + 1] = sdata[i + 1];
      odata.data[o + 2] = sdata[i + 2];
      odata.data[o + 3] = 255;
    }
  }
  octx.putImageData(odata, 0, 0);
  const blob = await new Promise((resolve) => out.toBlob(resolve, "image/jpeg", 0.85));
  return { href: URL.createObjectURL(blob), x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
}
