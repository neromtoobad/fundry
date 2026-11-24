// TapeOut TAP-02 netlist builder, encoder, decoder and evaluator.
//
// Signals: 0 = const 0, 1 = const 1, 2..2+nIn-1 = inputs, then the outputs of each record in order.
// Records:
//   NAND  (op 0, a:u24, b:u24)                                   -> 1 signal
//   LATCH (op 1, d:u24)                                          -> 1 signal (its stored bit)
//   REF   (op 2, cpu:20 bytes, id:u64, nIns:u8, nOuts:u8, ins:u24 x nIns) -> nOuts signals
// Integers are big-endian. Inputs, outputs and state are packed LSB-first:
// bit i = (bytes[i>>3] >> (i&7)) & 1. Outputs are the last nOut signals.
// State layout (TAP-02 §4): walking records in order, each LATCH takes the next state bit and each
// REF takes the next block of nState(sub) bits. A LATCH outputs its stored bit this beat; its new
// bit is signal d after the beat. A REF runs one beat of the referenced circuit on its block.

export const OP_NAND = 0;
export const OP_LATCH = 1;
export const OP_REF = 2;

export class Netlist {
  constructor(nIn) {
    this.nIn = nIn;
    this.records = [];
    this.nSig = 2 + nIn;
    this._nand = new Map();
    this._recOfSig = new Map(); // signal -> record (NAND/LATCH only), for NOT(NOT x) folding
  }

  get CONST0() { return 0; }
  get CONST1() { return 1; }
  input(i) {
    if (i < 0 || i >= this.nIn) throw new Error(`input ${i} out of range`);
    return 2 + i;
  }
  _push(rec, nOut = 1) {
    const s = this.nSig;
    this.records.push(rec);
    this.nSig += nOut;
    if (nOut === 1) this._recOfSig.set(s, rec);
    return s;
  }

  nand(a, b) {
    // constant folding keeps gate counts honest
    if (a === 0 || b === 0) return 1;
    if (a === 1 && b === 1) return 0;
    if (a === 1) return this.not(b);
    if (b === 1) return this.not(a);
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const hit = this._nand.get(key);
    if (hit !== undefined) return hit;
    const s = this._push({ op: "nand", a, b });
    this._nand.set(key, s);
    return s;
  }
  not(a) {
    if (a === 0) return 1;
    if (a === 1) return 0;
    const r = this._recOfSig.get(a); // NOT(NOT x) = x
    if (r && r.op === "nand" && r.a === r.b) return r.a;
    return this.nand(a, a);
  }
  and(a, b) { return this.not(this.nand(a, b)); }
  or(a, b) { return this.nand(this.not(a), this.not(b)); }
  mux(sel, ifOne, ifZero) {
    if (ifOne === ifZero) return ifOne;
    if (ifOne === 1 && ifZero === 0) return sel;
    if (ifOne === 0 && ifZero === 1) return this.not(sel);
    if (ifZero === 0) return this.and(sel, ifOne);
    if (ifOne === 0) return this.and(this.not(sel), ifZero);
    if (ifZero === 1) return this.nand(sel, this.not(ifOne));
    if (ifOne === 1) return this.or(sel, ifZero);
    return this.nand(this.nand(sel, ifOne), this.nand(this.not(sel), ifZero));
  }

  /** A latch whose input is wired later: returns {q, setD}. */
  latch() {
    const rec = { op: "latch", d: 0 };
    const q = this._push(rec);
    return { q, setD: (d) => { rec.d = d; } };
  }

  /**
   * Reuse a taped-out circuit as a black box. `sub` is {nIn, nOut, nState}. Returns its output signals.
   * Its gates are not burned again: only this circuit's own NAND and LATCH records cost transistors.
   */
  ref(cpu, id, ins, sub) {
    if (ins.length !== sub.nIn) throw new Error(`REF: ${ins.length} inputs for a ${sub.nIn}-input circuit`);
    if (sub.nIn > 255 || sub.nOut > 255) throw new Error("REF: at most 255 pins");
    const first = this._push({ op: "ref", cpu: cpu.toLowerCase(), id: Number(id), ins: [...ins], nOuts: sub.nOut, nState: sub.nState }, sub.nOut);
    return Array.from({ length: sub.nOut }, (_, i) => first + i);
  }

  /** Append output buffers so outputs are the last nOut signals, contiguous and in order. */
  finish(outputs) {
    const firsts = outputs.map((o) => this._push({ op: "nand", a: o, b: o }));
    for (const f of firsts) this._push({ op: "nand", a: f, b: f });
    this.nOut = outputs.length;
    return this;
  }

  /** Top-level LATCH records (each burns one LATCH transistor). */
  get nLatch() { return this.records.filter((r) => r.op === "latch").length; }
  /** Total state bits, including REF'd sub-circuits. */
  get nState() { return this.records.reduce((s, r) => s + (r.op === "latch" ? 1 : r.op === "ref" ? r.nState : 0), 0); }
  /** Top-level NAND + LATCH records: the transistors this tape-out burns. */
  get gateCount() { return this.records.filter((r) => r.op !== "ref").length; }

  encode() {
    return encode(this.records);
  }
}

