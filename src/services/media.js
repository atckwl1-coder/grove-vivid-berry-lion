// ─────────────────────────────────────────────────────────────
//  MEDIA AI — voice notes (STT) + photo analysis (Vision AI)
//  Abhi stubs hain: OpenAI key lagte hi Whisper/Vision live.
// ─────────────────────────────────────────────────────────────
import { config } from '../config.js';
import { downloadMedia } from './whatsapp.js';
import { log } from '../utils/logger.js';

// 🎤 Voice note → text (Urdu/Saraiki/Punjabi)
export async function transcribeVoiceNote(mediaId) {
  if (!config.openaiKey || !mediaId) {
    log.info('[DEMO] Voice note aaya — STT key na hone ki wajah se skip');
    return null;
  }
  // TODO(phase-2): media download → Whisper API (language: ur) → text
  // const audio = await downloadMedia(mediaId);
  return null;
}

// 📸 Photo → model identify / trade-in condition / price-match
// TODO(phase-2): GPT-4o / Claude vision ko image bhejo, structured JSON lo:
// { type: "tradein"|"pricematch"|"identify", model, condition, extracted_price }
export async function analyzePhonePhoto(mediaId, caption) {
  log.info(`[DEMO] Photo aayi (caption: "${caption}") — Vision AI phase-2 mein live hogi`);
  return (
    '📸 Photo mil gayi! Abhi mera vision system training par hai — ' +
    'filhal mujhe model ka naam aur condition likh kar bhejein (maslan *trade a57 good*), ' +
    'main fauran exchange value bata deta hoon! 🔄'
  );
}
