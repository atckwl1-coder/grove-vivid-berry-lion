// Fixture: REAL process crash mid-send — heartbeat likhta hai phir hang (SIGKILL target)
import fs from 'fs';
import { createOutbox } from '../../src/sentinel/outbox.js';

const ob = createOutbox({
  dir: process.env.CRASH_OB_DIR,
  sendFn: async () => {
    fs.writeFileSync(process.env.CRASH_HB, 'send-started'); // heartbeat = abhi dispatch ho raha tha
    await new Promise(() => {}); // hang — parent SIGKILL karega
  },
  auditFn: () => {},
  pollMs: 20,
  retry: { maxAttempts: 1, baseMs: 10, maxMs: 10 },
});
ob.start();
ob.enqueue({ messaging_product: 'whatsapp', to: '923001234567', type: 'text', text: { body: 'crash probe' } });

// FIX (found by failed test): outbox timer is unref'd by design; a naked fixture
// process has no other event-loop handle → Node exits before first tick.
// Server mein express loop alive rakhta hai; fixture ko apna keep-alive chahiye.
setInterval(() => {}, 5000);
