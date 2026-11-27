// How it works: the whole loop in plain words, what is fixed forever, who earns, and how to check
// it yourself. The chip drawn here is a real one, read from the Sworn processor.
import { Link } from "react-router-dom";
import { useAsync } from "../lib/hooks.js";
import { client, launchInfo, fundName } from "../lib/data.js";
import { factoryAbi } from "../lib/abi.js";
import { deployment, IS_FORK, DEWEB_URL, DEWEB_NAME } from "../lib/config.js";
import FundChip from "../components/FundChip.jsx";
import { REPO } from "../App.jsx";

const Arw = () => <span className="arw" aria-hidden>→</span>;

const LOOP = [
  { n: "01", t: "Launch", d: "Pick up to four tokenized stocks on X Layer and choose the rules: how much of each to hold, and what happens when one falls, rises or hits a stop-loss. Sworn compiles them into a chip and tapes it out." },
  { n: "02", t: "Invest", d: "Anyone deposits USDG and gets fund shares at today’s value. The fund holds the real tokens, priced from 30-minute Uniswap averages so one big trade can’t move them." },
  { n: "03", t: "Rebalance", d: "Once per period anyone can press Rebalance. The fund turns prices into yes/no signals, asks the chip for target weights and trades toward them. The caller can’t steer it." },
  { n: "04", t: "Withdraw", d: "Burn your shares any time and get your exact slice of every holding. No price is needed, so a withdrawal always works." },
  { n: "05", t: "Fork", d: "Like a fund but want it safer? Fork it. Your chip runs the parent chip inside it, untouched, and adds your rules on top. The parent’s holder earns from your fork forever." },
];

const FIXED = [
  "The stocks it can hold",
  "How much of each it holds at every level",
  "When a fall, a rise or a stop-loss counts",
  "Whether a stopped-out stock stays out",
  "How often it rebalances",
  "The yearly fee and the size cap",
];
const MOVES = [
  ["Investors’ money", "Only its owner can take it out, and always can."],
  ["The chip NFT", "Can be sold or given away. The creator fee follows it."],
  ["Prices", "Read from Uniswap every rebalance. The chip only sees what they crossed."],
];

const FAQ = [
  ["What is TapeOut?", "A way to put logic circuits on chain. A circuit is a list of NAND gates and memory latches; once it is taped out on a processor it can never be edited, and anyone can run it with Circuits.step."],
  ["Why a chip and not a normal smart contract?", "A contract with an owner can be upgraded or paused. A taped-out circuit can’t, and its whole logic is a few dozen gates anyone can read, draw and re-run. That is what makes the rules a promise."],
  ["Who presses Rebalance?", "Anyone, once it is due. The chip decides the weights from prices on chain, so it doesn’t matter who calls it."],
  ["Is this investment advice?", "No. Tokenized stocks can fall, and a chip only follows its rules. Read the rules of a fund before you put money in."],
];

