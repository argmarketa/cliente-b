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
  // 🟢 0. CONFIGURACIÓN CORS (CRÍTICO)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Método no permitido" });
    }

    // 🔴 1. Autenticación
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : null;
    
    if (!token || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ success: false, error: "No autorizado. Token inválido." });
    }

    // 🟢 2. Recibir Payload
    const payload = req.body || {};

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

    // --- 🛡️ LIMPIEZA ANTIFALLO (Elimina los "N/A" del Sheet) ---
    const cleanValue = (val) => {
      if (!val || String(val).trim().toUpperCase() === "N/A" || String(val).trim() === "") return null;
      return String(val).trim();
    };

    fbc = cleanValue(fbc);
    fbp = cleanValue(fbp);
    event_id = cleanValue(event_id);
    click_id = cleanValue(click_id);
    test_event_code = cleanValue(test_event_code);

    // 🟢 3. Validación Mínima
    if (!nombre || !phone || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: "Faltan datos obligatorios (nombre, phone, amount)" 
      });
    }

    // 🟢 4. Hashing SHA256
    const normalizedPhone = normalizeArgentinePhone(phone);
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

    // 🟢 6. Lógica de Identificadores
    const isModoAnuncio = (fbp || fbc || click_id);
    let final_event_id;
    
    // Construcción dinámica de user_data para evitar enviar nulos
    let user_data_payload = {
        ph: [hashedPhone],
        fn: [hashedName],
        ln: [hashedSurname]
    };

    if (fbp) user_data_payload.fbp = fbp;
    if (fbc) user_data_payload.fbc = fbc;

    if (isModoAnuncio) {
      final_event_id = event_id || click_id || `purchase_${Date.now()}_${hashedPhone.substring(0,5)}`; 
    } else {
      final_event_id = `purchase_offline_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    }

    // 🔴 7. Variables de Entorno
    const PIXEL_ID = process.env.META_PIXEL_ID;
    const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
    
    if (!PIXEL_ID || !ACCESS_TOKEN) {
      return res.status(500).json({ success: false, error: "Error de configuración (Env Vars)" });
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

    // Logging de auditoría en Vercel
    console.log(
      `[CAPI] Pixel: ${PIXEL_ID} | Amount: ${amount} | FBP: ${fbp ? 'YES' : 'NO'} | Meta: ${metaJson.events_received ? 'OK' : 'FAIL'}`
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
