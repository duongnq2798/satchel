use super::*;
use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{VMContextBuilder, accounts, get_created_receipts, get_logs};
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const ESTATE: &str = "estate.testnet";
const SATCHEL: &str = "v1.satchel-nft.testnet";
const TOKEN: &str = "11";
/// Block time at init.
const T0: u64 = 1_700_000_000_000_000_000;
const MINUTE: u64 = 60_000_000_000;
/// The demo's timers: a 3-minute interval and a 3-minute waiting period.
const INTERVAL: u64 = 3 * MINUTE;
const WAITING: u64 = 3 * MINUTE;
const ZERO: NearToken = NearToken::from_yoctonear(0);

fn owner() -> AccountId {
    accounts(0)
}
fn guardian1() -> AccountId {
    accounts(1)
}
fn guardian2() -> AccountId {
    accounts(2)
}
fn heir() -> AccountId {
    accounts(3)
}
fn stranger() -> AccountId {
    accounts(4)
}
fn estate_id() -> AccountId {
    ESTATE.parse().unwrap()
}

fn ctx(predecessor: AccountId, at: u64, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(estate_id())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor)
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(at);
    b
}

/// The next call comes from `predecessor` at block time `at`, with `deposit` attached.
fn set(predecessor: AccountId, at: u64, deposit: NearToken) {
    testing_env!(ctx(predecessor, at, deposit).build());
}

/// The next call is `on_release`, at block time `at`, seeing the transfer end as `result`.
fn callback(at: u64, result: PromiseResult) {
    testing_env!(
        ctx(estate_id(), at, ZERO).build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

/// An estate the estate account initializes at T0, for owner() and satchel TOKEN.
fn init_with(
    guardians: Vec<AccountId>,
    threshold: u32,
    heir: AccountId,
    interval: u32,
    waiting: u32,
) -> Contract {
    set(estate_id(), T0, ZERO);
    Contract::new(
        SATCHEL.parse().unwrap(),
        TOKEN.to_string(),
        owner(),
        guardians,
        threshold,
        heir,
        interval,
        waiting,
    )
}

/// The demo's estate: two guardians, both must approve, 3-minute timers.
fn setup() -> Contract {
    init_with(vec![guardian1(), guardian2()], 2, heir(), 3, 3)
}

/// Both guardians approve at `at`: the release starts there.
fn released_from(c: &mut Contract, at: u64) {
    set(guardian1(), at, ZERO);
    c.approve_release();
    set(guardian2(), at, ZERO);
    c.approve_release();
}

/// An estate whose release started one minute after the owner became overdue.
fn releasing() -> (Contract, u64) {
    let mut c = setup();
    let started = T0 + INTERVAL + MINUTE;
    released_from(&mut c, started);
    (c, started)
}

/// An estate whose transfer to the heir succeeded.
fn released() -> Contract {
    let (mut c, started) = releasing();
    set(stranger(), started + WAITING + 1, ZERO);
    let _ = c.finalize_release();
    callback(started + WAITING + 2, PromiseResult::Successful(vec![]));
    assert!(c.on_release());
    c
}

fn tx() -> EvmTx {
    EvmTx {
        chain_id: U64(11155111),
        nonce: U64(0),
        max_priority_fee_per_gas: U128(1_000_000_000),
        max_fee_per_gas: U128(5_000_000_000),
        gas_limit: U64(21_000),
        to: "0x000000000000000000000000000000000000dEaD".to_string(),
        value: U128(0),
        data: "0x".to_string(),
    }
}

/// Every function call the last method created: (receiver, method, args, deposit, static gas, weight).
fn calls() -> Vec<(String, String, Value, NearToken, Gas, u64)> {
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
                    gas_weight,
                    ..
                } => Some((
                    receiver.clone(),
                    String::from_utf8(method_name).unwrap(),
                    serde_json::from_slice(&args).unwrap_or(Value::Null),
                    attached_deposit,
                    prepaid_gas,
                    gas_weight.0,
                )),
                _ => None,
            })
        })
        .collect()
}

