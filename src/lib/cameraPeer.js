// Video goes directly between the devices when their networks allow it.
// The camera relay remains available when a direct connection cannot be made.
export default function createCameraPeer({ role, send, onStream, onStatus }) {
  let peer = null;
  let source = null;
  let paired = false;
  let candidates = [];
  let queue = Promise.resolve();
  let disposed = false;
  const reset = () => {
    const old = peer;
    peer = null;
    if (old) { old.ontrack = null; old.onconnectionstatechange = null; old.onicecandidate = null; old.close(); }
    candidates = [];
    onStream(null);
    onStatus("waiting");
  };
  const create = () => {
    if (!window.RTCPeerConnection) { onStatus("relay"); return null; }
    const current = new RTCPeerConnection({ iceServers: [
      { urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" },
    ] });
    peer = current;
    if (role === "camera" && source) source.getVideoTracks().forEach((track) => current.addTrack(track, source));
    current.onicecandidate = ({ candidate }) => { if (candidate && peer === current) send({ candidate: candidate.toJSON() }); };
    current.ontrack = ({ streams, track }) => { if (peer === current) onStream(streams[0] || new MediaStream([track])); };
    current.onconnectionstatechange = () => { if (peer === current) onStatus(current.connectionState); };
    return current;
  };
  const offer = async () => {
    if (disposed || role !== "camera" || !paired || !source || peer) return;
    const current = create();
    if (!current) return;
    await current.setLocalDescription(await current.createOffer());
    if (peer === current) send({ description: { type: "offer", sdp: current.localDescription.sdp } });
  };
  const failure = () => { if (!disposed) { reset(); onStatus("relay"); } };
  return {
    setStream(stream) { source = stream; offer().catch(failure); },
    pair() { paired = true; reset(); offer().catch(failure); },
    unpair() { paired = false; reset(); },
    receive(signal) {
      queue = queue.then(async () => {
        if (disposed || !paired) return;
        if (signal.description) {
          const description = signal.description;
          if ((role === "camera" && description.type !== "answer") || (role === "viewer" && description.type !== "offer")) return;
          const current = peer || create();
          if (!current) return;
          await current.setRemoteDescription(description);
          for (const candidate of candidates.splice(0)) await current.addIceCandidate(candidate);
          if (description.type === "offer") {
            await current.setLocalDescription(await current.createAnswer());
            if (peer === current) send({ description: { type: "answer", sdp: current.localDescription.sdp } });
          }
        } else if (signal.candidate) {
          if (peer?.remoteDescription) await peer.addIceCandidate(signal.candidate);
          else candidates.push(signal.candidate);
        }
      }).catch(failure);
    },
    close() { disposed = true; paired = false; reset(); },
  };
}