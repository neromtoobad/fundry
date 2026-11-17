// TapeOut TAP-02 netlist builder and evaluator.
//
// Signals: 0 = const 0, 1 = const 1, 2..2+nIn-1 = inputs, then one signal per record in order.
// Records: NAND (op 0, a:u24, b:u24) and LATCH (op 1, d:u24). Integers are big-endian.
// Inputs, outputs and state are packed LSB-first: bit i = (bytes[i>>3] >> (i&7)) & 1.
// Outputs are the last nOut signals. A LATCH outputs its stored bit this beat; its new
// stored bit is signal d after the beat. LATCH k uses state bit k (record order).

export const OP_NAND = 0;
export const OP_LATCH = 1;
export const OP_REF = 2;

export class Netlist {
  constructor(nIn) {
    this.nIn = nIn;
    this.records = [];
    this._nand = new Map();
  }

  get CONST0() { return 0; }
  get CONST1() { return 1; }
  input(i) {
    if (i < 0 || i >= this.nIn) throw new Error(`input ${i} out of range`);
    return 2 + i;
  }
  _next() { return 2 + this.nIn + this.records.length; }

  nand(a, b) {
    // constant folding keeps gate counts honest
    if (a === 0 || b === 0) return 1;
    if (a === 1 && b === 1) return 0;
    if (a === 1) return this.not(b);
    if (b === 1) return this.not(a);
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const hit = this._nand.get(key);
    if (hit !== undefined) return hit;
    const s = this._next();
    this.records.push({ op: "nand", a, b });
    this._nand.set(key, s);
    return s;
  }
  not(a) {
    if (a === 0) return 1;
    if (a === 1) return 0;
    // NOT(NOT x) = x
    const r = this.records[a - 2 - this.nIn];
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
    const s = this._next();
    const rec = { op: "latch", d: 0 };
    this.records.push(rec);
    return { q: s, setD: (d) => { rec.d = d; } };
  }

  /** Append output buffers so outputs are the last nOut signals, contiguous and in order. */
  finish(outputs) {
    const firsts = outputs.map((o) => {
      const s = this._next();
      this.records.push({ op: "nand", a: o, b: o });
      return s;
    });
    for (const f of firsts) this.records.push({ op: "nand", a: f, b: f });
    this.nOut = outputs.length;
    return this;
  }

  get nLatch() { return this.records.filter((r) => r.op === "latch").length; }
  get gateCount() { return this.records.length; }

  encode() {
    const out = [];
    const u24 = (v) => out.push((v >> 16) & 255, (v >> 8) & 255, v & 255);
    for (const r of this.records) {
      if (r.op === "nand") { out.push(OP_NAND); u24(r.a); u24(r.b); }
      else { out.push(OP_LATCH); u24(r.d); }
    }
    return Uint8Array.from(out);
  }
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

/** Decode NAND/LATCH records (REF unsupported here). */
export function decode(bytes) {
  const b = typeof bytes === "string" ? hexToBytes(bytes) : bytes;
  const recs = [];
  const u24 = (p) => (b[p] << 16) | (b[p + 1] << 8) | b[p + 2];
  for (let p = 0; p < b.length;) {
    if (b[p] === OP_NAND) { recs.push({ op: "nand", a: u24(p + 1), b: u24(p + 4) }); p += 7; }
    else if (b[p] === OP_LATCH) { recs.push({ op: "latch", d: u24(p + 1) }); p += 4; }
    else throw new Error(`unsupported opcode ${b[p]} at ${p}`);
  }
  return recs;
}

/**
 * One beat of a NAND/LATCH netlist, same semantics as TapeOut Circuits.step.
 * @returns {{outputs:number[], state:number[]}}
 */
export function step(records, nIn, nOut, inputs, state = []) {
  const n = 2 + nIn + records.length;
  const s = new Uint8Array(n);
  s[1] = 1;
  for (let i = 0; i < nIn; i++) s[2 + i] = inputs[i] ? 1 : 0;
  let k = 0;
  records.forEach((r, i) => {
    const idx = 2 + nIn + i;
    if (r.op === "nand") s[idx] = s[r.a] & s[r.b] ? 0 : 1;
    else s[idx] = state[k++] ? 1 : 0;
  });
  const newState = records.filter((r) => r.op === "latch").map((r) => s[r.d]);
  const outputs = Array.from(s.slice(n - nOut));
  return { outputs, state: newState };
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
