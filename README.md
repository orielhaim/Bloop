# Bloop
**A peer-to-peer encrypted phone system where nobody - not even the server - knows who's calling whom.**

Ever wished you could make a phone call without some company sitting in the middle, logging everything, and selling your metadata to advertisers? Yeah, me too.

Bloop is a proof-of-concept that reimagines how phone calls could work. You get a number. You make calls. The calls are direct, encrypted, and private. The server? It's basically a dumb phone book. It knows your number and your public key. That's it. It doesn't route your calls, it doesn't know who you're talking to, and it certainly doesn't know what you're saying.

No accounts. No passwords. No email verification. No "we value your privacy" banners that mean the exact opposite. Just cryptography doing what cryptography was always supposed to do.

---

## How It Works

1. You get a **phone number** and an **activation code** (think of it like buying a SIM card)
2. Your device generates cryptographic key pairs - your identity lives on *your* device, not on a server
3. You activate your number by registering your public keys
4. Want to call someone? Your device encrypts a "ring" message that **only the recipient can open** and drops it on a public Nostr relay
5. The recipient's device picks it up, decrypts it, and shows an incoming call
6. If they answer, both devices join a private encrypted room via WebRTC
7. Voice flows directly between devices through a TURN relay - no server in the middle, no IP addresses exposed

The Nostr relay sees encrypted blobs. The TURN server sees encrypted audio. The phone book server sees... public keys. Nobody has the full picture. That's the point.

---

## The SIM Card Model

There are no usernames. No passwords. No email addresses. No OAuth. None of that.

Your identity is a pair of cryptographic keys stored securely in your browser. Think of it as a digital SIM card:

- **Ed25519 key pair** - for signing and proving you own your number
- **X25519 key pair** - for encrypting messages so only the intended recipient can read them

When you activate your number, you send the server your *public* keys. The private keys never leave your device. Ever. Authentication works through challenge-response: the server sends you a random string, you sign it with your private key, and the server verifies the signature against your registered public key. Simple, elegant, unforgeable.

Lose your keys? That's like losing your SIM card. You'll need a new number.

---

## The Call Flow

### Alice calls Bob

**Ring phase** (via Nostr relay - no P2P connection, no IP exposure):

1. Alice's device generates a random room ID and password
2. It fetches Bob's public encryption key from the phone book server
3. It encrypts the room details + Alice's number into a sealed envelope that only Bob can open
4. The envelope is published to a Nostr relay as an opaque blob

**Answer phase** (still via Nostr relay):

5. Bob's device is listening on the relay. It tries to decrypt every message with its private key
6. If decryption works → it's for Bob. If not → silently ignored
7. Bob's device fetches Alice's public keys and verifies the encrypted secret inside
8. Bob sees "Incoming call from Alice"
9. If Bob answers, both devices join the private room via trystero (WebRTC over TURN)

**Voice phase** (direct P2P through TURN - relay is no longer involved):

10. Audio streams flow directly between devices, end-to-end encrypted
11. Neither device knows the other's IP address (TURN relay handles routing)
12. Hang up → room is destroyed, all state is cleared

If Bob doesn't answer? Alice waits 30 seconds and gives up. She doesn't know if Bob's number exists, if he's online, or if he's ignoring her. That's a feature, not a bug.

---

## Security Properties

| Threat | Mitigation |
|---|---|
| **Impersonation** | Challenge-response with Ed25519. Can't fake a signature without the private key. |
| **Eavesdropping on calls** | WebRTC E2E encryption. TURN server sees only encrypted packets. |
| **IP address discovery** | `iceTransportPolicy: 'relay'` forces all WebRTC traffic through TURN. No direct connections ever. |
| **Number existence probing** | Server returns challenges for non-existent numbers too. Nostr messages for non-existent numbers just sit unread. No timing or response differences. |
| **Relay snooping** | All messages on Nostr are encrypted envelopes. Relay sees ciphertext only. |
| **Server compromise** | Server only has public keys. Attacker gets a phone book - useless without private keys. Can't make calls, can't intercept calls. |
| **Replay attacks** | Challenges are single-use with 60s expiry. Call rooms are UUIDs used once. |
| **MITM on key exchange** | Users register keys via activation codes distributed out-of-band. Server is trusted as phone book only. |

---

## Tech Stack

| Layer | Tech | Why |
|---|---|---|
| Server | Bun + Hono + bun:sqlite | Fast, minimal, single binary. SQLite because this is a phone book, not a social network. |
| Client | React | Reactive UI because why not. |
| Styling | Tailwind + DaisyUI | Looks decent without effort. This is a demo, not a design portfolio. |
| Crypto | Web Crypto API | Built into every browser and Bun. No dependencies. No "trust this npm package with your keys." |
| Signaling | Nostr (nostr-tools) | Decentralized message relay. No account needed. Hundreds of public relays. |
| Voice | trystero + WebRTC | P2P audio with automatic room management. |

---

## Getting Started

### Setup

```bash
git clone https://github.com/orielhaim/bloop.git
cd bloop

# Install dependencies
bun install

# Start the server
bun start
# Server running on http://localhost:3000
```

---

## FAQ

**Q: Is this production-ready?**
A: No. This is a proof-of-concept. Production would need rate limiting, key pinning, multiple relay fallbacks, proper TURN authentication, and probably a less cavalier attitude toward error handling.

**Q: Why not just use Signal?**
A: Signal is great. Use Signal. This project explores what a phone system looks like when the *server literally cannot know who's calling whom*. Signal's server still handles message routing. Here, the server is just a phone book.

**Q: What happens if I clear my browser storage?**
A: Your SIM is gone. Your number is gone. Just like throwing your SIM card in a lake. You'll need a new number.

**Q: Can I run my own Nostr relay?**
A: Absolutely. Change the relay URLs in the client config. Run [strfry](https://github.com/hoytech/strfry) or any other Nostr relay implementation. Now you control the entire stack.

**Q: Why not use Nostr keys directly as phone numbers?**
A: Because `npub1qf3z...` is not a phone number. People remember four digits, not 64 hex characters. The phone book server is the trade-off that makes the UX human.

**Q: What if two people call each other at the same time?**
A: Both see an incoming call. Both can answer. You end up in two separate call rooms talking to each other twice. It's chaotic and hilarious. Fixing this is left as an exercise for the reader.

---

## Contributing

PRs welcome. If you find a security issue, please open an issue (or DM me if it's critical). If you want to add video calling, group calls, or a fancy dialer animation - go for it.

---

## License

AGPLv3. Do whatever you want with it. If you build something cool, let me know.

---

*Built with stubbornness and an unreasonable distrust of servers.*