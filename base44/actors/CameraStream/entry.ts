import { Actor } from 'base44:runtime/actors';

const MAX_IMAGE = 110000;
const clamp = (n) => Math.max(0, Math.min(100, Number(n)));
const point = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: clamp(p.x), y: clamp(p.y) } : null;
const box = (b) => point(b) && Number.isFinite(b.w) && Number.isFinite(b.h) && b.w > 0 && b.h > 0 ? { ...point(b), w: Math.min(clamp(b.w), 100 - clamp(b.x)), h: Math.min(clamp(b.h), 100 - clamp(b.y)) } : null;

export default class CameraStream extends Actor {
  peers = new Map();
  incoming = new Map();
  calibration = null;
  spots = null;
  snapshot = null;
  lastFrame = null;
  scanning = false;
  host = null;
  ended = false;

  async handleStart() {
    const saved = await this.storage.get('peers');
    if (saved) this.peers = new Map(saved);
    const live = new Set(this.getConnections().map((c) => c.id));
    for (const id of this.peers.keys()) if (!live.has(id)) this.peers.delete(id);
    this.calibration = await this.storage.get('calibration') || null;
    this.spots = await this.storage.get('spots') || null;
    this.snapshot = await this.storage.get('snapshot') || null;
    this.host = await this.storage.get('host') || null;
    this.ended = await this.storage.get('ended') || false;
  }

  async handleConnect(conn) {
    if (!this.peers.has(conn.id) && this.peers.size >= 4) {
      conn.reject(4001, 'This camera session is full');
      return;
    }
    if (!this.peers.has(conn.id)) {
      this.peers.set(conn.id, { role: 'unknown' });
      await this.savePeers();
    }
    conn.send({ type: 'welcome', protocol: 2 });
    this.broadcastPresence();
  }

