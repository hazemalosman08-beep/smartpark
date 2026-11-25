// Phone-as-camera: the phone streams its camera straight to the computer
// (WebRTC, peer to peer — on the same Wi-Fi the video never leaves your network).
//
// The two devices find each other through a PeerJS "broker". By default that is
// the free public PeerJS server; it only passes the short connection handshake,
// never the video. To use your own broker, set at build time:
//   VITE_PEER_HOST, VITE_PEER_PORT, VITE_PEER_PATH, VITE_PEER_SECURE ("true"/"false")
//
// The whole feature lives in this file, PhoneCamera.jsx and RemoteCameraDialog.jsx.
import Peer from "peerjs";

const env = import.meta.env || {};
const PREFIX = "smartpark-cam-v1-";

function peerOptions() {
  const options = {
    debug: 0,
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
      ],
    },
  };
  if (env.VITE_PEER_HOST) {
    options.host = env.VITE_PEER_HOST;
    options.port = Number(env.VITE_PEER_PORT) || 443;
    options.path = env.VITE_PEER_PATH || "/";
    options.secure = env.VITE_PEER_SECURE ? env.VITE_PEER_SECURE === "true" : options.port === 443;
  }
  return options;
}

export function makePairCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900000;
  return String(100000 + n);
}

export const normalizeCode = (value) => String(value || "").replace(/\D/g, "").slice(0, 6);

export function phoneLink(code) {
  const url = new URL("/phone-camera", window.location.origin);
  url.searchParams.set("code", code);
  return url.toString();
}

const friendly = (err) => {
  const type = err?.type || "";
  if (type === "peer-unavailable") return "No computer is waiting with that code. Check the code on the computer screen.";
  if (type === "unavailable-id") return "That code is already in use. Make a new code.";
  if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed") return "Can't reach the connection service. Check the internet connection on both devices.";
  if (type === "browser-incompatible") return "This browser can't stream video. Use Safari or Chrome.";
  return err?.message || "Connection failed";
};

/**
 * Computer side: wait for a phone with this code.
 * onStream(MediaStream|null), onStatus({ state: "starting"|"waiting"|"connected"|"error", message })
 */
export function receivePhoneCamera(code, { onStream, onStatus }) {
  let closed = false;
  let call = null;
  let retry = null;
  let peer = null;

  const start = () => {
    if (closed) return;
    onStatus({ state: "starting" });
    peer = new Peer(PREFIX + code, peerOptions());
    peer.on("open", () => onStatus({ state: "waiting" }));
    peer.on("call", (incoming) => {
      call?.close();
      call = incoming;
      incoming.answer(); // receive only; the computer sends nothing back
      incoming.on("stream", (stream) => { onStream(stream); onStatus({ state: "connected" }); });
      incoming.on("close", () => {
        if (call !== incoming) return;
        onStream(null);
        if (!closed) onStatus({ state: "waiting", message: "Phone disconnected" });
      });
      incoming.on("error", () => {});
    });
    peer.on("disconnected", () => { if (!closed) peer.reconnect(); });
    peer.on("error", (err) => {
      if (closed) return;
      onStatus({ state: "error", message: friendly(err), type: err?.type });
      if (err?.type === "network" || err?.type === "server-error" || err?.type === "socket-error") {
        peer.destroy();
        retry = setTimeout(start, 4000);
      }
    });
  };
  start();

  return {
    close() {
      closed = true;
      clearTimeout(retry);
      call?.close();
      peer?.destroy();
      onStream(null);
    },
  };
}

/**
 * Phone side: send this camera stream to the computer showing `code`.
 * Keeps retrying while the computer is not ready yet.
 */
export function sendPhoneCamera(code, stream, { onStatus }) {
  let closed = false;
  let retry = null;
  let call = null;
  const peer = new Peer(peerOptions());

  const dial = () => {
    if (closed || !peer.open) return;
    onStatus({ state: "connecting" });
    call?.close();
    call = peer.call(PREFIX + code, stream);
    if (!call) { retry = setTimeout(dial, 3000); return; }
    const current = call;
    const watch = setInterval(() => {
      const state = current.peerConnection?.connectionState || current.peerConnection?.iceConnectionState;
      if (state === "connected" || state === "completed") onStatus({ state: "connected" });
      if (state === "failed") {
        clearInterval(watch);
        onStatus({ state: "error", message: "The phone and computer couldn't connect directly. Put both on the same Wi-Fi and try again." });
        retry = setTimeout(dial, 4000);
      }
    }, 500);
    current.on("close", () => {
      clearInterval(watch);
      if (!closed && call === current) { onStatus({ state: "connecting", message: "Computer disconnected — reconnecting…" }); retry = setTimeout(dial, 2000); }
    });
    current.on("error", () => clearInterval(watch));
  };

  peer.on("open", dial);
  peer.on("disconnected", () => { if (!closed) peer.reconnect(); });
  peer.on("error", (err) => {
    if (closed) return;
    onStatus({ state: "error", message: friendly(err), type: err?.type });
    // The computer may simply not be waiting yet: keep trying.
    if (err?.type === "peer-unavailable") { clearTimeout(retry); retry = setTimeout(dial, 3000); }
  });

  return {
    setStream(next) {
      stream = next;
      if (call?.peerConnection) {
        const track = next.getVideoTracks()[0];
        const sender = call.peerConnection.getSenders().find((s) => s.track?.kind === "video");
        if (sender && track) sender.replaceTrack(track).catch(() => dial());
      }
    },
    close() {
      closed = true;
      clearTimeout(retry);
      call?.close();
      peer.destroy();
    },
  };
}
