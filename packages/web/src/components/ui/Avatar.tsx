const PALETTE = [
  { bg: '#EFF6FF', fg: '#2563eb' },
  { bg: '#F5F3FF', fg: '#7c3aed' },
  { bg: '#F0FDF4', fg: '#16a34a' },
  { bg: '#FDF2F8', fg: '#db2777' },
  { bg: '#FFFBEB', fg: '#d97706' },
  { bg: '#ECFEFF', fg: '#0891b2' },
  { bg: '#F0FDFA', fg: '#059669' },
];

const SIZES = { xs: 24, sm: 32, md: 40, lg: 48 } as const;

interface AvatarProps {
  name: string;
  src?: string;
  size?: keyof typeof SIZES;
  shape?: 'circle' | 'squircle';
}

export function Avatar({ name, src, size = 'md', shape = 'circle' }: AvatarProps) {
  const px = SIZES[size];
  const initial = name.charAt(0).toUpperCase();
  const colorIndex = initial.charCodeAt(0) % PALETTE.length;
  const { bg, fg } = PALETTE[colorIndex] ?? PALETTE[0]!;
  const radius = shape === 'circle' ? '50%' : '22%';

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="object-cover shrink-0"
        style={{ width: px, height: px, borderRadius: radius }}
      />
    );
  }

  return (
    <div
      className="shrink-0 flex items-center justify-center font-semibold"
      style={{
        width: px,
        height: px,
        borderRadius: radius,
        backgroundColor: bg,
        color: fg,
        fontSize: px * 0.36,
      }}
    >
      {initial}
    </div>
  );
}
