/**
 * Session upsert → existing sessionInbound → injected deliver
 * (handleIncomingMessage). No second processor. No Cloud webhook fake.
 */
import {
  ingestSessionUpsert,
  noteConnectionUpdate,
  noteProcessStart,
  noteProcessStop,
} from '../sessionInbound.js';

export function sessionInboundHandlers({ deliver, activated } = {}) {
  return {
    onStart() {
      noteProcessStart();
    },
    onStop() {
      noteProcessStop();
    },
    onConnection(update) {
      noteConnectionUpdate(update);
    },
    onUpsert(event) {
      return ingestSessionUpsert(event, {
        activated: Boolean(activated),
        deliver,
      });
    },
  };
}