export default function How() {
  // draw the first fund's real chip (on mainnet: chip #5, "AI + Market")
  const chip = useAsync(async () => {
    if (!deployment) return null;
    const list = await client.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "allFunds" });
    if (!list.length) return null;
    const [info, name] = await Promise.all([launchInfo(list[0]), fundName(list[0])]);
    return { fund: list[0], circuitId: info.circuitId, gates: info.gates, name };
  }, []);

  return (
    <main>
      <section className="stage flat page-head">
        <div className="scene" aria-hidden style={{ backgroundPosition: "86% 74%" }} />
        <div className="reveal">
          <span className="crumb"><Link to="/">SWORN</Link> / HOW IT WORKS</span>
          <h1 className="hero">A fund whose rules<br />can’t be taken back.</h1>
          <p className="lede" style={{ color: "rgba(255,255,255,.84)" }}>
            Most funds ask you to trust the manager. On Sworn the manager is a chip: its rules are etched at launch and
            run the same way every time, in public, on X Layer.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link to="/lab" className="pill light big">Try the Chip Lab <Arw /></Link>
            <Link to="/launch" className="pill ghost big">Launch a fund <Arw /></Link>
          </div>
        </div>
      </section>

      <section className="sect">
        <div className="sect-head">
          <div>
            <span className="kick">The loop</span>
            <h2 style={{ marginTop: 12 }}>Five steps, all on chain.</h2>
          </div>
        </div>
        <ol className="loop">
          {LOOP.map((s) => (
            <li key={s.n} className="card">
              <span className="mono">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="sect">
        <div className="sect-head">
          <div>
            <span className="kick">Inside the chip</span>
            <h2 style={{ marginTop: 12 }}>Prices in, weights out.</h2>
            <p>Every rebalance asks the same question. The chip only answers with gates, so the same prices always give the same answer.</p>
          </div>
        </div>
        <div className="card chip-explain">
          <div className="flow">
            <div className="flow-step">
              <span className="mono">1 · Prices</span>
              <b>30-minute averages</b>
              <p>The fund reads each stock’s price from its Uniswap pool and compares it with the last rebalance and its peak.</p>
            </div>
            <div className="flow-step">
              <span className="mono">2 · Signals</span>
              <b>3 yes/no bits per stock</b>
              <div className="signals"><span className="sigchip on">DROP</span><span className="sigchip">RISE</span><span className="sigchip">STOP-LOSS</span></div>
              <p>“Did NVDA fall at least 5% since last time?” becomes a 1 or a 0.</p>
            </div>
            <div className="flow-step dark">
              <span className="mono">3 · The chip</span>
              <b>NAND gates + memory</b>
              <p>TapeOut runs the circuit. Latches remember things like “stay out after a stop-loss”.</p>
            </div>
            <div className="flow-step">
              <span className="mono">4 · Weights</span>
              <b>out · low · medium · high</b>
              <p>Two bits per stock. Each stock gets its level’s share of the fund; all out means cash.</p>
            </div>
            <div className="flow-step">
              <span className="mono">5 · Trades</span>
              <b>Swap toward the target</b>
              <p>The fund trades on Uniswap with a slippage limit and logs every decision on chain.</p>
            </div>
          </div>
          <div className="chip-real">
            <div className="chip-real-die">
              {chip.data ? <FundChip circuitId={chip.data.circuitId} size={300} /> : <div className="chip-ph" />}
            </div>
            <div>
              <span className="kick">A real one</span>
              <h3 style={{ marginTop: 10 }}>{chip.data ? `Chip #${String(chip.data.circuitId)}${chip.data.name ? `, ${chip.data.name}` : ""}` : "Reading a chip from X Layer…"}</h3>
              <p className="muted" style={{ marginTop: 0, lineHeight: 1.5 }}>
                {chip.data ? `${chip.data.gates} gates, read just now from the Sworn processor. ` : ""}
                Input pads on the left carry the signals, ink tiles are NAND gates, copper tiles are memory, and the pads on the right are the weights.
              </p>
              {chip.data && <Link to={`/fund/${chip.data.fund}`} className="pill sm">Open this fund <Arw /></Link>}
            </div>
          </div>
        </div>
      </section>

      <section className="sect">
        <div className="sect-head">
          <div>
            <span className="kick">The promise</span>
            <h2 style={{ marginTop: 12 }}>What’s locked, and what still moves.</h2>
          </div>
        </div>
        <div className="grid2 even">
          <div className="card dark locked">
            <span className="mono">Locked at launch, for good</span>
            <ul>{FIXED.map((x) => <li key={x}>{x}</li>)}</ul>
            <p>There is no admin key, no upgrade and no pause switch on a fund. Not even its creator can change these.</p>
          </div>
          <div className="card">
            <span className="mono">What still moves</span>
            <dl className="kv moves">
              {MOVES.map(([k, v]) => <FragmentKV key={k} k={k} v={v} />)}
            </dl>
          </div>
        </div>
      </section>

      <section className="sect">
        <div className="sect-head">
          <div>
            <span className="kick">Who earns</span>
            <h2 style={{ marginTop: 12 }}>The chip is the business.</h2>
            <p>Each fund charges a small yearly fee, set at launch (1% on the demo funds), paid in new fund shares.</p>
          </div>
        </div>
        <div className="grid3">
          <div className="card earn"><b>50%</b><h3>The chip’s holder</h3><p>Whoever holds the fund’s chip NFT right now. Sell the chip and you sell its fee and its track record.</p></div>
          <div className="card earn"><b>50%</b><h3>Sworn</h3><p>Goes to the Sworn treasury, which runs the processor and this app.</p></div>
          <div className="card earn"><b>20%</b><h3>The parent, for forks</h3><p>A fork sends a fifth of its holder’s half to whoever holds the parent chip, for as long as the fork runs.</p></div>
        </div>
      </section>

      <section className="sect">
        <div className="card dark proof">
          <div>
            <span className="kick" style={{ color: "rgba(255,255,255,.7)" }}>Don’t trust us</span>
            <h2 style={{ marginTop: 12 }}>Check it yourself.</h2>
            <p>
              Every fund page has a Chip Lab, where you move prices and watch the real chip decide while TapeOut’s evaluator on X Layer
              returns the same bits, and a Check panel that re-runs every claim from chain data in your browser.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link to="/lab" className="pill light">Open the Chip Lab <Arw /></Link>
              <a className="pill ghost" href={`${REPO}/blob/main/JUDGES.md`} target="_blank" rel="noreferrer">The 5-minute check <Arw /></a>
            </div>
          </div>
          <dl>
            <dt>IN A TERMINAL</dt><dd>node scripts/verify.mjs --all</dd>
            <dt>EVALUATOR</dt><dd>Circuits.step on X Layer</dd>
            <dt>CONTRACT SOURCE</dt><dd>{!IS_FORK && deployment ? <a href={`https://repo.sourcify.dev/196/${deployment.factory}`} target="_blank" rel="noreferrer">Sourcify · exact match</a> : "Sourcify"}</dd>
            {!IS_FORK && <><dt>THIS APP</dt><dd><a href={DEWEB_URL} target="_blank" rel="noreferrer">Also on DeWEB · {DEWEB_NAME}</a></dd></>}
          </dl>
        </div>
      </section>

      <section className="sect">
        <div className="sect-head"><div><span className="kick">Questions</span><h2 style={{ marginTop: 12 }}>Short answers.</h2></div></div>
        <div className="card faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}

function FragmentKV({ k, v }) {
  return (<><dt>{k}</dt><dd>{v}</dd></>);
}
