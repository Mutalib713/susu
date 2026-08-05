# Susu

**A group savings box where everybody can see every cedi, and nobody has to know what a blockchain is.**

EAG Ghana Hackathon 2026 · Ghana Track · Built in one afternoon in Kumasi.

**Try it: https://susu-dpbrw08ny-mutalib.vercel.app**

Live contract: [`0x0401020fb602ae32F388F43B3f809AD98e08065B`](https://sepolia.etherscan.io/address/0x0401020fb602ae32F388F43B3f809AD98e08065B) on Ethereum Sepolia.
44 tests, all passing. `npm run check`.

Sign in with any name and any Ghana-format number, like `024 123 4567`. You get GHS 500 of demo
money and you're in the group. Nothing to install.

---

## What it is, in ordinary words

*Susu* is how a lot of Ghana already saves. A group puts money in every week. Each round,
somebody takes the whole pot. Your grandmother knows what it is.

The problem has always been the same one: **the money sits with a person.** Somebody holds the
book. Somebody holds the cash. Everybody else hopes. When it goes wrong, and it does go wrong,
there is no record anybody can check.

Susu puts the box somewhere nobody can quietly reach into, including us. Every contribution and
every payout is written where the whole group can see it, permanently, and nobody can edit it
afterwards.

## The part we actually think is interesting

Here is the thing about putting money on a blockchain: **normal people won't do it.**

Ask a student at KNUST to install a wallet app, buy a special coin just to pay transaction fees,
and safely store twelve secret words they can never lose. They won't. They'll use mobile money,
which takes one tap. We asked around before building this. Nobody wanted the crypto version.

So Susu doesn't have a crypto version.

You sign in with your phone number, the same one your group already knows you by. You see cedis.
You tap an amount. That's the whole experience. There is no wallet to install, no coin to buy, no fee to pay, no secret phrase, and
the word "Ethereum" appears nowhere in the interface.

It is still fully on a public blockchain the entire time.

At the bottom of the screen there's one quiet line: *"Where does this money actually live?"*
Tap it and the whole thing opens up — the contract, every receipt, links to the public record.
That's the only place crypto exists in this app, and it's opt-in.

## How we pulled that off

Two ideas, both simple once you see them.

**1. The key is made quietly, in the browser.** When you sign in, your phone creates a key and
keeps it. You are never shown it, never asked to write it down, never asked to install anything.

**2. Somebody else pays the postage.** That key holds no money and cannot pay transaction fees.
So it doesn't send transactions at all. It just **signs a note** that says "I authorise 20 cedis
into the pot." Our relayer picks up the note, carries it to the blockchain, and pays the fee out
of its own pocket.

You authorised it. Somebody else paid to deliver it. The blockchain checks your signature and
believes only you could have written that note.

That's the whole trick, and it's a real mechanism, not a mock. This is what the industry calls
*gas abstraction* and *account abstraction*, which are exactly the words the hackathon's Track 4
asks for. We just refused to make the user learn either one.

## What it does today

- **Sign in with a phone number.** An account opens on the public chain in about ten seconds.
- **Start a circle.** You set the name, the amount per round, how many people, and how long a
  round lasts. You get a join code to share.
- **Join with a code.** The code is stored onchain only as a hash, so nobody can read the
  blockchain and harvest working codes.
- **The order locks when the circle starts.** Members queue in join order. After the first cedi
  is paid, nobody can be added, removed, or reordered — including whoever started it.
- **Put in each round**, by signing rather than transacting. You never hold a coin or pay a fee.
- **The contract decides who gets paid.** There is no function anywhere that lets a person choose
  the recipient. `settleRound()` works it out from the locked order, and anyone can call it.
- **Fall behind and you lose your turn.** You cannot take a pot unless you have paid every round
  so far. Miss one and the contract passes over you, logs it publicly, and gives the pot to the
  next person who kept up.
- **Catch up whenever you like.** Pay the rounds you owe and you are eligible again. One missed
  week does not end your membership.
- **Deadlines keep it moving.** A round settles as soon as everyone has paid, or once the round
  closes — so one person refusing to pay cannot freeze everybody else's money.
- **The book** shows every payment with its date, time and a receipt link to the public record.

## Being straight about the limits

We would rather say this ourselves than have you find it.

- **It's test money on a test network.** Ethereum's Sepolia network, not real cedis and not real
  ETH. The plumbing is real; the money is play money.
- **The contract has not been audited.** It was written this afternoon. Do not put real money in it.
- **The key lives in the browser's storage.** A production version would split it across servers
  so that no single machine ever holds a whole key. That is a known, solved problem, and it was
  not solvable in the time we had.
- **The relayer is one server we run.** If it goes down, contributions stop. A real deployment
  would let anyone relay, which the contract already permits — the function is deliberately open
  to any sender, because the signature is what grants permission, not the sender.
- **There is no mobile money on-ramp yet.** Today the balance is handed out. Turning real cedis
  into a balance needs a payment provider and their approval, which takes weeks, not hours.

## The questions people actually ask

These came up while building it. Short answers here, full detail in
[TECHNICAL.md](TECHNICAL.md).

**What if someone stops paying after they've taken the pot?**

No software can force anyone to pay, and anybody who tells you a blockchain solves this is
selling something. Two things blunt it.

First, the record is permanent and public, so it travels with them. Today a defaulter takes the
pot, stops paying, and joins a different susu two streets over where nobody knows. That stops
being free.

Second, and this is enforced in code: **you cannot take a pot unless you have paid every round so
far.** When a member who is behind reaches the front of the queue, the contract passes over them,
emits a public `TurnMissed`, and hands the pot to the next person who kept up. They can pay their
arrears and become eligible again — one missed week is a lost turn, not an expulsion.

**How does money actually get in? Do you deposit?**

The shape is built, the provider is not. You tap **Top up**, enter an amount and your number,
and your balance goes up with a public receipt. Money comes in the way it already does, and you
never buy a coin — the chain holds the book, not the cash.

**The provider behind that button is a mock, and the app says so on the screen.** Connecting real
MTN MoMo needs a Bank of Ghana licence or a licensed partner, which is weeks of paperwork rather
than hours of code. Swapping it in means replacing one function and setting one secret.

**How would the app know the money arrived?**

The provider sends a signed message the moment a payment lands, and the relayer credits the
balance onchain. **That verification is real, not simulated:**

- HMAC-SHA256 over the exact raw request bytes, so a body altered after signing is refused
- a timing-safe comparison, so a signature can't be guessed a byte at a time
- a five-minute freshness window, so an old message can't be replayed
- a reference checked against the chain's own `Credited` events, so the same payment can't be
  credited twice even if the server restarts
- failed payments, bad amounts and malformed accounts refused outright

There are 18 tests on this path alone — forging a signature, tampering with a signed body,
signing with the wrong secret, replaying a stale payload. Try it yourself: POST a payload
claiming GHS 99,999 to `/api/momoWebhook` with a made-up signature and it returns
`400 webhook rejected`.

That arrangement is still an *oracle*, a bridge telling the chain about the real world, and the
uncomfortable part is that whoever tells the chain can lie to it. We shrank that trust rather
than removing it. Nobody here holds the cash, the book can't be edited, every credit is public
and dated with its provider reference, and the member keeps their own MoMo receipt to check
against. Proper fixes are multiple independent signers, and eventually web proofs (zkTLS).

**Who pays the transaction fees?**

Today, our relayer, out of a throwaway testnet account. In production, the same way the susu
collector already gets paid: traditionally about one day's contribution a month. On a cheap L2
a transaction costs a fraction of a pesewa, so the model doesn't need inventing. It needs
undercutting.

**What about people without smartphones?**

The real answer is USSD, the `*170#` menus that work on any phone with no internet, because
that's how Ghana already does mobile money. The honest tradeoff: a feature phone can't hold its
own key, so those members would rely on a server-held key confirmed by SMS. That's weaker
custody than the browser version, and worth it, because building smartphone-only means building
for the people who need this least.

**How do you explain this to someone's parents?**

You don't explain it. Nothing above needs to be said. "It's the same susu you already do, same
amounts, same people, same rounds. The book just can't be changed and nobody is holding the
cash." Then show them their name, their amount and the date, which is a passbook they've read
their whole life.

**Is there a group, and can I see what everyone put in?**

Yes. A circle has its own members, its own pot and its own order, and you can be in several at
once. The order view shows each member's position, whether they have paid this round, and who has
already taken their turn. The book shows every payment with its date, time and receipt.

**Who decides the payout order, and can they cheat it?**

Whoever starts the circle sets it, and members queue in join order. That is a trust point, so two
things constrain it: the order is public and locked before anybody pays a single cedi, and the
owner is bound by the same contribution rule as everyone else. A dishonest owner who puts
themselves first still has to keep paying every round or the contract skips them.

## Run it yourself

You need Node.js 18 or newer.

```bash
git clone https://github.com/Mutalib713/susu.git
cd susu
npm install
```

Make a `.env` file in the project root:

```
RELAYER_KEY=0xyour_test_private_key
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
CHAIN_ID=11155111
EXPLORER=https://sepolia.etherscan.io
```

The relayer key is a throwaway account holding a little Sepolia test ETH. Get some free from
[the Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
or [pk910's faucet](https://sepolia-faucet.pk910.de/). Never use a key that holds real money.

Then start it:

```bash
npm start
```

Open <http://localhost:8099>.

**To use the contract we already published**, do nothing. `build/deployment.json` already points
at it. **To publish your own copy:**

```bash
npm run compile
npm run deploy
```

## How the code is laid out

| Path | What it is |
|---|---|
| `contracts/Susu.sol` | The contract. Balances, the pot, signature checking, payouts. |
| `lib/handler.js` | The relayer. Takes signed notes and pays to put them onchain. |
| `public/index.html` | The whole app. One file, no build step, no framework. |
| `server.js` | Local server for running the demo. |
| `api/relay.js` | The same relayer, wrapped for hosting on Vercel. |
| `scripts/` | Compile, deploy, and generate a throwaway key. |

Deeper detail, architecture, and where this goes next: **[TECHNICAL.md](TECHNICAL.md)**.

## Licence

MIT.
