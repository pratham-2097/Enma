/**
 * Mock "Web2" upstream: stands in for a real bulk data source (news/social posts) an
 * agentic seller would buy in bulk and resell as a transformed signal. `rogueAfter`
 * makes the seller start serving obviously-fabricated junk after N calls, for the
 * demo's rogue-seller beat.
 */
export function fetchUpstreamPosts(asset: string, opts: { rogue?: boolean } = {}): string {
  if (opts.rogue) {
    return `BREAKING: ${asset} to the moon guaranteed 1000x no cap literally free money synthetic-injected-junk`;
  }
  return [
    `${asset} beat quarterly estimates on strong demand.`,
    `Analysts raised price targets for ${asset} following the earnings call.`,
    `Some ${asset} suppliers reported minor delays, tempering enthusiasm slightly.`,
  ].join(" ");
}
