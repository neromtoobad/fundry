// Rules written in words -> a Fundry rulebook. A small, predictable parser (no AI model): it knows
// a fixed set of sentence shapes, and reports every sentence it did not understand so nothing is
// guessed silently. What it returns still goes through validate() and the circuit compiler.
//
//   parseWords("Hold 60% NVDA and 40% SPY. If NVDA falls 5%, cut it to half. Stop-loss 15% on NVDA, stay out.")

const ALIASES = {
  NVDA: ["nvda", "nvidia"],
  SPY: ["spy", "s&p", "s&p 500", "s&p500", "sp500", "the market", "index"],
  SPCX: ["spcx", "spacex"],
  MSFT: ["msft", "microsoft"],
  META: ["meta", "facebook"],
  GOLD: ["gold", "paxg"],
  BTC: ["btc", "bitcoin"],
  ETH: ["eth", "ether", "ethereum"],
};

const DEFAULTS = { dropBps: 500, riseBps: 500, stopBps: 1500 };

function findSymbols(s, allowed) {
  const hits = [];
  for (const [sym, names] of Object.entries(ALIASES)) {
    if (allowed && !allowed.includes(sym)) continue;
    for (const n of names) {
      const re = new RegExp(`(^|[^a-z0-9&])${n.replace(/[&]/g, "\\&")}($|[^a-z0-9])`, "i");
      const m = re.exec(s);
      if (m) { hits.push({ sym, at: m.index }); break; }
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.sym);
}

const pctOf = (s) => {
  const m = /(\d+(?:\.\d+)?)\s*(%|percent|pct)/i.exec(s);
  return m ? Math.round(Number(m[1]) * 100) : null;
};

/**
 * @param {string} text  rules in plain English, one idea per sentence
 * @param {string[]} [allowed]  symbols the fund may hold (the factory's listed stocks)
 * @returns {{rulebook: object|null, understood: string[], skipped: string[], error: string|null}}
 */
export function parseWords(text, allowed) {
  const sentences = String(text || "")
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((x) => x.trim().replace(/[.!?;]+$/, ""))
    .filter(Boolean);
  const assets = new Map(); // symbol -> rule
  const weights = new Map(); // symbol -> raw weight (percent or count)
  const rb = { ...DEFAULTS, allFallingToCash: false };
  const understood = [];
  const skipped = [];
  let last = []; // what "it" / "them" refers to

  const rule = (sym) => {
    if (!assets.has(sym)) assets.set(sym, { symbol: sym, base: 2, onDrop: "none", onRise: "none", stop: "none" });
    return assets.get(sym);
  };

  for (const raw of sentences) {
    const s = raw.toLowerCase();
    let syms = findSymbols(s, allowed);
    const pronoun = /\b(it|them|each|both|every one|all of them|any of them)\b/.test(s);
    if (!syms.length && pronoun) syms = /\b(each|both|every one|all of them|any of them)\b/.test(s) ? [...assets.keys()] : last;
    const p = pctOf(s);
    let ok = false;

    // "everything falls ... cash" / "never go to cash"
    if (/(everything|all of them|the whole fund|all stocks|all at once)/.test(s) && /(fall|drop|crash|down)/.test(s) && /cash/.test(s)) {
      rb.allFallingToCash = !/\b(never|don't|do not|no)\b/.test(s);
      if (p) rb.dropBps = p;
      ok = true;
    } else if (/\b(never|don't|do not)\b.*\bcash\b/.test(s)) {
      rb.allFallingToCash = false;
      ok = true;
    }
    // stop-loss: "stop-loss 15%", "if NVDA is 15% below its peak sell it", "... and stay out"
    else if (/(stop[- ]?loss|below (its|the) (peak|high)|from (its|the) (peak|high))/.test(s)) {
      if (p) rb.stopBps = p;
      const targets = syms.length ? syms : [...assets.keys()];
      const kind = /(stay out|stays out|keep (it )?out|don't buy back|until it (rises|recovers))/.test(s) ? "stayOut" : "once";
      for (const sym of targets) rule(sym).stop = kind;
      ok = targets.length > 0;
    }
    // drops: "if NVDA falls 5%, cut it to half" / "... sell it"
    else if (/\b(fall|falls|fell|drop|drops|dips|dip|down|loses)\b/.test(s) && syms.length) {
      if (p) rb.dropBps = p;
      const act = /(half|halve|cut it in half|50%)/.test(s.replace(/\d+(\.\d+)?\s*%/, "")) ? "half"
        : /(sell (it|them|all|everything)|sell|exit|get out|zero|dump)/.test(s) ? "zero" : null;
      if (act) { for (const sym of syms) rule(sym).onDrop = act; ok = true; }
    }
    // rises: "if NVDA rises 8%, double it" / "buy more"
    else if (/\b(rise|rises|rose|up|gains|jumps|climbs)\b/.test(s) && syms.length) {
      if (p) rb.riseBps = p;
      if (/(double|buy more|add more|more of it|increase|lean in)/.test(s)) { for (const sym of syms) rule(sym).onRise = "double"; ok = true; }
    }
    // holdings: "hold 60% NVDA and 40% SPY", "NVDA and SPY equally", "mostly gold, some bitcoin"
    else if (syms.length && /(hold|own|buy|split|equal|mostly|some|a little|weight|portfolio|fund|\d+\s*%)/.test(s)) {
      const parts = s.split(/,|\band\b|\bplus\b|\bwith\b/);
      for (const sym of syms) rule(sym);
      for (const part of parts) {
        const [sym] = findSymbols(part, allowed);
        if (!sym) continue;
        const w = pctOf(part) ?? (/(mostly|mainly|heavy|a lot)/.test(part) ? 3 * 33 : /(a little|small|bit of|some)/.test(part) ? 33 : null);
        if (w != null) weights.set(sym, w);
      }
      ok = true;
    }

    (ok ? understood : skipped).push(raw);
    if (syms.length) last = syms;
  }

  // weights -> base levels 0..3 (the circuit has 2 bits per stock). The biggest weight gets 3.
  if (weights.size) {
    const max = Math.max(...weights.values());
    for (const a of assets.values()) {
      const w = weights.get(a.symbol);
      a.base = w == null ? 2 : Math.max(w > 0 ? 1 : 0, Math.min(3, Math.round((3 * w) / max)));
    }
  }

  const list = [...assets.values()];
  let error = null;
  if (!list.length) error = "Name at least one stock, for example “Hold NVDA and SPY”.";
  else if (list.length > 4) error = `A fund holds up to 4 stocks; you named ${list.length}.`;
  return { rulebook: error ? null : { assets: list, ...rb }, understood, skipped, error };
}
