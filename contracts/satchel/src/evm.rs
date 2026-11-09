//! EIP-1559 (type 2) transactions, built inside the contract.
//!
//! Satchel never signs an EVM hash it did not compute itself. The owner sends the transaction
//! fields, the contract RLP-encodes them, hashes them and records `(chain_id, nonce)` before it
//! asks the MPC network to sign. That record is what lets a buyer prove a transfer is clean.

use near_sdk::json_types::{U64, U128};
use near_sdk::{env, near, require};

/// Largest `data` field accepted, in bytes. Plenty for token transfers and approvals; keeps the
/// hashing cost and the event log bounded.
pub const MAX_DATA_BYTES: usize = 8 * 1024;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Eip1559Tx {
    pub chain_id: U64,
    pub nonce: U64,
    pub max_priority_fee_per_gas: U128,
    pub max_fee_per_gas: U128,
    pub gas_limit: U64,
    /// `0x` + 40 hex characters. Contract creation (no `to`) is not supported.
    pub to: String,
    /// Wei.
    pub value: U128,
    /// `0x`-prefixed hex, may be `0x` for a plain transfer.
    #[serde(default = "empty_hex")]
    pub data: String,
}

fn empty_hex() -> String {
    "0x".to_string()
}

impl Eip1559Tx {
    /// The 32-byte hash an EVM node checks the signature against:
    /// `keccak256(0x02 || rlp([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas,
    /// gas_limit, to, value, data, access_list]))`, with an empty access list.
    pub fn signing_hash(&self) -> [u8; 32] {
        let mut preimage = vec![0x02];
        preimage.extend_from_slice(&self.unsigned_rlp());
        env::keccak256_array(&preimage)
    }

    /// The RLP list of the unsigned fields, without the type byte.
    pub fn unsigned_rlp(&self) -> Vec<u8> {
        require!(self.chain_id.0 > 0, "Satchel: chain_id must be positive");
        require!(
            self.max_priority_fee_per_gas.0 <= self.max_fee_per_gas.0,
            "Satchel: max_priority_fee_per_gas is above max_fee_per_gas"
        );
        let to = decode_hex(&self.to, "to");
        require!(to.len() == 20, "Satchel: to must be 20 bytes");
        let data = decode_hex(&self.data, "data");
        require!(
            data.len() <= MAX_DATA_BYTES,
            "Satchel: data is longer than 8 KiB"
        );

        let mut fields = Vec::new();
        rlp_uint(&mut fields, self.chain_id.0.into());
        rlp_uint(&mut fields, self.nonce.0.into());
        rlp_uint(&mut fields, self.max_priority_fee_per_gas.0);
        rlp_uint(&mut fields, self.max_fee_per_gas.0);
        rlp_uint(&mut fields, self.gas_limit.0.into());
        rlp_bytes(&mut fields, &to);
        rlp_uint(&mut fields, self.value.0);
        rlp_bytes(&mut fields, &data);
        rlp_list_header(&mut fields, 0); // access list: empty

        let mut out = Vec::with_capacity(fields.len() + 9);
        rlp_list_header(&mut out, fields.len());
        out.extend_from_slice(&fields);
        out
    }
}

/// Calls that leave a standing right to move the wallet's assets after the transaction is mined.
/// A nonce check cannot see these, so the contract records each one it signs.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalKind {
    /// `approve(address,uint256)`: ERC-20 allowance, or ERC-721 approval of one token id.
    Approve,
    /// `increaseAllowance(address,uint256)` (OpenZeppelin ERC-20).
    IncreaseAllowance,
    /// `setApprovalForAll(address,bool)`: ERC-721 / ERC-1155 operator.
    SetApprovalForAll,
    /// Uniswap Permit2 `approve(address token,address spender,uint160,uint48)`.
    Permit2Approve,
}

