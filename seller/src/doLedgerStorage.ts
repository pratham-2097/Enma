import type { LedgerStorage } from "./ledger";

interface StoredRecord {
  servedValue: string;
  incidentCount: number;
  incidentValue: string;
}

/** LedgerStorage backed by a Durable Object's SQLite storage. */
export class DoLedgerStorage implements LedgerStorage {
  constructor(private readonly sql: SqlStorage) {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS ledger (
        payer TEXT PRIMARY KEY,
        served_value TEXT NOT NULL,
        incident_count INTEGER NOT NULL,
        incident_value TEXT NOT NULL
      )`,
    );
  }

  async get(payerKey: string) {
    const rows = [
      ...this.sql.exec("SELECT served_value, incident_count, incident_value FROM ledger WHERE payer = ?", payerKey),
    ] as { served_value: string; incident_count: number; incident_value: string }[];
    const row = rows[0];
    if (!row) return undefined;
    return {
      servedValue: BigInt(row.served_value),
      incidentCount: row.incident_count,
      incidentValue: BigInt(row.incident_value),
    };
  }

  async put(payerKey: string, value: { servedValue: bigint; incidentCount: number; incidentValue: bigint }) {
    const record: StoredRecord = {
      servedValue: value.servedValue.toString(),
      incidentCount: value.incidentCount,
      incidentValue: value.incidentValue.toString(),
    };
    this.sql.exec(
      `INSERT INTO ledger (payer, served_value, incident_count, incident_value) VALUES (?, ?, ?, ?)
       ON CONFLICT(payer) DO UPDATE SET
         served_value = excluded.served_value,
         incident_count = excluded.incident_count,
         incident_value = excluded.incident_value`,
      payerKey,
      record.servedValue,
      record.incidentCount,
      record.incidentValue,
    );
  }

  async delete(payerKey: string) {
    this.sql.exec("DELETE FROM ledger WHERE payer = ?", payerKey);
  }
}