/// The estate's events in the last method's logs: (event, data).
fn events() -> Vec<(String, Value)> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .inspect(|e| {
            assert_eq!(e["standard"], "satchel_estate");
            assert_eq!(e["version"], "1.0.0");
        })
        .map(|e| {
            (
                e["event"].as_str().unwrap().to_string(),
                e["data"][0].clone(),
            )
        })
        .collect()
}

fn names(events: &[(String, Value)]) -> Vec<&str> {
    events.iter().map(|(name, _)| name.as_str()).collect()
}

/// The view, read at block time `at`.
fn view_at(c: &Contract, at: u64) -> EstateView {
    set(stranger(), at, ZERO);
    c.estate()
}

// ---------- init ----------

#[test]
fn init_records_the_rules_and_counts_as_a_check_in() {
    let c = setup();
    let v = view_at(&c, T0);
    assert_eq!(v.satchel_contract.as_str(), SATCHEL);
    assert_eq!(v.token_id, TOKEN);
    assert_eq!(v.owner, owner());
    assert_eq!(v.guardians, vec![guardian1(), guardian2()]);
    assert_eq!(v.threshold, 2);
    assert_eq!(v.heir, heir());
    assert_eq!(v.check_in_interval_minutes, 3);
    assert_eq!(v.waiting_period_minutes, 3);
    assert_eq!(v.last_check_in, U64(T0));
    assert_eq!(v.overdue_at, U64(T0 + INTERVAL));
    assert_eq!(v.phase, Phase::Alive);
    assert!(v.approvals.is_empty());
    assert_eq!(v.release_started_at, None);
    assert_eq!(v.release_at, None);
    assert_eq!(v.released_at, None);
    assert!(!v.transfer_in_flight);
}

#[test]
fn the_view_serializes_phases_in_lowercase() {
    let c = setup();
    let json = serde_json::to_value(view_at(&c, T0)).unwrap();
    assert_eq!(json["phase"], "alive");
    assert_eq!(json["last_check_in"], T0.to_string());
    assert_eq!(json["release_at"], Value::Null);
}

#[test]
#[should_panic(expected = "Estate: name 1 to 5 guardians")]
fn init_needs_a_guardian() {
    init_with(vec![], 1, heir(), 3, 3);
}

#[test]
#[should_panic(expected = "Estate: name 1 to 5 guardians")]
fn init_takes_at_most_five_guardians() {
    let six = (0..6)
        .map(|i| format!("g{i}.testnet").parse().unwrap())
        .collect();
    init_with(six, 1, heir(), 3, 3);
}

#[test]
fn init_takes_five_guardians() {
    let five = (0..5)
        .map(|i| format!("g{i}.testnet").parse().unwrap())
        .collect();
    init_with(five, 5, heir(), 3, 3);
}

#[test]
#[should_panic(expected = "Estate: a guardian is named twice")]
fn init_refuses_a_guardian_named_twice() {
    init_with(vec![guardian1(), guardian1()], 1, heir(), 3, 3);
}

#[test]
#[should_panic(expected = "Estate: the owner cannot be a guardian")]
fn init_refuses_the_owner_as_guardian() {
    init_with(vec![guardian1(), owner()], 1, heir(), 3, 3);
}

#[test]
#[should_panic(expected = "Estate: the heir cannot be a guardian")]
fn init_refuses_the_heir_as_guardian() {
    init_with(vec![heir()], 1, heir(), 3, 3);
}

#[test]
#[should_panic(expected = "Estate: the heir cannot be the owner")]
fn init_refuses_the_owner_as_heir() {
    init_with(vec![guardian1()], 1, owner(), 3, 3);
}

#[test]
#[should_panic(expected = "Estate: the estate cannot be its own owner, heir or guardian")]
fn init_refuses_the_estate_as_heir() {
    init_with(vec![guardian1()], 1, estate_id(), 3, 3);
}

