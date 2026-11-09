#!/usr/bin/env bash
# Deploys Satchel to NEAR mainnet from the reproducible CI build of commit 87148c6, then locks it by
# deleting its only key, before anyone can mint. Run it in Git Bash from your own machine: every
# transaction is signed with your keys in ~/.near-credentials. Each step reads the chain first, so
# a rerun picks up where the last one stopped.
#
#   bash tools/deploy-mainnet.sh           deploy and lock (asks before the lock)
#   bash tools/deploy-mainnet.sh --check   only read the chain and say what each step would do
set -euo pipefail

CHECK=false
[ "${1:-}" = --check ] && CHECK=true

NEAR=~/.cargo/bin/near.exe
NODE=$(command -v node.exe || command -v node)
RPC=https://rpc.mainnet.fastnear.com
FUNDER=e0a1473828abe0e794769a4da69b765e6bd8446ff40650dd2afce7b8ab03099d
PARENT=satchel-nft.near
CONTRACT=v1.satchel-nft.near
MPC=v1.signer
CODE_HASH=94x4MmZKXGetffqJJVePLTdFkJvsmeXRLmi74Mdp2Lph
EMPTY_CODE=11111111111111111111111111111111
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WASM=$ROOT/contracts/satchel/target/near/satchel-87148c6.wasm
KEYS=~/.near-credentials/mainnet

# Reads mainnet at a final block: `code <account>` prints its code hash, `keys <account>` its public
# keys one per line, `mpc <account>` the contract's MPC signer. "missing" for no such account.
read_chain() {
  "$NODE" --input-type=module - "$RPC" "$@" <<'JS'
const [rpc, mode, account] = process.argv.slice(2);
const params = {
  code: { request_type: "view_account", account_id: account },
  keys: { request_type: "view_access_key_list", account_id: account },
  mpc: { request_type: "call_function", account_id: account, method_name: "mpc_contract", args_base64: "e30=" },
}[mode];
const res = await fetch(rpc, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { ...params, finality: "final" } }),
  signal: AbortSignal.timeout(30_000),
});
const { result, error } = await res.json();
if (error) console.log(error.cause?.name === "UNKNOWN_ACCOUNT" ? "missing" : `error ${JSON.stringify(error)}`);
else if (mode === "code") console.log(result.code_hash);
else if (mode === "keys") console.log(result.keys.map((k) => k.public_key).join("\n"));
else console.log(result.result ? JSON.parse(Buffer.from(result.result).toString()) : `error ${result.error}`);
JS
}

# Waits until `read_chain <mode> <account>` prints `want`: a new account, code or key takes a few
# blocks to be final.
wait_for() {
  local want=$1 out=""
  shift
  for _ in $(seq 60); do
    out=$(read_chain "$@")
    [ "$out" = "$want" ] && return
    sleep 2
  done
  echo "Gave up waiting: $* reads '$out', not '$want'" >&2
  exit 1
}

# Sends a transaction with near-cli, or in --check mode only says it would.
send() {
  if $CHECK; then
    echo "   would run: near $*"
    return 1
  fi
  "$NEAR" "$@"
}

ours() { [ -e "$KEYS/$1.json" ] || [ -d "$KEYS/$1" ]; }

echo "== The wasm is the reproducible build"
got=$("$NODE" "$ROOT/scripts/code-hash.mjs" "$WASM")
[ "$got" = "$CODE_HASH" ] || { echo "$WASM hashes to $got, not $CODE_HASH" >&2; exit 1; }
echo "   $got"

echo "== 1/4 Create $PARENT (3.5 NEAR from $FUNDER)"
code=$(read_chain code "$PARENT")
case "$code" in
  missing)
    if send account create-account fund-myself "$PARENT" '3.5 NEAR' autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain \
      sign-as "$FUNDER" network-config mainnet sign-with-legacy-keychain send; then
      code=$(read_chain code "$PARENT")
      until [ "$code" != missing ]; do sleep 2; code=$(read_chain code "$PARENT"); done
    fi
    ;;
  error*) echo "   couldn't read $PARENT: $code" >&2; exit 1 ;;
  *) ours "$PARENT" || { echo "   $PARENT exists and its key isn't in $KEYS: someone else owns it. Stopping." >&2; exit 1; }
     echo "   already created" ;;
esac

echo "== 2/4 Create $CONTRACT (3 NEAR from $PARENT)"
code=$(read_chain code "$CONTRACT")
case "$code" in
  missing)
    if send account create-account fund-myself "$CONTRACT" '3 NEAR' autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain \
      sign-as "$PARENT" network-config mainnet sign-with-legacy-keychain send; then
      wait_for "$EMPTY_CODE" code "$CONTRACT"
    fi
    ;;
  error*) echo "   couldn't read $CONTRACT: $code" >&2; exit 1 ;;
  *) ours "$CONTRACT" || { echo "   $CONTRACT exists and its key isn't in $KEYS. Stopping." >&2; exit 1; }
     echo "   already created" ;;
esac

echo "== 3/4 Deploy the build to $CONTRACT and initialize it with $MPC, in one transaction"
code=$(read_chain code "$CONTRACT")
if [ "$code" = "$CODE_HASH" ]; then
  echo "   already deployed"
elif [ "$code" = "$EMPTY_CODE" ] || { $CHECK && [ "$code" = missing ]; }; then
  if send contract deploy "$CONTRACT" use-file "$WASM" with-init-call new json-args "{\"mpc_contract\":\"$MPC\"}" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-legacy-keychain send; then
    wait_for "$CODE_HASH" code "$CONTRACT"
  fi
else
  echo "   $CONTRACT runs code $code, not the build or nothing. Stopping." >&2
  exit 1
fi

echo "== 4/4 Lock $CONTRACT by deleting its only key"
if $CHECK; then
  echo "   would check the code hash is $CODE_HASH and mpc_contract() is $MPC, then ask before deleting the key"
  exit 0
fi
signer=$(read_chain mpc "$CONTRACT")
[ "$signer" = "$MPC" ] || { echo "   mpc_contract() is '$signer', not $MPC. Not locking." >&2; exit 1; }
echo "   code hash $CODE_HASH, signs through $signer"
keys=$(read_chain keys "$CONTRACT")
if [ -z "$keys" ]; then
  echo "   already locked"
else
  [ "$(echo "$keys" | wc -l)" -eq 1 ] || { echo "   $CONTRACT has more than one key:" >&2; echo "$keys" >&2; exit 1; }
  echo "   its key: $keys"
  echo "   Deleting it is final: nobody can change the contract or sign as it again."
  read -r -p "   Type LOCK to delete it: " answer
  [ "$answer" = LOCK ] || { echo "   Not locked. Run the script again to lock it before anyone mints." >&2; exit 1; }
  "$NEAR" account delete-keys "$CONTRACT" public-keys "$keys" network-config mainnet sign-with-legacy-keychain send
  wait_for "" keys "$CONTRACT"
fi

echo "== Done: $CONTRACT is locked (0 keys), runs $CODE_HASH and signs through $MPC"
