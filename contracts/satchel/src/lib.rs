//! Satchel: an NFT that is a wallet on every EVM chain.
//!
//! Every token controls a secp256k1 key derived by NEAR's MPC network (Chain Signatures) from this
//! contract's account and the token's derivation path. Whoever owns the token can have the contract
//! request signatures for that key, so transferring the NFT transfers control of the same address
//! on Ethereum, Base, Arbitrum and the other supported chains.
//!
//! The hard part of selling a wallet is the seller who signs a withdrawal, sells, and broadcasts it
//! afterwards, or who leaves an approval behind. Satchel answers with a public signing record:
//! EVM transactions are built and hashed by this contract, which stores the highest nonce it signed
//! per chain, itemizes every approval, and counts every call it cannot classify. Signatures over
//! raw payloads are allowed but counted as opaque. Listing a token freezes signing, and `buy` only
//! goes through for the record the buyer checked.

mod evm;
#[cfg(test)]
mod tests;

pub use evm::{ApprovalKind, CallClass, Eip1559Tx, SUPPORTED_CHAINS};

use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{
    NonFungibleToken, NonFungibleTokenEnumeration, Token, TokenId,
};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseOrValue,
    assert_one_yocto, env, near, require,
};
use std::collections::HashMap;

/// Paid once per mint. It covers the token's storage plus its signing record and listing, which
/// the contract stores later without asking for more.
pub const MINT_DEPOSIT: NearToken = NearToken::from_millinear(100);
/// Distinct approvals itemized per token. Bounds the record's storage.
pub const MAX_APPROVALS: usize = 32;
/// The MPC contract refuses a `sign` call with less than 15 TGas; this leaves room for our own work.
pub const MIN_SIGN_GAS: Gas = Gas::from_tgas(50);
const MPC_SIGN_STATIC_GAS: Gas = Gas::from_tgas(20);
/// Secp256k1 domain of the MPC network (ECDSA): EVM chains and Bitcoin.
pub const ECDSA_DOMAIN: u64 = 0;
const EVENT_STANDARD: &str = "satchel";
const EVENT_VERSION: &str = "1.0.0";

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EvmChainRecord {
    pub chain_id: U64,
    /// Highest nonce this contract ever signed for the token on this chain.
    pub max_nonce: U64,
    pub signatures: u32,
}

/// An approval this contract signed for the token. After a transfer, the buyer checks that each
/// one is revoked on chain (allowance 0, operator off, `getApproved` cleared).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApprovalRecord {
    pub chain_id: U64,
    /// The contract the transaction called (`to`), lowercase `0x` hex.
    pub contract: String,
    pub kind: ApprovalKind,
    pub spender: String,
    /// Permit2 only: the token it approves.
    pub token: Option<String>,
    /// The second argument: amount, token id (ERC-721 `approve`), or the operator boolean. Part of
    /// the row's identity, so approvals of two token ids stay two rows.
    pub arg: String,
}

/// Everything this contract ever signed for one token. Written before the MPC request goes out,
/// so a failed request can only make the record stricter, never looser.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SigningRecord {
    pub evm: Vec<EvmChainRecord>,
    /// Distinct approvals signed through `sign_evm`, up to `MAX_APPROVALS`.
    pub approvals: Vec<ApprovalRecord>,
    /// Approvals signed after the list was full. A buyer cannot check these one by one.
    pub approvals_not_itemized: u32,
    /// `sign_evm` calls that were neither a value transfer, an asset transfer nor a decoded
    /// approval. Like opaque signatures, a buyer cannot rule out what these left behind.
    pub unclassified_calls: u32,
    /// Signatures over payloads the contract did not build. A buyer cannot rule these out.
    pub opaque_signatures: u32,
    /// Block time of the latest opaque signature, nanoseconds.
    pub last_opaque_at: U64,
    /// Bumped on every signature. `buy` must name the version the buyer checked.
    pub version: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listing {
    pub seller: AccountId,
    /// yoctoNEAR.
    pub price: U128,
    /// The signing record version when the token was listed. Signing is frozen while listed.
    pub record_version: U64,
    pub listed_at: U64,
}

#[near(serializers = [json])]
pub struct SatchelView {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    /// Path to pass to the MPC contract's `derived_public_key` with this contract as predecessor.
    pub path: String,
    pub record: SigningRecord,
    pub listing: Option<Listing>,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    TokenOwners,
    TokenMetadata,
    Enumeration,
    ContractMetadata,
    Records,
    Listings,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    mpc_contract: AccountId,
    next_id: u64,
    records: LookupMap<TokenId, SigningRecord>,
    listings: IterableMap<TokenId, Listing>,
}

