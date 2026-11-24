// Publishes a static folder (the Vite build in app/dist) as a TapeOut DeWEB site on X Layer (chain 196).
//
//   node --env-file=.env scripts/deweb-publish.mjs --cpu=<circuits address | processor number> --id=<circuitId> \
//        --dir=app/dist [--dry-run] [--months=12] [--fallback=index.html] [--rpc=https://...]
//
// What it does, in order (TAP-10 v1.1, Appendix A; TapeKit README "Publishing"):
//   1. Resolves the circuit: factory.isCPU, the processor number (factory.cpuAt scan), ownerOf(id),
//      opener.accountOf(cpu, id) = the container, opener.isOpened.
//   2. Opens the container if needed: opener.open(cpu, id) with msg.value = opener.FEE().
//   3. Uploads every file to SiteRegistry: putFile (first <= 24,000 bytes, replaces an existing file),
//      then appendChunk(expectIndex = 1, 2, ...). Files whose on-chain size, type, SHA-256 and chunk count
//      already match are skipped; an interrupted upload resumes from the chunks on chain.
//      Assets go first, other HTML next, index.html last, so the entry page never points at missing files.
//   4. Optionally setFallback(container, path) for History-API routers (not needed for a HashRouter).
//   5. Activates the name if it is not live: DomainBinding.bind("<id>.2.<cpu#>.tape", container, months)
//      with msg.value = months * monthlyFee() (read live; 0 on X Layer when checked). Without this the
//      gateways answer "unpaid" and show nothing.
//   6. Reads every file back (fileInfo, and index.html in full) and prints the gateway URLs.
//
// The signer is the circuit NFT holder (PRIVATE_KEY). The holder calls SiteRegistry and DomainBinding
// directly; no ERC-6551 execute is needed. --dry-run sends nothing and does not need PRIVATE_KEY.
import { readdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi, formatEther, formatGwei, getAddress, isAddress, hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";

// ---------- addresses (TAP-10 "Deployments", same in TapeKit kernel/src/config.js L2_CONTRACTS) ----------
const CHAIN_ID = 196;
const AREA = 2; // X Layer area code in names (TAP-10 §2.1)
const FACTORY = "0x1f09DAeFA827f02CBb40967cc91b259763760761";
const OPENER = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106";
const REGISTRY = "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6";
const BINDING = "0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9";
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ACCEPTED_IMPL = {
  [REGISTRY]: ["0xa85c4143d1d4a77f54b8e4ecc9e6d1418afea45f"],
  [BINDING]: ["0x5ebf29b80789e548907c707530c3c7607c4347df"],
};

const CHUNK = 24_000;           // SiteRegistry CHUNK_MAX
const MAX_CHUNKS = 350;         // 8,400,000 bytes per file; clients never read larger files
const READ_SEG = 98_304;        // readRange segment size used by the kernel

// Gas model. deweb-cli's BSC-fork constants (src/plan.mjs), checked against eth_estimateGas on X Layer
// (putFile new 24,000 B = 5.58M, new 1,000 B = 517k, replace 1,000 B = 376k, appendChunk 24,000 B = 5.54M).
const GAS = { putNew: 300_000n, putReplace: 170_000n, append: 100_000n, perByte: 226n, setFallback: 120_000n, open: 400_000n, bind: 150_000n };
const MARGIN = 110n; // +10% on the estimate

// ---------- ABIs ----------
const factoryAbi = parseAbi([
  "function cpuCount() view returns (uint256)",
  "function cpuAt(uint256) view returns (address)",
  "function isCPU(address) view returns (bool)",
]);
const circuitsAbi = parseAbi(["function ownerOf(uint256) view returns (address)", "function name() view returns (string)"]);
const openerAbi = parseAbi([
  "function accountOf(address circuits, uint256 tokenId) view returns (address)",
  "function isOpened(address circuits, uint256 tokenId) view returns (bool)",
  "function FEE() view returns (uint256)",
  "function open(address circuits, uint256 tokenId) payable returns (address)",
  "error NotOwner()", "error FeeTransferFailed()",
]);
const registryAbi = parseAbi([
  "function putFile(address container, string path, string contentType, bytes32 sha256Hash, bytes data)",
  "function appendChunk(address container, string path, uint256 expectIndex, bytes data)",
  "function setFallback(address container, string path)",
  "function fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)",
  "function read(address container, string path) view returns (bytes)",
  "function readRange(address container, string path, uint256 offset, uint256 len) view returns (bytes)",
  "function pathCount(address container) view returns (uint256)",
  "function pathsRange(address container, uint256 from, uint256 n) view returns (string[])",
  "function fallbackPath(address container) view returns (string)",
  "error NoSuchFile()", "error NotOwner()", "error NotOpened()", "error TooLarge()", "error BadIndex()", "error DeployFailed()",
]);
const bindingAbi = parseAbi([
  "function monthlyFee() view returns (uint256)",
  "function bind(string name, address container, uint256 months) payable",
  "function isLive(string name, address container) view returns (bool)",
  "function isContainerLive(address container) view returns (bool)",
  "function containerPaidUntil(address container) view returns (uint40)",
  "error NotOwner()", "error NotOpened()",
]);

// ---------- args ----------
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) die(`bad argument ${a}`);
  return [m[1], m[2] ?? true];
}));
const DRY = !!args["dry-run"];
const RPC = args.rpc || process.env.DEWEB_RPC || "https://rpc.xlayer.tech";
const MONTHS = BigInt(args.months ?? 12);
const FALLBACK = args.fallback === undefined ? undefined : String(args.fallback === true ? "index.html" : args.fallback);
if (!args.cpu || !args.id || !args.dir) die("usage: node --env-file=.env scripts/deweb-publish.mjs --cpu=<circuits address|processor #> --id=<circuitId> --dir=app/dist [--dry-run] [--months=12] [--fallback=index.html] [--rpc=URL]");
if (!/^[1-9][0-9]*$/.test(String(args.id))) die("--id must be a positive integer");
if (MONTHS < 1n || MONTHS > 120n) die("--months must be 1..120");
const ID = BigInt(args.id);

