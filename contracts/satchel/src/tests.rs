use super::*;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{VMContextBuilder, accounts, get_created_receipts, get_logs};
use near_sdk::testing_env;

const MPC: &str = "v1.signer-prod.testnet";
const VECTORS: &str = include_str!("evm_vectors.json");
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

fn ctx(predecessor: AccountId, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id("satchel.testnet".parse().unwrap())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor)
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(1_700_000_000_000_000_000);
    b
}

fn set(predecessor: AccountId, deposit: NearToken) {
    testing_env!(ctx(predecessor, deposit).build());
}

/// A contract where alice owns token "1".
fn setup() -> Contract {
    // `new` is private: the contract account initializes itself.
    set(
        "satchel.testnet".parse().unwrap(),
        NearToken::from_yoctonear(0),
    );
    let mut c = Contract::new(MPC.parse().unwrap());
    set(accounts(0), MINT_DEPOSIT);
    c.mint(None);
    c
}

fn tx(chain_id: u64, nonce: u64) -> Eip1559Tx {
    Eip1559Tx {
        chain_id: U64(chain_id),
        nonce: U64(nonce),
        max_priority_fee_per_gas: U128(1_000_000_000),
        max_fee_per_gas: U128(30_000_000_000),
        gas_limit: U64(21_000),
        to: "0x000000000000000000000000000000000000dEaD".to_string(),
        value: U128(1),
        data: "0x".to_string(),
    }
}

/// Every function call the last method created: (receiver, method, args, deposit, static gas).
fn calls() -> Vec<(String, String, Value, NearToken, Gas)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight {
                    method_name,
                    args,
                    attached_deposit,
                    prepaid_gas,
                    ..
                } => Some((
                    receiver.clone(),
                    String::from_utf8(method_name).unwrap(),
                    serde_json::from_slice(&args).unwrap(),
                    attached_deposit,
                    prepaid_gas,
                )),
                _ => None,
            })
        })
        .collect()
}

/// Every NEAR transfer the last method created: (receiver, amount).
fn transfers() -> Vec<(String, NearToken)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let receiver = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => Some((receiver.clone(), deposit)),
                _ => None,
            })
        })
        .collect()
}

// ---------- EIP-1559 encoding, checked against viem ----------

#[test]
fn evm_hash_and_rlp_match_viem_for_every_vector() {
    let vectors: Vec<Value> = serde_json::from_str(VECTORS).unwrap();
    assert_eq!(vectors.len(), 5);
    set(accounts(0), NearToken::from_yoctonear(0));
    for v in vectors {
        let tx: Eip1559Tx = serde_json::from_value(v["tx"].clone()).unwrap();
        let name = v["name"].as_str().unwrap();
        assert_eq!(
            format!("0x02{}", evm::encode_hex(&tx.unsigned_rlp())),
            v["serialized_unsigned"].as_str().unwrap(),
            "rlp: {name}"
        );
        assert_eq!(
            format!("0x{}", evm::encode_hex(&tx.signing_hash())),
            v["signing_hash"].as_str().unwrap(),
            "hash: {name}"
        );
    }
}

#[test]
fn evm_signing_hash_view_matches_the_hash_sign_evm_sends() {
    let mut c = setup();
    let expected = c.evm_signing_hash(tx(11155111, 0));
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(11155111, 0));
    let (_, _, args, _, _) = calls().pop().unwrap();
    assert_eq!(args["request"]["payload_v2"]["Ecdsa"], expected);
}

#[test]
#[should_panic(expected = "Satchel: to must be 20 bytes")]
fn evm_rejects_short_to() {
    set(accounts(0), NearToken::from_yoctonear(0));
    let mut t = tx(1, 0);
    t.to = "0x00000000000000000000000000000000000000".to_string();
    t.signing_hash();
}

#[test]
#[should_panic(expected = "Satchel: to must start with 0x")]
fn evm_rejects_to_without_prefix() {
    set(accounts(0), NearToken::from_yoctonear(0));
    let mut t = tx(1, 0);
    t.to = "000000000000000000000000000000000000dEaD".to_string();
    t.signing_hash();
}

