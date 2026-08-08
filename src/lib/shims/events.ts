/**
 * Browser shim for Node's `events`.
 *
 * WalletConnect's core does `import EE, { EventEmitter } from "events"`. In the
 * production client bundle the CJS→ESM interop for the `events` package loses
 * the named `EventEmitter` binding, so the connector blows up on
 * mobile Safari with `undefined is not a constructor (evaluating 'new
 * te.EventEmitter')`. Re-exporting explicitly from the package's real entry
 * file makes both the default and named shapes exist no matter how the module
 * is interop'd. EventEmitter3 has a native ESM build and implements the subset
 * of Node's emitter API used by Coinbase and WalletConnect.
 */
import EventEmitter3 from "eventemitter3";

const Emitter = EventEmitter3 as typeof EventEmitter3 & {
  EventEmitter?: typeof EventEmitter3;
};

// Node's module is self-referential; keep that shape for consumers that read
// `events.EventEmitter` off the default export.
Emitter.EventEmitter = Emitter;

export const EventEmitter = Emitter;
export const once = (emitter: EventEmitter3, event: string | symbol) =>
  new Promise<unknown[]>((resolve) => emitter.once(event, (...args: unknown[]) => resolve(args)));
export const on = (
  emitter: EventEmitter3,
  event: string | symbol,
  listener: (...args: unknown[]) => void,
) => emitter.on(event, listener);
export const captureRejectionSymbol = Symbol.for("nodejs.rejection");
export const errorMonitor = Symbol.for("events.errorMonitor");
export const defaultMaxListeners = 10;
export const setMaxListeners = () => undefined;
export const listenerCount = (emitter: EventEmitter3, event: string | symbol) =>
  emitter.listenerCount(event);

export default Emitter;