function die(msg) { console.error(`error: ${msg}`); process.exit(1); }
const okb = (wei) => `${formatEther(wei)} OKB`;

// ---------- local files ----------
const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json",
  webmanifest: "application/manifest+json", txt: "text/plain; charset=utf-8", xml: "application/xml",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  wasm: "application/wasm", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf",
};
const contentTypeOf = (p) => TYPES[p.split(".").pop().toLowerCase()] ?? "application/octet-stream";
const sha256 = (b) => "0x" + createHash("sha256").update(b).digest("hex");

async function walk(dir, root, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, root, out);
    else if (e.isFile()) out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

async function loadLocal(dir) {
  const st = await stat(dir).catch(() => null);
  if (!st?.isDirectory()) die(`not a directory: ${dir}`);
  const files = [], warnings = [];
  for (const raw of (await walk(dir, dir)).sort()) {
    if (raw.split("/").some((s) => s.startsWith(".")) || raw.endsWith(".map")) continue; // dotfiles, source maps
    const path = raw.normalize("NFC");
    if (path !== raw) die(`${raw}: file name is not NFC; rename it (ASCII is safest)`);
    if (/[\u0000-\u001f\u007f?#%]/.test(path) || path.split("/").some((s) => s === "." || s === "..")) die(`${path}: path a browser cannot request (TAP-10 §7.2)`);
    if (path === "sw.js" || path.startsWith(".tape/")) die(`${path}: reserved by the gateway (TAP-10 §8.8)`);
    const bytes = await readFile(join(dir, raw));
    const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK));
    if (chunks > MAX_CHUNKS) die(`${path}: ${bytes.length} bytes is over the 8,400,000-byte file limit`);
    const contentType = contentTypeOf(path);
    files.push({ path, bytes, size: bytes.length, contentType, sha: sha256(bytes), chunks });
    if (/^(text\/html|text\/css)/.test(contentType)) {
      const refs = [...bytes.toString("utf8").matchAll(/(?:src|href|action|poster|srcset)\s*=\s*["']\s*((?:https?:|wss?:)?\/\/[^"'\s>]+)|url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)|@import\s+["']((?:https?:)?\/\/[^"']+)/gi)]
        .map((m) => m[1] || m[2] || m[3]);
      for (const r of new Set(refs)) warnings.push(`${path}: off-chain reference ${r} (gateways block or flag it; not "100% on-chain")`);
    }
  }
  if (!files.some((f) => f.path === "index.html")) warnings.push("no index.html at the root: the site's home page will 404");
  const rank = (p) => (p === "index.html" ? 2 : /\.html?$/i.test(p) ? 1 : 0);
  files.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  return { files, warnings };
}

// ---------- chain ----------
const pub = createPublicClient({ chain: xLayer, transport: http(RPC, { timeout: 30_000, retryCount: 3 }) });
const rd = (address, abi, functionName, a = []) => pub.readContract({ address, abi, functionName, args: a });

async function resolveCircuit() {
  const count = await rd(FACTORY, factoryAbi, "cpuCount");
  let cpu, cpuNum;
  if (/^[0-9]+$/.test(String(args.cpu))) {
    cpuNum = BigInt(args.cpu);
    if (cpuNum >= count) die(`no processor #${cpuNum} (cpuCount = ${count})`);
    cpu = await rd(FACTORY, factoryAbi, "cpuAt", [cpuNum]);
  } else {
    if (!isAddress(String(args.cpu))) die("--cpu must be a circuits contract address or a processor number");
    cpu = getAddress(String(args.cpu));
    if (!(await rd(FACTORY, factoryAbi, "isCPU", [cpu]))) die(`${cpu} is not a TapeOut processor on X Layer`);
    // The factory has no reverse table (TAP-10 §4.3): scan cpuAt from the newest processor down.
    for (let hi = count; hi > 0n && cpuNum === undefined; hi -= 200n) {
      const lo = hi > 200n ? hi - 200n : 0n;
      const idx = Array.from({ length: Number(hi - lo) }, (_, k) => lo + BigInt(k));
      const res = await pub.multicall({ contracts: idx.map((i) => ({ address: FACTORY, abi: factoryAbi, functionName: "cpuAt", args: [i] })), allowFailure: false });
      const k = res.findIndex((a) => a.toLowerCase() === cpu.toLowerCase());
      if (k >= 0) cpuNum = idx[k];
    }
    if (cpuNum === undefined) die(`${cpu} not found in factory.cpuAt(0..${count - 1n})`);
  }
  const [cpuName, holder, container, opened] = await Promise.all([
    rd(cpu, circuitsAbi, "name").catch(() => "?"),
    rd(cpu, circuitsAbi, "ownerOf", [ID]).catch(() => die(`circuit #${ID} does not exist on ${cpu}`)),
    rd(OPENER, openerAbi, "accountOf", [cpu, ID]),
    rd(OPENER, openerAbi, "isOpened", [cpu, ID]),
  ]);
  const name = `${ID}.${AREA}.${cpuNum}.tape`; // TAP-10 §3.1
  return { cpu, cpuNum, cpuName, holder, container, opened, name };
}

async function checkImplementations() {
  for (const [proxy, ok] of Object.entries(ACCEPTED_IMPL)) {
    const slot = await pub.getStorageAt({ address: proxy, slot: IMPL_SLOT });
    const impl = "0x" + slot.slice(-40);
    if (!ok.includes(impl.toLowerCase())) die(`${proxy} implementation is ${impl}, not one TapeKit accepts; gateways would report store-changed. Stop and re-check TAP-10 Deployments.`);
  }
}

async function readRemote(container) {
  const count = await rd(REGISTRY, registryAbi, "pathCount", [container]);
  const paths = [];
  for (let from = 0n; from < count; from += 200n) paths.push(...await rd(REGISTRY, registryAbi, "pathsRange", [container, from, count - from < 200n ? count - from : 200n]));
  const infos = paths.length ? await pub.multicall({ contracts: paths.map((p) => ({ address: REGISTRY, abi: registryAbi, functionName: "fileInfo", args: [container, p] })), allowFailure: false }) : [];
  const files = new Map();
  paths.forEach((p, i) => {
    const [size, contentType, sha, updatedAt, chunkCount] = infos[i];
    files.set(p, { size: Number(size), contentType, sha: sha.toLowerCase(), updatedAt: Number(updatedAt), chunkCount: Number(chunkCount) });
  });
  const fallback = await rd(REGISTRY, registryAbi, "fallbackPath", [container]);
  return { files, fallback };
}

async function readOnChain(container, path, len) {
  const parts = [];
  for (let off = 0; off < len; off += READ_SEG) parts.push(hexToBytes(await rd(REGISTRY, registryAbi, "readRange", [container, path, BigInt(off), BigInt(Math.min(READ_SEG, len - off))])));
  return Buffer.concat(parts);
}

function plan(local, remote) {
  const uploads = [], same = [];
  for (const f of local) {
    const r = remote.files.get(f.path);
    if (r && r.sha === f.sha && r.size === f.size && r.contentType === f.contentType && r.chunkCount === f.chunks) { same.push(f.path); continue; }
    // Same declared hash and type but fewer chunks: an interrupted upload. Resume only if the bytes match (checked later).
    const resumeFrom = r && r.sha === f.sha && r.contentType === f.contentType && r.chunkCount > 0 && r.chunkCount < f.chunks ? r.chunkCount : 0;
    uploads.push({ f, kind: !r ? "new" : resumeFrom ? "resume" : "replace", from: resumeFrom });
  }
  const extra = [...remote.files.keys()].filter((p) => !local.some((f) => f.path === p));
  return { uploads, same, extra };
}

function uploadGas(u) {
  let g = 0n;
  for (let i = u.from; i < u.f.chunks; i++) {
    const n = BigInt(Math.max(0, Math.min(CHUNK, u.f.size - i * CHUNK)));
    g += (i === 0 ? (u.kind === "new" ? GAS.putNew : GAS.putReplace) : GAS.append) + GAS.perByte * n;
  }
  return g;
}

// ---------- main ----------
const dir = resolve(String(args.dir));
const chainId = await pub.getChainId();
if (chainId !== CHAIN_ID) die(`RPC ${RPC} is chain ${chainId}, expected ${CHAIN_ID} (X Layer)`);
await checkImplementations();
const { files: local, warnings } = await loadLocal(dir);
const c = await resolveCircuit();
const [fee, monthlyFee, gasPrice, live, containerLive, paidUntil] = await Promise.all([
  rd(OPENER, openerAbi, "FEE"),
  rd(BINDING, bindingAbi, "monthlyFee"),
  pub.getGasPrice(),
  rd(BINDING, bindingAbi, "isLive", [c.name, c.container]),
  rd(BINDING, bindingAbi, "isContainerLive", [c.container]).catch(() => false),
  rd(BINDING, bindingAbi, "containerPaidUntil", [c.container]).catch(() => 0n),
]);
const remote = c.opened ? await readRemote(c.container) : { files: new Map(), fallback: "" };
const p = plan(local, remote);
const needBind = !(live || containerLive);
const setFallback = FALLBACK !== undefined && FALLBACK !== remote.fallback ? FALLBACK : null;
if (setFallback && !local.some((f) => f.path === setFallback) && !remote.files.has(setFallback)) die(`--fallback ${setFallback} is not a file of the site`);

let gas = 0n, txs = 0;
const uploadBytes = p.uploads.reduce((s, u) => s + Math.max(0, u.f.size - u.from * CHUNK), 0);
for (const u of p.uploads) { gas += uploadGas(u); txs += u.f.chunks - u.from; }
if (!c.opened) { gas += GAS.open; txs++; }
if (setFallback !== null) { gas += GAS.setFallback; txs++; }
if (needBind) { gas += GAS.bind; txs++; }
gas = (gas * MARGIN) / 100n;
const value = (c.opened ? 0n : fee) + (needBind ? monthlyFee * MONTHS : 0n);
const gasCost = gas * gasPrice;

const signer = process.env.PRIVATE_KEY ? privateKeyToAccount(process.env.PRIVATE_KEY.startsWith("0x") ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`) : null;
const tapekitUrl = `https://${ID}-${AREA}-${c.cpuNum}.tapekit.org/`;
const fabxUrl = `https://r1-${c.container.toLowerCase().slice(2)}-deweb.fabx.tech/`;

console.log(`DeWEB publish ${DRY ? "(dry run, nothing is sent)" : ""}`);
console.log(`  RPC        ${RPC} (chain ${chainId})`);
console.log(`  circuit    ${c.cpu} #${ID}  processor #${c.cpuNum} "${c.cpuName}"`);
console.log(`  name       ${c.name}   (tape://${c.name})`);
console.log(`  holder     ${c.holder}${signer ? (signer.address.toLowerCase() === c.holder.toLowerCase() ? "  = PRIVATE_KEY address" : `  != PRIVATE_KEY address ${signer.address}`) : ""}`);
console.log(`  container  ${c.container}  ${c.opened ? "opened" : `NOT opened (open fee ${okb(fee)})`}`);
console.log(`  activation ${needBind ? `not live (paid until ${paidUntil ? new Date(Number(paidUntil) * 1000).toISOString() : "never"}); bind ${MONTHS} month(s) x ${okb(monthlyFee)}` : `live until ${new Date(Number(paidUntil) * 1000).toISOString()}`}`);
for (const w of warnings) console.log(`  warning    ${w}`);
console.log(`\nFiles in ${dir}: ${local.length}, ${local.reduce((s, f) => s + f.size, 0)} bytes`);
for (const f of local) {
  const u = p.uploads.find((x) => x.f === f);
  console.log(`  ${u ? (u.kind === "resume" ? `resume@${u.from}` : u.kind).padEnd(9) : "same".padEnd(9)} ${f.path}  ${f.size} B, ${f.chunks} chunk(s), ${f.contentType}, ${f.sha.slice(0, 18)}…`);
}
if (p.extra.length) console.log(`  ${p.extra.length} file(s) on chain but not local, left as is: ${p.extra.slice(0, 5).join(", ")}${p.extra.length > 5 ? ", …" : ""}`);
console.log(`\nPlan: ${!c.opened ? "open container, " : ""}${p.uploads.length} file(s) / ${uploadBytes} bytes to upload, ${p.same.length} unchanged${setFallback !== null ? `, setFallback(${setFallback})` : ""}${needBind ? `, bind ${MONTHS} month(s)` : ""}`);
console.log(`  ${txs} transaction(s), ~${(Number(gas) / 1e6).toFixed(2)}M gas (incl. 10% margin) x ${formatGwei(gasPrice)} gwei = ${okb(gasCost)}`);
console.log(`  value sent: ${okb(value)}   total ≈ ${okb(gasCost + value)}`);
console.log(`\nGateway:  ${tapekitUrl}\nFabX:     ${fabxUrl}\nStatus:   ${tapekitUrl}.tape/status`);

if (DRY) process.exit(0);
if (!txs) { console.log("\nNothing to do: the site on chain already matches."); process.exit(0); }

// ---------- send ----------
if (!signer) die("PRIVATE_KEY is not set (run with node --env-file=.env)");
if (signer.address.toLowerCase() !== c.holder.toLowerCase()) die(`PRIVATE_KEY address ${signer.address} is not the circuit holder ${c.holder}`);
const balance = await pub.getBalance({ address: signer.address });
if (balance < gasCost + value) die(`balance ${okb(balance)} is below the estimated ${okb(gasCost + value)}`);
const wallet = createWalletClient({ account: signer, chain: xLayer, transport: http(RPC, { timeout: 60_000, retryCount: 3 }) });

let spent = 0n, sent = 0;
async function send(label, request) {
  const { request: req } = await pub.simulateContract({ account: signer, ...request }); // reverts here, before any gas is spent
  const hash = await wallet.writeContract(req);
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") die(`${label}: transaction ${hash} reverted`);
  spent += r.gasUsed * r.effectiveGasPrice; sent++;
  console.log(`  [${sent}/${txs}] ${label}  ${hash}  ${r.gasUsed} gas`);
}

console.log("\nSending…");
if (!c.opened) {
  await send(`open ${c.name}`, { address: OPENER, abi: openerAbi, functionName: "open", args: [c.cpu, ID], value: fee });
  if (!(await rd(OPENER, openerAbi, "isOpened", [c.cpu, ID]))) die("open succeeded but isOpened is still false");
}
for (const u of p.uploads) {
  const f = u.f;
  let from = u.from;
  if (from && sha256(await readOnChain(c.container, f.path, from * CHUNK)) !== sha256(f.bytes.subarray(0, from * CHUNK))) from = 0; // partial bytes differ: start over
  for (let i = from; i < f.chunks; i++) {
    const data = `0x${f.bytes.subarray(i * CHUNK, (i + 1) * CHUNK).toString("hex")}`;
    const label = `${f.path} ${i + 1}/${f.chunks}`;
    if (i === 0) await send(label, { address: REGISTRY, abi: registryAbi, functionName: "putFile", args: [c.container, f.path, f.contentType, f.sha, data] });
    else await send(label, { address: REGISTRY, abi: registryAbi, functionName: "appendChunk", args: [c.container, f.path, BigInt(i), data] });
  }
  const [size, contentType, sha, , chunkCount] = await rd(REGISTRY, registryAbi, "fileInfo", [c.container, f.path]);
  if (Number(size) !== f.size || sha.toLowerCase() !== f.sha || Number(chunkCount) !== f.chunks || contentType !== f.contentType) die(`${f.path}: on-chain record is wrong after upload (size ${size}, chunks ${chunkCount}, sha ${sha})`);
}
if (setFallback !== null) await send(`setFallback ${setFallback}`, { address: REGISTRY, abi: registryAbi, functionName: "setFallback", args: [c.container, setFallback] });
if (needBind) {
  const mf = await rd(BINDING, bindingAbi, "monthlyFee"); // TAP-10 §6.3: read the fee at payment time, never hard-code it
  await send(`bind ${c.name} ${MONTHS} month(s)`, { address: BINDING, abi: bindingAbi, functionName: "bind", args: [c.name, c.container, MONTHS], value: mf * MONTHS });
}

// ---------- read back ----------
console.log("\nVerifying…");
const after = await readRemote(c.container);
let bad = 0;
for (const f of local) {
  const r = after.files.get(f.path);
  const ok = r && r.sha === f.sha && r.size === f.size && r.chunkCount === f.chunks;
  if (!ok) { bad++; console.log(`  MISMATCH ${f.path}`); }
}
const index = local.find((f) => f.path === "index.html");
if (index && sha256(await readOnChain(c.container, "index.html", index.size)) !== index.sha) { bad++; console.log("  MISMATCH index.html bytes"); }
const [liveNow, cLiveNow, until] = await Promise.all([
  rd(BINDING, bindingAbi, "isLive", [c.name, c.container]),
  rd(BINDING, bindingAbi, "isContainerLive", [c.container]).catch(() => false),
  rd(BINDING, bindingAbi, "containerPaidUntil", [c.container]).catch(() => 0n),
]);
console.log(`  ${local.length - bad}/${local.length} files match; activation ${liveNow || cLiveNow ? `live until ${new Date(Number(until) * 1000).toISOString()}` : "NOT live"}`);
console.log(`  ${sent} transaction(s), spent ${okb(spent)} gas + ${okb(value)} value`);
console.log(`\nLive at: ${tapekitUrl}\nFabX:    ${fabxUrl}\nName:    tape://${c.name}`);
if (bad) process.exit(1);
