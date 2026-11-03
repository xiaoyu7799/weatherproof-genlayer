/* End-to-end claims loop against an already-deployed WeatherProof v2 contract.
 *
 * Usage:
 *   CONTRACT_ADDRESS=0x... GENLAYER_PRIVATE_KEY=0x... node scripts/flow-v2.mjs
 *   # or without a key: an ephemeral account is used (permissionless writes).
 *
 * Steps (London, 2025-10-01 — the day v1 record #0 already verified):
 *   1. create claim TRUE: precipitation_sum >= "0.1" -> settle -> settled_true, measured 0.1
 *   2. create claim FALSE: precipitation_sum >= "10" -> settle -> settled_false
 * Every transaction waits for FINALIZED. Writes evidence-v2.json (tx hashes,
 * final statuses, readbacks). No key is ever written to disk.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployment = JSON.parse(readFileSync(path.join(root, "deployment.json"), "utf-8"));
const address = process.env.CONTRACT_ADDRESS || deployment.contractAddress;
if (!address) throw new Error("No contract address: set CONTRACT_ADDRESS or run deploy-v2 first");

const account = createAccount(process.env.GENLAYER_PRIVATE_KEY || generatePrivateKey());
console.log("Flow account:", account.address);
console.log("Contract:", address);
const client = createClient({ chain: studionet, account });

const FINAL_NAMES = { 0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING", 4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED", 8: "CANCELED" };

async function waitFinal(hash, label) {
  console.log(`${label} tx:`, hash);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 180,
    interval: 5000,
  });
  const statusName = receipt.statusName ?? FINAL_NAMES[receipt.status] ?? String(receipt.status ?? "");
  console.log(`${label} final:`, statusName);
  if (statusName !== "FINALIZED") throw new Error(`${label} did not reach FINALIZED: ${statusName}`);
  return receipt;
}

async function readClaim(id) {
  const raw = await client.readContract({ address, functionName: "get_claim", args: [BigInt(id)] });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function runClaim(label, threshold, expectStatus) {
  const createTx = await client.writeContract({
    address,
    functionName: "create_claim",
    args: ["London", "51.5074", "-0.1278", "2025-10-01", "precipitation_sum", ">=", threshold, `milestone demo ${label}`],
    value: 0n,
    leaderOnly: false,
  });
  await waitFinal(createTx, `create ${label}`);
  const countRaw = await client.readContract({ address, functionName: "get_claim_count", args: [] });
  const id = Number(countRaw) - 1;
  const settleTx = await client.writeContract({
    address,
    functionName: "settle_claim",
    args: [BigInt(id)],
    value: 0n,
    leaderOnly: false,
  });
  await waitFinal(settleTx, `settle ${label}`);
  const claim = await readClaim(id);
  console.log(`${label} claim #${id}:`, JSON.stringify(claim));
  if (claim.status !== expectStatus) {
    throw new Error(`${label} claim settled to ${claim.status}, expected ${expectStatus}`);
  }
  return { id, createTxHash: createTx, settleTxHash: settleTx, claim };
}

const claimTrue = await runClaim("true", "0.1", "settled_true");
if (claimTrue.claim.measured_value !== 0.1) {
  throw new Error(`TRUE claim measured_value ${claimTrue.claim.measured_value}, expected 0.1`);
}
const claimFalse = await runClaim("false", "10", "settled_false");

const evidence = {
  network: "Stable Studionet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
  contractAddress: address,
  contractFile: "contracts/weatherproof_v2.py",
  contractSha256: deployment.contractSha256 ?? null,
  deployTxHash: deployment.deployTxHash ?? null,
  explorer: `https://explorer-studio.genlayer.com/address/${address}`,
  flowAccount: account.address,
  claims: {
    trueClaim: claimTrue,
    falseClaim: claimFalse,
  },
  scope: "Milestone demo loop only. All writes used an ephemeral in-memory script account on gasless Studionet; no adoption claim is made and no real user data is involved. The demo day (London 2025-10-01) is the same day v1 record #0 verified.",
  checkedAt: new Date().toISOString(),
};
writeFileSync(path.join(root, "evidence-v2.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log("Wrote evidence-v2.json");