#[test]
#[should_panic(expected = "Estate: the estate cannot be its own owner, heir or guardian")]
fn init_refuses_the_estate_as_guardian() {
    init_with(vec![estate_id()], 1, heir(), 3, 3);
}

#[test]
#[should_panic(expected = "Estate: the threshold must be from 1 to the number of guardians")]
fn init_refuses_a_zero_threshold() {
    init_with(vec![guardian1(), guardian2()], 0, heir(), 3, 3);
}

#[test]
#[should_panic(expected = "Estate: the threshold must be from 1 to the number of guardians")]
fn init_refuses_a_threshold_above_the_guardians() {
    init_with(vec![guardian1(), guardian2()], 3, heir(), 3, 3);
}

#[test]
#[should_panic(expected = "Estate: the check-in interval must be 1 to 5256000 minutes")]
fn init_refuses_a_zero_interval() {
    init_with(vec![guardian1()], 1, heir(), 0, 3);
}

#[test]
#[should_panic(expected = "Estate: the check-in interval must be 1 to 5256000 minutes")]
fn init_refuses_an_interval_over_ten_years() {
    init_with(vec![guardian1()], 1, heir(), MAX_MINUTES + 1, 3);
}

#[test]
#[should_panic(expected = "Estate: the waiting period must be 1 to 5256000 minutes")]
fn init_refuses_a_zero_waiting_period() {
    init_with(vec![guardian1()], 1, heir(), 3, 0);
}

#[test]
#[should_panic(expected = "Estate: token_id is empty")]
fn init_refuses_an_empty_token_id() {
    set(estate_id(), T0, ZERO);
    Contract::new(
        SATCHEL.parse().unwrap(),
        String::new(),
        owner(),
        vec![guardian1()],
        1,
        heir(),
        3,
        3,
    );
}

#[test]
fn ten_year_timers_do_not_overflow() {
    let mut c = init_with(vec![guardian1()], 1, heir(), MAX_MINUTES, MAX_MINUTES);
    let ten_years = u64::from(MAX_MINUTES) * MINUTE;
    assert_eq!(view_at(&c, T0).overdue_at, U64(T0 + ten_years));
    set(guardian1(), T0 + ten_years + 1, ZERO);
    c.approve_release();
    let v = view_at(&c, T0 + ten_years + 1);
    assert_eq!(v.release_at, Some(U64(T0 + 2 * ten_years + 1)));
}

// ---------- check-ins and phases ----------

#[test]
fn the_owner_is_overdue_only_after_the_interval() {
    let c = setup();
    assert_eq!(view_at(&c, T0 + INTERVAL).phase, Phase::Alive);
    assert_eq!(view_at(&c, T0 + INTERVAL + 1).phase, Phase::Overdue);
}

#[test]
fn a_check_in_restarts_the_interval() {
    let mut c = setup();
    set(owner(), T0 + INTERVAL + MINUTE, ZERO);
    c.check_in();
    let e = events();
    assert_eq!(names(&e), vec!["check_in"]);
    assert_eq!(e[0].1["via"], "check_in");
    assert_eq!(e[0].1["at"], (T0 + INTERVAL + MINUTE).to_string());
    let v = view_at(&c, T0 + INTERVAL + MINUTE);
    assert_eq!(v.phase, Phase::Alive);
    assert_eq!(v.last_check_in, U64(T0 + INTERVAL + MINUTE));
    assert_eq!(v.overdue_at, U64(T0 + 2 * INTERVAL + MINUTE));
}

#[test]
#[should_panic(expected = "Estate: only the owner can do this")]
fn a_guardian_cannot_check_in() {
    let mut c = setup();
    set(guardian1(), T0 + MINUTE, ZERO);
    c.check_in();
}

#[test]
#[should_panic(expected = "Estate: only the owner can do this")]
fn the_heir_cannot_check_in() {
    let mut c = setup();
    set(heir(), T0 + MINUTE, ZERO);
    c.check_in();
}

// ---------- approvals ----------

