# Susu — Technical Documentation

Rotating savings circles with the payout order enforced onchain, built so members never
touch crypto.

| | |
|---|---|
| Contract | [`0x0401020fb602ae32F388F43B3f809AD98e08065B`](https://sepolia.etherscan.io/address/0x0401020fb602ae32F388F43B3f809AD98e08065B) |
| Network | Ethereum Sepolia (`11155111`) |
| Live | https://susu-cyan.vercel.app |
| Compiler | solc 0.8.36, optimizer on, 200 runs |
| Tests | 44 passing — `npm run check` |

---

## 1. Track

**Primary: Application Middleware & Open-Source Tooling.** The track asks for "account
abstraction, smart account UX, session keys, gas abstraction, intent-based UX." Susu is a
working demonstration of gas abstraction and intent-based UX where the end user has no wallet,
no ETH, and no awareness that a chain is involved.

**Secondary: Real-World Ethereum Applications** — "community coordination, membership systems,
contribution records" and "applications for emerging regions."

Submitted under the **Ghana Track**.

## 2. The problem, and the constraint it forces

Group savings in Ghana (*susu*) runs on a trusted individual holding both the cash and the book.
When it fails there is usually no verifiable record.

Putting the ledger onchain fixes the record. Done naively it also destroys adoption, because the
onchain version asks the user to install a wallet, acquire ETH for gas, and take custody of a
seed phrase — three hard blockers in front of someone who currently completes the same task with
one tap in MTN MoMo.

**So the constraint was: the ledger goes onchain, and the user's experience gets no harder than
it is today.** Everything below follows from that.

## 3. Architecture

```
  Browser                      Relayer (Node)                Ethereum Sepolia
  ───────                      ──────────────                ────────────────
  phone-number sign-in
      │
      ├─► key generated locally
      │   (never displayed, never transmitted)
      │
      ├─ POST /api/createCircle ──► createCircle(label, keccak(code), owner, amount, …)
      ├─ POST /api/joinCircle ────► joinCircle(keccak(code), member, handle)
      │                             + credit(member, 50000, "DEMO-WELCOME")
      ├─ POST /api/startCircle ───► startCircle(id)      ← locks the order
      │
      ├─► EIP-712 signTypedData
      │   Contribute(circleId, member, amount, round, nonce)
      │        │  the signature IS the authorisation
      │        ▼
      ├─ POST /api/contribute ────► contributeWithSig(circleId, member, amount, round, v, r, s)
      │                             ├─ ecrecover(digest) == member ?
      │                             ├─ amount == the circle's fixed amount ?
      │                             ├─ round <= currentRound, and unpaid ?
      │                             ├─ nonce consumed (replay-proof)
      │                             └─► balance → pot
      │
      └─ POST /api/settleRound ───► settleRound(id)
                                    └─► contract picks the recipient itself
```

### The two properties that matter

**Gas abstraction.** `contributeWithSig` is deliberately callable by **any** address. The sender
is irrelevant; the EIP-712 signature is the sole authorisation. So:

- the member needs zero ETH, because they never send a transaction
- whoever submits pays the gas, which is what makes the wallet invisible
- the relayer cannot forge, alter, or redirect a contribution — only choose whether to pay to
  deliver one
- anyone can run a competing relayer without permission

That last property is the difference between gas abstraction and custody. We hold no user funds
and cannot move them.

**Onchain rotation.** There is no function anywhere that accepts a recipient address for a
payout. `settleRound(circleId)` derives the recipient from the order locked at `startCircle`,
and anyone may call it. The result is identical regardless of who asks. The owner who set the
order cannot revisit it, reorder it, or pay someone out of turn.

### Replay and scope protection

- **Nonces.** Each member has an incrementing nonce consumed in the same call that verifies the
  signature. A captured signature cannot be replayed.
- **Domain binding.** The EIP-712 domain separator commits to `chainId` and `verifyingContract`,
  so a signature made for this contract on Sepolia is invalid anywhere else.
- **Round binding.** `round` is inside the signed struct, so a signature for round 3 cannot be
  submitted as round 1.

### Join codes

Codes are stored **only as `keccak256(code)`**. The plaintext never touches the chain, so nobody
can read public state and harvest working invitations. `circleByCode(hash)` resolves a hash to a
circle id; the relayer hashes what the user typed.

## 4. The default rule

The hardest problem in any rotating savings group: somebody takes the pot and stops paying.

**No contract can force payment.** What this one does instead:

`paidCount[circleId][member]` tracks rounds paid. A member is eligible for a payout when
`paidCount >= currentRound + 1` — that is, they have paid every round including the current one.

On `settleRound`, the contract walks the order from `payoutCursor`:

1. skip anyone who has already received
2. if the next candidate is not eligible, increment `missedTurns`, emit `TurnMissed`, and keep
   walking
3. the first eligible candidate takes the whole pot; the cursor advances past them
4. if nobody is eligible, emit `RoundStalled` and the pot rolls into the next round

A skipped member keeps their place in the queue. They lose *that* turn, not their membership.

**Arrears.** `contributeWithSig` accepts any `round <= currentRound` that the member has not yet
paid, so somebody who fell behind can settle up and become eligible again. `arrearsOf()` reports
how many rounds they owe.

> This came out of a failing test. The suite had a case named *"lets a member who catches up take
> a later turn"* which could not pass, because the original contract only ever accepted payment
> for the current round — one missed week disqualified you permanently. The test was right and
> the contract was wrong.

### Deadlines

`settleRound` succeeds when every member has paid, **or** once `roundStartedAt + roundLength` has
passed. One person refusing to pay delays the round; it cannot freeze everyone's money forever.

## 5. Contract surface

| Function | Who | Notes |
|---|---|---|
| `createCircle(label, codeHash, owner, amount, roundLength, size)` | operator | size 2–20 |
| `joinCircle(codeHash, member, handle)` | operator | join order becomes payout order |
| `startCircle(circleId)` | operator or owner | locks the order, opens round 0 |
| `credit(member, amount, providerRef)` | operator | stands in for a confirmed deposit |
| `contributeWithSig(circleId, member, amount, round, v, r, s)` | **anyone** | signature is the authorisation |
| `settleRound(circleId)` | **anyone** | contract picks the recipient |
| `circleInfo` · `membersOf` · `nextInLine` · `arrearsOf` · `orderOf` | view | one call feeds the whole UI |

`joinCircle` being operator-only is a deliberate boundary: **signatures guard value, the operator
guards convenience.** The operator can add a member but cannot move a single pesewa.

## 6. Stack and engineering notes

- **Contract**: Solidity `^0.8.24`, no external dependencies, no OpenZeppelin, no proxy.
  `SusuCircles` is 11,215 bytes.
- **Relayer**: Node 24 + ethers v6. Plain HTTP server locally, Vercel serverless in production,
  same handler module in both.
- **Front end**: one HTML file. No framework, no bundler, no build step. `ethers` is vendored
  locally with a CDN fallback, so a demo survives bad venue wifi.
- **Design**: palette derived from the `kejetia-awning` world (the tarpaulin awnings over Kumasi
  central market), every token pair contrast-proven. Fraunces + Public Sans.

**RPC resilience.** Ghanaian networks block or throttle several public Sepolia endpoints, and
which ones varies by hour. The relayer holds a candidate list, probes each with the queries it
actually depends on — including an `eth_getLogs` over the real block range, because `1rpc.io`
answers `eth_blockNumber` and then caps logs at 50 blocks — and keeps the first that works. A
failure clears the memo so the next request retries rather than staying wedged.

**One log query, not many.** Reading the book once meant three filtered `eth_getLogs` calls,
which timed out on free endpoints. It now fetches the contract's logs once, parses, and filters
in process, with a short cache.

## 6b. Mobile money on-ramp

`lib/momo.js` implements the on-ramp with a **real verification path and a mock provider**.

```
  Browser                Relayer                          Provider
  ───────                ───────                          ────────
  Top up GHS 250
      │
      ├─ POST /api/momoTopUp ──► MockMoMoProvider.requestPayment()
      │                          └─► builds payload + HMAC-SHA256 signature
      │                                         │
      │                          POST /api/momoWebhook  ◄── (a live provider calls this)
      │                                         │
      │                          verifyWebhook(rawBody, signature)
      │                            ├─ timing-safe HMAC over the EXACT bytes
      │                            ├─ timestamp inside a 5 minute window
      │                            ├─ status == SUCCESS, amount and account well-formed
      │                            └─ reference not already in the chain's Credited events
      │                                         │
      └──────────────────────────────────────► credit(account, amount, reference)
```

**What is genuinely production-shaped**

| Concern | How |
|---|---|
| Authenticity | HMAC-SHA256 over the raw body. The route is public because the signature authenticates it, not the caller. |
| Byte fidelity | Both server wrappers keep the raw bytes; re-serialising a parsed object would break the signature. |
| Guessing | `crypto.timingSafeEqual`, length-checked first. |
| Replay | Five-minute freshness window, plus rejection of future-dated payloads. |
| Double credit | In-process reference set for provider retries, and a check against the chain's own `Credited(member, amount, providerRef)` events so a restart cannot re-credit. |
| Failure handling | A reference is released again if the onchain credit throws, so a genuine retry still lands. |
| Information leakage | The caller gets `webhook rejected`; the reason goes to our logs. |

**What is mocked:** only `MockMoMoProvider.requestPayment`. It builds the payload a live provider
would send instead of pushing a PIN prompt to a phone. Going live means implementing that one
method against MTN/Hubtel/Paystack and setting `MOMO_WEBHOOK_SECRET` to theirs. `verifyWebhook`
does not change.

18 tests cover this path, including forged signatures, tampered bodies, wrong secrets, stale and
future timestamps, failed payment statuses, and malformed accounts.

## 7. What is deliberately not built

- **No licensed mobile money provider.** The verification path is real; the provider is a mock,
  and the UI says so. A live connection needs a Bank of Ghana licence or a licensed partner —
  weeks of paperwork, not hours of code.
- **No payouts back out to MoMo.** Money in is modelled; money out is not.
- **No MPC or TEE key management.** The browser key is a single key in `localStorage`. Production
  needs threshold splitting so no machine ever holds a whole key.
- **No ERC-4337 bundler.** Gas abstraction is implemented directly: smaller, easier to audit, and
  sufficient for one action type.
- **No USSD.** The right answer for feature phones, and it changes the custody model, because a
  feature phone cannot hold its own key.
- **No audit.** Do not put real money in this.

## 8. Roadmap

**Next**
- Mobile money in and out through a licensed provider. The single change that turns this into a
  product.
- Threshold key custody so no single server can reconstruct a member's key.
- Open relaying — a public mempool of signed notes, removing the last central point.
- Migrate to a real stablecoin on an L2 where fees are a fraction of a pesewa.

**Then**
- USSD for feature phones, with the custody trade-off stated plainly to users.
- Exportable contribution history — the beginning of a portable savings record.
- Independent audit before any real value touches the contract.

**The long bet.** Millions of Ghanaians save this way and none of it counts as financial history.
A verifiable, member-owned record of years of consistent contributions is a credit signal that
does not currently exist. That is worth more than the savings box itself.

## 9. Running it

```bash
npm install
npm run check      # compile + 44 tests
npm start          # http://localhost:8099
npm run e2e        # full flow against the live contract
npm run shots      # recapture media from the live URL
```

`npm run deploy [ContractName]` publishes a fresh copy and rewrites `build/deployment.json`.
