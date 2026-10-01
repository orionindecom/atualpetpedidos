// Ícones de traço da Central (24x24, stroke currentColor). Um único conjunto
// compartilhado por diálogos, toasts e estados vazios, sem biblioteca externa.
const PATHS = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 3.5 2.8 19.5h18.4z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.2v.3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8v.3" />
    </>
  ),
  package: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9" />
      <path d="m7.8 5.3 8.4 4.5" />
    </>
  ),
  packageCheck: (
    <>
      <path d="M20.5 11V7.5L12 3 3.5 7.5v9L12 21l1.5-.8" />
      <path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9" />
      <path d="m15.5 18 2 2 4-4" />
    </>
  ),
  userCheck: (
    <>
      <circle cx="9.5" cy="8" r="4" />
      <path d="M2.5 20v-.8A5.7 5.7 0 0 1 8.2 13.5h2.6c1.3 0 2.5.4 3.4 1.2" />
      <path d="m15.5 18 2 2 4-4.5" />
    </>
  ),
  userSwitch: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2.5 20v-.8A5.7 5.7 0 0 1 8.2 13.5h1.6" />
      <path d="M14 15.5h7l-2-2M21 19.5h-7l2 2" />
    </>
  ),
  userMinus: (
    <>
      <circle cx="9.5" cy="8" r="4" />
      <path d="M2.5 20v-.8A5.7 5.7 0 0 1 8.2 13.5h2.6a5.7 5.7 0 0 1 3.2 1" />
      <path d="M16 17.5h6" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6.5 3h11M6.5 21h11" />
      <path d="M7.5 3v3.2a4.5 4.5 0 0 0 1.8 3.6L12 12l2.7-2.2a4.5 4.5 0 0 0 1.8-3.6V3" />
      <path d="M7.5 21v-3.2a4.5 4.5 0 0 1 1.8-3.6L12 12l2.7 2.2a4.5 4.5 0 0 1 1.8 3.6V21" />
    </>
  ),
  fileX: (
    <>
      <path d="M13.5 3H6.5v18h11V7z" />
      <path d="M13.5 3v4h4" />
      <path d="m9.8 12.3 4.4 4.4M14.2 12.3l-4.4 4.4" />
    </>
  ),
  fileSend: (
    <>
      <path d="M13.5 3H6.5v18h6" />
      <path d="M13.5 3v4h4v5" />
      <path d="M15 17.5h6.5M18.5 14.5l3 3-3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.5h16M9.5 6.5V4h5v2.5" />
      <path d="M6 6.5 7 20h10l1-13.5" />
      <path d="M10 10.5v6M14 10.5v6" />
    </>
  ),
  archive: (
    <>
      <path d="M3.5 4.5h17v4h-17z" />
      <path d="M5 8.5V20h14V8.5" />
      <path d="M9.5 12.5h5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 8.7-8.7M16.5 6.5l2.5 2.5M14 9l2 2" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13 7 4 4" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2.5l2.2 11h10.8l2-7.5H6.4" />
      <circle cx="9" cy="19" r="1.3" />
      <circle cx="17" cy="19" r="1.3" />
    </>
  ),
  document: (
    <>
      <path d="M13.5 3H6.5v18h11V7z" />
      <path d="M13.5 3v4h4M9.5 12.5h5M9.5 16h5" />
    </>
  ),
  clients: (
    <>
      <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1" />
      <path d="M16 3.5a4 4 0 0 1 0 7" />
      <path d="M22 21v-1a6 6 0 0 0-4-5.6" />
    </>
  ),
  orders: (
    <>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h8M9 17h6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
};

function FeedbackIcon({ name, className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] || PATHS.info}
    </svg>
  );
}

export default FeedbackIcon;
