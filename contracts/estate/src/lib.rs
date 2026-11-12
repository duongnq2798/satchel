//! Estate: a testnet demo contract that owns one satchel and hands it to a named heir when its
//! owner stops checking in.
//!
//! The owner checks in from time to time. Once a check-in is overdue, the guardians can approve a
//! release; when enough of them have, a waiting period starts, and any check-in by the owner
//! cancels it. After the waiting period anyone can finalize: the estate transfers the satchel to
//! the heir with the Satchel contract's own `nft_transfer`, and from then on only the heir can have
//! anything signed for its address, on every chain the satchel signs for. The rules are set once,
//! at init, and the deploy deletes the account's only key, so nobody can change them.
//!
//! The estate owns the satchel the way any account does: the Satchel contract is not changed and
//! knows nothing about it. What the estate checks: who calls, and block time. What it does not: that
//! the owner is alive (a check-in only shows someone used the owner's key), what the satchel's
//! address holds, or what was signed for it before the satchel came here. Not audited.

#[cfg(test)]
mod tests;

use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::{
    AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseError, assert_one_yocto,
    env, near, require,
};

/// The most guardians an estate names.
pub const MAX_GUARDIANS: usize = 5;
/// The longest check-in interval or waiting period, in minutes: ten 365-day years.
pub const MAX_MINUTES: u32 = 10 * 365 * 24 * 60;
const NANOS_PER_MINUTE: u64 = 60_000_000_000;
/// What the Sputnik DAO run attached to its `sign_evm` call on testnet. The Satchel contract needs
/// 50 TGas of it and passes the rest to the MPC request.
pub const SATCHEL_SIGN_GAS: Gas = Gas::from_tgas(150);
/// `sign_evm` refuses less: the Satchel call's 150 TGas plus room for the estate's own work.
pub const MIN_SIGN_GAS: Gas = Gas::from_tgas(200);
/// For the Satchel contract's `nft_transfer`, as much as the DAO's transfer proposal attached.
pub const TRANSFER_GAS: Gas = Gas::from_tgas(30);
/// For `on_release`, which only reads the transfer's result and writes a few fields.
pub const CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// `finalize_release` refuses less, so the transfer and its callback always get their gas.
pub const MIN_FINALIZE_GAS: Gas = Gas::from_tgas(60);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const EVENT_STANDARD: &str = "satchel_estate";
const EVENT_VERSION: &str = "1.0.0";

/// The Satchel contract's `Eip1559Tx`, field for field. The estate passes it on as it is: the
/// Satchel contract builds, checks, hashes and records it.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvmTx {
    pub chain_id: U64,
    pub nonce: U64,
    pub max_priority_fee_per_gas: U128,
    pub max_fee_per_gas: U128,
    pub gas_limit: U64,
    pub to: String,
    pub value: U128,
    #[serde(default = "empty_hex")]
    pub data: String,
}

fn empty_hex() -> String {
    "0x".to_string()
}

/// Where the estate stands, as of a block's time.
#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// The owner's last check-in is within the interval. Guardians cannot approve.
    Alive,
    /// The interval has passed since the last check-in. Guardians can approve a release.
    Overdue,
    /// Enough guardians approved: the waiting period runs, then anyone can finalize. A check-in by
    /// the owner cancels it.
    Releasing,
    /// The satchel was transferred to the heir. Every owner and guardian call is refused.
    Released,
}

/// The whole state and the phase, from one view. Times are block times, in nanoseconds.
#[near(serializers = [json])]
pub struct EstateView {
    pub satchel_contract: AccountId,
    pub token_id: String,
    pub owner: AccountId,
    pub guardians: Vec<AccountId>,
    pub threshold: u32,
    pub heir: AccountId,
    pub check_in_interval_minutes: u32,
    pub waiting_period_minutes: u32,
    pub last_check_in: U64,
    /// Guardians who approved since the last check-in.
    pub approvals: Vec<AccountId>,
    pub release_started_at: Option<U64>,
    /// `finalize_release` sent the transfer and its callback has not run yet.
    pub transfer_in_flight: bool,
    pub released_at: Option<U64>,
    /// The block time this view was read at.
    pub now: U64,
    pub phase: Phase,
    /// The owner is overdue from the first block after this time, unless they check in first.
    pub overdue_at: U64,
    /// While releasing: `finalize_release` is accepted from the first block after this time.
    pub release_at: Option<U64>,
}

#[near(
    contract_state,
    contract_metadata(standard(standard = "nep297", version = "1.0.0"))
)]
#[derive(PanicOnDefault)]
pub struct Contract {
    satchel_contract: AccountId,
    token_id: String,
    owner: AccountId,
    guardians: Vec<AccountId>,
    threshold: u32,
    heir: AccountId,
    check_in_interval_minutes: u32,
    waiting_period_minutes: u32,
    last_check_in: u64,
    approvals: Vec<AccountId>,
    release_started_at: Option<u64>,
    transfer_in_flight: bool,
    released_at: Option<u64>,
}