#[test]
#[should_panic(expected = "Satchel: data has an odd number of hex digits")]
fn evm_rejects_odd_hex() {
    set(accounts(0), NearToken::from_yoctonear(0));
    let mut t = tx(1, 0);
    t.data = "0xabc".to_string();
    t.signing_hash();
}

#[test]
#[should_panic(expected = "Satchel: data is not hex")]
fn evm_rejects_non_hex() {
    set(accounts(0), NearToken::from_yoctonear(0));
    let mut t = tx(1, 0);
    t.data = "0xzz".to_string();
    t.signing_hash();
}

#[test]
#[should_panic(expected = "Satchel: data is longer than 8 KiB")]
fn evm_rejects_oversized_data() {
    set(accounts(0), NearToken::from_yoctonear(0));
    let mut t = tx(1, 0);
    t.data = format!("0x{}", "00".repeat(evm::MAX_DATA_BYTES + 1));
    t.signing_hash();
}

#[test]
#[should_panic(expected = "Satchel: max_priority_fee_per_gas is above max_fee_per_gas")]
fn evm_rejects_priority_fee_above_max_fee() {
    set(accounts(0), NearToken::from_yoctonear(0));
    let mut t = tx(1, 0);
    t.max_priority_fee_per_gas = U128(t.max_fee_per_gas.0 + 1);
    t.signing_hash();
}

#[test]
#[should_panic(expected = "Satchel: chain_id must be positive")]
fn evm_rejects_chain_zero() {
    set(accounts(0), NearToken::from_yoctonear(0));
    tx(0, 0).signing_hash();
}

// ---------- mint ----------

#[test]
fn mint_numbers_tokens_and_refunds_the_excess() {
    let mut c = setup();
    set(
        accounts(1),
        MINT_DEPOSIT.saturating_add(NearToken::from_near(1)),
    );
    let t = c.mint(None);
    assert_eq!(t.token_id, "2");
    assert_eq!(t.owner_id, accounts(1));
    assert_eq!(
        transfers(),
        vec![(accounts(1).to_string(), NearToken::from_near(1))]
    );
    let view = c.satchel("2".to_string()).unwrap();
    assert_eq!(view.path, "satchel/2");
    assert_eq!(view.record, SigningRecord::default());
    assert_eq!(c.nft_total_supply(), U128(2));
}

#[test]
fn mint_to_another_account() {
    let mut c = setup();
    set(accounts(0), MINT_DEPOSIT);
    let t = c.mint(Some(accounts(2)));
    assert_eq!(t.owner_id, accounts(2));
    assert!(transfers().is_empty());
}

#[test]
#[should_panic(expected = "Satchel: attach 0.1 NEAR to mint")]
fn mint_requires_the_deposit() {
    let mut c = setup();
    set(accounts(0), MINT_DEPOSIT.saturating_sub(ONE_YOCTO));
    c.mint(None);
}

// ---------- sign_evm ----------

#[test]
fn sign_evm_calls_mpc_with_the_token_path_and_records_the_nonce() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(11155111, 7));
    let calls = calls();
    assert_eq!(calls.len(), 1);
    let (receiver, method, args, deposit, gas) = &calls[0];
    assert_eq!(receiver, MPC);
    assert_eq!(method, "sign");
    assert_eq!(args["request"]["path"], "satchel/1");
    assert_eq!(args["request"]["domain_id"], 0);
    assert_eq!(*deposit, ONE_YOCTO);
    assert!(*gas >= Gas::from_tgas(15), "the MPC contract needs 15 TGas");

    let record = c.signing_record("1".to_string());
    assert_eq!(
        record.evm,
        vec![EvmChainRecord {
            chain_id: U64(11155111),
            max_nonce: U64(7),
            signatures: 1
        }]
    );
    assert_eq!(record.version, U64(1));
    assert_eq!(record.opaque_signatures, 0);
    let log = get_logs().pop().unwrap();
    assert!(log.starts_with("EVENT_JSON:"), "{log}");
    let event: Value = serde_json::from_str(&log["EVENT_JSON:".len()..]).unwrap();
    assert_eq!(event["standard"], "satchel");
    assert_eq!(event["event"], "sign_evm");
    assert_eq!(event["data"][0]["nonce"], "7");
}

