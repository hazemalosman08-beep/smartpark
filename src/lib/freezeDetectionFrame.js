// Capture once, before awaiting anything. Vehicle geometry and lot mapping must
// describe the same pixels even when the phone/video source keeps advancing.
export default function freezeDetectionFrame(source, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);
  return { source: canvas, width, height };
}