pub const SELECTOR_APPROVE: [u8; 4] = [0x09, 0x5e, 0xa7, 0xb3];
pub const SELECTOR_INCREASE_ALLOWANCE: [u8; 4] = [0x39, 0x50, 0x93, 0x51];
pub const SELECTOR_SET_APPROVAL_FOR_ALL: [u8; 4] = [0xa2, 0x2c, 0xb4, 0x65];
pub const SELECTOR_PERMIT2_APPROVE: [u8; 4] = [0x87, 0x51, 0x7c, 0x45];

/// An approval decoded from a transaction's calldata.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecodedApproval {
    pub kind: ApprovalKind,
    pub spender: [u8; 20],
    /// The token Permit2 approves; `None` for the other kinds, where the token is the `to` address.
    pub token: Option<[u8; 20]>,
    /// The second ABI word: amount, token id or the boolean for operators. Permit2: the amount.
    pub arg: [u8; 32],
}

impl Eip1559Tx {
    /// Decodes the call if it grants an approval. Panics if the selector is an approval but the
    /// calldata is too short to name the spender: an approval Satchel cannot itemize is refused.
    pub fn approval(&self) -> Option<DecodedApproval> {
        let data = decode_hex(&self.data, "data");
        let selector: [u8; 4] = data.get(..4)?.try_into().ok()?;
        let kind = match selector {
            SELECTOR_APPROVE => ApprovalKind::Approve,
            SELECTOR_INCREASE_ALLOWANCE => ApprovalKind::IncreaseAllowance,
            SELECTOR_SET_APPROVAL_FOR_ALL => ApprovalKind::SetApprovalForAll,
            SELECTOR_PERMIT2_APPROVE => ApprovalKind::Permit2Approve,
            _ => return None,
        };
        let word = |i: usize| -> [u8; 32] {
            data.get(4 + 32 * i..4 + 32 * (i + 1))
                .and_then(|w| w.try_into().ok())
                .unwrap_or_else(|| env::panic_str("Satchel: approval calldata is too short"))
        };
        let address = |w: [u8; 32]| -> [u8; 20] { w[12..].try_into().unwrap() };
        Some(match kind {
            ApprovalKind::Permit2Approve => DecodedApproval {
                kind,
                token: Some(address(word(0))),
                spender: address(word(1)),
                arg: word(2),
            },
            _ => DecodedApproval {
                kind,
                token: None,
                spender: address(word(0)),
                arg: word(1),
            },
        })
    }
}

fn rlp_uint(out: &mut Vec<u8>, value: u128) {
    let bytes = value.to_be_bytes();
    let first = bytes.iter().position(|b| *b != 0).unwrap_or(bytes.len());
    rlp_bytes(out, &bytes[first..]);
}

fn rlp_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    if bytes.len() == 1 && bytes[0] < 0x80 {
        out.push(bytes[0]);
    } else {
        rlp_length(out, 0x80, bytes.len());
        out.extend_from_slice(bytes);
    }
}

fn rlp_list_header(out: &mut Vec<u8>, payload_len: usize) {
    rlp_length(out, 0xc0, payload_len);
}

fn rlp_length(out: &mut Vec<u8>, offset: u8, len: usize) {
    if len <= 55 {
        out.push(offset + len as u8);
    } else {
        let be = (len as u64).to_be_bytes();
        let first = be.iter().position(|b| *b != 0).unwrap_or(be.len() - 1);
        out.push(offset + 55 + (be.len() - first) as u8);
        out.extend_from_slice(&be[first..]);
    }
}

/// Decodes `0x`-prefixed hex. Panics with the field name on bad input.
pub fn decode_hex(input: &str, field: &str) -> Vec<u8> {
    let Some(digits) = input.strip_prefix("0x") else {
        env::panic_str(&format!("Satchel: {field} must start with 0x"))
    };
    if digits.len() % 2 != 0 {
        env::panic_str(&format!("Satchel: {field} has an odd number of hex digits"));
    }
    digits
        .as_bytes()
        .chunks(2)
        .map(|pair| (nibble(pair[0], field) << 4) | nibble(pair[1], field))
        .collect()
}

fn nibble(c: u8, field: &str) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => env::panic_str(&format!("Satchel: {field} is not hex")),
    }
}

pub fn encode_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 0x0f) as usize] as char);
    }
    out
}
