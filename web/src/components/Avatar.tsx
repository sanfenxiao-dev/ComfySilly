export function Avatar({
  src,
  name,
  size = 'normal',
}: {
  src?: string;
  name: string;
  size?: 'small' | 'normal' | 'large';
}) {
  return (
    <span className={`avatar avatar-${size}`} aria-label={name}>
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <span aria-hidden="true">{[...name.trim()][0] || 'U'}</span>
      )}
    </span>
  );
}