#[test]
#[should_panic(expected = "Estate: the owner is not overdue yet")]
fn an_approval_before_the_owner_is_overdue_is_refused() {
    let mut c = setup();
    set(guardian1(), T0 + MINUTE, ZERO);
    c.approve_release();
}

#[test]
#[should_panic(expected = "Estate: the owner is not overdue yet")]
fn an_approval_at_the_last_moment_of_the_interval_is_refused() {
    let mut c = setup();
    set(guardian1(), T0 + INTERVAL, ZERO);
    c.approve_release();
}

#[test]
#[should_panic(expected = "Estate: only a guardian can do this")]
fn a_stranger_cannot_approve() {
    let mut c = setup();
    set(stranger(), T0 + INTERVAL + 1, ZERO);
    c.approve_release();
}

#[test]
#[should_panic(expected = "Estate: only a guardian can do this")]
fn the_heir_cannot_approve() {
    let mut c = setup();
    set(heir(), T0 + INTERVAL + 1, ZERO);
    c.approve_release();
}

#[test]
#[should_panic(expected = "Estate: only a guardian can do this")]
fn the_owner_cannot_approve() {
    let mut c = setup();
    set(owner(), T0 + INTERVAL + 1, ZERO);
    c.approve_release();
}

#[test]
#[should_panic(expected = "Estate: this guardian has already approved")]
fn a_guardian_approves_once() {
    let mut c = setup();
    set(guardian1(), T0 + INTERVAL + 1, ZERO);
    c.approve_release();
    set(guardian1(), T0 + INTERVAL + MINUTE, ZERO);
    c.approve_release();
}

#[test]
fn one_approval_of_two_does_not_start_the_release() {
    let mut c = setup();
    set(guardian1(), T0 + INTERVAL + 1, ZERO);
    c.approve_release();
    let e = events();
    assert_eq!(names(&e), vec!["approve"]);
    assert_eq!(e[0].1["guardian"], guardian1().as_str());
    assert_eq!(e[0].1["approvals"], 1);
    assert_eq!(e[0].1["threshold"], 2);
    let v = view_at(&c, T0 + INTERVAL + 2);
    assert_eq!(v.phase, Phase::Overdue);
    assert_eq!(v.approvals, vec![guardian1()]);
    assert_eq!(v.release_started_at, None);
}

#[test]
fn the_approval_that_reaches_the_threshold_starts_the_waiting_period() {
    let mut c = setup();
    let at = T0 + INTERVAL + MINUTE;
    set(guardian1(), at, ZERO);
    c.approve_release();
    set(guardian2(), at + 5, ZERO);
    c.approve_release();
    let e = events();
    assert_eq!(names(&e), vec!["approve", "release_started"]);
    assert_eq!(
        e[1].1["approvals"],
        serde_json::json!([guardian1(), guardian2()])
    );
    assert_eq!(e[1].1["at"], (at + 5).to_string());
    assert_eq!(e[1].1["release_at"], (at + 5 + WAITING).to_string());
    let v = view_at(&c, at + 6);
    assert_eq!(v.phase, Phase::Releasing);
    assert_eq!(v.release_started_at, Some(U64(at + 5)));
    assert_eq!(v.release_at, Some(U64(at + 5 + WAITING)));
}

#[test]
fn a_threshold_of_one_starts_the_release_at_the_first_approval() {
    let mut c = init_with(vec![guardian1(), guardian2()], 1, heir(), 3, 3);
    set(guardian2(), T0 + INTERVAL + 1, ZERO);
    c.approve_release();
    assert_eq!(names(&events()), vec!["approve", "release_started"]);
    assert_eq!(view_at(&c, T0 + INTERVAL + 2).phase, Phase::Releasing);
}

#[test]
#[should_panic(expected = "Estate: the release has already started")]
fn no_approval_after_the_release_started() {
    let three: Vec<AccountId> = (0..3)
        .map(|i| format!("g{i}.testnet").parse().unwrap())
        .collect();
    let mut c = init_with(three.clone(), 2, heir(), 3, 3);
    for g in &three {
        set(g.clone(), T0 + INTERVAL + 1, ZERO);
        c.approve_release();
    }
}