#[near]
impl Contract {
    /// Sets the rules for good: there is no method that changes them. `satchel_contract` is the
    /// Satchel contract (`v1.satchel-nft.testnet` on testnet) and `token_id` the satchel this
    /// estate will own. 1 to 5 distinct guardians, none of them the owner or the heir; `threshold`
    /// of them must approve. The heir is not the owner. Both times are whole minutes, at least 1.
    /// The owner counts as checked in at init. Private, so nobody can front-run the deployer's init.
    #[init]
    #[private]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        satchel_contract: AccountId,
        token_id: String,
        owner: AccountId,
        guardians: Vec<AccountId>,
        threshold: u32,
        heir: AccountId,
        check_in_interval_minutes: u32,
        waiting_period_minutes: u32,
    ) -> Self {
        let me = env::current_account_id();
        require!(!token_id.is_empty(), "Estate: token_id is empty");
        require!(heir != owner, "Estate: the heir cannot be the owner");
        require!(
            !guardians.is_empty() && guardians.len() <= MAX_GUARDIANS,
            "Estate: name 1 to 5 guardians"
        );
        for (i, guardian) in guardians.iter().enumerate() {
            require!(
                !guardians[..i].contains(guardian),
                "Estate: a guardian is named twice"
            );
            require!(*guardian != owner, "Estate: the owner cannot be a guardian");
            require!(*guardian != heir, "Estate: the heir cannot be a guardian");
        }
        require!(
            owner != me && heir != me && !guardians.contains(&me),
            "Estate: the estate cannot be its own owner, heir or guardian"
        );
        require!(
            threshold >= 1 && threshold as usize <= guardians.len(),
            "Estate: the threshold must be from 1 to the number of guardians"
        );
        require!(
            (1..=MAX_MINUTES).contains(&check_in_interval_minutes),
            "Estate: the check-in interval must be 1 to 5256000 minutes"
        );
        require!(
            (1..=MAX_MINUTES).contains(&waiting_period_minutes),
            "Estate: the waiting period must be 1 to 5256000 minutes"
        );
        Self {
            satchel_contract,
            token_id,
            owner,
            guardians,
            threshold,
            heir,
            check_in_interval_minutes,
            waiting_period_minutes,
            last_check_in: env::block_timestamp(),
            approvals: Vec::new(),
            release_started_at: None,
            transfer_in_flight: false,
            released_at: None,
        }
    }

    /// The owner is alive: restarts the interval, voids every approval and cancels a release that
    /// is waiting. Owner only. No deposit, so a function-call key the owner gave an app can check
    /// in too.
    pub fn check_in(&mut self) {
        self.assert_owner();
        self.record_check_in("check_in");
    }

    /// The same as `check_in`, by its other name: the owner cancels a release by checking in.
    pub fn cancel_release(&mut self) {
        self.assert_owner();
        self.record_check_in("cancel_release");
    }

    /// A guardian approves handing the satchel to the heir. Only once the owner is overdue (block
    /// time past the last check-in plus the interval), once per guardian per overdue period, and
    /// not after a release has started. The approval that reaches the threshold starts the waiting
    /// period.
    pub fn approve_release(&mut self) {
        self.assert_open();
        let guardian = env::predecessor_account_id();
        require!(
            self.guardians.contains(&guardian),
            "Estate: only a guardian can do this"
        );
        require!(
            self.release_started_at.is_none(),
            "Estate: the release has already started"
        );
        let now = env::block_timestamp();
        require!(
            now > self.overdue_at(),
            "Estate: the owner is not overdue yet"
        );
        require!(
            !self.approvals.contains(&guardian),
            "Estate: this guardian has already approved"
        );
        self.approvals.push(guardian.clone());
        emit(
            "approve",
            json!({
                "guardian": guardian,
                "approvals": self.approvals.len(),
                "threshold": self.threshold,
                "at": U64(now),
            }),
        );
        if self.approvals.len() >= self.threshold as usize {
            self.release_started_at = Some(now);
            emit(
                "release_started",
                json!({
                    "approvals": self.approvals,
                    "at": U64(now),
                    "release_at": U64(now + self.waiting_ns()),
                }),
            );
        }
    }

    /// Anyone can finalize once the waiting period has passed with no check-in since it started.
    /// Sends the Satchel contract `nft_transfer(heir, token_id)` with 1 yoctoNEAR from the
    /// estate's balance; `on_release` records the release only if the transfer succeeded, and
    /// otherwise leaves the estate as it was, so it can be finalized again. At least 60 TGas.
    pub fn finalize_release(&mut self) -> Promise {
        self.assert_open();
        let started = self
            .release_started_at
            .unwrap_or_else(|| env::panic_str("Estate: no release is in progress"));
        require!(
            env::block_timestamp() > started + self.waiting_ns(),
            "Estate: the waiting period has not passed yet"
        );
        require!(
            env::prepaid_gas() >= MIN_FINALIZE_GAS,
            "Estate: attach at least 60 TGas to finalize"
        );
        self.transfer_in_flight = true;
        emit(
            "release_sent",
            json!({
                "heir": self.heir,
                "token_id": self.token_id,
                "by": env::predecessor_account_id(),
                "at": U64(env::block_timestamp()),
            }),
        );
        let args = json!({ "receiver_id": self.heir, "token_id": self.token_id });
        Promise::new(self.satchel_contract.clone())
            .function_call(
                "nft_transfer".to_string(),
                args.to_string().into_bytes(),
                ONE_YOCTO,
                TRANSFER_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_release(),
            )
    }

    /// The transfer's result. Released only if `nft_transfer` succeeded; if it failed, the estate
    /// stays releasing and `finalize_release` can be called again. Returns whether it moved.
    #[private]
    pub fn on_release(&mut self) -> bool {
        self.transfer_in_flight = false;
        // Only success or failure matters: `nft_transfer` returns nothing, and a value too long to
        // read is still a success.
        let moved = !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed));
        let now = U64(env::block_timestamp());
        if moved {
            self.released_at = Some(now.0);
            emit(
                "released",
                json!({ "heir": self.heir, "token_id": self.token_id, "at": now }),
            );
        } else {
            emit(
                "release_failed",
                json!({ "token_id": self.token_id, "at": now }),
            );
        }
        moved
    }

    /// Has the satchel sign an EVM transaction: passes `tx` to the Satchel contract's
    /// `sign_evm(token_id, tx)` with 1 yoctoNEAR and returns its promise, which resolves to the MPC
    /// signature. Owner only, exactly 1 yoctoNEAR, at least 200 TGas. Allowed until the release:
    /// it is the owner using their wallet, so it counts as a check-in and cancels a release that is
    /// waiting. The check-in stands even if the Satchel contract refuses the transaction: the owner
    /// signed a NEAR transaction either way.
    #[payable]
    pub fn sign_evm(&mut self, tx: EvmTx) -> Promise {
        assert_one_yocto();
        self.assert_owner();
        require!(
            env::prepaid_gas() >= MIN_SIGN_GAS,
            "Estate: attach at least 200 TGas to sign"
        );
        self.record_check_in("sign_evm");
        let args = json!({ "token_id": self.token_id, "tx": tx });
        Promise::new(self.satchel_contract.clone()).function_call_weight(
            "sign_evm".to_string(),
            args.to_string().into_bytes(),
            ONE_YOCTO,
            SATCHEL_SIGN_GAS,
            GasWeight(1),
        )
    }

    // ---------- views ----------

    /// The rules, the state and the phase, computed from the block time of the read.
    pub fn estate(&self) -> EstateView {
        let now = env::block_timestamp();
        EstateView {
            satchel_contract: self.satchel_contract.clone(),
            token_id: self.token_id.clone(),
            owner: self.owner.clone(),
            guardians: self.guardians.clone(),
            threshold: self.threshold,
            heir: self.heir.clone(),
            check_in_interval_minutes: self.check_in_interval_minutes,
            waiting_period_minutes: self.waiting_period_minutes,
            last_check_in: U64(self.last_check_in),
            approvals: self.approvals.clone(),
            release_started_at: self.release_started_at.map(U64),
            transfer_in_flight: self.transfer_in_flight,
            released_at: self.released_at.map(U64),
            now: U64(now),
            phase: self.phase(now),
            overdue_at: U64(self.overdue_at()),
            release_at: self
                .release_started_at
                .filter(|_| self.released_at.is_none())
                .map(|started| U64(started + self.waiting_ns())),
        }
    }

    // ---------- internals ----------

    fn phase(&self, now: u64) -> Phase {
        if self.released_at.is_some() {
            Phase::Released
        } else if self.release_started_at.is_some() {
            Phase::Releasing
        } else if now > self.overdue_at() {
            Phase::Overdue
        } else {
            Phase::Alive
        }
    }

    fn overdue_at(&self) -> u64 {
        self.last_check_in + u64::from(self.check_in_interval_minutes) * NANOS_PER_MINUTE
    }

    fn waiting_ns(&self) -> u64 {
        u64::from(self.waiting_period_minutes) * NANOS_PER_MINUTE
    }

    /// Refuses every owner and guardian call once the satchel was released, and while the
    /// transfer to the heir is in flight.
    fn assert_open(&self) {
        require!(
            self.released_at.is_none(),
            "Estate: the satchel was released to the heir"
        );
        require!(
            !self.transfer_in_flight,
            "Estate: the satchel is on its way to the heir"
        );
    }

    fn assert_owner(&self) {
        self.assert_open();
        require!(
            env::predecessor_account_id() == self.owner,
            "Estate: only the owner can do this"
        );
    }

    fn record_check_in(&mut self, via: &str) {
        let now = env::block_timestamp();
        self.last_check_in = now;
        let voided = std::mem::take(&mut self.approvals);
        let cancelled = self.release_started_at.take();
        emit(
            "check_in",
            json!({
                "owner": self.owner,
                "via": via,
                "at": U64(now),
                "overdue_at": U64(self.overdue_at()),
                "approvals_voided": voided,
            }),
        );
        if let Some(started) = cancelled {
            emit(
                "release_cancelled",
                json!({ "started_at": U64(started), "via": via, "at": U64(now) }),
            );
        }
    }
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
