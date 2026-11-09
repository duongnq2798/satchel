import { type Address, type PublicClient, getAddress, parseAbi } from "viem";
import type { ApprovalRecord } from "./near";

const ERC20 = parseAbi(["function allowance(address owner, address spender) view returns (uint256)"]);
const ERC721 = parseAbi([
  "function getApproved(uint256 tokenId) view returns (address)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
]);
const PERMIT2 = parseAbi([
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

/** Where an approval stands on chain. `live: null` means it could not be read, which never passes. */
export interface Liveness {
  live: boolean | null;
  detail: string;
}

/** The finalized block every read on a chain is pinned to. */
export interface ReadAt {
  blockNumber: bigint;
  /** Its timestamp, seconds. Permit2 allowances expire. */
  now: bigint;
}

async function attempt<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/**
 * Reads whether the right an approval row granted is still there. Reads are conservative: an
 * `Approve` row is checked both as an ERC-20 allowance and as an ERC-721 `getApproved`, and is live
 * if either read says so, since the record cannot tell which standard the contract follows.
 */
export async function approvalLiveness(
  c: PublicClient,
  wallet: Address,
  row: ApprovalRecord,
  at: ReadAt,
): Promise<Liveness> {
  const contract = getAddress(row.contract);
  const spender = getAddress(row.spender);
  const { blockNumber } = at;

  switch (row.kind) {
    case "Approve":
    case "IncreaseAllowance": {
      const allowance = await attempt(() =>
        c.readContract({ address: contract, abi: ERC20, functionName: "allowance", args: [wallet, spender], blockNumber }),
      );
      const approved =
        row.kind === "Approve"
          ? await attempt(() =>
              c.readContract({ address: contract, abi: ERC721, functionName: "getApproved", args: [BigInt(row.arg)], blockNumber }),
            )
          : undefined;
      const allowanceLive = allowance !== undefined && allowance > 0n;
      const approvedLive = approved !== undefined && getAddress(approved) === spender;
      if (allowanceLive) return { live: true, detail: `allowance of ${allowance} still granted` };
      if (approvedLive) return { live: true, detail: `token ${BigInt(row.arg)} still approved` };
      if (allowance === undefined && approved === undefined) {
        return { live: null, detail: "could not read allowance or getApproved" };
      }
      return { live: false, detail: allowance !== undefined ? "allowance is 0" : "getApproved cleared" };
    }
    case "SetApprovalForAll": {
      const on = await attempt(() =>
        c.readContract({ address: contract, abi: ERC721, functionName: "isApprovedForAll", args: [wallet, spender], blockNumber }),
      );
      if (on === undefined) return { live: null, detail: "could not read isApprovedForAll" };
      return on ? { live: true, detail: "operator still approved" } : { live: false, detail: "operator off" };
    }
    case "Permit2Approve": {
      if (row.token === null) return { live: null, detail: "Permit2 row without a token" };
      const token = getAddress(row.token);
      const result = await attempt(() =>
        c.readContract({ address: contract, abi: PERMIT2, functionName: "allowance", args: [wallet, token, spender], blockNumber }),
      );
      if (result === undefined) return { live: null, detail: "could not read the Permit2 allowance" };
      const [amount, expiration] = result;
      if (amount > 0n && BigInt(expiration) >= at.now) {
        return { live: true, detail: `Permit2 allowance of ${amount} until ${new Date(Number(expiration) * 1000).toISOString()}` };
      }
      return { live: false, detail: amount === 0n ? "Permit2 allowance is 0" : "Permit2 allowance expired" };
    }
  }
}
