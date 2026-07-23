export const revealOnHover =
  'opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-standard)] group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100';

export const rowHover =
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-hover';

export const cardHover =
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:border-border-strong hover:bg-surface-2';

export const surfaceHover =
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none';

export const pressable =
  'transition-[transform,opacity] duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)] active:scale-[0.985] motion-reduce:active:scale-100';
