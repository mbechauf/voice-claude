// The certificate the phone has to believe in.
//
// A phone will not give a web page the microphone unless the connection is secure, so
// this has to be HTTPS whatever else happens — and for a long time "whatever else
// happens" meant a certificate this Mac signed itself, covering the IP addresses it
// had on the day it was first made. That is where the warnings come from, and there
// are two separate ones hiding behind the same red screen:
//
//   · Opened by a *name* — a Tailscale name, the Mac's own name — nothing matches,
//     because the old certificate carried no names at all. Safari treats a name that
//     does not match far more harshly than an issuer it does not know, and asking it
//     once does not settle it.
//   · Opened by an address that has since changed. The certificate was written once
//     and then kept forever, so a new Wi-Fi network or a Tailscale that came up later
//     leaves it covering somewhere this machine no longer is.
//
// So: use a real certificate when there is one to be had, and when there is not, sign
// one that covers every name and address this machine currently answers to — and throw
// it away and sign again the moment that stops being true.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";

// Somewhere to keep what we make. Alongside, never mixed together: a certificate
// Tailscale issued and one we signed ourselves are different things with different
// lifetimes, and telling them apart later matters more than saving two filenames.
const OURS = { key: "key.pem", cert: "cert.pem" };
const TAILNET = { key: "tailnet.key", cert: "tailnet.crt" };

// A real certificate lasts ninety days and Tailscale renews it for us, but only if
// somebody asks. Asking is nearly free when the answer is already cached, so the only
// question is how close to the edge to leave it. A week is enough slack that a Mac
// left shut for a few days still comes up with a certificate that works.
const RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Every name and address this machine answers to, in the form OpenSSL wants.
 *
 * The point of collecting all of them is that you do not get to choose which one is
 * typed at it: the driving address is an IP, the handover is a Tailscale name, and the
 * Mac calls itself something else again on the local network. Any of them failing is
 * a red screen at the exact moment somebody is trying to start a drive.
 */
export function whatThisMachineAnswersTo() {
  const names = ["localhost", os.hostname().replace(/\.local$/, "")];
  names.push(`${names[1]}.local`);

  const full = tailnetName();
  if (full) names.push(full);

  return {
    names: [...new Set(names.filter(Boolean))],
    addresses: ["127.0.0.1", ...localAddresses()],
  };
}

/** The IPv4 addresses this Mac is reachable on, Tailscale's 100.x among them. */
export function localAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

let askedTheTailnet = false;
let knownTailnetName = null;

