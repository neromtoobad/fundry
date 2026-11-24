// The demo funds the seed script launches. Each rulebook is compiled by the SDK into the circuit
// that gets taped out, exactly as the Launch page does it.
export const demoFunds = [
  {
    name: "AI + Market", symbol: "fAIM", deposit: 1_000,
    rulebook: {
      assets: [
        { symbol: "NVDA", base: 2, onDrop: "half", onRise: "double", stop: "stayOut" },
        { symbol: "SPY", base: 2, onDrop: "none", onRise: "none", stop: "none" },
      ],
      dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: true,
    },
  },
  {
    name: "Big Tech Guard", symbol: "fBTG", deposit: 1_500,
    rulebook: {
      assets: [
        { symbol: "MSFT", base: 1, onDrop: "zero", onRise: "none", stop: "once" },
        { symbol: "META", base: 1, onDrop: "zero", onRise: "none", stop: "once" },
        { symbol: "NVDA", base: 1, onDrop: "zero", onRise: "none", stop: "once" },
      ],
      dropBps: 400, riseBps: 400, stopBps: 1000, allFallingToCash: true,
    },
  },
  {
    name: "Hard Assets", symbol: "fHARD", deposit: 800,
    rulebook: {
      assets: [
        { symbol: "GOLD", base: 2, onDrop: "none", onRise: "none", stop: "none" },
        { symbol: "BTC", base: 1, onDrop: "half", onRise: "double", stop: "stayOut" },
        { symbol: "ETH", base: 1, onDrop: "half", onRise: "double", stop: "stayOut" },
      ],
      dropBps: 800, riseBps: 800, stopBps: 2000, allFallingToCash: false,
    },
  },
  {
    name: "SpaceX Moonshot", symbol: "fSPCX", deposit: 600,
    rulebook: {
      assets: [
        { symbol: "SPCX", base: 3, onDrop: "half", onRise: "none", stop: "stayOut" },
        { symbol: "SPY", base: 1, onDrop: "none", onRise: "none", stop: "none" },
      ],
      dropBps: 1000, riseBps: 1000, stopBps: 2500, allFallingToCash: false,
    },
  },
];

// Forks: each one's chip REFs its parent's chip (launched above), so the parent's rules run first,
// unchanged, and these rules adjust the result. The parent chip's holder earns 20% of the fork's
// creator fee.
export const demoForks = [
  {
    name: "AI + Market, Safer", symbol: "fAIMS", forkOf: "AI + Market", deposit: 500,
    rulebook: {
      kind: "fork",
      assets: [
        { symbol: "NVDA", shift: -1, onDrop: "none", onRise: "none", stop: "none" },
        { symbol: "SPY", shift: 1, onDrop: "none", onRise: "none", stop: "stayOut" },
      ],
      dropBps: 500, riseBps: 500, stopBps: 1500, allFallingToCash: true,
    },
  },
  {
    name: "Moonshot, Steady", symbol: "fSPCXS", forkOf: "SpaceX Moonshot", deposit: 400,
    rulebook: {
      kind: "fork",
      assets: [
        { symbol: "SPCX", shift: -1, onDrop: "none", onRise: "none", stop: "none" },
        { symbol: "SPY", shift: 1, onDrop: "none", onRise: "none", stop: "none" },
      ],
      dropBps: 1000, riseBps: 1000, stopBps: 2500, allFallingToCash: true,
    },
  },
];