#[test]
fn a_check_in_voids_approvals_below_the_threshold() {
    let mut c = setup();
    set(guardian1(), T0 + INTERVAL + 1, ZERO);
    c.approve_release();
    set(owner(), T0 + INTERVAL + MINUTE, ZERO);
    c.check_in();
    let e = events();
    assert_eq!(names(&e), vec!["check_in"]);
    assert_eq!(e[0].1["approvals_voided"], serde_json::json!([guardian1()]));
    let v = view_at(&c, T0 + INTERVAL + MINUTE);
    assert!(v.approvals.is_empty());
    assert_eq!(v.phase, Phase::Alive);
    // Overdue again a full interval later, and the first guardian can approve again.
    set(guardian1(), T0 + 2 * INTERVAL + MINUTE + 1, ZERO);
    c.approve_release();
    assert_eq!(
        view_at(&c, T0 + 2 * INTERVAL + MINUTE + 1).approvals,
        vec![guardian1()]
    );
}

// ---------- the owner cancels ----------

#[test]
fn the_owner_cancels_a_waiting_release_by_checking_in() {
    let (mut c, started) = releasing();
    set(owner(), started + MINUTE, ZERO);
    c.check_in();
    let e = events();
    assert_eq!(names(&e), vec!["check_in", "release_cancelled"]);
    assert_eq!(e[1].1["started_at"], started.to_string());
    assert_eq!(e[1].1["via"], "check_in");
    let v = view_at(&c, started + MINUTE);
    assert_eq!(v.phase, Phase::Alive);
    assert!(v.approvals.is_empty());
    assert_eq!(v.release_started_at, None);
    assert_eq!(v.release_at, None);
}

#[test]
fn cancel_release_does_what_check_in_does() {
    let (mut c, started) = releasing();
    set(owner(), started + MINUTE, ZERO);
    c.cancel_release();
    let e = events();
    assert_eq!(names(&e), vec!["check_in", "release_cancelled"]);
    assert_eq!(e[0].1["via"], "cancel_release");
    let v = view_at(&c, started + MINUTE);
    assert_eq!(v.phase, Phase::Alive);
    assert_eq!(v.last_check_in, U64(started + MINUTE));
}

#[test]
fn the_owner_can_cancel_after_the_waiting_period_until_someone_finalizes() {
    let (mut c, started) = releasing();
    set(owner(), started + WAITING + MINUTE, ZERO);
    c.check_in();
    assert_eq!(view_at(&c, started + WAITING + MINUTE).phase, Phase::Alive);
}

#[test]
#[should_panic(expected = "Estate: only the owner can do this")]
fn a_guardian_cannot_cancel() {
    let (mut c, started) = releasing();
    set(guardian1(), started + MINUTE, ZERO);
    c.cancel_release();
}

#[test]
#[should_panic(expected = "Estate: no release is in progress")]
fn after_a_cancel_there_is_nothing_to_finalize() {
    let (mut c, started) = releasing();
    set(owner(), started + MINUTE, ZERO);
    c.check_in();
    set(stranger(), started + WAITING + MINUTE, ZERO);
    let _ = c.finalize_release();
}

// ---------- finalize ----------

#[test]
#[should_panic(expected = "Estate: no release is in progress")]
fn finalize_needs_a_release() {
    let mut c = setup();
    set(stranger(), T0 + 10 * INTERVAL, ZERO);
    let _ = c.finalize_release();
}

#[test]
#[should_panic(expected = "Estate: no release is in progress")]
fn finalize_needs_the_threshold_not_just_an_overdue_owner() {
    let mut c = setup();
    set(guardian1(), T0 + INTERVAL + 1, ZERO);
    c.approve_release();
    set(stranger(), T0 + 10 * INTERVAL, ZERO);
    let _ = c.finalize_release();
}

#[test]
#[should_panic(expected = "Estate: the waiting period has not passed yet")]
fn finalize_during_the_waiting_period_is_refused() {
    let (mut c, started) = releasing();
    set(heir(), started + MINUTE, ZERO);
    let _ = c.finalize_release();
}

