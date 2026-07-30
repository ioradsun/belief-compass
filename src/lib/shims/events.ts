/**
 * Browser shim for Node's `events`.
 *
 * WalletConnect's core does `import EE, { EventEmitter } from "events"`. In the
 * production (rolldown) client bundle the CJS→ESM interop for the `events`
 * package loses the named `EventEmitter` binding, so the connector blows up on
 * mobile Safari with `undefined is not a constructor (evaluating 'new
 * te.EventEmitter')`. Re-exporting explicitly from the package's real entry
 * file makes both the default and named shapes exist no matter how the module
 * is interop'd.
 */
// @ts-expect-error — deep path into the `events` package has no type declarations.
import EE from "events/events.js";

const mod = EE as unknown as Record<string, unknown>;
const Emitter = (mod.EventEmitter ?? EE) as unknown as {
  new (): unknown;
  EventEmitter?: unknown;
};

// Node's module is self-referential; keep that shape for consumers that read
// `events.EventEmitter` off the default export.
Emitter.EventEmitter = Emitter;

export const EventEmitter = Emitter;
export const once = mod.once;
export const on = mod.on;
export const captureRejectionSymbol = mod.captureRejectionSymbol;
export const errorMonitor = mod.errorMonitor;
export const defaultMaxListeners = mod.defaultMaxListeners;
export const setMaxListeners = mod.setMaxListeners;
export const listenerCount = mod.listenerCount;

export default Emitter;
