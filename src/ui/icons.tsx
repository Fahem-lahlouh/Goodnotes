import type { SVGProps } from 'react';

/** Jeu d'icônes original (traits 1.8 px, 24×24). */
const paths: Record<string, string> = {
  pen: 'M4 20l1.2-4.6L15.6 5a2.1 2.1 0 013 3L8.2 18.4 4 20zM13.5 7.1l3.4 3.4',
  highlighter: 'M6 21h7M8.5 17.5l-2-2 9-10.8a2 2 0 012.9-.1l1 1a2 2 0 01-.1 2.9L8.5 17.5zM6.5 15.5L4 18l2 2 2.5-2.5',
  eraser: 'M8.5 20H20M4.7 14.3l9.6-9.6a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 18l-2 2H8.4l-3.7-3.7a1.4 1.4 0 010-2zM9.6 9.4l5.1 5.1',
  lasso: 'M5.2 14.8C3.2 13.4 2.6 11.4 3.6 9.4 5.2 6.2 10 4.4 14.6 5.1s7 3.6 6 6.4-5.6 4.4-10 4M8.6 15.6c-1.7.3-2.4 1.6-1.6 2.7.7 1 2.3 1.3 2.6 2.7',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  back: 'M15 18l-6-6 6-6',
  plus: 'M12 5v14M5 12h14',
  settings:
    'M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4zM19.4 13.5l1.4 1.1-1.8 3.1-1.7-.6a7.6 7.6 0 01-2 1.2l-.3 1.8h-3.6l-.3-1.8a7.6 7.6 0 01-2-1.2l-1.7.6-1.8-3.1 1.4-1.1a7.7 7.7 0 010-2.4L3.6 9.8l1.8-3.1 1.7.6a7.6 7.6 0 012-1.2l.3-1.8h3.6l.3 1.8a7.6 7.6 0 012 1.2l1.7-.6 1.8 3.1-1.4 1.1a7.7 7.7 0 010 2.4z',
  pages: 'M8 3h9a2 2 0 012 2v12M5 7h9a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z',
  focus: 'M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4',
  unfocus: 'M9 4v4a1 1 0 01-1 1H4M20 9h-4a1 1 0 01-1-1V4M15 20v-4a1 1 0 011-1h4M4 15h4a1 1 0 011 1v4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3',
  star: 'M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.5z',
  search: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  copy: 'M9 9h10v10a1 1 0 01-1 1H10a1 1 0 01-1-1V9zM15 9V5a1 1 0 00-1-1H6a1 1 0 00-1 1v8a1 1 0 001 1h3',
  hand: 'M8 13V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-4a1.5 1.5 0 013 0v6.5a7 7 0 01-7 7h-.6a6 6 0 01-4.8-2.4L4 15.4a1.5 1.5 0 012.3-1.9L8 15',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  restore: 'M4 12a8 8 0 108-8 8.3 8.3 0 00-6 2.6L4 9M4 4v5h5',
  zoomIn: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8M10.5 7.5v6M7.5 10.5h6',
  zoomOut: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8M7.5 10.5h6',
  fit: 'M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3',
  check: 'M5 12.5l4.5 4.5L19 7',
  cloudOff: 'M3 3l18 18M7.5 7.6A5 5 0 007 17.5h10M16.4 10.1A4.5 4.5 0 0120 17',
  device: 'M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM11 18h2',
  alert: 'M12 4l9 16H3l9-16zM12 10v4M12 17h.01',
  duplicate: 'M8 8h11v11H8zM5 16V5h11',
  palette:
    'M12 3a9 9 0 100 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 005-5c0-4.1-4-7.4-9-7.4zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
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