#[test]
fn sign_evm_keeps_the_highest_nonce_per_chain() {
    let mut c = setup();
    for (chain, nonce) in [(1, 5), (1, 2), (8453, 0), (1, 9)] {
        set(accounts(0), ONE_YOCTO);
        let _ = c.sign_evm("1".to_string(), tx(chain, nonce));
    }
    let record = c.signing_record("1".to_string());
    assert_eq!(
        record.evm,
        vec![
            EvmChainRecord {
                chain_id: U64(1),
                max_nonce: U64(9),
                signatures: 3
            },
            EvmChainRecord {
                chain_id: U64(8453),
                max_nonce: U64(0),
                signatures: 1
            },
        ]
    );
    assert_eq!(record.version, U64(4));
}

#[test]
#[should_panic(expected = "Satchel: chain_id is not one of the supported chains")]
fn sign_evm_refuses_an_unsupported_chain() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    // A chain that does not exist yet: a signature for it could never be checked.
    let _ = c.sign_evm("1".to_string(), tx(999_999_999, 0));
}

#[test]
fn every_supported_chain_can_be_signed_for() {
    let mut c = setup();
    for chain in SUPPORTED_CHAINS {
        set(accounts(0), ONE_YOCTO);
        let _ = c.sign_evm("1".to_string(), tx(chain, 0));
    }
    assert_eq!(
        c.signing_record("1".to_string()).evm.len(),
        SUPPORTED_CHAINS.len()
    );
}

#[test]
fn mint_logs_the_nep171_mint_event() {
    let mut c = setup();
    set(accounts(1), MINT_DEPOSIT);
    c.mint(None);
    let logs = get_logs();
    let mint = logs
        .iter()
        .find(|l| l.contains("\"event\":\"nft_mint\""))
        .unwrap_or_else(|| panic!("no nft_mint event in {logs:?}"));
    let event: Value = serde_json::from_str(&mint["EVENT_JSON:".len()..]).unwrap();
    assert_eq!(event["standard"], "nep171");
    assert_eq!(event["data"][0]["owner_id"], accounts(1).as_str());
    assert_eq!(event["data"][0]["token_ids"][0], "2");
}

#[test]
fn a_bounced_transfer_call_voids_the_receivers_listing() {
    let mut c = setup();
    // Alice sends token 1 to bob's contract with nft_transfer_call; while bob holds it, bob lists it.
    set(accounts(0), ONE_YOCTO);
    let _ = c.nft_transfer_call(accounts(1), "1".to_string(), None, None, "".to_string());
    set(accounts(1), ONE_YOCTO);
    c.list("1".to_string(), U128(10));
    // Bob's nft_on_transfer returns true: give the token back.
    testing_env!(
        ctx(
            "satchel.testnet".parse().unwrap(),
            NearToken::from_yoctonear(0)
        )
        .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Successful(b"true".to_vec())],
    );
    assert!(!c.nft_resolve_transfer(accounts(0), accounts(1), "1".to_string(), None));
    assert_eq!(c.nft_token("1".to_string()).unwrap().owner_id, accounts(0));
    assert!(c.listing("1".to_string()).is_none());
    assert!(c.listings(None, None).is_empty());
    // Alice can sign again: nothing is frozen.
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(1, 0));
}

#[test]
#[should_panic(expected = "Satchel: only the token's owner can do this")]
fn sign_evm_refuses_a_non_owner() {
    let mut c = setup();
    set(accounts(1), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(1, 0));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn sign_evm_requires_one_yocto() {
    let mut c = setup();
    set(accounts(0), NearToken::from_yoctonear(0));
    let _ = c.sign_evm("1".to_string(), tx(1, 0));
}

#[test]
#[should_panic(expected = "Satchel: attach at least 50 TGas to sign")]
fn sign_evm_requires_gas() {
    let mut c = setup();
    testing_env!(
        ctx(accounts(0), ONE_YOCTO)
            .prepaid_gas(Gas::from_tgas(49))
            .build()
    );
    let _ = c.sign_evm("1".to_string(), tx(1, 0));
}

#[test]
#[should_panic(expected = "Satchel: no such token")]
fn sign_evm_refuses_unknown_token() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("99".to_string(), tx(1, 0));
}

#[test]
#[should_panic(expected = "Satchel: signing is frozen while the token is listed")]
fn sign_evm_is_frozen_while_listed() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    c.list("1".to_string(), U128(10));
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(1, 0));
}

