// ─────────────────────────────────────────────────────────────
//  MEDIA AI — voice notes (STT) + photo analysis (Vision AI)
//  Stubs only. Do NOT implement vision in this module.
//
//  SAFETY CONTRACT (DEBT-07):
//  Any future LLM-generated customer-facing output from text,
//  image, audio, or multimodal reasoning is UNTRUSTED. This
//  module may return text / structured analysis. It must NEVER
//  call whatsapp.sendText / sendButtons / outbox.enqueue.
//  The caller (brain.deliverModelOutput) is the only legal
//  customer-facing send path for that copy, and it runs
//  validateMonetaryReply first.
// ─────────────────────────────────────────────────────────────
import { config } from '../config.js';
import { downloadMedia } from './whatsapp.js';
import { log } from '../utils/logger.js';

async function stubTranscribeVoiceNote(mediaId) {
  if (!config.openaiKey || !mediaId) {
    log.info('[DEMO] Voice note aaya — STT key na hone ki wajah se skip');
    return null;
  }
  // TODO(phase-2): media download → Whisper API (language: ur) → text
  // Transcript is inbound customer text (untrusted). It is NOT sent
  // to the customer; brain.thinkAndReply generates the reply and that
  // reply is gated. Do not send STT output outbound.
  // const audio = await downloadMedia(mediaId);
  return null;
}

async function stubAnalyzePhonePhoto(mediaId, caption) {
  log.info(`[DEMO] Photo aayi (caption: "${caption}") — Vision AI phase-2 mein live hogi`);
  return (
    '📸 Photo mil gayi. Abhi automatic photo analysis available nahi — ' +
    'filhal model ka naam aur condition likh kar bhejein (maslan *trade a57 good*), ' +
    'main table se andazan exchange value bata deta hoon. Final value store par phone dekh kar confirm hogi. 🔄'
  );
}

/**
 * Future vision/STT implementations replace the function on this
 * object. They still MUST only return untrusted text. Sending is
 * brain's job. The mutable object is also the test seam.
 */
export const vision = {
  analyze: stubAnalyzePhonePhoto,
};
export const speech = {
  transcribe: stubTranscribeVoiceNote,
};

export async function transcribeVoiceNote(mediaId) {
  return speech.transcribe(mediaId);
}

export async function analyzePhonePhoto(mediaId, caption) {
  return vision.analyze(mediaId, caption);
}
