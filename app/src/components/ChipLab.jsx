// Chip Lab: move prices, watch the fund's real chip decide, and see TapeOut's own evaluator on
// X Layer give the same answer (a free read call, no wallet).
import { useEffect, useMemo, useState } from "react";
import { step, hexToBytes, unpackBits, isFork } from "@sworn/sdk";
import Chip from "./Chip.jsx";
import { useChip } from "./FundChip.jsx";
import { stepOnChain } from "../lib/data.js";
import { Ticker } from "./StockLogo.jsx";

const SIG = ["DROP", "RISE", "STOP-LOSS"];
const LEVEL = ["out", "low", "medium", "high"];
const pctTxt = (v) => `${v > 0 ? "+" : ""}${v}%`;

/** Names for each memory bit, in state order (a fork's parent bits come first). */
export function memoryLabels(rb, parents) {
  if (!rb) return [];
  const own = rb.assets.filter((a) => a.stop === "stayOut").map((a) => `${a.symbol} is staying out`);
  if (!isFork(rb)) return own;
  const p = parents?.[Number(rb.parent?.circuitId)];
  const up = p ? memoryLabels(p.rulebook, parents).map((l) => `parent: ${l}`) : [];
  return [...up, ...own];
}

function levelsOf(outputs) {
  const lv = [];
  for (let i = 0; i < outputs.length; i += 2) lv.push(outputs[i] | (outputs[i + 1] << 1));
  return lv;
}