// ---------- sign_raw ----------

#[test]
fn sign_raw_counts_as_opaque() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_raw("1".to_string(), format!("0x{}", "11".repeat(32)));
    let (_, method, args, _, _) = calls().pop().unwrap();
    assert_eq!(method, "sign");
    assert_eq!(args["request"]["payload_v2"]["Ecdsa"], "11".repeat(32));
    let record = c.signing_record("1".to_string());
    assert_eq!(record.opaque_signatures, 1);
    assert_eq!(record.last_opaque_at, U64(1_700_000_000_000_000_000));
    assert_eq!(record.version, U64(1));
    assert!(record.evm.is_empty());
}

#[test]
#[should_panic(expected = "Satchel: payload must be 32 bytes")]
fn sign_raw_needs_32_bytes() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_raw("1".to_string(), format!("0x{}", "11".repeat(31)));
}

#[test]
#[should_panic(expected = "Satchel: signing is frozen while the token is listed")]
fn sign_raw_is_frozen_while_listed() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    c.list("1".to_string(), U128(10));
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_raw("1".to_string(), format!("0x{}", "11".repeat(32)));
}

// ---------- list, delist, transfer ----------

#[test]
fn list_pins_the_record_version() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(1, 3));
    set(accounts(0), ONE_YOCTO);
    c.list("1".to_string(), U128(500));
    let listing = c.listing("1".to_string()).unwrap();
    assert_eq!(listing.seller, accounts(0));
    assert_eq!(listing.price, U128(500));
    assert_eq!(listing.record_version, U64(1));
    assert_eq!(c.listings(None, None).len(), 1);
}

#[test]
#[should_panic(expected = "Satchel: only the token's owner can do this")]
fn list_refuses_a_non_owner() {
    let mut c = setup();
    set(accounts(1), ONE_YOCTO);
    c.list("1".to_string(), U128(500));
}

#[test]
#[should_panic(expected = "Satchel: price must be positive")]
fn list_refuses_zero_price() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    c.list("1".to_string(), U128(0));
}

#[test]
fn delist_unfreezes_signing() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    c.list("1".to_string(), U128(500));
    set(accounts(0), ONE_YOCTO);
    c.delist("1".to_string());
    assert!(c.listing("1".to_string()).is_none());
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(1, 0));
}

#[test]
#[should_panic(expected = "Satchel: token is not listed")]
fn delist_needs_a_listing() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    c.delist("1".to_string());
}

#[test]
fn nft_transfer_ends_the_listing_and_moves_signing_rights() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    c.list("1".to_string(), U128(500));
    set(accounts(0), ONE_YOCTO);
    c.nft_transfer(accounts(1), "1".to_string(), None, None);
    assert!(c.listing("1".to_string()).is_none());
    assert_eq!(c.nft_token("1".to_string()).unwrap().owner_id, accounts(1));
    // The new owner signs with the same key path.
    set(accounts(1), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(1, 0));
    assert_eq!(calls().pop().unwrap().2["request"]["path"], "satchel/1");
}

#[test]
#[should_panic(expected = "Satchel: only the token's owner can do this")]
fn the_previous_owner_cannot_sign_after_a_transfer() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    c.nft_transfer(accounts(1), "1".to_string(), None, None);
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(1, 0));
}

// ---------- buy ----------

/// Alice signed nonce 4 on chain 1 (record version 1), then listed token "1" for `price`.
fn listed(price: u128) -> Contract {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(1, 4));
    set(accounts(0), ONE_YOCTO);
    c.list("1".to_string(), U128(price));
    c
}

#[test]
fn buy_moves_the_token_pays_the_seller_and_refunds_the_rest() {
    let mut c = listed(1_000);
    set(accounts(1), NearToken::from_yoctonear(1_250));
    c.buy("1".to_string(), U64(1), U128(1_000));
    assert_eq!(c.nft_token("1".to_string()).unwrap().owner_id, accounts(1));
    assert!(c.listing("1".to_string()).is_none());
    assert_eq!(
        transfers(),
        vec![
            (accounts(0).to_string(), NearToken::from_yoctonear(1_000)),
            (accounts(1).to_string(), NearToken::from_yoctonear(250)),
        ]
    );
    let logs = get_logs();
    assert!(
        logs.iter()
            .any(|l| l.contains("\"event\":\"nft_transfer\"")),
        "{logs:?}"
    );
    assert!(
        logs.iter().any(|l| l.contains("\"event\":\"sale\"")),
        "{logs:?}"
    );
    // The record travels with the token: the buyer sees what the seller signed.
    assert_eq!(c.signing_record("1".to_string()).evm[0].max_nonce, U64(4));
}

