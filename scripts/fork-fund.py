"""Local fork only: give an address BEM, USDG and OKB by writing ERC20 balance storage on anvil.
Usage: python3 scripts/fork-fund.py <address> [rpc]"""
import json, subprocess, sys
who = sys.argv[1]; rpc = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8545"
def cast(*a): return subprocess.check_output(["cast", *a, "--rpc-url", rpc]).decode().strip()
def raw(*a): return subprocess.check_output(["cast", *a]).decode().strip()
BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952"
USDG = json.load(open("deployments/assets.json"))["usdg"]
def bal(t): return int(cast("call", t, "balanceOf(address)(uint256)", who).split()[0])
def set_balance(token, amount, known):
    val = "0x" + format(amount, "064x")
    for slot in [known] + [s for s in range(60) if s != known]:
        key = raw("index", "address", who, str(slot))
        old = cast("storage", token, key)
        cast("rpc", "anvil_setStorageAt", token, key, val)
        if bal(token) == amount: return slot
        cast("rpc", "anvil_setStorageAt", token, key, old)
    # some tokens keep balances in an ERC-7201 namespaced or solady slot: fall back to impersonating a holder
    raise SystemExit(f"could not find the balance slot of {token}")
print("BEM slot", set_balance(BEM, 50 * 10**8, 5))
print("USDG slot", set_balance(USDG, 100_000 * 10**6, 1))
cast("rpc", "anvil_setBalance", who, hex(100 * 10**18))
print("BEM", bal(BEM), "USDG", bal(USDG))