  async handleMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const peer = this.peers.get(conn.id);
    if (!peer) return;
    if (msg.type === 'role') {
      if (!['camera', 'viewer'].includes(msg.role)) return;
      const fail = (message) => conn.send({ type: 'pairing_error', message });
      if (this.ended) return fail('This session has ended. Scan a new QR code on the computer.');
      if (msg.role === 'viewer') {
        if (typeof msg.owner !== 'string' || !/^[a-f0-9-]{36}$/.test(msg.owner) || !/^\d{6}$/.test(msg.pin)) return fail('Create a new pairing code on the computer.');
        if (!this.host) {
          this.host = { owner: msg.owner, pin: msg.pin, expires: Date.now() + 15 * 60 * 1000, attempts: 0 };
          await this.storage.put('host', this.host);
        }
        if (this.host.owner !== msg.owner || this.host.pin !== msg.pin) return fail('This camera session belongs to another computer.');
      } else {
        if (!this.host) {
          // A phone can arrive while the host is reconnecting. Ask the computer
          // to restore its registration; never authorize the phone without it.
          conn.send({ type: 'pairing_waiting' });
          this.broadcast({ type: 'host_needed' });
          return;
        }
        if (this.host.attempts >= 10) return fail('Too many incorrect codes. Create a new code on the computer.');
        if (peer.role !== 'camera' && Date.now() > this.host.expires) return fail('This code expired. Create a new code on the computer.');
        if (msg.pin !== this.host.pin) {
          this.host.attempts += 1;
          await this.storage.put('host', this.host);
          return fail('That code does not match. Enter the six digits shown on the computer.');
        }
        if ([...this.peers.entries()].some(([id, p]) => id !== conn.id && p.role === 'camera')) return fail('Another phone is already sharing its camera. Stop it before connecting this phone.');
      }
      peer.role = msg.role;
      await this.savePeers();
      conn.send({ type: 'joined' });
      if (peer.role === 'viewer') this.broadcast({ type: 'host_ready' });
      conn.send({ type: 'session', calibration: this.calibration, spots: this.spots, scanning: this.scanning });
      if (this.snapshot) this.sendImage(conn, 'capture', this.snapshot);
      else conn.send({ type: 'snapshot_clear' });
      if (peer.role === 'viewer' && this.lastFrame) this.sendImage(conn, 'frame', this.lastFrame);
      this.broadcastPresence();
      if ([...this.peers.values()].some((p) => p.role === 'camera') && [...this.peers.values()].some((p) => p.role === 'viewer')) {
        for (const c of this.getConnections()) if (['camera', 'viewer'].includes(this.peers.get(c.id)?.role)) c.send({ type: 'paired' });
      }
      return;
    }
    if (peer.role === 'unknown' || this.ended) return;
    if (msg.type === 'end' && peer.role === 'viewer') {
      this.ended = true;
      await this.storage.put('ended', true);
      this.lastFrame = null;
      this.broadcast({ type: 'session_ended', message: 'The computer stopped sharing. Scan its QR code again to reconnect.' });
    } else if (msg.type === 'signal') {
      let signal = null;
      if (msg.description && ['offer', 'answer'].includes(msg.description.type) && typeof msg.description.sdp === 'string' && msg.description.sdp.length <= 24000) {
        if ((peer.role === 'camera') !== (msg.description.type === 'offer')) return;
        signal = { description: { type: msg.description.type, sdp: msg.description.sdp } };
      } else if (msg.candidate && typeof msg.candidate.candidate === 'string' && msg.candidate.candidate.length <= 2048) {
        signal = { candidate: { candidate: msg.candidate.candidate, sdpMid: typeof msg.candidate.sdpMid === 'string' ? msg.candidate.sdpMid.slice(0, 80) : null, sdpMLineIndex: Number.isInteger(msg.candidate.sdpMLineIndex) ? msg.candidate.sdpMLineIndex : null } };
      }
      if (!signal) return;
      for (const c of this.getConnections()) {
        const other = this.peers.get(c.id)?.role;
        if ((peer.role === 'camera' && other === 'viewer') || (peer.role === 'viewer' && other === 'camera')) c.send({ type: 'signal', ...signal });
      }
    } else if (msg.type === 'image_part') {
      await this.acceptImage(conn, peer, msg);
    } else if (msg.type === 'displayed' && peer.role === 'viewer') {
      for (const c of this.getConnections()) {
        if (this.peers.get(c.id)?.role === 'camera') c.send({ type: 'displayed' });
      }
    } else if (msg.type === 'calibration' && msg.value && typeof msg.value === 'object') {
      const value = msg.value;
      this.calibration = {
        spot: box(value.spot), occupied: box(value.occupied), entrance: point(value.entrance),
        boundaries: Array.isArray(value.boundaries) ? value.boundaries.slice(0, 20).map(box).filter(Boolean) : [],
        streets: Array.isArray(value.streets) ? value.streets.slice(0, 40).map(box).filter(Boolean) : [],
      };
      await this.storage.put('calibration', this.calibration);
      this.broadcast({ type: 'calibration', value: this.calibration });
    } else if (msg.type === 'spots' && Array.isArray(msg.value) && msg.value.length <= 400) {
      this.spots = msg.value.filter((s) => s && point(s) && ['free', 'occupied', 'blocked', 'predicted'].includes(s.status)).map((s, i) => ({
        id: String(s.id || `cam-${i}`).slice(0, 40), ...point(s), status: s.status, label: String(s.label || '').slice(0, 12),
      }));
      await this.storage.put('spots', this.spots);
      this.broadcast({ type: 'spots', value: this.spots });
    } else if (msg.type === 'scan_state') {
      this.scanning = msg.busy === true;
      this.broadcast({ type: 'scan_state', busy: this.scanning, error: typeof msg.error === 'string' ? msg.error.slice(0, 240) : null });
    } else if (msg.type === 'resume') {
      this.snapshot = null;
      await this.storage.delete('snapshot');
      this.broadcast({ type: 'snapshot_clear' });
    }
  }

  async acceptImage(conn, peer, msg) {
    if (!['frame', 'capture'].includes(msg.kind) || (msg.kind === 'frame' && peer.role !== 'camera')) return;
    if (typeof msg.id !== 'string' || msg.id.length > 64 || typeof msg.data !== 'string' || msg.data.length > 12000) return;
    if (!Number.isInteger(msg.total) || msg.total < 1 || msg.total > 10 || !Number.isInteger(msg.index) || msg.index < 0 || msg.index >= msg.total) return;
    const key = `${conn.id}:${msg.kind}`;
    let pending = this.incoming.get(key);
    if (pending?.id !== msg.id) {
      pending = { id: msg.id, parts: Array(msg.total), at: Date.now() };
      this.incoming.set(key, pending);
    }
    if (Date.now() - pending.at > 10000 || pending.parts.length !== msg.total) return;
    pending.parts[msg.index] = msg.data;
    if (pending.parts.filter((p) => typeof p === 'string').length !== msg.total) return;
    this.incoming.delete(key);
    const data = pending.parts.join('');
    if (data.length > MAX_IMAGE || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data)) return;
    if (msg.kind === 'frame') {
      if (peer.lastFrame && Date.now() - peer.lastFrame < 200) return;
      peer.lastFrame = Date.now();
      this.lastFrame = data;
      conn.send({ type: 'frame_ack', id: msg.id });
    } else {
      this.snapshot = data;
      await this.storage.put('snapshot', data);
    }
    for (const c of this.getConnections()) {
      if (msg.kind === 'frame' && this.peers.get(c.id)?.role !== 'viewer') continue;
      this.sendImage(c, msg.kind, data, msg.id);
    }
  }

  sendImage(conn, kind, data, id = crypto.randomUUID()) {
    const total = Math.ceil(data.length / 12000);
    for (let index = 0; index < total; index += 1) {
      conn.send({ type: 'image_part', kind, id, index, total, data: data.slice(index * 12000, (index + 1) * 12000) });
    }
  }

  async handleClose(conn) {
    this.peers.delete(conn.id);
    this.incoming.delete(`${conn.id}:frame`);
    this.incoming.delete(`${conn.id}:capture`);
    this.scanning = false;
    await this.savePeers();
    this.broadcast({ type: 'scan_state', busy: false });
    this.broadcastPresence();
  }

  savePeers() { return this.storage.put('peers', [...this.peers.entries()]); }

  broadcastPresence() {
    const roles = [...this.peers.values()].map((p) => p.role);
    this.broadcast({ type: 'presence', cameras: roles.filter((r) => r === 'camera').length, viewers: roles.filter((r) => r === 'viewer').length });
  }
}