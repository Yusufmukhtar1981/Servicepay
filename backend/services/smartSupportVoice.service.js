const axios = require("axios");
const { getProviderConfig } = require("./aiProvider.service");
const { clean } = require("./smartSupport.service");

const MAX_SECONDS = 30;
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const SPEECH_MODEL = "gpt-4o-mini-tts";
const fail = code => { throw Object.assign(new Error(code), { safeCode: code }); };

function decodeRecording(encoded) {
  if (typeof encoded !== "string" || encoded.length > 3900000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail("INVALID_RECORDING");
  const data = Buffer.from(encoded, "base64");
  if (data.length < 46 || data.toString("ascii", 0, 4) !== "RIFF" ||
      data.readUInt32LE(4) !== data.length - 8 ||
      data.toString("ascii", 8, 12) !== "WAVE" ||
      data.toString("ascii", 12, 16) !== "fmt " || data.readUInt32LE(16) !== 16 ||
      data.readUInt16LE(20) !== 1 || data.readUInt16LE(22) !== 1 ||
      data.readUInt16LE(34) !== 16 || data.readUInt16LE(32) !== 2 ||
      data.toString("ascii", 36, 40) !== "data" ||
      data.readUInt32LE(40) !== data.length - 44) fail("INVALID_RECORDING");
  const rate = data.readUInt32LE(24);
  if (![16000, 24000, 44100, 48000].includes(rate) || data.readUInt32LE(28) !== rate * 2 ||
      (data.length - 44) % 2 !== 0) fail("INVALID_RECORDING");
  const duration = (data.length - 44) / (rate * 2);
  if (duration < 0.15 || duration > MAX_SECONDS) fail("RECORDING_DURATION");
  return { data, duration };
}

function config() {
  const c = getProviderConfig();
  if (!c.apiKey || c.provider !== "openai" ||
      c.apiUrl !== "https://api.openai.com/v1/chat/completions") fail("VOICE_UNAVAILABLE");
  return c;
}
async function transcribe(data, language, requester = axios) {
  const c = config();
  const form = new FormData();
  form.append("file", new Blob([data], { type: "audio/wav" }), "support-voice.wav");
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", language);
  const result = await requester.post("https://api.openai.com/v1/audio/transcriptions", form, {
    timeout: 25000, headers: { Authorization: `Bearer ${c.apiKey}` },
    maxContentLength: 100000,
  });
  if (typeof result.data?.text !== "string" || !result.data.text.trim()) fail("EMPTY_TRANSCRIPTION");
  return clean(result.data.text, 2000);
}
async function speak(text, requester = axios) {
  const c = config();
  if (typeof text !== "string" || !text.trim() || text.length > 600) fail("SPEECH_TOO_LONG");
  const result = await requester.post("https://api.openai.com/v1/audio/speech", {
    model: SPEECH_MODEL, voice: "alloy", input: clean(text, 600), response_format: "mp3",
  }, {
    timeout: 25000, responseType: "arraybuffer", maxContentLength: 1500000,
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
  });
  const buffer = Buffer.from(result.data);
  if (buffer.length < 100 || !String(result.headers?.["content-type"] || "").startsWith("audio/")) fail("INVALID_SPEECH");
  return { audioBase64: buffer.toString("base64"), mimeType: "audio/mpeg", disclosure: "AI-generated voice, not a human support agent." };
}
module.exports = { MAX_SECONDS, TRANSCRIBE_MODEL, SPEECH_MODEL, decodeRecording, transcribe, speak };
