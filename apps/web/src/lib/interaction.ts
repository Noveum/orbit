export const revealOnHover =
  'opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100';

export const revealOnCardHover =
  'opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none group-hover/card:opacity-100 group-focus-within/card:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100';

export const rowHover =
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none hover:bg-hover';

export const cardHover =
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none hover:border-border-strong hover:bg-surface-2';

export const tabHover =
  'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none hover:text-text';

export const dangerAction = 'text-danger hover:text-danger';

export const dangerMenuAction = 'text-danger data-[highlighted]:text-danger';
