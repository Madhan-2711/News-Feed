'use client';

export default function TerminalButton({ children, onClick, variant, size, disabled, loading, id }) {
  const classes = [
    'btn',
    variant === 'amber' ? 'btn-primary' : variant === 'danger' ? 'btn-outline' : 'btn-outline',
    size === 'small' && 'btn-sm',
  ].filter(Boolean).join(' ');

  return (
    <button className={classes} onClick={onClick} disabled={disabled || loading} id={id}>
      {loading ? 'Processing…' : children}
    </button>
  );
}
