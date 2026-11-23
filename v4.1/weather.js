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

async function fetchDestinationWeatherData(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation_probability,weather_code&timezone=Asia%2FTokyo&forecast_days=16`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function getArrivalWeatherBadgeHtml(weatherData, arrivalDate) {
  if (!weatherData || !weatherData.hourly || !arrivalDate) return '';

  const rounded = new Date(arrivalDate.getTime());
  if (rounded.getMinutes() >= 30) {
    rounded.setHours(rounded.getHours() + 1);
  }
  rounded.setMinutes(0, 0, 0);

  const pad = (n) => String(n).padStart(2, '0');
  const targetIso = `${rounded.getFullYear()}-${pad(rounded.getMonth() + 1)}-${pad(rounded.getDate())}T${pad(rounded.getHours())}:00`;

  const idx = weatherData.hourly.time.indexOf(targetIso);
  if (idx === -1) {
    return `<div class="weather-badge muted">☁️ 到着時天気: 予報範囲外</div>`;
  }

  const code = weatherData.hourly.weather_code[idx];
  const temp = Math.round(weatherData.hourly.temperature_2m[idx]);
  const rainProb = weatherData.hourly.precipitation_probability[idx] ?? 0;
  const w = parseWeatherCode(code);
  const isRainy = rainProb >= 40 || code >= 51;

  return `
    <div class="weather-badge ${isRainy ? 'rain' : ''}">
      <span>${w.icon} 到着時 ${w.text}</span>
      <span><b>${temp}℃</b> / 降水${rainProb}%</span>
    </div>
  `;
}
