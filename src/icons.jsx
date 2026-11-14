// A small set of line icons drawn for this project (24px grid, 1.5 stroke).
const paths = {
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  people: <><circle cx="9" cy="8" r="3.2" /><path d="M2.8 19.5c.6-3.3 3-5 6.2-5s5.6 1.7 6.2 5" /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.8M18.5 14.9c1.5.7 2.4 2.2 2.7 4.6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.3 9.3a2.8 2.8 0 1 1 4.2 2.4c-.9.6-1.5 1.1-1.5 2.3" /><path d="M12 17.2v.1" /></>,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="1" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  user: <><circle cx="12" cy="8.5" r="3.7" /><path d="M4.5 20c.7-3.8 3.6-5.8 7.5-5.8s6.8 2 7.5 5.8" /></>,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />,
  comment: <path d="M4 5.5h16v11h-9l-4.5 3.5v-3.5H4z" />,
  repost: <><path d="M7 7h10.5v7.5" /><path d="m14.5 11.5 3 3 3-3" /><path d="M17 17H6.5V9.5" /><path d="m9.5 12.5-3-3-3 3" /></>,
  bookmark: <path d="M6.5 4h11v16.5L12 16.2l-5.5 4.3z" />,
  more: <><circle cx="5.5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" /></>,
  image: <><rect x="3.5" y="4.5" width="17" height="15" rx="1" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  back: <path d="M19 12H5.5M11 6l-6 6 6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  send: <path d="M4 12 20 4.5 14.5 20l-3-6.5z" />,
  music: <><path d="M9 17.5V5.5l10-2v12" /><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="16.5" cy="15.5" r="2.5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="1" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  shield: <path d="M12 3.5 5 6v5.5c0 4.3 2.9 7.4 7 9 4.1-1.6 7-4.7 7-9V6z" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M4 4l16 16" /><path d="M9.5 5.9A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M14.7 14.8A3 3 0 0 1 9.2 9.3M6.3 7.4A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.6-.8" /></>,
};

export function Icon({ name, size = 20, filled = false, label }) {
  return (
    <svg
      className="icon" width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}
    >
      {paths[name]}
    </svg>
  );
}