#[test]
#[should_panic(expected = "Estate: the waiting period has not passed yet")]
fn finalize_at_the_last_moment_of_the_waiting_period_is_refused() {
    let (mut c, started) = releasing();
    set(heir(), started + WAITING, ZERO);
    let _ = c.finalize_release();
}

#[test]
#[should_panic(expected = "Estate: attach at least 60 TGas to finalize")]
fn finalize_needs_gas_for_the_transfer_and_the_callback() {
    let (mut c, started) = releasing();
    testing_env!(
        ctx(heir(), started + WAITING + 1, ZERO)
            .prepaid_gas(Gas::from_tgas(59))
            .build()
    );
    let _ = c.finalize_release();
}

#[test]
fn finalize_after_the_waiting_period_transfers_the_satchel_to_the_heir() {
    let (mut c, started) = releasing();
    set(stranger(), started + WAITING + 1, ZERO);
    let _ = c.finalize_release();
    let made = calls();
    assert_eq!(made.len(), 2);
    let (receiver, method, args, deposit, gas, weight) = &made[0];
    assert_eq!(receiver, SATCHEL);
    assert_eq!(method, "nft_transfer");
    assert_eq!(
        *args,
        serde_json::json!({ "receiver_id": heir(), "token_id": TOKEN })
    );
    assert_eq!(*deposit, NearToken::from_yoctonear(1));
    assert_eq!(*gas, TRANSFER_GAS);
    assert_eq!(*weight, 0);
    let (receiver, method, _, deposit, gas, _) = &made[1];
    assert_eq!(receiver, ESTATE);
    assert_eq!(method, "on_release");
    assert_eq!(*deposit, ZERO);
    assert_eq!(*gas, CALLBACK_GAS);
    let e = events();
    assert_eq!(names(&e), vec!["release_sent"]);
    assert_eq!(e[0].1["by"], stranger().as_str());
    let v = view_at(&c, started + WAITING + 1);
    assert!(v.transfer_in_flight);
    assert_eq!(v.phase, Phase::Releasing);
    assert_eq!(v.released_at, None);
}

#[test]
#[should_panic(expected = "Estate: the satchel is on its way to the heir")]
fn finalize_twice_while_the_transfer_is_in_flight_is_refused() {
    let (mut c, started) = releasing();
    set(stranger(), started + WAITING + 1, ZERO);
    let _ = c.finalize_release();
    set(heir(), started + WAITING + 2, ZERO);
    let _ = c.finalize_release();
}

#[test]
#[should_panic(expected = "Estate: the satchel is on its way to the heir")]
fn the_owner_cannot_check_in_while_the_transfer_is_in_flight() {
    let (mut c, started) = releasing();
    set(stranger(), started + WAITING + 1, ZERO);
    let _ = c.finalize_release();
    set(owner(), started + WAITING + 2, ZERO);
    c.check_in();
}

#[test]
#[should_panic(expected = "Estate: the satchel is on its way to the heir")]
fn the_owner_cannot_sign_while_the_transfer_is_in_flight() {
    let (mut c, started) = releasing();
    set(stranger(), started + WAITING + 1, ZERO);
    let _ = c.finalize_release();
    set(owner(), started + WAITING + 2, NearToken::from_yoctonear(1));
    let _ = c.sign_evm(tx());
}

#[test]
fn a_successful_transfer_releases_the_estate() {
    let c = released();
    let e = events();
    assert_eq!(names(&e), vec!["released"]);
    assert_eq!(e[0].1["heir"], heir().as_str());
    assert_eq!(e[0].1["token_id"], TOKEN);
    let v = view_at(&c, T0 + 100 * MINUTE);
    assert_eq!(v.phase, Phase::Released);
    assert!(!v.transfer_in_flight);
    assert_eq!(
        v.released_at,
        Some(U64(T0 + INTERVAL + MINUTE + WAITING + 2))
    );
    assert_eq!(v.release_at, None);
}

