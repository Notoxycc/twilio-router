const express = require("express");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));

const RETELL_AGENT_ID = process.env.RETELL_AGENT_ID || "agent_07c85b3b7b299302b93035ac53";
const RETELL_API_KEY = process.env.RETELL_API_KEY;

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

// ========== LLAMADA INICIAL ==========
app.post("/", (req, res) => {
  console.log("📞 LLAMADA ENTRANTE");
  console.log("De:", req.body.From);
  console.log("A:", req.body.To);
  console.log("CallSid:", req.body.CallSid);
  
  const twiml = new twilio.twiml.VoiceResponse();
  const baseUrl = getBaseUrl(req);

  const dial = twiml.dial({
    timeout: 15,
    action: `${baseUrl}/fallback`,
    method: "POST"
  });

  dial.sip("sip:west-2.sip.calltools.io:5060");

  res.type("text/xml").send(twiml.toString());
});

// ========== FALLBACK ==========
app.post("/fallback", async (req, res) => {
  const dialStatus = req.body.DialCallStatus;
  
  console.log("🔄 FALLBACK EJECUTADO");
  console.log("DialCallStatus:", dialStatus);

  if (dialStatus === "completed") {
    console.log("✅ CallTools contestó");
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  if (["no-answer", "busy", "failed", "canceled"].includes(dialStatus)) {
    console.log("🤖 Transfiriendo a Retell AI...");

    try {
      if (!RETELL_API_KEY) {
        throw new Error("Falta RETELL_API_KEY");
      }

      // ✅ CORRECTO: register-phone-call para INBOUND transfers
      console.log("📡 Registrando llamada en Retell...");
      const response = await fetch("https://api.retellai.com/v2/register-phone-call", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RETELL_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          agent_id: RETELL_AGENT_ID,
          audio_websocket_protocol: "twilio",  // ⚠️ CRÍTICO
          audio_encoding: "mulaw",              // ⚠️ CRÍTICO
          sample_rate: 8000,                    // ⚠️ CRÍTICO
          from_number: req.body.From,
          to_number: req.body.To,
          metadata: {
            twilio_call_sid: req.body.CallSid
          }
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error("❌ Retell API error:", data);
        throw new Error(`Retell API: ${JSON.stringify(data)}`);
      }

      const callId = data.call_id;
      console.log("✅ Retell call_id:", callId);

      // Conectar via SIP
      const twiml = new twilio.twiml.VoiceResponse();
      const dial = twiml.dial();
      
      // ⚠️ IMPORTANTE: Sin el "+"
      dial.sip(`sip:${callId}@sip.retellai.com`);
      
      console.log("📤 TwiML:", twiml.toString());
      return res.type("text/xml").send(twiml.toString());

    } catch (err) {
      console.error("❌ ERROR:", err.message);
      
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say("Lo sentimos, tenemos dificultades técnicas.");
      twiml.hangup();
      return res.type("text/xml").send(twiml.toString());
    }
  }

  const twiml = new twilio.twiml.VoiceResponse();
  twiml.hangup();
  res.type("text/xml").send(twiml.toString());
});

app.get("/", (req, res) => {
  res.send("✅ Server OK");
});

app.listen(3000, () => {
  console.log("🚀 Server en puerto 3000");
  console.log("📝 RETELL_AGENT_ID:", RETELL_AGENT_ID);
});