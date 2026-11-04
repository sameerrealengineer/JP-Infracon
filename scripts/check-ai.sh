#!/usr/bin/env bash
# Checks, on the Azure server, everything AI voice, bill scan and document upload depend on.
#   bash scripts/check-ai.sh
# Prints only yes/no and HTTP status codes; never a key or any company data.
set -euo pipefail
HOST="${JP_DEPLOY_HOST:-jpadmin@jpinfracon.centralindia.cloudapp.azure.com}"

ssh "$HOST" 'cd ~/jp-infracon/deploy && docker compose exec -T api node --input-type=module -e "
const env = process.env;
const say = (label, value) => console.log(label.padEnd(34), value);
say(\"GEMINI_API_KEY set\", env.GEMINI_API_KEY ? \"yes\" : \"NO\");
say(\"SARVAM_API_KEY set\", env.SARVAM_API_KEY ? \"yes\" : \"NO\");
say(\"GEMINI_MODEL\", env.GEMINI_MODEL || \"(default gemini-3.8-flash)\");
if (env.GEMINI_API_KEY) {
  const r = await fetch(\"https://generativelanguage.googleapis.com/v1beta/models?pageSize=200\", { headers: { \"x-goog-api-key\": env.GEMINI_API_KEY } });
  say(\"Gemini key accepted\", r.ok ? \"yes\" : \"NO (HTTP \" + r.status + \")\");
  if (r.ok) {
    const names = ((await r.json()).models || []).map((m) => m.name.replace(\"models/\", \"\"));
    const model = env.GEMINI_MODEL || \"gemini-3.8-flash\";
    say(\"Gemini model available\", names.includes(model) ? \"yes (\" + model + \")\" : \"NO: \" + model + \" not in list\");
    say(\"Embedding model available\", names.includes(\"gemini-embedding-2\") ? \"yes\" : \"NO\");
    say(\"Flash models offered\", names.filter((n) => /flash/.test(n) && !/lite|image|tts|live|audio/.test(n)).slice(0, 6).join(\", \"));
  }
}
if (env.SARVAM_API_KEY) {
  const r = await fetch(\"https://api.sarvam.ai/text-to-speech\", { method: \"POST\", headers: { \"api-subscription-key\": env.SARVAM_API_KEY, \"Content-Type\": \"application/json\" }, body: JSON.stringify({ text: \"Namaste\", language_code: \"hi-IN\", model: \"bulbul:v3\", speaker: \"priya\", output_audio_codec: \"mp3\" }) });
  say(\"Sarvam voice (TTS) works\", r.ok ? \"yes\" : \"NO (HTTP \" + r.status + \")\");
}
const model = env.GEMINI_MODEL || \"gemini-3.8-flash\";
const g = (body) => fetch(\"https://generativelanguage.googleapis.com/v1beta/models/\" + model + \":generateContent\", { method: \"POST\", headers: { \"x-goog-api-key\": env.GEMINI_API_KEY, \"Content-Type\": \"application/json\" }, body: JSON.stringify(body) });
const err = async (r) => { try { const j = await r.json(); return \"HTTP \" + r.status + \": \" + String(j.error?.message || \"\").slice(0, 140); } catch { return \"HTTP \" + r.status; } };
if (env.GEMINI_API_KEY) {
  const r = await g({ contents: [{ role: \"user\", parts: [{ text: \"Reply with {\\\"ok\\\": true}\" }] }], generationConfig: { responseMimeType: \"application/json\", responseSchema: { type: \"object\", properties: { ok: { type: \"boolean\" } }, required: [\"ok\"] } } });
  say(\"Gemini JSON answer (assistant)\", r.ok ? \"yes\" : \"NO \" + await err(r));
  const r2 = await g({ contents: [{ role: \"user\", parts: [{ text: \"Name the colour of the left half in one word.\" }, { inline_data: { mime_type: \"image/png\", data: \"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALklEQVR4nO3NQQkAAAgEMJNcEvunMIwZfAqD/VeTnKTnpAQCgUAgEAgEAsGXYAHPA5w9DhJY2AAAAABJRU5ErkJggg==\" } }] }], generationConfig: { responseMimeType: \"application/json\", responseSchema: { type: \"object\", properties: { left: { type: \"string\" } }, required: [\"left\"] } } });
  say(\"Gemini reads a photo (bill scan)\", r2.ok ? \"yes: \" + ((await r2.json()).candidates?.[0]?.content?.parts?.[0]?.text || \"\").slice(0, 40) : \"NO \" + await err(r2));
  const r3 = await fetch(\"https://generativelanguage.googleapis.com/v1beta/interactions\", { method: \"POST\", headers: { \"x-goog-api-key\": env.GEMINI_API_KEY, \"Content-Type\": \"application/json\" }, body: JSON.stringify({ model, input: [{ type: \"text\", text: \"Say ok\" }] }) });
  say(\"Gemini Interactions API\", r3.ok ? \"yes\" : \"no (falls back) \" + r3.status);
}
if (env.SARVAM_API_KEY) {
  const t = await fetch(\"https://api.sarvam.ai/text-to-speech\", { method: \"POST\", headers: { \"api-subscription-key\": env.SARVAM_API_KEY, \"Content-Type\": \"application/json\" }, body: JSON.stringify({ text: \"Aaj first floor par plaster ka kaam hua\", language_code: \"hi-IN\", model: \"bulbul:v3\", speaker: \"priya\", output_audio_codec: \"mp3\" }) });
  if (t.ok) {
    const audio = Buffer.from(((await t.json()).audios || []).join(\"\"), \"base64\");
    for (const [label, mime, name] of [[\"mp3\", \"audio/mpeg\", \"note.mpeg\"], [\"as phone m4a name\", \"audio/mp4\", \"note.mp4\"]]) {
      const form = new FormData();
      form.append(\"file\", new Blob([audio], { type: mime }), name);
      form.append(\"model\", env.SARVAM_STT_MODEL || \"saaras:v4\");
      form.append(\"language_code\", \"unknown\");
      form.append(\"keyterms\", JSON.stringify([\"DPR\", \"plaster\"]));
      const s = await fetch(\"https://api.sarvam.ai/speech-to-text\", { method: \"POST\", headers: { \"api-subscription-key\": env.SARVAM_API_KEY }, body: form });
      say(\"Sarvam voice to text (\" + label + \")\", s.ok ? \"yes: \" + ((await s.json()).transcript || \"(empty)\").slice(0, 50) : \"NO \" + await err(s));
    }
  }
}
const fs = await import(\"node:fs/promises\");
const dir = env.STORAGE_DIR;
if (dir) {
  try { const f = dir + \"/.write-check\"; await fs.writeFile(f, \"ok\"); await fs.rm(f); say(\"File storage writable\", \"yes (\" + dir + \")\"); }
  catch (e) { say(\"File storage writable\", \"NO: \" + e.code); }
} else say(\"File storage\", env.S3_BUCKET ? \"S3/R2\" : \"NOT SET (STORAGE_DIR or S3_*)\");
say(\"PUBLIC_BASE_URL set\", env.PUBLIC_BASE_URL ? \"yes\" : \"NO\");
"'
