# Susu — Technical Documentation

EAG Ghana Hackathon 2026.

---

## 1. Track

**Primary: Track 4 — Application Middleware & Open-Source Tooling.**
The track asks for "account abstraction, smart account UX, session keys, gas abstraction,
intent-based UX." Susu is a working demonstration of gas abstraction and intent-based UX, where
the end user has no wallet, no ETH, and no awareness that a chain is involved.

**Secondary: Track 6 — Real-World Ethereum Applications.**
Susu is a rotating savings group (*susu*), a savings instrument already used daily across Ghana.
The track asks for "community coordination, membership systems, contribution records" and
"applications for emerging regions."

**Submitted under: Ghana Track.**

## 2. The problem we're actually solving

Group savings in Ghana runs on a trusted individual holding the money and the book. The failure
mode is well known and there is usually no verifiable record afterwards.

Putting the ledger onchain fixes the record. It also, done naively, destroys adoption — because
the onchain version demands the user install a wallet, acquire ETH to pay gas, and take custody
of a seed phrase. That is three hard blockers in front of a person who currently completes the
same task with one tap in MTN MoMo.

**So the design constraint was: the ledger goes onchain, and the user's experience gets no
harder than it is today.** Everything below follows from that one constraint.

## 3. Core architecture

```
  Browser                    Relayer (Node)              Ethereum Sepolia
  ───────                    ──────────────              ────────────────
  email sign-in
      │
      ├─► key generated locally
      │   (never displayed, never transmitted)
      │
      ├─ POST /api/join ──────► susu.join(addr, handle, 50000)  ──► tx
      │                          (relayer signs + pays gas)
      │
      ├─ GET nonce ───────────► susu.nonces(addr)
      │
      ├─► EIP-712 signTypedData
      │   Contribute(member, amount, nonce)
      │        │
      │        │  the signature IS the authorisation
      │        ▼
      └─ POST /api/contribute ─► susu.contributeWithSig(member, amount, v, r, s)
                                  │
                                  ├─ ecrecover(digest) == member ?
                                  ├─ balance sufficient ?
                                  ├─ nonce consumed (replay-proof)
                                  └─► balance → pot, event emitted
```

**The key mechanism.** `contributeWithSig` is deliberately callable by **any** address. The
sender is irrelevant; the EIP-712 signature is the sole authorisation. This means:

- the member needs zero ETH, because they never send a transaction
- whoever submits it pays the gas, which is what makes the wallet invisible
- the relayer is a convenience, not a trust assumption — it cannot forge, alter, or redirect a
  contribution, only choose whether to pay to deliver one
- anyone can run a competing relayer without permission

That last property is the difference between gas abstraction and custody. We hold no user funds
and cannot move them.

**Replay protection.** Each member has an incrementing nonce, consumed inside the same call that
verifies the signature. A captured signature cannot be replayed.

**EIP-712 domain binding.** The domain separator commits to `chainId` and `verifyingContract`, so
a signature produced for this contract on Sepolia is invalid anywhere else.

## 4. Key features

| Feature | Implementation |
|---|---|
| Email sign-in, no wallet | `ethers.Wallet.createRandom()` in-browser, persisted to `localStorage` |
| Zero gas for the user | EIP-712 meta-transaction, relayer-funded |
| Currency shown in GHS | `uint8 decimals = 2`, pesewa-denominated integers throughout |
| Public contribution ledger | `snapshot()` returns all members, balances and totals in one call |
| Round payout | `payout(address)` transfers the whole pot, emits `PaidOut` with a round number |
| Opt-in transparency | The "boring truth" drawer — the only place the chain surfaces in the UI |
| Spend ceiling | `MAX_CONTRIBUTION` caps a single contribution at GHS 200 in the relayer |

## 5. Stack

- **Contract**: Solidity `^0.8.24`, compiled with solc 0.8.36, optimizer on, 200 runs. 4.6KB.
  No external dependencies, no OpenZeppelin, no proxy.
- **Chain**: Ethereum Sepolia (`chainId 11155111`).
- **Relayer**: Node 24, ethers v6. Runs as a plain HTTP server locally and as a Vercel serverless
  function in production. Same handler module in both.
- **Front end**: one HTML file. No framework, no bundler, no build step. `ethers` is vendored
  locally rather than pulled from a CDN, so the demo works on venue wifi that is misbehaving.
- **Design**: palette derived from the `kejetia-awning` world (Kumasi central market awnings),
  contrast-proven at every token pair. Fraunces + Public Sans.

## 6. What we deliberately did not build

Naming these because a hackathon project that claims completeness is lying.

- **No mobile money on-ramp.** Real MoMo integration requires a payment provider agreement and
  weeks of approval. Balances are currently issued by the relayer.
- **No MPC or TEE key management.** The browser key is a single key in `localStorage`. Production
  needs threshold splitting so no single machine ever holds a whole key.
- **No ERC-4337 bundler.** We implemented gas abstraction directly, which is smaller, easier to
  audit, and sufficient for one action type. A general-purpose account would want 4337.
- **No dispute or governance mechanism.** Payout order is operator-decided.
- **No audit.** Written in an afternoon.

## 7. Roadmap

**Next (weeks)**
- Move key custody to threshold shares so no single server can reconstruct a key.
- Open relaying to anyone with a public mempool of signed notes, removing the last central point.
- Onchain payout rotation, so whose turn it is is enforced by the contract rather than an operator.
- Migrate demo balances to a real stablecoin on an L2 where fees are a fraction of a pesewa.

**Then (months)**
- Mobile money on-ramp and off-ramp through a licensed Ghanaian provider. This is the single
  change that turns the demo into a product.
- Group creation, invites, and multiple concurrent susu groups per member.
- A contribution history that a member can export, which is the beginning of a portable savings
  record — useful anywhere a Ghanaian is asked to prove income and cannot.
- Independent audit before any real value touches the contract.

**The long bet.** Millions of Ghanaians save this way and none of it counts as financial history.
A verifiable, member-owned record of years of consistent contributions is a credit signal that
does not currently exist. That is worth more than the savings box itself.

## 8. Deployment record

| | |
|---|---|
| Contract | `0xe66CEB8f1791ab5BAC2ce49299fD6731dfc633d9` |
| Network | Ethereum Sepolia (11155111) |
| Explorer | https://sepolia.etherscan.io/address/0xe66CEB8f1791ab5BAC2ce49299fD6731dfc633d9 |
| Compiler | solc 0.8.36, optimizer enabled, 200 runs |