export function encode(records) {
  const out = [];
  const u24 = (v) => out.push((v >> 16) & 255, (v >> 8) & 255, v & 255);
  for (const r of records) {
    if (r.op === "nand") { out.push(OP_NAND); u24(r.a); u24(r.b); }
    else if (r.op === "latch") { out.push(OP_LATCH); u24(r.d); }
    else {
      out.push(OP_REF, ...hexToBytes(r.cpu));
      let id = BigInt(r.id);
      const idb = [];
      for (let i = 0; i < 8; i++) { idb.unshift(Number(id & 255n)); id >>= 8n; }
      out.push(...idb, r.ins.length, r.nOuts);
      for (const x of r.ins) u24(x);
    }
  }
  return Uint8Array.from(out);
}

export function packBits(bits) {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { if (b) out[i >> 3] |= 1 << (i & 7); });
  return out;
}

export function unpackBits(bytes, n) {
  const bits = [];
  for (let i = 0; i < n; i++) bits.push(((bytes[i >> 3] ?? 0) >> (i & 7)) & 1);
  return bits;
}

/** Decode NAND, LATCH and REF records. REF records carry cpu (lowercase hex), id, ins and nOuts. */
export function decode(bytes) {
  const b = typeof bytes === "string" ? hexToBytes(bytes) : bytes;
  const recs = [];
  const u24 = (p) => (b[p] << 16) | (b[p + 1] << 8) | b[p + 2];
  for (let p = 0; p < b.length;) {
    if (b[p] === OP_NAND) { recs.push({ op: "nand", a: u24(p + 1), b: u24(p + 4) }); p += 7; }
    else if (b[p] === OP_LATCH) { recs.push({ op: "latch", d: u24(p + 1) }); p += 4; }
    else if (b[p] === OP_REF) {
      if (p + 31 > b.length) throw new Error(`truncated REF at ${p}`);
      const cpu = bytesToHex(b.slice(p + 1, p + 21));
      let id = 0n;
      for (let i = 0; i < 8; i++) id = (id << 8n) | BigInt(b[p + 21 + i]);
      const nIns = b[p + 29], nOuts = b[p + 30];
      const ins = Array.from({ length: nIns }, (_, i) => u24(p + 31 + 3 * i));
      recs.push({ op: "ref", cpu, id: Number(id), ins, nOuts });
      p += 31 + 3 * nIns;
    } else throw new Error(`unsupported opcode ${b[p]} at ${p}`);
  }
  return recs;
}

/** The first signal index each record produces. */
export function firstSignals(records, nIn) {
  let s = 2 + nIn;
  return records.map((r) => { const f = s; s += r.op === "ref" ? r.nOuts : 1; return f; });
}

const refKey = (cpu, id) => `${String(cpu).toLowerCase()}:${Number(id)}`;
export { refKey };

/**
 * One beat of a netlist, same semantics as TapeOut Circuits.step (TAP-02 §4).
 * `resolve(cpu, id)` returns {records, nIn, nOut} of a REF'd circuit (needed only when there are REFs).
 * @returns {{outputs:number[], state:number[], signals:Uint8Array}}
 */
export function step(records, nIn, nOut, inputs, state = [], resolve = null) {
  const s = [0, 1];
  for (let i = 0; i < nIn; i++) s.push(inputs[i] ? 1 : 0);
  let k = 0;
  const latches = [];
  const refs = [];
  for (const r of records) {
    if (r.op === "nand") s.push(s[r.a] & s[r.b] ? 0 : 1);
    else if (r.op === "latch") { s.push(state[k] ? 1 : 0); latches.push({ pos: k, d: r.d }); k++; }
    else {
      if (!resolve) throw new Error("REF needs a resolver");
      const sub = resolve(r.cpu, r.id);
      if (!sub) throw new Error(`REF target ${refKey(r.cpu, r.id)} not loaded`);
      const subState = stateSize(sub.records, sub.resolve || resolve);
      const res = step(sub.records, sub.nIn, sub.nOut, r.ins.map((i) => s[i]), state.slice(k, k + subState), sub.resolve || resolve);
      s.push(...res.outputs);
      refs.push({ pos: k, bits: res.state });
      k += subState;
    }
  }
  const newState = new Array(k).fill(0);
  for (const l of latches) newState[l.pos] = s[l.d];
  for (const r of refs) r.bits.forEach((b, i) => { newState[r.pos + i] = b; });
  return { outputs: s.slice(s.length - nOut), state: newState, signals: Uint8Array.from(s) };
}

/** Total state bits of a netlist, including REF'd sub-circuits. */
export function stateSize(records, resolve = null) {
  let n = 0;
  for (const r of records) {
    if (r.op === "latch") n++;
    else if (r.op === "ref") {
      if (r.nState != null) n += r.nState;
      else { const sub = resolve?.(r.cpu, r.id); if (!sub) throw new Error(`REF target ${refKey(r.cpu, r.id)} not loaded`); n += stateSize(sub.records, sub.resolve || resolve); }
    }
  }
  return n;
}

/** Every gate a netlist runs, including REF'd sub-circuits (what circuitInfo calls gateCount). */
export function totalGates(records, resolve = null) {
  let n = 0;
  for (const r of records) {
    if (r.op !== "ref") n++;
    else { const sub = resolve?.(r.cpu, r.id); if (!sub) throw new Error(`REF target ${refKey(r.cpu, r.id)} not loaded`); n += totalGates(sub.records, sub.resolve || resolve); }
  }
  return n;
}

export function hexToBytes(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  let s = "0x";
  for (const x of bytes) s += x.toString(16).padStart(2, "0");
  return s;
}
