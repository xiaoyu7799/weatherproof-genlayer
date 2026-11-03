/* Deploy WeatherProof v2 (claims) to Stable Studionet (chain 61999) only.
 *
 * Usage:
 *   GENLAYER_PRIVATE_KEY=0x... node scripts/deploy-v2.mjs
 *   # or, for a throwaway test deployer (Studionet is gasless, 0 GEN):
 *   node scripts/deploy-v2.mjs
 *
 * The private key is NEVER written to disk or to deployment.json. If no
 * key is supplied, an ephemeral key is generated for this run only; the
 * contract is permissionless, so losing that key loses nothing.
 *
 * BEFORE overwriting deployment.json, the current (v1) record is copied
 * to deployment-v1.json, so the v1 deployment is never lost. deployment.json
 * always holds the CURRENT contract: the GitHub Pages workflow reads the
 * contract address from it at build time.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codePath = path.join(root, "contracts", "weatherproof_v2.py");
const code = readFileSync(codePath, "utf-8");

const deploymentPath = path.join(root, "deployment.json");
const v1Path = path.join(root, "deployment-v1.json");
if (existsSync(deploymentPath) && !existsSync(v1Path)) {
  copyFileSync(deploymentPath, v1Path);
  console.log("Preserved previous deployment record as deployment-v1.json");
}

const suppliedKey = process.env.GENLAYER_PRIVATE_KEY;
const privateKey = suppliedKey || generatePrivateKey();
if (!suppliedKey) {
  console.log("No GENLAYER_PRIVATE_KEY supplied: using an ephemeral deployer key for this run only.");
}
const account = createAccount(privateKey);
console.log("Deployer:", account.address);
console.log("Network: Stable Studionet, chain 61999, https://studio.genlayer.com/api");

const client = createClient({ chain: studionet, account });
const txHash = await client.deployContract({ code, args: [], leaderOnly: false });
console.log("Deploy tx:", txHash);

const receipt = await client.waitForTransactionReceipt({
  hash: txHash,
  status: TransactionStatus.FINALIZED,
  retries: 180,
  interval: 5000,
});
console.log("Receipt status:", receipt.status, receipt.statusName ?? "");
if (receipt.statusName !== "FINALIZED" && receipt.status !== 7) {
  throw new Error(`Deploy did not reach FINALIZED (status ${receipt.status} / ${receipt.statusName ?? ""})`);
}
if (receipt.execution_result !== undefined && receipt.execution_result !== "SUCCESS" && receipt.execution_result !== "success") {
  const data = receipt?.data ?? receipt?.txDataDecoded ?? {};
  console.log("Receipt data:", JSON.stringify(data).slice(0, 2000));
  throw new Error(`Deploy execution was not SUCCESS: ${receipt.execution_result}`);
}

const address =
  receipt?.data?.contract_address ??
  receipt?.txDataDecoded?.contractAddress ??
  receipt?.contractAddress ??
  null;
if (!address) {
  console.log("Full receipt (no private key):", JSON.stringify(receipt, null, 2).slice(0, 4000));
  throw new Error("Could not find contract address in deploy receipt");
}
console.log("Contract address:", address);

const deployment = {
  network: "Stable Studionet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
  explorer: `https://explorer-studio.genlayer.com/address/${address}`,
  studio: `https://studio.genlayer.com/?import-contract=${address}`,
  contractAddress: address,
  deployTxHash: txHash,
  deployer: account.address,
  contractFile: "contracts/weatherproof_v2.py",
  contractSha256: createHash("sha256").update(code).digest("hex"),
  deployedAt: new Date().toISOString(),
  receiptStatus: receipt.statusName ?? ({ 0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING", 4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED", 8: "CANCELED" }[receipt.status] ?? String(receipt.status ?? "")),
  previousVersion: {
    contractFile: "contracts/weatherproof.py",
    record: "deployment-v1.json",
    note: "v1 attestation records remain readable on the v1 contract",
  },
};
writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2) + "\n");
console.log("Wrote deployment.json (v2)");