export default function ChipLab({ f, live, parents, initialMode = "now", bare = false }) {
  const chip = useChip(f.circuitId);
  const n = f.holdings.length;
  const [mode, setMode] = useState(initialMode);
  const [moves, setMoves] = useState(() => f.holdings.map(() => ({ change: 0, fromPeak: 0 })));
  const liveState = useMemo(() => unpackBits(hexToBytes(f.latchState || "0x"), chip?.nState ?? 0), [f.latchState, chip?.nState]);
  const [memory, setMemory] = useState(null);
  const state = mode === "now" ? liveState : memory ?? liveState;
  const labels = memoryLabels(f.rulebook, parents);

  // what-if price moves -> the bits the fund would compute (Fund.currentInputs)
  const whatIfBits = moves.flatMap((m) => [
    m.change * 100 <= -f.dropBps ? 1 : 0,
    m.change * 100 >= f.riseBps ? 1 : 0,
    m.fromPeak * 100 >= f.stopBps ? 1 : 0,
  ]);
  const bits = mode === "now" ? live : whatIfBits;

  const res = useMemo(() => {
    if (!chip || !bits) return null;
    try { return step(chip.records, chip.nIn, chip.nOut, bits, state, chip.resolve); } catch { return null; }
  }, [chip, bits?.join(), state.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const levels = res ? levelsOf(res.outputs) : null;
  const sum = levels ? levels.reduce((s, x) => s + x, 0) : 0;

  // the same question, asked of the real TapeOut evaluator on X Layer
  const [chain, setChain] = useState(null);
  useEffect(() => {
    if (!chip || !bits || !res) return;
    let on = true;
    setChain({ busy: true });
    const t = setTimeout(() => {
      stepOnChain(f.circuitId, state, bits)
        .then((c) => {
          if (!on) return;
          const same = res.outputs.every((b, i) => b === c.outputs[i]) && res.state.every((b, i) => b === c.state[i]);
          setChain({ same, levels: levelsOf(c.outputs.slice(0, 2 * n)) });
        })
        .catch((e) => on && setChain({ err: e.shortMessage || e.message }));
    }, 350);
    return () => { on = false; clearTimeout(t); };
  }, [chip, bits?.join(), state.join(), res]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMove = (i, k, v) => setMoves((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  return (
    <section className="card" style={{ marginTop: 16 }} id="lab">
      <div className="sect-head" style={{ marginBottom: 18 }}>
        {bare ? <h3 style={{ margin: 0 }}>{f.name} · chip #{String(f.circuitId)}</h3> : (
        <div>
          <span className="kick">Chip Lab</span>
          <h2 style={{ marginTop: 12 }}>Move the prices. Watch the chip decide.</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 640 }}>
            This is the fund’s real circuit, read from X Layer. Every change below runs it gate by gate in your browser, then asks
            TapeOut’s own evaluator on chain the same question. It’s a free read, no wallet needed.
          </p>
        </div>)}
        <span className="seg">
          <button className={mode === "now" ? "on" : ""} onClick={() => setMode("now")}>Right now</button>
          <button className={mode === "what" ? "on" : ""} onClick={() => setMode("what")}>What if…</button>
        </span>
      </div>

      <div className="rules-grid">
        <div>
          {chip ? (
            <Chip records={chip.records} nIn={chip.nIn} nOut={chip.nOut} size={320} inputs={bits} state={state} resolve={chip.resolve} totalGates={chip.gateCount} />
          ) : <div style={{ width: "100%", maxWidth: 320, aspectRatio: "1", background: "var(--canvas)", borderRadius: 8 }} />}
          <div className="mono" style={{ marginTop: 8 }}>DARK GATES CARRY A 1 · HOVER A GATE TO READ IT</div>
        </div>

        <div>
          {f.holdings.map((h, i) => (
            <div key={h.address} className="lab-row">
              <div className="lab-top">
                <Ticker symbol={h.symbol} />
                <span className="signals" style={{ margin: 0 }}>
                  {SIG.map((s, k) => <span key={s} className={`sigchip ${bits?.[3 * i + k] ? "on" : ""}`}>{s}</span>)}
                </span>
                <span className="lab-out">
                  {levels ? (sum ? <><b>{Math.round((100 * levels[i]) / sum)}%</b> <span className="muted">{LEVEL[levels[i]]}</span></> : <b>0%</b>) : "…"}
                </span>
              </div>
              {mode === "what" && (
                <div className="lab-sliders">
                  <label>
                    <span>Since last rebalance <b>{pctTxt(moves[i].change)}</b></span>
                    <input type="range" min={-25} max={25} step={1} value={moves[i].change} onChange={(e) => setMove(i, "change", Number(e.target.value))} />
                  </label>
                  <label>
                    <span>Below its peak <b>{moves[i].fromPeak ? `−${moves[i].fromPeak}%` : "0%"}</b></span>
                    <input type="range" min={0} max={40} step={1} value={moves[i].fromPeak} onChange={(e) => setMove(i, "fromPeak", Number(e.target.value))} />
                  </label>
                </div>
              )}
            </div>
          ))}

          {labels.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="mono" style={{ marginBottom: 8 }}>The chip’s memory (LATCH gates){mode === "what" ? " · tap to flip" : ""}</div>
              <div className="signals">
                {labels.map((l, k) => (
                  <button key={l + k} type="button" disabled={mode !== "what"} className={`sigchip mem ${state[k] ? "on" : ""}`}
                    onClick={() => setMemory(state.map((b, j) => (j === k ? 1 - b : b)))}>
                    {l}: {state[k] ? "yes" : "no"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`lab-verdict ${chain?.same === false || chain?.err ? "bad" : chain?.same ? "good" : ""}`}>
            {sum === 0 && levels && <div style={{ fontWeight: 600, marginBottom: 4 }}>The chip says: move everything to cash.</div>}
            {!chain || chain.busy ? (
              <span>Asking TapeOut’s evaluator on X Layer…</span>
            ) : chain.err ? (
              <span>Couldn’t reach the chain: {chain.err}</span>
            ) : chain.same ? (
              <span><b>✓ Same answer on chain.</b> <code>Circuits.step(#{String(f.circuitId)})</code> on X Layer returned exactly these bits.</span>
            ) : (
              <span><b>✗ The chain answered differently.</b> This page’s evaluator and TapeOut disagree; please report it.</span>
            )}
            {mode === "what" && <div className="mono" style={{ marginTop: 8 }}>“Falls” = {f.dropBps / 100}% · “rises” = {f.riseBps / 100}% · stop-loss = {f.stopBps / 100}% below peak</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
