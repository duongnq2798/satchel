// Prints EIP-1559 signing hashes computed by viem, the independent reference for
// contracts/satchel/src/evm.rs. Run `npm run gen` after changing the cases.
import { keccak256, serializeTransaction } from "viem";

const cases = [
  {
    name: "plain transfer, nonce 0 (zero fields encode as 0x80)",
    tx: { chainId: 11155111, nonce: 0, maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: 30_000_000_000n, gas: 21000n, to: "0x000000000000000000000000000000000000dEaD", value: 10_000_000_000_000_000n, data: "0x" },
  },
  {
    name: "single-byte nonce below 0x80 and zero value",
    tx: { chainId: 84532, nonce: 127, maxPriorityFeePerGas: 0n, maxFeePerGas: 1n, gas: 21000n, to: "0x1111111111111111111111111111111111111111", value: 0n, data: "0x" },
  },
  {
    name: "nonce 128 needs a length prefix",
    tx: { chainId: 1, nonce: 128, maxPriorityFeePerGas: 2n, maxFeePerGas: 3n, gas: 50000n, to: "0x2222222222222222222222222222222222222222", value: 1n, data: "0x00" },
  },
  {
    name: "ERC-20 transfer calldata (68 bytes, long-string header)",
    tx: { chainId: 8453, nonce: 42, maxPriorityFeePerGas: 1_500_000n, maxFeePerGas: 9_000_000n, gas: 65000n, to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", value: 0n, data: "0xa9059cbb000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd00000000000000000000000000000000000000000000000000000000000f4240" },
  },
  {
    name: "large values and 600 bytes of data (two-byte list length)",
    tx: { chainId: 42161, nonce: 18446744073709551615n, maxPriorityFeePerGas: 340282366920938463463374607431768211455n, maxFeePerGas: 340282366920938463463374607431768211455n, gas: 18446744073709551615n, to: "0xffffffffffffffffffffffffffffffffffffffff", value: 340282366920938463463374607431768211455n, data: "0x" + "ab".repeat(600) },
  },
];

const out = cases.map(({ name, tx }) => {
  const serialized = serializeTransaction({ type: "eip1559", accessList: [], ...tx });
  return {
    name,
    tx: {
      chain_id: String(tx.chainId),
      nonce: String(tx.nonce),
      max_priority_fee_per_gas: String(tx.maxPriorityFeePerGas),
      max_fee_per_gas: String(tx.maxFeePerGas),
      gas_limit: String(tx.gas),
      to: tx.to,
      value: String(tx.value),
      data: tx.data,
    },
    serialized_unsigned: serialized,
    signing_hash: keccak256(serialized),
  };
});
console.log(JSON.stringify(out, null, 2));
