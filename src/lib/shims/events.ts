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
import EE from "events/events.js";

type EventEmitterCtor = typeof EE;

const Emitter: EventEmitterCtor =
  ((EE as unknown as { EventEmitter?: EventEmitterCtor }).EventEmitter ?? EE) as EventEmitterCtor;

// Node's module is self-referential; keep that shape for consumers that read
// `events.EventEmitter` off the default export.
(Emitter as unknown as { EventEmitter: EventEmitterCtor }).EventEmitter = Emitter;

export const EventEmitter = Emitter;
export const once = (EE as unknown as { once: unknown }).once;
export const on = (EE as unknown as { on: unknown }).on;
export const captureRejectionSymbol = (EE as unknown as { captureRejectionSymbol: unknown })
  .captureRejectionSymbol;
export const errorMonitor = (EE as unknown as { errorMonitor: unknown }).errorMonitor;
export const defaultMaxListeners = (EE as unknown as { defaultMaxListeners: unknown })
  .defaultMaxListeners;
export const setMaxListeners = (EE as unknown as { setMaxListeners: unknown }).setMaxListeners;
export const listenerCount = (EE as unknown as { listenerCount: unknown }).listenerCount;

export default Emitter;
