import { useEffect, useRef } from "react";
import jsQR from "jsqr";

/* Camera preview with continuous QR decoding.
   The stream stays open while a result is shown; decoding pauses instead. */
export default function ScanCamera({ enabled, onDecoded, onError }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const lastRef = useRef({ value: "", at: 0 });
  const enabledRef = useRef(enabled);
  const decodeRef = useRef(onDecoded);

  enabledRef.current = enabled;
  decodeRef.current = onDecoded;

  useEffect(() => {
    let cancelled = false;

    const loop = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && enabledRef.current) {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (width && height) {
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, width, height);
          const frame = ctx.getImageData(0, 0, width, height);
          const code = jsQR(frame.data, width, height, { inversionAttempts: "dontInvert" });
          if (code?.data) {
            const now = Date.now();
            const same = code.data === lastRef.current.value;
            if (!same || now - lastRef.current.at > 3000) {
              lastRef.current = { value: code.data, at: now };
              decodeRef.current(code.data);
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        loop();
      } catch (err) {
        onError?.(err);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-[28px] bg-black">
      <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="relative h-[62%] w-[62%]">
          <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-xl border-l-2 border-t-2 border-white/90" />
          <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-xl border-r-2 border-t-2 border-white/90" />
          <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-xl border-b-2 border-l-2 border-white/90" />
          <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-xl border-b-2 border-r-2 border-white/90" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/60 to-transparent px-4 pb-4 pt-10 text-[11px] font-medium text-white/80">
        Hold the pass inside the frame
      </div>
    </div>
  );
}