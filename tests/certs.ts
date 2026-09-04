/**
 * Test certificates, generated at test time.
 *
 * These used to be six committed `.pem` files. That was wrong twice over: it
 * put private key material in the repository, and it baked absolute expiry
 * dates into the test suite, so the "nearly expired" fixture would have gone
 * from *nearly* expired to *actually* expired and taken the suite red on a
 * date nobody had written down anywhere.
 *
 * Expiry here is relative to the moment the test runs, so the "expiring" case
 * is always about to expire and never has.
 */
import { generate } from "selfsigned";

const DAY_MS = 86_400_000;

export interface TestCert {
  cert: string;
  key: string;
}

interface CertSpec {
  /** Common name, and the only DNS name in the SAN. */
  commonName: string;
  /** Days from now until the certificate expires. */
  expiresInDays: number;
}

/**
 * P-256 rather than RSA: forge's RSA keygen takes seconds per key in pure JS,
 * and nothing here is testing key strength.
 */
async function makeCert({ commonName, expiresInDays }: CertSpec): Promise<TestCert> {
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate.getTime() + expiresInDays * DAY_MS);

  const pems = await generate([{ name: "commonName", value: commonName }], {
    keyType: "ec",
    curve: "P-256",
    algorithm: "sha256",
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: commonName }] },
    ],
  });

  return { cert: pems.cert, key: pems.private };
}

const SPECS = {
  /** Valid for years — the "nothing to worry about" case. */
  healthy: { commonName: "localhost", expiresInDays: 3650 },
  /**
   * Deliberately inside the warning window. 5.5 days so that
   * `Math.floor(daysRemaining)` is a stable 5 however long the suite takes.
   */
  expiring: { commonName: "localhost", expiresInDays: 5.5 },
  /** Correct in every way except the name, which is the point. */
  wrongname: { commonName: "other.example", expiresInDays: 3650 },
} satisfies Record<string, CertSpec>;

export type TestCertName = keyof typeof SPECS;

/**
 * Generated once per process and shared. Keygen is fast on P-256, but there is
 * no reason to pay for it three times in a file that starts three servers.
 */
const cache = new Map<TestCertName, Promise<TestCert>>();

export function testCert(name: TestCertName): Promise<TestCert> {
  let pending = cache.get(name);
  if (!pending) {
    pending = makeCert(SPECS[name]);
    cache.set(name, pending);
  }
  return pending;
}