#[near]
impl Contract {
    /// `mpc_contract` is `v1.signer-prod.testnet` on testnet and `v1.signer` on mainnet. It cannot
    /// be changed later: there is no admin. Private, so nobody can front-run the deployer's init.
    #[init]
    #[private]
    pub fn new(mpc_contract: AccountId) -> Self {
        let metadata = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Satchel".to_string(),
            symbol: "SATCHEL".to_string(),
            icon: Some(ICON.to_string()),
            base_uri: None,
            reference: None,
            reference_hash: None,
        };
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::TokenOwners,
                env::current_account_id(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                None::<StorageKey>,
            ),
            metadata: LazyOption::new(StorageKey::ContractMetadata, Some(&metadata)),
            mpc_contract,
            next_id: 1,
            records: LookupMap::new(StorageKey::Records),
            listings: IterableMap::new(StorageKey::Listings),
        }
    }

    /// Mints a new satchel to `receiver_id` (the caller by default). Attach `MINT_DEPOSIT`; anything
    /// above it is refunded.
    #[payable]
    pub fn mint(&mut self, receiver_id: Option<AccountId>) -> Token {
        let deposit = env::attached_deposit();
        require!(
            deposit >= MINT_DEPOSIT,
            "Satchel: attach 0.1 NEAR to mint (it pays for the token's storage)"
        );
        let owner = receiver_id.unwrap_or_else(env::predecessor_account_id);
        let id = self.next_id;
        self.next_id += 1;
        let token_id = id.to_string();
        let metadata = TokenMetadata {
            title: Some(format!("Satchel #{id}")),
            description: Some(
                "A wallet on every chain. Whoever owns this NFT controls the addresses its keys derive."
                    .to_string(),
            ),
            media: None,
            media_hash: None,
            copies: Some(1),
            issued_at: Some(env::block_timestamp_ms().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(json!({ "path": token_path(&token_id) }).to_string()),
            reference: None,
            reference_hash: None,
        };
        let token = self.tokens.internal_mint_with_refund(
            token_id.clone(),
            owner.clone(),
            Some(metadata),
            None,
        );
        // `internal_mint_with_refund` does not log NEP-171's mint event; wallets and indexers need it.
        NftMint {
            owner_id: &owner,
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();
        let refund = deposit.saturating_sub(MINT_DEPOSIT);
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id())
                .transfer(refund)
                .detach();
        }
        token
    }

    /// Builds and hashes `tx`, records its chain and nonce, then asks the MPC network to sign the
    /// hash with this token's key. Owner only, 1 yoctoNEAR, at least 50 TGas, not while listed.
    /// The returned promise resolves to the MPC signature (`big_r`, `s`, `recovery_id`).
    #[payable]
    pub fn sign_evm(&mut self, token_id: TokenId, tx: Eip1559Tx) -> Promise {
        self.assert_can_sign(&token_id);
        require!(
            SUPPORTED_CHAINS.contains(&tx.chain_id.0),
            "Satchel: chain_id is not one of the supported chains"
        );
        let hash = tx.signing_hash();
        let class = tx.classify();
        let mut record = self.record(&token_id);
        match record.evm.iter_mut().find(|r| r.chain_id == tx.chain_id) {
            Some(chain) => {
                chain.max_nonce = U64(chain.max_nonce.0.max(tx.nonce.0));
                chain.signatures += 1;
            }
            None => record.evm.push(EvmChainRecord {
                chain_id: tx.chain_id,
                max_nonce: tx.nonce,
                signatures: 1,
            }),
        }
        let (class_name, approval, selector) = match &class {
            CallClass::ValueTransfer => ("value_transfer", None, None),
            CallClass::AssetTransfer => ("asset_transfer", None, None),
            CallClass::Revocation => ("revocation", None, None),
            CallClass::Approval(a) => (
                "approval",
                Some(ApprovalRecord {
                    chain_id: tx.chain_id,
                    contract: format!("0x{}", evm::encode_hex(&evm::decode_hex(&tx.to, "to"))),
                    kind: a.kind,
                    spender: format!("0x{}", evm::encode_hex(&a.spender)),
                    token: a.token.map(|t| format!("0x{}", evm::encode_hex(&t))),
                    arg: format!("0x{}", evm::encode_hex(&a.arg)),
                }),
                None,
            ),
            CallClass::Unclassified(sel) => {
                record.unclassified_calls += 1;
                (
                    "unclassified",
                    None,
                    Some(format!("0x{}", evm::encode_hex(sel))),
                )
            }
        };
        if let Some(new) = &approval {
            // Only an identical row is merged: two token ids, amounts or spenders stay two rows,
            // so every approval the buyer must see revoked is listed.
            if !record.approvals.contains(new) {
                if record.approvals.len() < MAX_APPROVALS {
                    record.approvals.push(new.clone());
                } else {
                    record.approvals_not_itemized += 1;
                }
            }
        }
        record.version = U64(record.version.0 + 1);
        self.records.insert(token_id.clone(), record.clone());
        emit(
            "sign_evm",
            json!({
                "token_id": token_id,
                "chain_id": tx.chain_id,
                "nonce": tx.nonce,
                "to": tx.to,
                "value": tx.value,
                "class": class_name,
                "approval": approval,
                "selector": selector,
                "data_hash": evm::encode_hex(&tx.data_hash()),
                "payload": evm::encode_hex(&hash),
                "record_version": record.version,
            }),
        );
        self.request_signature(&token_id, &hash)
    }

    /// Signs a 32-byte payload the contract did not build (a Bitcoin sighash, a message hash).
    /// Allowed, but counted in the token's record as opaque, which every buyer sees.
    #[payable]
    pub fn sign_raw(&mut self, token_id: TokenId, payload: String) -> Promise {
        self.assert_can_sign(&token_id);
        let bytes = evm::decode_hex(&payload, "payload");
        let hash: [u8; 32] = bytes
            .try_into()
            .unwrap_or_else(|_| env::panic_str("Satchel: payload must be 32 bytes"));
        let mut record = self.record(&token_id);
        record.opaque_signatures += 1;
        record.last_opaque_at = U64(env::block_timestamp());
        record.version = U64(record.version.0 + 1);
        self.records.insert(token_id.clone(), record.clone());
        emit(
            "sign_raw",
            json!({
                "token_id": token_id,
                "payload": evm::encode_hex(&hash),
                "record_version": record.version,
            }),
        );
        self.request_signature(&token_id, &hash)
    }

    /// Offers the token for `price` yoctoNEAR. Signing stays frozen until it is sold, delisted or
    /// transferred. Owner only, 1 yoctoNEAR.
    #[payable]
    pub fn list(&mut self, token_id: TokenId, price: U128) {
        assert_one_yocto();
        let owner = self.assert_owner(&token_id);
        require!(price.0 > 0, "Satchel: price must be positive");
        let listing = Listing {
            seller: owner,
            price,
            record_version: self.record(&token_id).version,
            listed_at: U64(env::block_timestamp()),
        };
        emit(
            "list",
            json!({ "token_id": token_id, "price": price, "record_version": listing.record_version }),
        );
        self.listings.insert(token_id, listing);
    }

    #[payable]
    pub fn delist(&mut self, token_id: TokenId) {
        assert_one_yocto();
        self.assert_owner(&token_id);
        require!(
            self.listings.remove(&token_id).is_some(),
            "Satchel: token is not listed"
        );
        emit("delist", json!({ "token_id": token_id }));
    }

    /// Buys a listed token. `record_version` and `price` must match what the buyer checked, so a
    /// seller cannot change either between the check and the purchase. Attach at least `price`;
    /// the rest is refunded. The token moves in this receipt; the seller's payment is a transfer
    /// receipt created by it. If the seller deleted their account, that transfer fails and the NEAR
    /// stays in this contract.
    #[payable]
    pub fn buy(&mut self, token_id: TokenId, record_version: U64, price: U128) {
        let buyer = env::predecessor_account_id();
        let listing = self
            .active_listing(&token_id)
            .unwrap_or_else(|| env::panic_str("Satchel: token is not listed"));
        require!(listing.price == price, "Satchel: the price changed");
        let current = self.record(&token_id).version;
        require!(
            current == record_version && listing.record_version == record_version,
            "Satchel: the signing record changed since you checked it"
        );
        require!(buyer != listing.seller, "Satchel: the seller cannot buy");
        let deposit = env::attached_deposit();
        require!(
            deposit.as_yoctonear() >= price.0,
            "Satchel: attach at least the price"
        );

        self.listings.remove(&token_id);
        self.tokens
            .internal_transfer(&listing.seller, &buyer, &token_id, None, None);
        emit(
            "sale",
            json!({
                "token_id": token_id,
                "seller": listing.seller,
                "buyer": buyer,
                "price": price,
                "record_version": record_version,
            }),
        );
        Promise::new(listing.seller)
            .transfer(NearToken::from_yoctonear(price.0))
            .detach();
        let refund = deposit.as_yoctonear() - price.0;
        if refund > 0 {
            Promise::new(buyer)
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }
    }

    // ---------- views ----------

    pub fn satchel(&self, token_id: TokenId) -> Option<SatchelView> {
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        Some(SatchelView {
            path: token_path(&token_id),
            record: self.record(&token_id),
            listing: self.active_listing(&token_id),
            owner_id,
            token_id,
        })
    }

    pub fn signing_record(&self, token_id: TokenId) -> SigningRecord {
        self.record(&token_id)
    }

    pub fn listing(&self, token_id: TokenId) -> Option<Listing> {
        self.active_listing(&token_id)
    }

    /// Listings whose seller still owns the token. Removing a listing moves the last one into its
    /// slot, so a page can shift between calls.
    pub fn listings(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<(TokenId, Listing)> {
        self.listings
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .filter(|(id, l)| self.tokens.owner_by_id.get(*id).as_ref() == Some(&l.seller))
            .map(|(id, l)| (id.clone(), l.clone()))
            .collect()
    }

    pub fn derivation_path(&self, token_id: TokenId) -> String {
        token_path(&token_id)
    }

    pub fn mpc_contract(&self) -> AccountId {
        self.mpc_contract.clone()
    }

    /// The hash `sign_evm` would sign for `tx`, as hex. Lets a client check the contract's
    /// encoding before it spends a signature.
    pub fn evm_signing_hash(&self, tx: Eip1559Tx) -> String {
        evm::encode_hex(&tx.signing_hash())
    }

    // ---------- internals ----------

    fn record(&self, token_id: &TokenId) -> SigningRecord {
        self.records.get(token_id).cloned().unwrap_or_default()
    }

    /// The listing, if its seller still owns the token. Every path that moves a token removes its
    /// listing; this is the second lock in case one is ever missed.
    fn active_listing(&self, token_id: &TokenId) -> Option<Listing> {
        let listing = self.listings.get(token_id)?;
        let owner = self.tokens.owner_by_id.get(token_id)?;
        (listing.seller == owner).then(|| listing.clone())
    }

    fn assert_owner(&self, token_id: &TokenId) -> AccountId {
        let owner = self
            .tokens
            .owner_by_id
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("Satchel: no such token"));
        require!(
            owner == env::predecessor_account_id(),
            "Satchel: only the token's owner can do this"
        );
        owner
    }

    fn assert_can_sign(&self, token_id: &TokenId) {
        assert_one_yocto();
        self.assert_owner(token_id);
        require!(
            self.active_listing(token_id).is_none(),
            "Satchel: signing is frozen while the token is listed"
        );
        require!(
            env::prepaid_gas() >= MIN_SIGN_GAS,
            "Satchel: attach at least 50 TGas to sign"
        );
    }

    fn request_signature(&self, token_id: &TokenId, hash: &[u8; 32]) -> Promise {
        let args = json!({
            "request": {
                "path": token_path(token_id),
                "payload_v2": { "Ecdsa": evm::encode_hex(hash) },
                "domain_id": ECDSA_DOMAIN,
            }
        });
        Promise::new(self.mpc_contract.clone()).function_call_weight(
            "sign".to_string(),
            args.to_string().into_bytes(),
            NearToken::from_yoctonear(1),
            MPC_SIGN_STATIC_GAS,
            GasWeight(1),
        )
    }
}

/// The MPC derivation path for a token. The key is derived from this contract's account and this
/// path, so it is fixed for the token's lifetime, whoever owns it.
pub fn token_path(token_id: &str) -> String {
    format!("satchel/{token_id}")
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({
            "standard": EVENT_STANDARD,
            "version": EVENT_VERSION,
            "event": event,
            "data": [data],
        })
    ));
}

#[near]
impl NonFungibleTokenCore for Contract {
    /// A transfer ends any listing: the new owner starts unlisted and free to sign.
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.listings.remove(&token_id);
        self.tokens
            .nft_transfer(receiver_id, token_id, approval_id, memo);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.listings.remove(&token_id);
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let kept = self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id.clone(),
            approved_account_ids,
        );
        if !kept {
            // The receiver gave the token back; any listing it made while it held the token is void.
            self.listings.remove(&token_id);
        }
        kept
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata.get().unwrap()
    }
}

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='4' y='10' width='24' height='18' rx='4' fill='%23111'/%3E%3Cpath d='M11 10V7a5 5 0 0 1 10 0v3' stroke='%23111' stroke-width='3' fill='none'/%3E%3Ccircle cx='16' cy='19' r='3' fill='%23f5c84b'/%3E%3C/svg%3E";
