import crypto from "crypto";

// --- FUNCIÓN AUXILIAR: Normalizar Teléfonos Argentinos ---
function normalizeArgentinePhone(rawPhone) {
  let p = String(rawPhone).replace(/\D/g, "");
  
  if (p.startsWith("549")) return p;
  
  if (p.startsWith("54") && !p.startsWith("549") && p.length >= 12) {
     return "549" + p.substring(2);
  }

  if (p.startsWith("0")) p = p.substring(1);
  
  if (p.length === 10) {
    return "549" + p;
  }

  return p;
}

export default async function handler(req, res) {
  // 🟢 0. CONFIGURACIÓN CORS (CRÍTICO PARA MAKE/KEITARO)
  // Esto permite que Make o tus Scripts de Google envíen datos sin bloqueo.
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Responder rápido a las solicitudes "Pre-flight" del navegador/Make
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Método no permitido" });
    }

    // 🔴 1. Autenticación (Token Maestro de la Agencia)
    // Este token lo defines tú en Vercel (Variable: ADMIN_TOKEN)
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : null;
    
    if (!token || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ success: false, error: "No autorizado. Token inválido." });
    }

    // 🟢 2. Recibir Payload (Flexible para Sheet y Make)
    const payload = req.body || {};
    
    // Log para depuración en Vercel (Ver qué manda Make)
    // console.log("[INBOUND] Payload recibido:", JSON.stringify(payload));

    let { 
      nombre, 
      apellido, 
      phone, 
      amount, 
      event_time, 
      event_id, 
      fbp,          
      fbc,          
      click_id,
      test_event_code
    } = payload;

    // --- 🛡️ LIMPIEZA DE DATOS ---
    if (fbc) fbc = String(fbc).trim();
    if (fbp) fbp = String(fbp).trim();
    if (event_id) event_id = String(event_id).trim();
    if (click_id) click_id = String(click_id).trim();
    if (test_event_code) test_event_code = String(test_event_code).trim();

    // 🟢 3. Validación Mínima
    if (!nombre || !phone || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: "Faltan datos obligatorios (nombre, phone, amount)" 
      });
    }

    // 🟢 4. Hashing SHA256 (Requisito de Meta)
    const normalizedPhone = normalizeArgentinePhone(phone);
    // Si no hay apellido, usamos string vacío para no romper el hash
    const normalizedName = String(nombre || "").trim().toLowerCase();
    const normalizedSurname = String(apellido || "").trim().toLowerCase();

    const hash = (str) => crypto.createHash("sha256").update(str).digest("hex");

    const hashedPhone = hash(normalizedPhone);
    const hashedName = hash(normalizedName);
    const hashedSurname = hash(normalizedSurname);

    // 🟢 5. Lógica de Fecha
    let final_event_time = Math.floor(Date.now() / 1000);
    if (event_time) {
      const d = new Date(event_time);
      if (!isNaN(d.getTime())) {
        final_event_time = Math.floor(d.getTime() / 1000);
      }
    }

    // 🟢 6. Lógica de Identificadores (CAPI Deduplication)
    // Si viene fbp/fbc, intentamos atribuir.
    const isModoAnuncio = (fbp || fbc);
    let final_event_id;
    let user_data_payload = {
        ph: [hashedPhone],
        fn: [hashedName],
        ln: [hashedSurname]
    };

    if (isModoAnuncio) {
      // Prioridad 1: event_id que mandaste (contact_id del sheet)
      // Prioridad 2: click_id
      // Prioridad 3: Generado
      final_event_id = event_id || click_id || `purchase_${Date.now()}_${hashedPhone.substring(0,5)}`; 
      
      if (fbp) user_data_payload.fbp = fbp;
      if (fbc) user_data_payload.fbc = fbc;
    } else {
      // Modo Offline puro
      final_event_id = `purchase_offline_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    }

    // 🔴 7. Variables de Entorno (DINÁMICAS POR CLIENTE)
    const PIXEL_ID = process.env.META_PIXEL_ID;
    const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
    
    if (!PIXEL_ID || !ACCESS_TOKEN) {
      console.error("[ERROR CRÍTICO] Faltan variables META_PIXEL_ID o META_ACCESS_TOKEN en Vercel");
      return res.status(500).json({ success: false, error: "Error de configuración del servidor (Env Vars)" });
    }

    // 🟢 8. Construir Body para Meta CAPI
    const eventBody = {
      data: [
        {
          event_name: "Purchase",
          event_time: final_event_time,
          event_id: final_event_id,
          user_data: user_data_payload,
          custom_data: {
            currency: "ARS",
            value: parseFloat(amount)
          },
          // MANTENEMOS TU CONFIGURACIÓN EXITOSA
          action_source: "system_generated", 
        }
      ]
    };

    if (test_event_code) {
        eventBody.test_event_code = test_event_code;
    }

    // 🟢 9. Enviar a Meta Graph API
    const graphUrl = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    
    const metaResp = await fetch(graphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventBody)
    });

    const metaJson = await metaResp.json();

    // Logging de auditoría
    console.log(
      `[CAPI] Client Pixel: ${PIXEL_ID} | Amount: ${amount} | FBP: ${fbp ? 'YES' : 'NO'}`,
      `| Meta Status: ${metaJson.events_received ? 'OK' : 'FAIL'}`
    );
    
    if (metaJson.error) {
       return res.status(400).json({ success: false, message: "Meta rechazó el evento", metaError: metaJson.error });
    }

    return res.status(200).json({ success: true, metaResponse: metaJson, event_id: final_event_id });

  } catch (error) {
    console.error("Critical API Error:", error);
    return res.status(500).json({ success: false, error: error?.message || "error interno desconocido" });
  }
}