#[test]
fn buy_with_the_exact_price_sends_no_refund() {
    let mut c = listed(1_000);
    set(accounts(1), NearToken::from_yoctonear(1_000));
    c.buy("1".to_string(), U64(1), U128(1_000));
    assert_eq!(
        transfers(),
        vec![(accounts(0).to_string(), NearToken::from_yoctonear(1_000))]
    );
}

#[test]
#[should_panic(expected = "Satchel: the signing record changed since you checked it")]
fn buy_refuses_a_stale_record_version() {
    let mut c = listed(1_000);
    set(accounts(1), NearToken::from_yoctonear(1_000));
    c.buy("1".to_string(), U64(0), U128(1_000));
}

#[test]
#[should_panic(expected = "Satchel: the signing record changed since you checked it")]
fn buy_refuses_after_the_seller_delists_signs_and_relists() {
    let mut c = listed(1_000);
    // The buyer checked version 1. The seller delists, signs again, relists at the same price.
    set(accounts(0), ONE_YOCTO);
    c.delist("1".to_string());
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(1, 5));
    set(accounts(0), ONE_YOCTO);
    c.list("1".to_string(), U128(1_000));
    set(accounts(1), NearToken::from_yoctonear(1_000));
    c.buy("1".to_string(), U64(1), U128(1_000));
}

#[test]
#[should_panic(expected = "Satchel: the price changed")]
fn buy_refuses_a_changed_price() {
    let mut c = listed(1_000);
    set(accounts(0), ONE_YOCTO);
    c.list("1".to_string(), U128(2_000));
    set(accounts(1), NearToken::from_yoctonear(2_000));
    c.buy("1".to_string(), U64(1), U128(1_000));
}

#[test]
#[should_panic(expected = "Satchel: attach at least the price")]
fn buy_needs_the_full_price() {
    let mut c = listed(1_000);
    set(accounts(1), NearToken::from_yoctonear(999));
    c.buy("1".to_string(), U64(1), U128(1_000));
}

#[test]
#[should_panic(expected = "Satchel: the seller cannot buy")]
fn buy_refuses_the_seller() {
    let mut c = listed(1_000);
    set(accounts(0), NearToken::from_yoctonear(1_000));
    c.buy("1".to_string(), U64(1), U128(1_000));
}

#[test]
#[should_panic(expected = "Satchel: token is not listed")]
fn buy_refuses_an_unlisted_token() {
    let mut c = setup();
    set(accounts(1), NearToken::from_yoctonear(1_000));
    c.buy("1".to_string(), U64(0), U128(1_000));
}

#[test]
#[should_panic(expected = "Satchel: token is not listed")]
fn a_transfer_cancels_the_sale() {
    let mut c = listed(1_000);
    set(accounts(0), ONE_YOCTO);
    c.nft_transfer(accounts(2), "1".to_string(), None, None);
    set(accounts(1), NearToken::from_yoctonear(1_000));
    c.buy("1".to_string(), U64(1), U128(1_000));
}

#[test]
fn metadata_and_enumeration() {
    let c = setup();
    let m = c.nft_metadata();
    assert_eq!(m.symbol, "SATCHEL");
    assert_eq!(m.spec, NFT_METADATA_SPEC);
    assert_eq!(c.nft_supply_for_owner(accounts(0)), U128(1));
    let tokens = c.nft_tokens_for_owner(accounts(0), None, None);
    assert_eq!(
        tokens[0].metadata.as_ref().unwrap().title.as_deref(),
        Some("Satchel #1")
    );
    assert_eq!(c.mpc_contract().as_str(), MPC);
    assert_eq!(c.derivation_path("1".to_string()), "satchel/1");
}

// ---------- approvals ----------

fn word_address(byte: u8) -> String {
    format!("{}{}", "00".repeat(12), format!("{byte:02x}").repeat(20))
}

