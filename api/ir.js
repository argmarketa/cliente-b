export default function handler(req, res) {
  try {
    // 1. RECIBIMOS TODOS LOS DATOS (Teléfono + UTMs del Anuncio)
    const { phone, utm_campaign, utm_content } = req.query;

    // 2. FALLBACK DE NÚMERO
    // Si el rotador falla, usa este número de respaldo.
    const destinationPhone = phone || "5492235568815"; 

    // 3. CONSTRUIMOS EL MENSAJE
    // Empezamos con el saludo normal
    let message = "Hola! Quiero mi usuario";

    // 4. LA MAGIA PARA EL SHEET (Inyectar datos)
    // Si la URL trae info de campaña/anuncio, la agregamos al final del mensaje.
    // Ejemplo resultado: "Hola! Quiero mi usuario (Ref: PROSPECTING | VideoKun)"
    if (utm_campaign || utm_content) {
      const campana = utm_campaign || "N/A";
      const anuncio = utm_content || "N/A";
      // Agregamos la referencia al final
      message += ` (Ref: ${campana} | ${anuncio})`;
    }

    // 5. CODIFICAMOS Y REDIRIGIMOS
    const encodedMessage = encodeURIComponent(message);
    const finalUrl = `https://wa.me/${destinationPhone}?text=${encodedMessage}`;

    res.redirect(307, finalUrl);

  } catch (error) {
    console.error(error);
    // Redirección de emergencia si todo explota
    res.redirect(307, "https://wa.me/5492235568815");
  }
}
