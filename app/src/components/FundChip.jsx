import { useEffect, useState } from "react";
import Chip from "./Chip.jsx";
import { chipTree } from "../lib/data.js";

const cache = new Map();
/** A chip read from the TapeOut processor, with every REF'd parent chip loaded. */
export function useChip(circuitId) {
  const key = circuitId == null ? null : String(circuitId);
  const [c, setC] = useState(key ? cache.get(key) || null : null);
  useEffect(() => {
    if (!key || cache.has(key)) { setC(key ? cache.get(key) : null); return; }
    let on = true;
    chipTree(key).then((v) => { cache.set(key, v); if (on) setC(v); }).catch(() => {});
    return () => { on = false; };
  }, [key]);
  return c;
}

/** A fund's die, read from the TapeOut processor by circuit id. */
export default function FundChip({ circuitId, size, inputs, state, label }) {
  const c = useChip(circuitId);
  if (!c) return <div style={{ width: "100%", maxWidth: size, aspectRatio: "1", background: "var(--canvas)", borderRadius: 8 }} />;
  return <Chip records={c.records} nIn={c.nIn} nOut={c.nOut} size={size} inputs={inputs} state={state} resolve={c.resolve} label={label} totalGates={c.gateCount} />;
}