fn call(to: &str, data: String) -> Eip1559Tx {
    let mut t = tx(8453, 0);
    t.to = to.to_string();
    t.value = U128(0);
    t.data = data;
    t
}

const USDC: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

#[test]
fn approval_selectors_are_the_keccak_of_their_signatures() {
    set(accounts(0), NearToken::from_yoctonear(0));
    for (sig, sel) in [
        ("approve(address,uint256)", evm::SELECTOR_APPROVE),
        (
            "increaseAllowance(address,uint256)",
            evm::SELECTOR_INCREASE_ALLOWANCE,
        ),
        (
            "setApprovalForAll(address,bool)",
            evm::SELECTOR_SET_APPROVAL_FOR_ALL,
        ),
        (
            "approve(address,address,uint160,uint48)",
            evm::SELECTOR_PERMIT2_APPROVE,
        ),
    ] {
        assert_eq!(env::keccak256_array(sig.as_bytes())[..4], sel, "{sig}");
    }
}

#[test]
fn sign_evm_itemizes_an_erc20_approval() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let amount = format!("{:064x}", 1_000_000u64);
    let _ = c.sign_evm(
        "1".to_string(),
        call(USDC, format!("0x095ea7b3{}{amount}", word_address(0xab))),
    );
    let r = c.signing_record("1".to_string());
    assert_eq!(
        r.approvals,
        vec![ApprovalRecord {
            chain_id: U64(8453),
            contract: USDC.to_lowercase(),
            kind: ApprovalKind::Approve,
            spender: format!("0x{}", "ab".repeat(20)),
            token: None,
            arg: format!("0x{amount}"),
        }]
    );
    let log = get_logs().pop().unwrap();
    assert!(log.contains("\"approval\":{"), "{log}");
}

#[test]
fn an_identical_approval_is_one_row() {
    let mut c = setup();
    for _ in 0..2 {
        set(accounts(0), ONE_YOCTO);
        let data = format!("0x095ea7b3{}{:064x}", word_address(0xab), 5);
        let _ = c.sign_evm("1".to_string(), call(USDC, data));
    }
    let r = c.signing_record("1".to_string());
    assert_eq!(r.approvals.len(), 1);
    assert_eq!(r.evm[0].signatures, 2);
}

#[test]
fn erc721_approvals_of_two_token_ids_stay_two_rows() {
    // approve(S, 1) then approve(S, 2) on a collection: both are live on chain, so the buyer must
    // see both. Merging them would let the seller clear #2, sell, and take #1.
    let mut c = setup();
    let collection = "0x3333333333333333333333333333333333333333";
    for id in [1u64, 2] {
        set(accounts(0), ONE_YOCTO);
        let data = format!("0x095ea7b3{}{id:064x}", word_address(0xab));
        let _ = c.sign_evm("1".to_string(), call(collection, data));
    }
    let r = c.signing_record("1".to_string());
    assert_eq!(r.approvals.len(), 2);
    assert_eq!(r.approvals[0].arg, format!("0x{:064x}", 1));
    assert_eq!(r.approvals[1].arg, format!("0x{:064x}", 2));
}

#[test]
fn a_call_satchel_cannot_classify_is_counted() {
    // multicall(bytes[]) wrapping setApprovalForAll: a standing grant the decoder cannot see into.
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let npm = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
    let _ = c.sign_evm(
        "1".to_string(),
        call(npm, format!("0xac9650d8{}", "00".repeat(64))),
    );
    let r = c.signing_record("1".to_string());
    assert_eq!(r.unclassified_calls, 1);
    assert!(r.approvals.is_empty());
    let event: Value =
        serde_json::from_str(&get_logs().pop().unwrap()["EVENT_JSON:".len()..]).unwrap();
    assert_eq!(event["data"][0]["class"], "unclassified");
    assert_eq!(event["data"][0]["selector"], "0xac9650d8");
    assert_eq!(event["data"][0]["data_hash"].as_str().unwrap().len(), 64);
}

#[test]
fn calldata_shorter_than_a_selector_is_unclassified() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), call(USDC, "0x0102".to_string()));
    assert_eq!(c.signing_record("1".to_string()).unclassified_calls, 1);
}

