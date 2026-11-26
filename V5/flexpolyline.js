

// ===== HERE Flexible Polyline デコーダー（Pure JS） =====
// 仕様: https://github.com/heremaps/flexible-polyline
(function (global) {
  const DECODING_TABLE = [
    62, -1, -1, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, -1, -1, -1, -1,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    22, 23, 24, 25, -1, -1, -1, -1, 63, -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
    36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51
  ];

  function decodeChar(char) {
    const code = char.charCodeAt(0) - 45;
    if (code < 0 || code >= DECODING_TABLE.length) {
      throw new Error('Invalid flexible polyline character: ' + char);
    }
    const val = DECODING_TABLE[code];
    if (val < 0) {
      throw new Error('Invalid flexible polyline character: ' + char);
    }
    return val;
  }

  function decodeUnsignedValues(encoded) {
    const result = [];
    let shift = 0;
    let current = 0;
    for (let i = 0; i < encoded.length; i++) {
      const value = decodeChar(encoded[i]);
      current |= (value & 0x1f) << shift;
      if ((value & 0x20) === 0) {
        result.push(current);
        current = 0;
        shift = 0;
      } else {
        shift += 5;
      }
    }
    return result;
  }

  function toSigned(val) {
    let res = val;
    if (res & 1) {
      res = ~res;
    }
    res >>= 1;
    return res;
  }

  function decodeFlexiblePolyline(encoded) {
    if (!encoded || typeof encoded !== 'string') return [];
    const values = decodeUnsignedValues(encoded);
    if (values.length < 2) return [];

    // values[0]: format version (must be 1), values[1]: header
    const version = values[0];
    if (version !== 1) {
      throw new Error('Unsupported flexible polyline version: ' + version);
    }
    const header = values[1];
    const precision = header & 0x0f;
    const thirdDim = (header >> 4) & 0x07;
    const thirdDimPrecision = (header >> 7) & 0x0f;

    const factorDegree = Math.pow(10, precision);
    const factorZ = Math.pow(10, thirdDimPrecision);
    const hasThirdDim = thirdDim !== 0;

    let lastLat = 0;
    let lastLng = 0;
    let lastZ = 0;
    const coords = [];

    let idx = 2;
    while (idx < values.length) {
      const dLat = toSigned(values[idx++]);
      if (idx >= values.length) break;
      const dLng = toSigned(values[idx++]);
      lastLat += dLat;
      lastLng += dLng;

      if (hasThirdDim) {
        if (idx >= values.length) break;
        const dZ = toSigned(values[idx++]);
        lastZ += dZ;
        coords.push({
          lat: lastLat / factorDegree,
          lng: lastLng / factorDegree,
          z: lastZ / factorZ
        });
      } else {
        coords.push({
          lat: lastLat / factorDegree,
          lng: lastLng / factorDegree
        });
      }
    }
    return coords;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { decodeFlexiblePolyline };
  }
  global.decodeFlexiblePolyline = decodeFlexiblePolyline;
})(typeof window !== 'undefined' ? window : globalThis);
1 / 2 ページ
