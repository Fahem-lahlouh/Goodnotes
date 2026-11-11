import type { SVGProps } from 'react';

/** Jeu d'icônes original de Calame (24×24, trait 1.8). */
const paths: Record<string, string> = {
  pen: 'M5 19l1.5-4.5L16 5a2.1 2.1 0 013 3l-9.5 9.5L5 19zM14.5 6.5l3 3M6.5 14.5l3 3',
  fountain: 'M12 3l4.5 6.5L13 20h-2L7.5 9.5 12 3zM12 3v8.5M12 14.2a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zM10 20h4',
  brush: 'M14.5 4.5l5 5-6.5 6.5-5-5 6.5-6.5zM8 11l5 5M7.6 12.6c-2.6.4-3.4 2.4-3.6 4.4-.1 1.2-.6 2-1.5 2.5 3.6.6 6.8-.4 7.7-3.4',
  pencil: 'M15.5 4.5l4 4L8.5 19.5 4 20l.5-4.5 11-11zM13.5 6.5l4 4M4.5 15.5l4 4',
  fineliner: 'M7 17l1-3.2 8.7-8.7a1.7 1.7 0 012.4 2.4L10.4 16.2 7 17zM14.8 7.1l2.4 2.4M7 17l-2.5 2.5',
  marker: 'M13.5 4.5l6 6-7.5 7.5H6.5v-5.5l7-8zM6.5 18l-2.5 2.5M9.5 9.5l5 5',
  shape: 'M4 20L20 4M4 4h7v7H4zM17 13a3.5 3.5 0 110 7 3.5 3.5 0 010-7z',
  zoomWindow: 'M3 4h18v9H3zM6 16h12v4H6zM9 7h6v3H9z',
  convert: 'M4 7c2-3 4 3 6 0s4 3 6 0M4 17h9M16 14l3 3-3 3M4 12h6',
  newline: 'M20 6v5a3 3 0 01-3 3H5M9 10l-4 4 4 4',
  arrowRight: 'M5 12h14M14 7l5 5-5 5',
  highlighter: 'M6 21h7M8.5 17.5l-2-2 9-10.8a2 2 0 012.9-.1l1 1a2 2 0 01-.1 2.9L8.5 17.5zM6.5 15.5L4 18l2 2 2.5-2.5',
  eraser: 'M8.5 20H20M4.7 14.3l9.6-9.6a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 18l-2 2H8.4l-3.7-3.7a1.4 1.4 0 010-2zM9.6 9.4l5.1 5.1',
  lasso: 'M5.2 14.8C3.2 13.4 2.6 11.4 3.6 9.4 5.2 6.2 10 4.4 14.6 5.1s7 3.6 6 6.4-5.6 4.4-10 4M8.6 15.6c-1.7.3-2.4 1.6-1.6 2.7.7 1 2.3 1.3 2.6 2.7',
  selectRect: 'M4 7V5a1 1 0 011-1h2M11 4h2M17 4h2a1 1 0 011 1v2M20 11v2M20 17v2a1 1 0 01-1 1h-2M13 20h-2M7 20H5a1 1 0 01-1-1v-2M4 13v-2',
  selectSquare: 'M5 5h14v14H5zM9 9h6v6H9z',
  text: 'M5 6V4.5h14V6M12 4.5V19.5M9 19.5h6',
  image: 'M4 5h16v14H4zM4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17.5M15.5 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  back: 'M15 18l-6-6 6-6',
  chevronLeft: 'M14.5 6l-6 6 6 6',
  chevronRight: 'M9.5 6l6 6-6 6',
  chevronDown: 'M6 9.5l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  settings:
    'M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4zM19.4 13.5l1.4 1.1-1.8 3.1-1.7-.6a7.6 7.6 0 01-2 1.2l-.3 1.8h-3.6l-.3-1.8a7.6 7.6 0 01-2-1.2l-1.7.6-1.8-3.1 1.4-1.1a7.7 7.7 0 010-2.4L3.6 9.8l1.8-3.1 1.7.6a7.6 7.6 0 012-1.2l.3-1.8h3.6l.3 1.8a7.6 7.6 0 012 1.2l1.7-.6 1.8 3.1-1.4 1.1a7.7 7.7 0 010 2.4z',
  pages: 'M8 3h9a2 2 0 012 2v12M5 7h9a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z',
  focus: 'M3 12h3M18 12h3M12 3v3M12 18v3M8 8h8v8H8z',
  unfocus: 'M9 4v4a1 1 0 01-1 1H4M20 9h-4a1 1 0 01-1-1V4M15 20v-4a1 1 0 011-1h4M4 15h4a1 1 0 011 1v4',
  fullscreen: 'M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4',
  exitFullscreen: 'M9 4v4a1 1 0 01-1 1H4M20 9h-4a1 1 0 01-1-1V4M15 20v-4a1 1 0 011-1h4M4 15h4a1 1 0 011 1v4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3',
  star: 'M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.5z',
  search: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  copy: 'M9 9h10v10a1 1 0 01-1 1H10a1 1 0 01-1-1V9zM15 9V5a1 1 0 00-1-1H6a1 1 0 00-1 1v8a1 1 0 001 1h3',
  cut: 'M6.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM17.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8.3 15.7L18 4M15.7 15.7L6 4',
  paste: 'M9 4h6v3H9zM8 5.5H6a1 1 0 00-1 1V20a1 1 0 001 1h12a1 1 0 001-1V6.5a1 1 0 00-1-1h-2M9 12h6M9 16h4',
  duplicate: 'M8 8h11v11H8zM5 16V5h11',
  hand: 'M8 13V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-4a1.5 1.5 0 013 0v6.5a7 7 0 01-7 7h-.6a6 6 0 01-4.8-2.4L4 15.4a1.5 1.5 0 012.3-1.9L8 15',
  finger: 'M9 11V5.5a1.5 1.5 0 013 0V12l3.6.9a2 2 0 011.5 2.3l-.8 4.3A2 2 0 0114.3 21H10a3 3 0 01-2.4-1.2l-2.9-3.9a1.5 1.5 0 012.3-1.9L9 15.5M15 4.5c1.6.6 2.6 1.8 3 3.5M15.5 1.8c2.6.9 4.3 3 4.8 5.7',
  pencilOnly: 'M15.5 4.5l4 4L8.5 19.5 4 20l.5-4.5 11-11zM3 3l18 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  restore: 'M4 12a8 8 0 108-8 8.3 8.3 0 00-6 2.6L4 9M4 4v5h5',
  check: 'M5 12.5l4.5 4.5L19 7',
  alert: 'M12 4l9 16H3l9-16zM12 10v4M12 17h.01',
  device: 'M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2',
  folder: 'M3.5 7a2 2 0 012-2h4l2 2.5h7a2 2 0 012 2V17a2 2 0 01-2 2h-13a2 2 0 01-2-2V7z',
  folderPlus: 'M3.5 7a2 2 0 012-2h4l2 2.5h7a2 2 0 012 2V17a2 2 0 01-2 2h-13a2 2 0 01-2-2V7zM12 11v5M9.5 13.5h5',
  notebook: 'M7 3h11a1 1 0 011 1v16a1 1 0 01-1 1H7a2 2 0 01-2-2V5a2 2 0 012-2zM9 3v18M12 8h4M12 11h4',
  board: 'M4 5h16v11H4zM12 16v4M8 20h8M7.5 9.5h.01M11 9.5h.01M14.5 9.5h.01M7.5 12.5h.01M11 12.5h.01M14.5 12.5h.01',
  quick: 'M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z',
  sort: 'M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3',
  palette:
    'M12 3a9 9 0 100 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 005-5c0-4.1-4-7.4-9-7.4zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
  alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.7 1-3.9 14.5-3.7-1',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  thicker: 'M5 12h14M5 12a1 1 0 000 0',
  layoutH: 'M3 6h7v12H3zM14 6h7v12h-7z',
  layoutV: 'M6 3h12v7H6zM6 14h12v7H6z',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5h.01',
  cloudOff: 'M3 3l18 18M7.5 7.6A5 5 0 007 17.5h10M16.4 10.1A4.5 4.5 0 0120 17',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, filled, ...rest }: { name: IconName; size?: number; filled?: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}

/** Logo Calame : un calame (roseau taillé) traçant une boucle d'encre. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="calame-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b4170" />
          <stop offset="1" stopColor="#16223d" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#calame-g)" />
      <path d="M13 45c6-1 9-7 14-7s3 8 9 7 7-12 13-14" fill="none" stroke="#e9b872" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M41 14l9 9-15 15-7 2 2-7 11-19z" fill="#f4efe4" />
      <path d="M30 33l4 4" stroke="#16223d" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