#[test]
fn a_failed_transfer_leaves_the_estate_releasing_and_it_can_finalize_again() {
    let (mut c, started) = releasing();
    set(stranger(), started + WAITING + 1, ZERO);
    let _ = c.finalize_release();
    callback(started + WAITING + 2, PromiseResult::Failed);
    assert!(!c.on_release());
    assert_eq!(names(&events()), vec!["release_failed"]);
    let v = view_at(&c, started + WAITING + 3);
    assert_eq!(v.phase, Phase::Releasing);
    assert!(!v.transfer_in_flight);
    assert_eq!(v.released_at, None);
    assert_eq!(v.release_started_at, Some(U64(started)));
    assert_eq!(v.approvals, vec![guardian1(), guardian2()]);
    // Anyone can try again.
    set(heir(), started + WAITING + 4, ZERO);
    let _ = c.finalize_release();
    assert_eq!(calls()[0].1, "nft_transfer");
}

#[test]
fn after_a_failed_transfer_the_owner_can_still_cancel() {
    let (mut c, started) = releasing();
    set(stranger(), started + WAITING + 1, ZERO);
    let _ = c.finalize_release();
    callback(started + WAITING + 2, PromiseResult::Failed);
    c.on_release();
    set(owner(), started + WAITING + 3, ZERO);
    c.check_in();
    assert_eq!(view_at(&c, started + WAITING + 3).phase, Phase::Alive);
}

// ---------- after the release ----------

#[test]
#[should_panic(expected = "Estate: the satchel was released to the heir")]
fn the_old_owner_cannot_sign_after_the_release() {
    let mut c = released();
    set(owner(), T0 + 100 * MINUTE, NearToken::from_yoctonear(1));
    let _ = c.sign_evm(tx());
}

#[test]
#[should_panic(expected = "Estate: the satchel was released to the heir")]
fn the_old_owner_cannot_check_in_after_the_release() {
    let mut c = released();
    set(owner(), T0 + 100 * MINUTE, ZERO);
    c.check_in();
}

#[test]
#[should_panic(expected = "Estate: the satchel was released to the heir")]
fn the_old_owner_cannot_cancel_after_the_release() {
    let mut c = released();
    set(owner(), T0 + 100 * MINUTE, ZERO);
    c.cancel_release();
}

#[test]
#[should_panic(expected = "Estate: the satchel was released to the heir")]
fn a_guardian_cannot_approve_after_the_release() {
    let mut c = released();
    set(guardian1(), T0 + 100 * MINUTE, ZERO);
    c.approve_release();
}

#[test]
#[should_panic(expected = "Estate: the satchel was released to the heir")]
fn finalize_after_the_release_is_refused() {
    let mut c = released();
    set(heir(), T0 + 100 * MINUTE, ZERO);
    let _ = c.finalize_release();
}

// ---------- sign_evm ----------

#[test]
fn sign_evm_passes_the_transaction_to_the_satchel_contract() {
    let mut c = setup();
    set(owner(), T0 + MINUTE, NearToken::from_yoctonear(1));
    let _ = c.sign_evm(tx());
    let made = calls();
    assert_eq!(made.len(), 1);
    let (receiver, method, args, deposit, gas, weight) = &made[0];
    assert_eq!(receiver, SATCHEL);
    assert_eq!(method, "sign_evm");
    assert_eq!(
        *args,
        serde_json::json!({
            "token_id": TOKEN,
            "tx": {
                "chain_id": "11155111",
                "nonce": "0",
                "max_priority_fee_per_gas": "1000000000",
                "max_fee_per_gas": "5000000000",
                "gas_limit": "21000",
                "to": "0x000000000000000000000000000000000000dEaD",
                "value": "0",
                "data": "0x",
            },
        })
    );
    assert_eq!(*deposit, NearToken::from_yoctonear(1));
    assert_eq!(*gas, SATCHEL_SIGN_GAS);
    assert_eq!(*weight, 1);
}

