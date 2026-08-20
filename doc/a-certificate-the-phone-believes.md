# A certificate the phone believes

## The problem it solves

A phone will not give a web page the microphone over an insecure connection, so this
app has always served HTTPS with a certificate the Mac signed for itself. The README
said Safari warns *the first time*. In practice it warned every time, and the warning
was not one thing but two, wearing the same red screen.

**It carried no names.** The certificate covered IP addresses and `localhost`, nothing
else. So the moment the address you typed was a name — the Mac's own, or a Tailscale
one — the certificate was for somewhere else entirely. A name that does not match is a
much more serious complaint to a browser than an issuer it happens not to know: it is
what an interception looks like, and Safari does not let you settle it once and forget
it the way it does an unknown issuer.

**It was written once and kept forever.** The file existed, so nothing was ever made
again. A new wifi network, or a Tailscale that came up after the first run, left it
claiming an address this Mac no longer had — while the address you were actually
opening was in no certificate at all.

Both failures point the same way: the certificate described the machine as it was on
one particular afternoon, and nothing ever checked whether that was still true.

## What it does now

Three sources, tried in the order of how little they make the phone complain, and the
one you got is said in the startup banner rather than left to be inferred from whether
you were shouted at.

1. **One you supplied** — `VOICE_CLAUDE_CERT` and `VOICE_CLAUDE_KEY`. Both or neither.
   Half a pair is somebody having set this up and it not having taken, and the whole
   point of this change is that a certificate quietly not being the one you arranged
   looks exactly like the bug it replaced.
2. **Tailscale's.** On a tailnet, ask Tailscale for a real certificate for the
   machine's full MagicDNS name. This is the only arrangement here where the phone
   never warns at all.
3. **Ours**, covering every name and address the machine currently answers to.

## Why Tailscale is the one worth having

Not neatness. Safari is measurably less willing to hand over the microphone on a
connection it has been told to distrust, and the microphone is the entire app. A
warning you have accepted is also a thing you have taught yourself to click through,
on a phone, in a car — which is the wrong habit to be training.

It also fixes the address problem rather than papering over it. A tailnet name is the
same wherever the Mac is; the local IP address is not, and the whole reason this app
prints several addresses is that none of them is reliable. So when there is a tailnet
name it is printed first, and the IP addresses are demoted to what they are: a way in
for a phone that cannot resolve the name.

Two things follow that are worth saying out loud, because both are places people
reasonably guess wrong:

- **The full name, always.** `mac.tailnet-name.ts.net`, not `mac`. The short one is
  not what MagicDNS resolves, and no certificate is ever issued for it.
- **By IP it still warns, and always will.** No public certificate authority will put
  an IP address in a certificate. This is not something left unfinished.

Tailscale will not issue anything until HTTPS is switched on for the tailnet, which is
a setting in a web console and not something this end can do for you. So that refusal
is recognised and named — the console, the section, the switch — rather than printed
as whatever Tailscale said and left for you to search for.

## The rule underneath

Anything less than a complete match with where this machine is *now* is thrown away and
signed again. Not "if the file is missing", which is what it used to be, and which is
the condition under which the stale certificate survived for months.

That costs a moment at startup and one tap on the phone to re-accept. The alternative
is what it replaced: a certificate that is correct about a Wi-Fi network you were on in
June. The one thing deliberately *not* done is signing a new one on every start —
acceptance on the phone is the only thing a self-signed certificate has going for it,
and throwing it away for tidiness would be worse than the bug.

## What is checked

In `npm run check`, against a stood-in Tailscale so the tailnet paths are exercised on
a machine that has never heard of Tailscale:

- the certificate covers the Mac's own name, `name.local`, and every address it can be
  reached on;
- one that still fits is kept rather than replaced, so the tap on the phone survives;
- one that no longer covers where the machine is gets signed again — the actual bug;
- so does one that has run out, asked as of a date past its end rather than by waiting
  825 days;
- a supplied pair is used as given, and half a pair is said out loud;
- a Tailscale certificate is taken for the full name, trailing dot removed;
- a tailnet with HTTPS switched off is told which switch, and the certificate it falls
  back to still covers the Tailscale name — because that is the address somebody on a
  tailnet is going to type, warning or no warning.
