// functions/whatsapp.js
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const API_VERSION = "v20.0";

async function callGraphApi(token, body) {
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("WhatsApp Graph API Error:", res.status, await res.text());
    return { ok: false };
  }
  return { ok: true, data: await res.json() };
}

async function sendWhatsAppText({ token, to, body }) {
  if (!PHONE_NUMBER_ID || !token || !to) {
    console.warn("WhatsApp Text aborted: Missing required configuration.");
    return { ok: false, error: "missing config" };
  }
  return callGraphApi(token, { 
    messaging_product: "whatsapp", 
    to, 
    type: "text", 
    text: { body } 
  });
}

async function sendWhatsAppTemplate({ token, to, templateName, languageCode = "en", params = [] }) {
  if (!PHONE_NUMBER_ID || !token || !to) {
    console.warn("WhatsApp Template aborted: Missing required configuration.");
    return { ok: false, error: "missing config" };
  }
  return callGraphApi(token, {
    messaging_product: "whatsapp", 
    to, 
    type: "template",
    template: { 
      name: templateName, 
      language: { code: languageCode },
      components: params.length ? [{ 
        type: "body", 
        parameters: params.map((text) => ({ type: "text", text })) 
      }] : [] 
    },
  });
}

module.exports = { sendWhatsAppText, sendWhatsAppTemplate };