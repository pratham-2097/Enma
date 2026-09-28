import type { Channel, ChannelStorage, ChannelUpdateResult } from "@x402/evm/batch-settlement/server";

/**
 * ChannelStorage backed by a Durable Object's SQLite storage.
 *
 * `updateChannel`'s read-modify-write must be atomic even under concurrent calls within
 * the same DO instance: `sql.exec` itself is synchronous, so a read immediately followed
 * by a write with no `await` between them can't be interleaved by another JS task. Queuing
 * each call behind the previous one (via `queue`) additionally serializes the *callback*
 * itself, since `update()` may be async and awaiting inside it would otherwise let a second
 * call's synchronous read/write pair run in between.
 */
export class DoChannelStorage implements ChannelStorage {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly sql: SqlStorage) {
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS channels (
        channel_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )`,
    );
  }

  private readSync(channelId: string): Channel | undefined {
    const rows = [
      ...this.sql.exec("SELECT data FROM channels WHERE channel_id = ?", channelId),
    ] as { data: string }[];
    return rows[0] ? (JSON.parse(rows[0].data) as Channel) : undefined;
  }

  async get(channelId: string): Promise<Channel | undefined> {
    return this.readSync(channelId);
  }

  async list(): Promise<Channel[]> {
    const rows = [...this.sql.exec("SELECT data FROM channels")] as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Channel);
  }

  async updateChannel(
    channelId: string,
    update: (current: Channel | undefined) => Channel | undefined,
  ): Promise<ChannelUpdateResult> {
    const run = async (): Promise<ChannelUpdateResult> => {
      const current = this.readSync(channelId);
      const next = update(current);

      if (next === undefined) {
        if (current === undefined) {
          return { channel: undefined, status: "unchanged" };
        }
        this.sql.exec("DELETE FROM channels WHERE channel_id = ?", channelId);
        return { channel: undefined, status: "deleted" };
      }

      if (current !== undefined && next === current) {
        return { channel: current, status: "unchanged" };
      }

      this.sql.exec(
        "INSERT INTO channels (channel_id, data) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET data = excluded.data",
        channelId,
        JSON.stringify(next),
      );
      return { channel: next, status: "updated" };
    };

    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