#[test]
fn sign_evm_passes_calldata_as_given_and_defaults_data_to_0x() {
    let mut c = setup();
    let mut t = tx();
    t.data = "0xa9059cbb".to_string();
    set(owner(), T0 + MINUTE, NearToken::from_yoctonear(1));
    let _ = c.sign_evm(t);
    assert_eq!(calls()[0].2["tx"]["data"], "0xa9059cbb");
    let parsed: EvmTx = serde_json::from_value(serde_json::json!({
        "chain_id": "1", "nonce": "0", "max_priority_fee_per_gas": "1", "max_fee_per_gas": "1",
        "gas_limit": "21000", "to": "0x000000000000000000000000000000000000dEaD", "value": "0",
    }))
    .unwrap();
    assert_eq!(parsed.data, "0x");
}

#[test]
fn sign_evm_counts_as_a_check_in_and_cancels_a_waiting_release() {
    let (mut c, started) = releasing();
    set(owner(), started + MINUTE, NearToken::from_yoctonear(1));
    let _ = c.sign_evm(tx());
    let e = events();
    assert_eq!(names(&e), vec!["check_in", "release_cancelled"]);
    assert_eq!(e[0].1["via"], "sign_evm");
    assert_eq!(calls()[0].1, "sign_evm");
    let v = view_at(&c, started + MINUTE);
    assert_eq!(v.phase, Phase::Alive);
    assert_eq!(v.last_check_in, U64(started + MINUTE));
}

#[test]
#[should_panic(expected = "Estate: only the owner can do this")]
fn sign_evm_refuses_the_heir_before_the_release() {
    let mut c = setup();
    set(heir(), T0 + MINUTE, NearToken::from_yoctonear(1));
    let _ = c.sign_evm(tx());
}

#[test]
#[should_panic(expected = "Estate: only the owner can do this")]
fn sign_evm_refuses_a_guardian() {
    let mut c = setup();
    set(guardian1(), T0 + MINUTE, NearToken::from_yoctonear(1));
    let _ = c.sign_evm(tx());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn sign_evm_requires_one_yocto() {
    let mut c = setup();
    set(owner(), T0 + MINUTE, ZERO);
    let _ = c.sign_evm(tx());
}

#[test]
#[should_panic(expected = "Estate: attach at least 200 TGas to sign")]
fn sign_evm_requires_gas_for_the_mpc_request() {
    let mut c = setup();
    testing_env!(
        ctx(owner(), T0 + MINUTE, NearToken::from_yoctonear(1))
            .prepaid_gas(Gas::from_tgas(199))
            .build()
    );
    let _ = c.sign_evm(tx());
}

// ---------- the demo run, end to end ----------

#[test]
fn the_testnet_run_in_order() {
    let mut c = setup();
    // The owner checks in; a guardian's approval right after is refused (checked above).
    let check_in = T0 + MINUTE;
    set(owner(), check_in, ZERO);
    c.check_in();
    // Past the interval, both guardians approve: the release starts.
    let first = check_in + INTERVAL + 20 * 1_000_000_000;
    released_from(&mut c, first);
    assert_eq!(view_at(&c, first).phase, Phase::Releasing);
    // The owner cancels by checking in.
    let cancel = first + MINUTE;
    set(owner(), cancel, ZERO);
    c.check_in();
    assert_eq!(view_at(&c, cancel).phase, Phase::Alive);
    // Past the interval again, both approve again; the waiting period runs out; the heir finalizes.
    let second = cancel + INTERVAL + 20 * 1_000_000_000;
    released_from(&mut c, second);
    let finalize = second + WAITING + 20 * 1_000_000_000;
    set(heir(), finalize, ZERO);
    let _ = c.finalize_release();
    callback(finalize + 1, PromiseResult::Successful(vec![]));
    assert!(c.on_release());
    let v = view_at(&c, finalize + 2);
    assert_eq!(v.phase, Phase::Released);
    assert_eq!(v.release_started_at, Some(U64(second)));
    assert_eq!(v.last_check_in, U64(cancel));
}
