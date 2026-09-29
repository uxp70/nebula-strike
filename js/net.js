/* Squad netcode: dependency-free MQTT-over-WebSocket client + co-op protocol.
   Transport: public brokers (EMQX primary, HiveMQ fallback), no signup/keys.
   Protocol (namespace neb1/):
     neb1/r/<CODE>/p/<id>  retained presence {id,name,join} (heartbeat 4s, expire 12s)
     neb1/r/<CODE>/in/<id> inputs {mx,my,ax,ay,f,d,seq} ~12Hz, guests -> host
     neb1/r/<CODE>/snap    snapshots from host ~10Hz (full sim state)
     neb1/r/<CODE>/ev      events {t:'start'|'over'|'msg',...}
   Host = member with smallest (join, id). All members compute it locally.
   Snapshots carry full state, so a new host can resume mid-run (migration). */
(function (global) {
  "use strict";

  const BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt"
  ];
  const NS = "neb1/r/";
  const HEARTBEAT_MS = 4000;
  const PRESENCE_TTL_MS = 12000;

  const TE = new TextEncoder();
  const TD = new TextDecoder();

  function encStr(s) {
    const b = TE.encode(s);
    const out = new Uint8Array(2 + b.length);
    out[0] = (b.length >> 8) & 0xff; out[1] = b.length & 0xff;
    out.set(b, 2);
    return out;
  }
  function encLen(n) {
    const out = [];
    do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 0x80; out.push(d); } while (n > 0);
    return new Uint8Array(out);
  }
  function packet(typeFlags, body) {
    const len = encLen(body.length);
    const out = new Uint8Array(1 + len.length + body.length);
    out[0] = typeFlags; out.set(len, 1); out.set(body, 1 + len.length);
    return out;
  }
  function concat(arrays) {
    let n = 0; for (const a of arrays) n += a.length;
    const out = new Uint8Array(n);
    let o = 0; for (const a of arrays) { out.set(a, o); o += a.length; }
    return out;
  }

  class MiniMQTT {
    constructor(opts) {
      this.url = opts.url;
      this.clientId = opts.clientId || ("nx" + Math.random().toString(36).slice(2, 10));
      this.will = opts.will || null;
      this.onMessage = opts.onMessage || function () {};
      this.onState = opts.onState || function () {};
      this.ws = null; this.buf = new Uint8Array(0);
      this.connected = false; this.closed = false;
      this._ping = null; this._connectResolve = null;
    }
    connect(timeoutMs = 12000) {
      const self = this;
      self.closed = false;
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (ok, val) => {
          if (done) return; done = true;
          clearTimeout(timer);
          ok ? resolve(val) : reject(val);
        };
        const timer = setTimeout(() => { try { self.ws && self.ws.close(); } catch {} finish(false, new Error("connect timeout")); }, timeoutMs);
        self._connectResolve = (code) => {
          if (code === 0) { self.connected = true; self.onState(true); self._armPing(); finish(true); }
          else finish(false, new Error("connack " + code));
        };
        self._connectReject = (e) => finish(false, e);
        let ws;
        try { ws = new WebSocket(self.url, ["mqtt"]); }
        catch (e) { finish(false, e); return; }
        ws.binaryType = "arraybuffer";
        self.ws = ws;
        ws.onopen = () => {
          // CONNECT flags byte: bit1 clean session, bit2 will retain,
          // bit3 will flag, bit0 reserved (must be 0)
          let flags = 0x02; // clean session
          const parts = [encStr("MQTT"), new Uint8Array([4, flags, 0, 40]), encStr(self.clientId)];
          if (self.will) {
            parts[1][1] = flags = 0x02 | 0x04 | 0x08; // clean + will retain + will flag
            parts.push(encStr(self.will.topic));
            const wb = typeof self.will.payload === "string" ? TE.encode(self.will.payload) : self.will.payload;
            const wl = new Uint8Array(2); wl[0] = (wb.length >> 8) & 0xff; wl[1] = wb.length & 0xff;
            parts.push(concat([wl, wb]));
          }
          try { ws.send(packet(0x10, concat(parts))); }
          catch (e) { finish(false, e); }
        };
        ws.onmessage = (ev) => self._onData(new Uint8Array(ev.data));
        ws.onerror = () => { if (!done) finish(false, new Error("ws error")); };
        ws.onclose = () => {
          self.connected = false; self.onState(false);
          clearInterval(self._ping);
          if (self._connectResolve && !done) { const r = self._connectResolve; self._connectResolve = null; }
          if (!done) finish(false, new Error("ws closed"));
        };
      });
    }
    _armPing() {
      clearInterval(this._ping);
      this._ping = setInterval(() => {
        try { this.ws && this.ws.readyState === 1 && this.ws.send(packet(0xc0, new Uint8Array(0))); } catch {}
      }, 25000);
    }
    _onData(chunk) {
      const nb = new Uint8Array(this.buf.length + chunk.length);
      nb.set(this.buf, 0); nb.set(chunk, this.buf.length);
      this.buf = nb;
      for (;;) {
        if (this.buf.length < 2) return;
        const type = this.buf[0] & 0xf0;
        let mul = 1, len = 0, pos = 1, ok = false;
        for (let i = 0; i < 4 && pos < this.buf.length; i++, pos++) {
          const b = this.buf[pos];
          len += (b & 0x7f) * mul; mul *= 128;
          if ((b & 0x80) === 0) { ok = true; pos++; break; }
        }
        if (!ok) return;
        if (this.buf.length < pos + len) return;
        const body = this.buf.slice(pos, pos + len);
        this.buf = this.buf.slice(pos + len);
        this._dispatch(type, body);
      }
    }
    _dispatch(type, body) {
      if (type === 0x20) { // CONNACK
        const code = body.length >= 2 ? body[1] : 255;
        const r = this._connectResolve; this._connectResolve = null;
        if (r) r(code);
      } else if (type === 0x90) { // SUBACK (ignore)
      } else if (type === 0x30) { // PUBLISH qos0: topic + payload
        if (body.length < 2) return;
        const tl = (body[0] << 8) | body[1];
        if (body.length < 2 + tl) return;
        const topic = TD.decode(body.slice(2, 2 + tl));
        const payload = body.slice(2 + tl);
        try { this.onMessage(topic, payload); } catch {}
      } else if (type === 0xd0) { // PINGRESP
      }
    }
    subscribe(topic) {
      const id = new Uint8Array([0, 1]);
      this._send(packet(0x82, concat([id, encStr(topic), new Uint8Array([0])])));
    }
    publish(topic, data, retain) {
      const payload = typeof data === "string" ? TE.encode(data) : data;
      this._send(packet(retain ? 0x31 : 0x30, concat([encStr(topic), payload])));
    }
    _send(bytes) {
      if (this.ws && this.ws.readyState === 1 && !this.closed) {
        try { this.ws.send(bytes); } catch {}
      }
    }
    disconnect() {
      this.closed = true;
      clearInterval(this._ping);
      try { this.ws && this.ws.close(); } catch {}
      this.connected = false;
    }
  }

  function randCode() {
    const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }
  function uid() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  class Squad {
    constructor(opts) {
      this.name = opts.name || "Pilot";
      this.onRoster = opts.onRoster || function () {};
      this.onSnap = opts.onSnap || function () {};
      this.onEvent = opts.onEvent || function () {};
      this.onStatus = opts.onStatus || function () {};
      this.conn = null; this.code = null;
      this.id = uid();
      this.joinTs = Date.now();
      this.cosmetics = opts.cosmetics || {}; // {paint, emblem} shown to the squad
      this.presence = {}; // id -> {id,name,join,seen}
      this._hb = null; this._sweep = null;
      this._seq = 0;
    }
    topics() {
      const base = NS + this.code;
      return {
        presence: base + "/p/+",
        myPresence: base + "/p/" + this.id,
        inputs: base + "/in/+",
        myInput: base + "/in/" + this.id,
        snap: base + "/snap",
        ev: base + "/ev"
      };
    }
    async create() {
      return this.join(randCode());
    }
    async join(code) {
      code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || randCode();
      this.leave();
      this.code = code;
      this.id = uid();
      this.joinTs = Date.now();
      this.presence = {};
      this.onStatus("connecting…");
      const t = this.topics();
      let lastErr = null;
      for (const url of BROKERS) {
        const conn = new MiniMQTT({
          url,
          clientId: this.id,
          will: { topic: t.myPresence, payload: "" }, // retained will clears us on drop
          onMessage: (topic, bytes) => this._msg(topic, bytes),
          onState: (up) => { if (!up) this.onStatus("reconnecting…"); }
        });
        try {
          await conn.connect();
          this.conn = conn;
          conn.subscribe(t.presence);
          conn.subscribe(t.inputs);
          conn.subscribe(t.snap);
          conn.subscribe(t.ev);
          this._beat();
          clearInterval(this._hb); clearInterval(this._sweep);
          this._hb = setInterval(() => this._beat(), HEARTBEAT_MS);
          this._sweep = setInterval(() => this._sweepRoster(), 2000);
          this.onStatus("in room " + code);
          this._emitRoster();
          return code;
        } catch (e) { lastErr = e; }
      }
      this.onStatus("relay error: " + ((lastErr && lastErr.message) || "unreachable"));
      throw lastErr || new Error("no relay");
    }
    leave() {
      try {
        if (this.conn && this.code) {
          this.conn.publish(this.topics().myPresence, "", true); // clear retained presence
        }
      } catch {}
      try { this.conn && this.conn.disconnect(); } catch {}
      this.conn = null; this.code = null;
      clearInterval(this._hb); clearInterval(this._sweep);
      this.presence = {};
    }
    _beat() {
      if (!this.conn || !this.code) return;
      this.conn.publish(this.topics().myPresence,
        JSON.stringify({ id: this.id, name: this.name, join: this.joinTs, paint: this.cosmetics.paint || null, emblem: this.cosmetics.emblem || null }), true);
      this.presence[this.id] = { id: this.id, name: this.name, join: this.joinTs, seen: Date.now(), paint: this.cosmetics.paint || null, emblem: this.cosmetics.emblem || null };
      this._emitRoster();
    }
    _sweepRoster() {
      const now = Date.now();
      let changed = false;
      for (const id of Object.keys(this.presence)) {
        if (now - this.presence[id].seen > PRESENCE_TTL_MS) { delete this.presence[id]; changed = true; }
      }
      if (changed) this._emitRoster();
    }
    _msg(topic, bytes) {
      const t = this.topics();
      let txt = "";
      try { txt = TD.decode(bytes); } catch { return; }
      if (topic.indexOf("/p/") >= 0) {
        if (!txt) { // retained clear / will
          const pid = topic.split("/p/")[1];
          if (this.presence[pid]) { delete this.presence[pid]; this._emitRoster(); }
          return;
        }
        try {
          const p = JSON.parse(txt);
          if (p && p.id && p.name) {
            const paint = (typeof p.paint === "string" && /^#[0-9a-fA-F]{6}$/.test(p.paint)) ? p.paint : null;
            const emblem = (typeof p.emblem === "string" && p.emblem.length >= 1 && p.emblem.length <= 8) ? p.emblem : null;
            this.presence[p.id] = { id: p.id, name: String(p.name).slice(0, 16), join: Number(p.join) || 0, seen: Date.now(), paint, emblem };
            this._emitRoster();
          }
        } catch {}
      } else if (topic.indexOf("/in/") >= 0) {
        const pid = topic.split("/in/")[1];
        if (pid === this.id) return;
        try { this.onEvent({ t: "input", from: pid, data: JSON.parse(txt) }); } catch {}
      } else if (topic === t.snap) {
        try { this.onSnap(JSON.parse(txt)); } catch {}
      } else if (topic === t.ev) {
        try { this.onEvent(JSON.parse(txt)); } catch {}
      }
    }
    roster() {
      return Object.values(this.presence).sort((a, b) => (a.join - b.join) || (a.id < b.id ? -1 : 1));
    }
    hostId() {
      const r = this.roster();
      return r.length ? r[0].id : null;
    }
    amHost() {
      return !!this.code && this.hostId() === this.id;
    }
    _emitRoster() {
      try { this.onRoster(this.roster(), this.hostId()); } catch {}
    }
    sendInput(inp) {
      if (!this.conn || !this.code || this.amHost()) return;
      inp.seq = ++this._seq;
      this.conn.publish(this.topics().myInput, JSON.stringify(inp));
    }
    sendSnap(snap) {
      if (!this.conn || !this.code || !this.amHost()) return;
      snap.seq = ++this._seq;
      const s = JSON.stringify(snap);
      if (s.length < 60000) this.conn.publish(this.topics().snap, s);
    }
    sendEvent(ev) {
      if (!this.conn || !this.code) return;
      this.conn.publish(this.topics().ev, JSON.stringify(ev));
    }
  }

  global.MiniMQTT = MiniMQTT;
  global.SquadNet = Squad;
  global.SquadBrokers = BROKERS.slice();
})(window);