#[test]
fn value_and_asset_transfers_are_classified() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), tx(8453, 0));
    let event: Value =
        serde_json::from_str(&get_logs().pop().unwrap()["EVENT_JSON:".len()..]).unwrap();
    assert_eq!(event["data"][0]["class"], "value_transfer");
    for selector in evm::ASSET_TRANSFER_SELECTORS {
        set(accounts(0), ONE_YOCTO);
        let data = format!("0x{}{}", evm::encode_hex(&selector), "00".repeat(64));
        let _ = c.sign_evm("1".to_string(), call(USDC, data));
        let event: Value =
            serde_json::from_str(&get_logs().pop().unwrap()["EVENT_JSON:".len()..]).unwrap();
        assert_eq!(event["data"][0]["class"], "asset_transfer");
    }
    let r = c.signing_record("1".to_string());
    assert_eq!(r.unclassified_calls, 0);
    assert!(r.approvals.is_empty());
}

#[test]
fn asset_transfer_selectors_are_the_keccak_of_their_signatures() {
    set(accounts(0), NearToken::from_yoctonear(0));
    let sigs = [
        "transfer(address,uint256)",
        "transferFrom(address,address,uint256)",
        "safeTransferFrom(address,address,uint256)",
        "safeTransferFrom(address,address,uint256,bytes)",
        "safeTransferFrom(address,address,uint256,uint256,bytes)",
        "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
        "deposit()",
        "withdraw(uint256)",
    ];
    for (sig, sel) in sigs.iter().zip(evm::ASSET_TRANSFER_SELECTORS) {
        assert_eq!(env::keccak256_array(sig.as_bytes())[..4], sel, "{sig}");
    }
}

#[test]
fn sign_evm_itemizes_operator_and_permit2_approvals() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let on = format!("{:064x}", 1);
    let _ = c.sign_evm(
        "1".to_string(),
        call(
            "0x1111111111111111111111111111111111111111",
            format!("0xa22cb465{}{on}", word_address(0xcd)),
        ),
    );
    set(accounts(0), ONE_YOCTO);
    let permit2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    let data = format!(
        "0x87517c45{}{}{:064x}{:064x}",
        word_address(0x01),
        word_address(0xef),
        u64::MAX,
        1_800_000_000u64
    );
    let _ = c.sign_evm("1".to_string(), call(permit2, data));
    let r = c.signing_record("1".to_string());
    assert_eq!(r.approvals.len(), 2);
    assert_eq!(r.approvals[0].kind, ApprovalKind::SetApprovalForAll);
    assert_eq!(r.approvals[0].spender, format!("0x{}", "cd".repeat(20)));
    assert_eq!(r.approvals[1].kind, ApprovalKind::Permit2Approve);
    assert_eq!(r.approvals[1].contract, permit2.to_lowercase());
    assert_eq!(r.approvals[1].token, Some(format!("0x{}", "01".repeat(20))));
    assert_eq!(r.approvals[1].spender, format!("0x{}", "ef".repeat(20)));
}

#[test]
fn a_plain_transfer_records_no_approval() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    // ERC-20 transfer(address,uint256): moves tokens now, leaves no standing right.
    let data = format!("0xa9059cbb{}{:064x}", word_address(0xab), 5);
    let _ = c.sign_evm("1".to_string(), call(USDC, data));
    assert!(c.signing_record("1".to_string()).approvals.is_empty());
}

#[test]
#[should_panic(expected = "Satchel: approval calldata is too short")]
fn an_approval_too_short_to_name_its_spender_is_refused() {
    let mut c = setup();
    set(accounts(0), ONE_YOCTO);
    let _ = c.sign_evm("1".to_string(), call(USDC, "0x095ea7b30000".to_string()));
}

#[test]
fn approvals_beyond_the_cap_are_counted_not_dropped() {
    let mut c = setup();
    for spender in 0..(MAX_APPROVALS as u8 + 2) {
        set(accounts(0), ONE_YOCTO);
        let data = format!("0x095ea7b3{}{:064x}", word_address(spender), 1);
        let _ = c.sign_evm("1".to_string(), call(USDC, data));
    }
    let r = c.signing_record("1".to_string());
    assert_eq!(r.approvals.len(), MAX_APPROVALS);
    assert_eq!(r.approvals_not_itemized, 2);
}
