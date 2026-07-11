import type { SVGProps } from 'react';

export type IconName =
  | 'home'
  | 'tasks'
  | 'chart'
  | 'path'
  | 'feedback'
  | 'classes'
  | 'students'
  | 'assign'
  | 'grade'
  | 'users'
  | 'library'
  | 'menu'
  | 'close'
  | 'chevron'
  | 'clock'
  | 'arrow'
  | 'check'
  | 'alert'
  | 'book'
  | 'spark'
  | 'logout'
  | 'building'
  | 'search'
  | 'plus'
  | 'filter'
  | 'bell'
  | 'calendar'
  | 'target'
  | 'headphones'
  | 'microphone';

const paths: Record<IconName, string[]> = {
  home: ['M3 11.5 12 4l9 7.5', 'M5.5 10.5V20h13v-9.5', 'M9 20v-6h6v6'],
  tasks: [
    'M8 6h12',
    'M8 12h12',
    'M8 18h12',
    'm3.5 6 1 1 2-2',
    'm3.5 12 1 1 2-2',
    'm3.5 18 1 1 2-2',
  ],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  path: [
    'M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    'M19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    'M7 17c5 0 3-10 10-10',
  ],
  feedback: ['M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z', 'M8 9h8', 'M8 13h5'],
  classes: ['M3 5h18v14H3Z', 'M3 9h18', 'M8 9v10'],
  students: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  assign: ['M14 3h7v7', 'm10 14 11-11', 'M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5'],
  grade: ['M12 2 15 8l6 .9-4.5 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L3 8.9 9 8Z'],
  users: [
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M23 21v-2a4 4 0 0 0-3-3.87',
  ],
  library: [
    'M4 19.5A2.5 2.5 0 0 1 6.5 17H20',
    'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z',
  ],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  close: ['m5 5 14 14', 'M19 5 5 19'],
  chevron: ['m9 18 6-6-6-6'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2'],
  arrow: ['M5 12h14', 'm13 6 6 6-6 6'],
  check: ['m4 12 5 5L20 6'],
  alert: [
    'M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z',
    'M12 9v4',
    'M12 17h.01',
  ],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5Z', 'M4 5.5v14'],
  spark: [
    'm12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2Z',
    'm19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7Z',
  ],
  logout: ['M10 17l5-5-5-5', 'M15 12H3', 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4'],
  building: [
    'M3 21h18',
    'M6 21V3h12v18',
    'M9 7h2',
    'M13 7h2',
    'M9 11h2',
    'M13 11h2',
    'M10 21v-5h4v5',
  ],
  search: ['M21 21l-4.3-4.3', 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z'],
  plus: ['M12 5v14', 'M5 12h14'],
  filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  calendar: ['M3 5h18v16H3Z', 'M16 3v4', 'M8 3v4', 'M3 10h18'],
  target: [
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
    'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z',
    'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  ],
  headphones: [
    'M4 14v-2a8 8 0 0 1 16 0v2',
    'M4 14h3v7H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 1-2Z',
    'M20 14h-3v7h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-1-2Z',
  ],
  microphone: [
    'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z',
    'M19 10v2a7 7 0 0 1-14 0v-2',
    'M12 19v3',
    'M8 22h8',
  ],
};

export function Icon({
  name,
  size = 20,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {paths[name].map((path, index) => (
        <path d={path} key={index} />
      ))}
    </svg>
  );
}
