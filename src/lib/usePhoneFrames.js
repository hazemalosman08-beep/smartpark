import { useEffect } from "react";
import { captureCameraImage } from "@/lib/cameraSession";

export default function usePhoneFrames(videoRef, enabled, sendFrame) {
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer;
    const send = () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video?.readyState >= 2 && video.videoWidth && video.videoHeight) {
        const { data } = captureCameraImage(video, video.videoWidth, video.videoHeight, { maxSize: 640, maxChars: 11000, quality: 0.55 });
        sendFrame(data);
      }
      timer = setTimeout(send, 250);
    };
    send();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [videoRef, enabled, sendFrame]);
}