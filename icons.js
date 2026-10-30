// Íconos SVG de trazo (24x24). icon('home') devuelve el SVG listo para insertar.

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  kb: 'M8.5 9.2V7a3.5 3.5 0 0 1 7 0v2.2M5.5 15a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0',
  dumbbell: 'M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11',
  chart: 'M3 21h18M6 17v-5M11 17V7M16 17v-8M21 17v-3',
  user: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4.5 21a7.5 7.5 0 0 1 15 0',
  play: '@M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z',
  pause: '@M6 4h4v16H6zM14 4h4v16h-4z',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  close: 'M6 6l12 12M18 6 6 18',
  flame: 'M12 22c3.9 0 7-2.9 7-6.9 0-3.6-2.6-5.8-3.8-8.6-.9 1.9-2 2.8-3.4 2.9.2-2.4-.4-4.7-1.8-6.4C7 5.6 5 9.4 5 14.9 5 19 8.1 22 12 22z',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5',
  clock: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM12 7v5l3 2',
  scale: 'M5 21h14l-2-13H7zM9.5 8a2.5 2.5 0 0 1 5 0',
  timer: 'M12 22a8 8 0 1 0 0-16a8 8 0 0 0 0 16zM12 10v4M9.5 2h5',
  info: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM12 11v6M12 7.5v.01',
  video: 'M3 6.5h12v11H3zM15 10.5l6-3.5v10l-6-3.5',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  trash: 'M4 7h16M9.5 7V4h5v3M6 7l1 14h10l1-14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  target: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM12 12.01V12',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  heart: 'M12 20s-7.5-4.6-9.2-9.3C1.6 7.3 3.9 4 7.3 4c2 0 3.6 1.1 4.7 2.7C13.1 5.1 14.7 4 16.7 4c3.4 0 5.7 3.3 4.5 6.7C19.5 15.4 12 20 12 20z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  skip: 'M5 5l10 7-10 7zM18.5 5v14',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.9 10.6c.6.6.9 1.4.9 2.4h6c0-1 .3-1.8.9-2.4A6 6 0 0 0 12 3z',
  medal: 'M8 3h8l-2 6h-4zM12 21a5.5 5.5 0 1 0 0-11a5.5 5.5 0 0 0 0 11zM12 13v2.5l1.5 1',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  search: 'M11 18a7 7 0 1 0 0-14a7 7 0 0 0 0 14zM20 20l-4-4',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  volume: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11',
  mute: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
};

function icon(name, size = 20, cls = '') {
  const d = ICONS[name] || ICONS.info;
  const filled = d.startsWith('@');
  return `<svg class="i ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${filled ? d.slice(1) : d}"/></svg>`;
}
