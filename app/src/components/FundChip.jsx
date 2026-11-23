import { useEffect, useState } from "react";
import Chip from "./Chip.jsx";
import { circuit } from "../lib/data.js";

const cache = new Map();
export function useCircuit(circuitId) {
  const key = circuitId == null ? null : String(circuitId);
  const [c, setC] = useState(key ? cache.get(key) || null : null);
  useEffect(() => {
    if (!key || cache.has(key)) { setC(key ? cache.get(key) : null); return; }
    let on = true;
    circuit(BigInt(key)).then((v) => { cache.set(key, v); if (on) setC(v); }).catch(() => {});
    return () => { on = false; };
  }, [key]);
  return c;
}

/** A fund's die, read from the TapeOut processor by circuit id. */
export default function FundChip({ circuitId, size, inputs, state, label }) {
  const c = useCircuit(circuitId);
  if (!c) return <div style={{ width: "100%", maxWidth: size, aspectRatio: "1", background: "var(--canvas)", borderRadius: 8 }} />;
  return <Chip netlist={c.netlist} nIn={c.nIn} nOut={c.nOut} size={size} inputs={inputs} state={state} label={label} />;
}
