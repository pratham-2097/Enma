// Demo-prep utility: run this before any rehearsal so both sellers start from a known,
// unrevoked state (see src/restoreSellers.ts for why this is needed).
//   npx tsx scripts/restoreSellers.ts
import "dotenv/config";
import { baseSepolia } from "viem/chains";
import type { Address, Hex } from "viem";
import { restoreIfRevoked, type RestoreTarget } from "../src/restoreSellers";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

async function main() {
  const RPC_URL = requireEnv("RPC_URL");
  const GUARD_ADDRESS = requireEnv("ENMA_GUARD_ADDRESS") as Address;
  const guardianPrivateKey = requireEnv("GUARDIAN_PRIVATE_KEY") as Hex;

  const enma = process.env.ENMA_RECEIVER_ADDRESS as Address | undefined;
  const rogue = process.env.ROGUE_RECEIVER_ADDRESS as Address | undefined;
  const targets: RestoreTarget[] = [];
  if (enma) targets.push({ label: "enma", address: enma });
  if (rogue) targets.push({ label: "rogue", address: rogue });
  if (targets.length === 0) {
    throw new Error("neither ENMA_RECEIVER_ADDRESS nor ROGUE_RECEIVER_ADDRESS is set");
  }

  await restoreIfRevoked(baseSepolia, RPC_URL, GUARD_ADDRESS, guardianPrivateKey, targets);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
