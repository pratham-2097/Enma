export interface LedgerStorage {
  get(key: string): Promise<PayerRecord | undefined>;
  put(key: string, value: PayerRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

interface PayerRecord {
  servedValue: bigint;
  incidentCount: number;
  incidentValue: bigint;
}

const MIN_INCIDENTS_TO_BAN = 2;
const UNCLAIMABLE_RATIO_TO_BAN = 0.5;

function emptyRecord(): PayerRecord {
  return { servedValue: 0n, incidentCount: 0, incidentValue: 0n };
}

function key(payer: string): string {
  return payer.toLowerCase();
}

/**
 * Tracks each payer's served vs. incident (revoked/unclaimable) value. A payer is
 * banned only once BOTH hold: at least 2 incidents (so one honest QA miss never
 * bans) AND incident value is at least half of served value.
 */
export class Ledger {
  constructor(private readonly storage: LedgerStorage) {}

  async recordServed(payer: string, amount: string): Promise<void> {
    const record = (await this.storage.get(key(payer))) ?? emptyRecord();
    record.servedValue += BigInt(amount);
    await this.storage.put(key(payer), record);
  }

  async recordIncident(payer: string, amount: string): Promise<void> {
    const record = (await this.storage.get(key(payer))) ?? emptyRecord();
    record.incidentCount += 1;
    record.incidentValue += BigInt(amount);
    await this.storage.put(key(payer), record);
  }

  async isBanned(payer: string): Promise<boolean> {
    const record = await this.storage.get(key(payer));
    if (!record || record.servedValue === 0n) return false;
    if (record.incidentCount < MIN_INCIDENTS_TO_BAN) return false;

    const ratio = Number(record.incidentValue) / Number(record.servedValue);
    return ratio >= UNCLAIMABLE_RATIO_TO_BAN;
  }

  /** Clears a payer's served/incident history entirely, un-banning them. Admin-only. */
  async reset(payer: string): Promise<void> {
    await this.storage.delete(key(payer));
  }
}
