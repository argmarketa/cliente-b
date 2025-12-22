export default function handler(req, res) {
  // 1. Obtener la URL de destino desde las Variables de Entorno de Vercel
  // Cada proyecto de Vercel (Cliente A, Cliente B) tendrá un valor distinto aquí.
  const keitaroUrl = process.env.KEITARO_URL;

  // 2. Validación de Seguridad
  // Si te olvidaste de configurar la variable en Vercel, mandamos a Google para no mostrar error 500
  if (!keitaroUrl) {
    console.error("[ERROR] Falta la variable de entorno KEITARO_URL");
    return res.redirect(302, 'https://www.google.com'); 
  }

  // 3. Preservar los parámetros (Click ID, FBP, FBC, UTMs)
  // req.query ya trae todos los parámetros que el index.html le pasó (click_id=xyz&fbp=...)
  // Los convertimos a string para pegárselos a la URL de destino.
  const queryParams = new URLSearchParams(req.query).toString();

  // 4. Construir la URL Final
  // Si ya hay params, los concatenamos.
  const finalUrl = queryParams ? `${keitaroUrl}?${queryParams}` : keitaroUrl;

  // 5. Redirección
  // Usamos 302 (Found) o 307 (Temporary Redirect) para que el navegador NO guarde esto en caché.
  // Queremos que siempre ejecute el script por si cambiamos la URL de Keitaro mañana.
  res.redirect(307, finalUrl);
}
