export const fontSizeToIconSize = {
  'text-xs': 15,
  'text-sm': 16,
  'text-base': 18,
  'text-lg': 20,
}

export function shadeColor(percent: number, color: string): string {
  // Entferne ggf. führendes "#"
  if (color.startsWith('#')) color = color.substring(1);
  // Wandle Hex in Dezimal um
  const num: number = parseInt(color, 16);
  let r: number = (num >> 16) & 0xff;
  let g: number = (num >> 8) & 0xff;
  let b: number = num & 0xff;

  // Berechne die neuen Kanalwerte
  r = Math.floor(r * (1 - percent));
  g = Math.floor(g * (1 - percent));
  b = Math.floor(b * (1 - percent));

  // Setze die neuen Werte wieder zu einem Hex-Wert zusammen
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