// Tailscale ships its command line inside the app on a Mac, which is not on anybody's
// PATH, so looking in one place and giving up would miss the common install.
function theTailscaleCommand() {
  const candidates = [
    process.env.VOICE_CLAUDE_TAILSCALE,
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
    "/usr/bin/tailscale",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * This machine's full Tailscale name, or null when there is no Tailscale here.
 *
 * The full one, deliberately. A short name is not what MagicDNS resolves and not what
 * any certificate will ever be issued for, so half-remembering it as the short one is
 * exactly the mistake that produces a warning nobody can get rid of.
 */
export function tailnetName() {
  // Asked more than once — the certificate wants it, and so does the line that tells
  // you what to open — and the answer cannot change under a running app in any way
  // that matters: the certificate was chosen at startup on the strength of it. So the
  // first answer stands until this restarts, which it does whenever anything changes.
  if (askedTheTailnet) return knownTailnetName;
  askedTheTailnet = true;

  const command = theTailscaleCommand();
  if (!command) return null;

  try {
    const raw = execFileSync(command, ["status", "--json"], { encoding: "utf8", timeout: 5_000 });
    const name = JSON.parse(raw)?.Self?.DNSName ?? "";
    knownTailnetName = name.replace(/\.$/, "") || null; // MagicDNS says it with a trailing dot
    return knownTailnetName;
  } catch {
    // Not running, not logged in, too old to know --json. All of them mean the same
    // thing here — there is no Tailscale name to be had — and none of them are worth
    // a line on the way past.
    return null;
  }
}

// What a certificate on disk actually covers, or null if it cannot be read.
function whatItCovers(file) {
  try {
    const parsed = new X509Certificate(fs.readFileSync(file));
    const covers = (parsed.subjectAltName ?? "").split(",").map((part) => part.trim());
    return {
      names: covers.filter((c) => c.startsWith("DNS:")).map((c) => c.slice(4)),
      addresses: covers.filter((c) => c.startsWith("IP Address:")).map((c) => c.slice(11)),
      expiresAt: new Date(parsed.validTo).getTime(),
    };
  } catch {
    return null;
  }
}

const stillGoodFor = (covering, now, slack = 0) =>
  Boolean(covering) && covering.expiresAt - now > slack;

/**
 * A certificate to serve with, and enough about it to say something true afterwards.
 *
 * Three ways to get one, in the order of how few warnings they cause. Each says out
 * loud why it fell through to the next: a certificate quietly not being the one you
 * set up is the same red screen as before with no explanation attached.
 */
export function theCertificate({ dir, say = () => {}, now = Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const wanted = whatThisMachineAnswersTo();

  return (
    oneYouSuppliedYourself({ say }) ??
    oneTailscaleIssued({ dir, say, now, full: wanted.names.find((n) => n.endsWith(".ts.net")) }) ??
    oneWeSignOurselves({ dir, say, now, wanted })
  );
}

// Set both and they are used exactly as given, including a certificate from somewhere
// this code has never heard of. Set one, and saying nothing would mean silently
// ignoring a deliberate act of configuration.
function oneYouSuppliedYourself({ say }) {
  const cert = process.env.VOICE_CLAUDE_CERT;
  const key = process.env.VOICE_CLAUDE_KEY;
  if (!cert && !key) return null;

  if (!cert || !key) {
    // Named both ways round, because the useful half of this sentence is the one that
    // is missing: a certificate without its key is not a thing that can be served.
    const [set, missing] = cert ? ["CERT", "KEY"] : ["KEY", "CERT"];
    say(`VOICE_CLAUDE_${set} is set but VOICE_CLAUDE_${missing} is not, so neither is used.`);
    return null;
  }

  try {
    const loaded = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
    const covering = whatItCovers(cert);
    say(`Certificate: the one you set, covering ${(covering?.names ?? []).join(", ") || "no names"}.`);
    return { ...loaded, kind: "yours", covers: covering, warns: false };
  } catch (err) {
    say(`Couldn't read the certificate you set: ${err.message}`);
    return null;
  }
}

/**
 * The real one, if this machine is on a tailnet with HTTPS switched on.
 *
 * Tailscale issues a genuine certificate for the machine's full name, which is the
 * only arrangement here where the phone never warns at all — worth having for its own
 * sake, and worth more than that because Safari is meaningfully less willing to hand
 * over the microphone on a connection it has been told to distrust.
 */
function oneTailscaleIssued({ dir, say, now, full }) {
  if (!full) return null;

  const certFile = path.join(dir, TAILNET.cert);
  const keyFile = path.join(dir, TAILNET.key);
  const held = whatItCovers(certFile);

  // Already have one, issued for this name, with time left on it. Asking Tailscale
  // again would be answered from its own cache anyway, but doing it every start makes
  // starting up wait on the network for no gain.
  if (held?.names.includes(full) && stillGoodFor(held, now, RENEW_WITHIN_MS)) {
    say(`Certificate: Tailscale's, for ${full}. No warning on the phone.`);
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), kind: "tailnet", covers: held, warns: false };
  }

  const command = theTailscaleCommand();
  if (!command) return null;

  try {
    execFileSync(command, ["cert", "--cert-file", certFile, "--key-file", keyFile, full], {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // Overwhelmingly this is HTTPS not being switched on for the tailnet, which is a
    // setting in the admin console and not something this app can do for you. Say
    // which of the two it is rather than printing a stack trace at somebody who is
    // about to get in a car.
    const complaint = (err.stderr ?? err.stdout ?? err.message ?? "").toString().trim();
    say(
      /HTTPS|not enabled|not available/i.test(complaint)
        ? `Tailscale won't issue a certificate until HTTPS is switched on for your tailnet (admin console, Settings, Features).`
        : `Tailscale couldn't issue a certificate: ${complaint.split("\n").pop()}`,
    );
    return null;
  }

  const issued = whatItCovers(certFile);
  if (!issued) return null;

  say(`Certificate: Tailscale's, for ${full}. No warning on the phone.`);
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), kind: "tailnet", covers: issued, warns: false };
}

/**
 * Ours, covering everywhere this machine currently is.
 *
 * The part that matters is the second half of that sentence. The old one was written
 * once and kept forever, so it went on claiming the address the Mac had on the day it
 * was made — and a certificate for somewhere you are not is indistinguishable, from
 * the phone, from an attack. Signing a new one costs a moment at startup and nothing
 * else, so anything less than a complete match is thrown away.
 */
function oneWeSignOurselves({ dir, say, now, wanted }) {
  const certFile = path.join(dir, OURS.cert);
  const keyFile = path.join(dir, OURS.key);
  const held = whatItCovers(certFile);

  const missing = [
    ...wanted.names.filter((n) => !(held?.names ?? []).includes(n)),
    ...wanted.addresses.filter((a) => !(held?.addresses ?? []).includes(a)),
  ];

  if (fs.existsSync(keyFile) && !missing.length && stillGoodFor(held, now)) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), kind: "ours", covers: held, warns: true };
  }

  if (held && missing.length) {
    say(`The certificate here didn't cover ${missing.join(", ")} — signing a new one.`);
  }

  const alt = [
    ...wanted.addresses.map((a) => `IP:${a}`),
    ...wanted.names.map((n) => `DNS:${n}`),
  ].join(",");

  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyFile, "-out", certFile,
    "-days", "825", "-subj", "/CN=voice-claude",
    "-addext", `subjectAltName=${alt}`,
  ], { stdio: ["ignore", "ignore", "pipe"] });

  say(`Certificate: this Mac's own, covering ${wanted.names.join(", ")}.`);
  return {
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile),
    kind: "ours",
    covers: whatItCovers(certFile),
    warns: true,
  };
}
