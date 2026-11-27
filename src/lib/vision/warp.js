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

/**
 * One combined picture: the site's aerial / satellite picture with the linked
 * camera's current view projected onto the ground where the camera sees it,
 * blended in at the edges. H: camera % -> site % (the camera link).
 * Only ground the camera sees well is used: where one camera pixel would be
 * stretched over many site pixels (far away, near the horizon) the satellite
 * picture is kept. Returns an object URL (JPEG) of the site picture's size.
 */
export async function composeSiteWithCamera(siteUrl, frameUrl, H, { maxSide = 1600, maxStretch = 3 } = {}) {
  const load = async (url) => { const img = new Image(); img.src = url; await img.decode(); return img; };
  const [site, cam] = await Promise.all([load(siteUrl), load(frameUrl)]);
  const k = Math.min(1, maxSide / Math.max(site.naturalWidth, site.naturalHeight));
  const W = Math.round(site.naturalWidth * k), Hh = Math.round(site.naturalHeight * k);
  const out = document.createElement("canvas");
  out.width = W; out.height = Hh;
  const octx = out.getContext("2d", { willReadFrequently: true });
  octx.drawImage(site, 0, 0, W, Hh);
  const base = octx.getImageData(0, 0, W, Hh);
  const cw = cam.naturalWidth, ch = cam.naturalHeight;
  const cc = document.createElement("canvas");
  cc.width = cw; cc.height = ch;
  const cctx = cc.getContext("2d", { willReadFrequently: true });
  cctx.drawImage(cam, 0, 0);
  const cd = cctx.getImageData(0, 0, cw, ch).data;
  const Hi = invert(H);
  if (!Hi) return null;
  // Which side of the plane is in front of the camera: the camera's own centre.
  const centre = apply(H, { x: 50, y: 75 });
  const sign = Math.sign(Hi[6] * centre.x + Hi[7] * centre.y + Hi[8]);
  const d = base.data;
  // Site pixel -> camera pixel.
  const toCam = (x, y) => {
    const sx = (x / W) * 100, sy = (y / Hh) * 100;
    const w = Hi[6] * sx + Hi[7] * sy + Hi[8];
    if (Math.sign(w) !== sign) return null;
    return [((Hi[0] * sx + Hi[1] * sy + Hi[2]) / w / 100) * cw, ((Hi[3] * sx + Hi[4] * sy + Hi[5]) / w / 100) * ch];
  };
  const feather = Math.max(4, Math.round(Math.min(cw, ch) * 0.04));
  for (let y = 0; y < Hh; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const p = toCam(x + 0.5, y + 0.5);
      if (!p) continue;
      const [u, v] = p;
      if (u < 0 || v < 0 || u >= cw - 1 || v >= ch - 1) continue;
      // How much the camera is stretched here (camera pixels per site pixel).
      const q = toCam(x + 1.5, y + 0.5), r = toCam(x + 0.5, y + 1.5);
      if (!q || !r) continue;
      const area = Math.abs((q[0] - u) * (r[1] - v) - (q[1] - v) * (r[0] - u));
      if (area < 1 / (maxStretch * maxStretch)) continue;
      // Soft edges: blend over the last few pixels of the camera frame, and
      // fade in where the camera starts to get too coarse.
      const edge = Math.min(u, v, cw - 1 - u, ch - 1 - v) / feather;
      const coarse = (area * maxStretch * maxStretch - 1) / 3;
      const a = Math.max(0, Math.min(1, edge, coarse));
      if (a <= 0) continue;
      // Bilinear sample.
      const u0 = Math.floor(u), v0 = Math.floor(v), fu = u - u0, fv = v - v0;
      const i00 = (v0 * cw + u0) * 4, i10 = i00 + 4, i01 = i00 + cw * 4, i11 = i01 + 4;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const val = (cd[i00 + c] * (1 - fu) + cd[i10 + c] * fu) * (1 - fv) + (cd[i01 + c] * (1 - fu) + cd[i11 + c] * fu) * fv;
        d[o + c] = d[o + c] * (1 - a) + val * a;
      }
    }
  }
  octx.putImageData(base, 0, 0);
  const blob = await new Promise((resolve) => out.toBlob(resolve, "image/jpeg", 0.88));
  return blob ? URL.createObjectURL(blob) : null;
}

function apply(H, p) {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

function invert(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}
