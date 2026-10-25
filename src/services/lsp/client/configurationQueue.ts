import type {LspClientBridge} from "./contracts";

const tails = new WeakMap<LspClientBridge, Promise<void>>();

/** Keep a context reset behind earlier sends and ahead of replacement metadata.
 * A rejected send must not poison subsequent configuration for this session. */
export function queueLspConfiguration(client: LspClientBridge, send: () => Promise<void>): Promise<void> {
  const previous = tails.get(client);
  const next = previous ? previous.catch(() => undefined).then(send) : send();
  tails.set(client, next);
  const release = () => { if (tails.get(client) === next) tails.delete(client); };
  void next.then(release, release);
  return next;
}
