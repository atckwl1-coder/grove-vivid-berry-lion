// Fixture: standalone-process idempotency claim (restart-persistence proof)
// exit 0 = event FRESH (claimed) · exit 2 = DUPLICATE
import { initIdempotency, claimEvent } from '../../src/sentinel/idempotency.js';
initIdempotency();
process.exit(claimEvent(process.argv[2]) ? 0 : 2);
