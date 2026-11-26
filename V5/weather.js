// ===== 到着時天気（Open-Meteo API） =====
function parseWeatherCode(code) {
  if (code === 0) return { icon: '☀️', text: '快晴' };
  if (code <= 3) return { icon: '⛅', text: '晴/曇' };
  if (code <= 48) return { icon: '🌫️', text: '霧' };
  if (code <= 55) return { icon: '🌦️', text: '霧雨' };
  if (code <= 65) return { icon: '🌧️', text: '雨' };
  if (code <= 77) return { icon: '⛄', text: '雪' };
  if (code <= 82) return { icon: '☔', text: 'にわか雨' };
  if (code <= 99) return { icon: '⛈️', text: '雷雨' };
  return { icon: '☁️', text: '曇り' };
}

async function fetchArrivalWeather(lat, lng, arrivalDateObj) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  try {
    const dt = arrivalDateObj instanceof Date ? arrivalDateObj : new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const targetHour = dt.getHours();

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,weather_code&timezone=Asia%2FTokyo&start_date=${dateStr}&end_date=${dateStr}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const times = data.hourly?.time || [];
    const temps = data.hourly?.temperature_2m || [];
    const codes = data.hourly?.weather_code || [];

    const matchPrefix = `${dateStr}T${String(targetHour).padStart(2, '0')}:00`;
    let idx = times.findIndex(t => t.startsWith(matchPrefix));
    if (idx === -1 && times.length > 0) idx = Math.min(targetHour, times.length - 1);
    if (idx === -1) return null;

    const w = parseWeatherCode(codes[idx]);
    const temp = temps[idx] !== undefined ? `${Math.round(temps[idx])}℃` : '';
    return {
      label: `${w.icon} ${w.text}${temp ? ` ${temp}` : ''}`,
      timeLabel: `${String(targetHour).padStart(2, '0')}時頃`
    };
  } catch (e) {
    return null;
  }
}
