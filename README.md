# Susu

**A group savings box where everybody can see every cedi, and nobody has to know what a blockchain is.**

EAG Ghana Hackathon 2026 · Ghana Track · Built in one afternoon in Kumasi.

**Try it: https://susu-dpbrw08ny-mutalib.vercel.app**

Live contract: [`0xe66CEB8f1791ab5BAC2ce49299fD6731dfc633d9`](https://sepolia.etherscan.io/address/0xe66CEB8f1791ab5BAC2ce49299fD6731dfc633d9) on Ethereum Sepolia.

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

- Sign in with an email. An account opens on the public chain in about ten seconds.
- New members get GHS 500 of demo money so anyone can try it immediately.
- Put money into the group box. Pick 10, 20, 50, or type your own amount.
- Watch the box fill up, and see exactly who has put in what.
- Pay the whole pot out to whoever's turn it is this round.
- Open the receipts drawer to see every action on the public record.

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
selling something. What changes is the consequence. Today a defaulter takes the pot, stops
paying, and joins a different susu two streets over where nobody knows. Here the record is
permanent and public, so it travels with them. Next contract change is eligibility by history:
you must have contributed several rounds before you can take a pot, which is how careful groups
already order people. **The current version does not handle this yet.** Payout is operator-
triggered with no eligibility rules.

**How does money actually get in? Do you deposit?**

Right now, no. New members are handed GHS 500 of demo money by the relayer. Nothing real moves.

The real version is mobile money in, mobile money out. You send to the group's number the way
you already send MoMo to anyone, and your balance goes up. Payout comes back to your number. You
never buy a coin. The chain holds the book and the rules, not the cash. The reason this isn't
built is a Bank of Ghana licence or a licensed partner, which is weeks of paperwork rather than
an afternoon of code.

**How would the app know the money arrived?**

The payment provider sends an automatic signed message the moment a payment lands, and the
relayer credits the balance. That mechanism is called an *oracle*, a bridge that tells the chain
about something that happened in the real world. The uncomfortable part: whoever tells the chain
can lie to it. We shrank that trust rather than removing it. Nobody here holds the cash, the book
can't be edited, every credit is public and dated, and the member keeps their own MoMo receipt to
check against. Proper fixes are multiple independent signers, and eventually web proofs (zkTLS).

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

Yes. The ledger shows every member and their total, and the book shows every contribution with
its date, time and receipt. What doesn't exist yet is *multiple* groups. Right now there is one
box. Group creation and invites are on the roadmap.

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
