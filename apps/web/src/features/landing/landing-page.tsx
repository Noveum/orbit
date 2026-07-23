import {
  Bell,
  Bot,
  Box,
  Check,
  CircleDot,
  FileText,
  GitPullRequest,
  Inbox,
  IterationCw,
  Layers,
  type LucideIcon,
  Search,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SlidersHorizontal,
  SquareKanban,
  Target,
} from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { Kbd } from '@/components/ui/kbd.tsx';
import { cn } from '@/lib/cn.ts';
import { EnterToSignIn } from './enter-to-sign-in.tsx';

const SIGN_IN_HREF = '/login';
const GITHUB_HREF = 'https://github.com/Noveum/orbit';

const primaryCta =
  'inline-flex h-10 items-center justify-center rounded-md bg-accent px-5 text-sm font-medium text-accent-contrast transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)] hover:bg-accent-hover active:scale-[0.985]';

const quietLink = 'text-muted transition-[color] duration-[var(--duration-fast)] hover:text-text';

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r="7"
          fill="none"
          strokeWidth="1.5"
          className="stroke-text"
          opacity="0.85"
        />
        <circle cx="15.6" cy="5.4" r="2.1" className="fill-accent" />
      </svg>
      {compact ? null : <span className="text-base font-semibold tracking-tight">Orbit</span>}
    </span>
  );
}

function StackSwap({
  base,
  alt,
  delay,
  className,
}: {
  base: ReactNode;
  alt: ReactNode;
  delay?: string;
  className?: string;
}) {
  const style: CSSProperties | undefined =
    delay === undefined ? undefined : { animationDelay: delay };
  return (
    <span className={cn('relative inline-flex', className)}>
      <span className="landing-cycle-base inline-flex items-center" style={style}>
        {base}
      </span>
      <span
        className="landing-cycle-alt absolute inset-0 inline-flex items-center"
        style={style}
        aria-hidden="true"
      >
        {alt}
      </span>
    </span>
  );
}

function SectionEyebrow({
  id,
  label,
  className,
}: {
  id: string;
  label: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-center gap-2.5 font-mono text-xs tracking-[0.16em] text-muted uppercase',
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-state-completed" aria-hidden="true" />
      <span className="text-faint">{id}</span>
      {label}
    </p>
  );
}

function LandingHeader() {
  return (
    <header className="landing-header hairline-b sticky top-0 z-40">
      <div className="mx-auto flex h-14 w-full max-w-6xl 2xl:max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="rounded-sm" aria-label="Orbit home">
          <Wordmark />
        </Link>
        <nav aria-label="Landing sections" className="hidden items-center gap-6 text-sm md:flex">
          <a href="#features" className={quietLink}>
            Features
          </a>
          <a href="#realtime" className={quietLink}>
            Realtime
          </a>
          <a href="#keyboard" className={quietLink}>
            Keyboard
          </a>
          <a
            href="#pricing"
            className={cn(quietLink, 'line-through decoration-1')}
            aria-label="Pricing, there is none"
          >
            Pricing
          </a>
          <a href={GITHUB_HREF} className={quietLink} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </nav>
        <Link href={SIGN_IN_HREF} className={cn(primaryCta, 'h-8 px-3.5 text-xs')}>
          Sign in
        </Link>
      </div>
    </header>
  );
}

function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="landing-glow -top-[26rem] left-1/2 h-[52rem] w-[80rem] max-w-none -translate-x-1/2" />
      <div className="landing-ring -top-[30rem] w-[64rem]" />
      <div className="landing-ring -top-[34rem] w-[88rem]" />
      <div className="landing-ring -top-[38rem] w-[116rem]">
        <span className="absolute bottom-0 left-1/2 size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-accent" />
      </div>
    </div>
  );
}

const PRIORITY_ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  high: { icon: SignalHigh, tone: 'text-priority-high' },
  medium: { icon: SignalMedium, tone: 'text-priority-medium' },
  low: { icon: SignalLow, tone: 'text-priority-low' },
};

function PriorityGlyph({ level }: { level: string }) {
  const entry = PRIORITY_ICONS[level] ?? PRIORITY_ICONS['medium'];
  if (entry === undefined) return null;
  const Icon = entry.icon;
  return <Icon className={cn('size-3.5 shrink-0', entry.tone)} strokeWidth={2.25} />;
}

function MockAvatar({ initials, tone }: { initials: string; tone?: string }) {
  return (
    <span
      className={cn(
        'flex size-4.5 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-[9px] font-medium text-accent',
        tone,
      )}
    >
      {initials}
    </span>
  );
}

function StateDot({ tone }: { tone: string }) {
  return <span className={cn('size-2 shrink-0 rounded-full', tone)} />;
}

function MockRow({
  id,
  title,
  priority,
  avatar,
  label,
  done = false,
  flips = false,
}: {
  id: string;
  title: string;
  priority: string;
  avatar: string;
  label?: string;
  done?: boolean;
  flips?: boolean;
}) {
  return (
    <div className="hairline-b flex h-9 items-center gap-3 px-4 last:shadow-none">
      <PriorityGlyph level={priority} />
      <span className="w-14 shrink-0 font-mono text-2xs text-faint">{id}</span>
      {flips ? (
        <StackSwap
          className="min-w-0 flex-1"
          base={<span className="truncate text-xs">{title}</span>}
          alt={<span className="truncate text-xs text-faint line-through">{title}</span>}
        />
      ) : (
        <span className={cn('min-w-0 flex-1 truncate text-xs', done && 'text-muted')}>{title}</span>
      )}
      {label === undefined ? null : (
        <span className="hidden rounded-full border border-border px-1.5 py-px text-2xs text-muted md:inline">
          {label}
        </span>
      )}
      {flips ? (
        <StackSwap
          base={<StateDot tone="bg-state-started" />}
          alt={<StateDot tone="bg-state-completed" />}
        />
      ) : (
        <StateDot tone={done ? 'bg-state-completed' : 'bg-state-started'} />
      )}
      <MockAvatar initials={avatar} />
    </div>
  );
}

function MockGroupHeader({
  tone,
  name,
  from,
  to,
}: {
  tone: string;
  name: string;
  from: string;
  to: string;
}) {
  return (
    <div className="hairline-b flex items-center gap-2 bg-surface-2 px-4 py-1.5 text-xs text-muted">
      <StateDot tone={tone} />
      <span className="font-medium">{name}</span>
      <StackSwap
        className="w-4 justify-center font-mono text-2xs text-faint tabular"
        base={from}
        alt={to}
      />
    </div>
  );
}

function MockSidebarItem({
  icon: Icon,
  name,
  active = false,
  badge,
}: {
  icon: LucideIcon;
  name: string;
  active?: boolean;
  badge?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1 text-xs',
        active ? 'bg-surface-3 text-text' : 'text-muted',
      )}
    >
      <Icon className="size-3 shrink-0" strokeWidth={2} />
      <span className="flex-1">{name}</span>
      {badge === undefined ? null : <span className="font-mono text-2xs text-faint">{badge}</span>}
    </div>
  );
}

function ProductWindow() {
  return (
    <div aria-hidden="true" className="relative select-none text-left">
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
        <div className="hairline-b flex h-9 items-center gap-2 px-3">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full border border-border bg-surface-3" />
            <span className="size-2.5 rounded-full border border-border bg-surface-3" />
            <span className="size-2.5 rounded-full border border-border bg-surface-3" />
          </span>
          <span className="flex-1 text-center font-mono text-2xs text-faint">
            <span className="hidden sm:inline">meridian / web / cycle 14</span>
          </span>
          <span className="flex items-center gap-1.5">
            <MockAvatar initials="MK" />
            <MockAvatar initials="AS" />
            <MockAvatar initials="JT" />
            <span className="ml-1 flex items-center gap-1 rounded-full border border-border px-1.5 py-px text-2xs text-muted">
              <span className="landing-live-dot size-1.5 rounded-full bg-success" />
              Live
            </span>
          </span>
        </div>
        <div className="flex">
          <div className="hairline-r hidden w-44 shrink-0 flex-col gap-0.5 bg-bg p-2.5 sm:flex">
            <div className="mb-1.5 flex items-center gap-2 px-2 text-xs font-medium">
              <span className="flex size-4 items-center justify-center rounded bg-accent font-mono text-[9px] text-accent-contrast">
                M
              </span>
              Meridian
            </div>
            <MockSidebarItem icon={Inbox} name="Inbox" badge="3" />
            <MockSidebarItem icon={CircleDot} name="My issues" active />
            <MockSidebarItem icon={IterationCw} name="Cycles" />
            <MockSidebarItem icon={Box} name="Projects" />
            <MockSidebarItem icon={Layers} name="Views" />
            <MockSidebarItem icon={FileText} name="Docs" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="hairline-b flex h-9 items-center gap-1.5 px-4">
              <span className="rounded border border-border px-1.5 py-px text-2xs text-muted">
                State · Started
              </span>
              <span className="rounded border border-border px-1.5 py-px text-2xs text-muted">
                Assignee · me
              </span>
              <span className="flex-1" />
              <Kbd keys={['mod', 'k']} />
            </div>
            <MockGroupHeader tone="bg-state-started" name="In Progress" from="4" to="3" />
            <MockRow
              id="ORB-231"
              title="Palette: fuzzy match issue IDs"
              priority="high"
              avatar="AS"
              label="Bug"
            />
            <MockRow
              id="ORB-207"
              title="Slack: unfurl issue links in threads"
              priority="medium"
              avatar="MK"
              label="Integrations"
              flips
            />
            <MockRow
              id="ORB-198"
              title="Board: keyboard drag for columns"
              priority="medium"
              avatar="JT"
            />
            <MockRow
              id="ORB-186"
              title="Docs: paste GitHub links as issue chips"
              priority="low"
              avatar="AS"
            />
            <MockGroupHeader tone="bg-state-completed" name="Done" from="2" to="3" />
            <MockRow
              id="ORB-171"
              title="Filters: share saved views with the team"
              priority="medium"
              avatar="MK"
              done
            />
            <MockRow
              id="ORB-164"
              title="Cycles: carry unfinished scope forward"
              priority="low"
              avatar="JT"
              done
            />
          </div>
        </div>
      </div>
      <div className="landing-cycle-alt absolute right-3 bottom-3 flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-pop">
        <MockAvatar initials="MK" />
        <span>
          MK moved <span className="font-mono text-2xs">ORB-207</span> to Done
        </span>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative">
      <HeroBackdrop />
      <div className="relative mx-auto w-full max-w-6xl 2xl:max-w-7xl px-5 pt-20 pb-16 text-center sm:px-8 sm:pt-28">
        <p
          className="landing-rise mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 font-mono text-xs text-muted"
          style={{ animationDelay: '40ms' }}
        >
          <span className="landing-live-dot size-1.5 rounded-full bg-success" aria-hidden="true" />
          Free forever · No paid tiers · No catch
        </p>
        <h1 className="landing-h1 mx-auto mt-6 max-w-3xl" style={{ animationDelay: '90ms' }}>
          <span className="landing-rise inline-block" style={{ animationDelay: '90ms' }}>
            Issue tracking at the speed of typing.
          </span>
        </h1>
        <p
          className="landing-lede landing-rise mx-auto mt-5 max-w-2xl text-muted"
          style={{ animationDelay: '150ms' }}
        >
          Orbit is a free, realtime work tracker for teams: issues, cycles, projects, and docs,
          synced to every open screen the instant anything changes, driven entirely from the
          keyboard.
        </p>
        <div
          className="landing-rise mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row"
          style={{ animationDelay: '210ms' }}
        >
          <Link href={SIGN_IN_HREF} className={primaryCta}>
            Sign in to Orbit
          </Link>
          <span className="flex items-center gap-1.5 text-sm text-muted">
            or press <Kbd keys={['enter']} /> anywhere
          </span>
        </div>
        <p className="landing-rise mt-4 text-xs text-faint" style={{ animationDelay: '250ms' }}>
          Google, GitHub, passkey, or magic link. No password to invent.
        </p>
        <div
          className="landing-rise mx-auto mt-14 max-w-4xl 2xl:max-w-5xl"
          style={{ animationDelay: '300ms' }}
        >
          <ProductWindow />
        </div>
      </div>
    </section>
  );
}

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: SquareKanban,
    title: 'Issues and boards',
    body: 'Fast lists and drag-and-drop boards over the same issues, so triage and standup share one source of truth.',
  },
  {
    icon: IterationCw,
    title: 'Cycles and sprints',
    body: 'Timebox the work into cycles and watch the current sprint fill, start, and ship.',
  },
  {
    icon: Target,
    title: 'Projects',
    body: 'Group related work into projects that carry it from kickoff to done.',
  },
  {
    icon: FileText,
    title: 'Docs',
    body: 'A rich editor for specs, notes, and RFCs that lives next to the issues they describe.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Filters and saved views',
    body: 'Slice any list by state, assignee, label, or priority, then save the view for the whole team.',
  },
  {
    icon: GitPullRequest,
    title: 'GitHub and Slack',
    body: 'Connect the repo and the channel so updates land where the team already looks.',
  },
  {
    icon: Bell,
    title: 'Notifications',
    body: 'A focused inbox for mentions, assignments, and everything that needs your eyes.',
  },
  {
    icon: Bot,
    title: 'MCP server',
    body: 'Orbit speaks MCP, so agents can read the board, file issues, and update work for you.',
  },
];

function FeaturesSection() {
  return (
    <section
      id="features"
      className="mx-auto w-full max-w-6xl 2xl:max-w-7xl scroll-mt-20 px-5 py-24 sm:px-8"
    >
      <SectionEyebrow id="ORB-101" label="Features" />
      <h2 className="landing-h2 mt-4 max-w-xl">Everything a team ships with.</h2>
      <p className="landing-lede mt-4 max-w-xl text-muted">
        Not a starter tier with the good parts held back. This is the whole tracker.
      </p>
      <ul className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="group bg-bg p-6 transition-[background-color] duration-[var(--duration-base)] hover:bg-surface"
          >
            <Icon className="size-4.5 text-muted" strokeWidth={1.75} aria-hidden="true" />
            <h3 className="mt-4 text-sm font-semibold">{title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SyncPane({ owner, you = false }: { owner: string; you?: boolean }) {
  const delay = you ? '160ms' : undefined;
  const delayProps = delay === undefined ? {} : { delay };
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-pop">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs text-muted">
          <MockAvatar initials={you ? 'You' : 'MK'} />
          {owner}
        </span>
        <span className="landing-live-dot size-1.5 rounded-full bg-success" />
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-2.5">
        <span className="font-mono text-2xs text-faint">ORB-207</span>
        <span className="min-w-0 flex-1 truncate text-xs">Slack: unfurl issue links</span>
        <StackSwap
          {...delayProps}
          base={
            <span className="rounded-full border border-border px-2 py-px text-2xs text-state-started">
              In Progress
            </span>
          }
          alt={
            <span className="rounded-full border border-border px-2 py-px text-2xs text-state-completed">
              Done
            </span>
          }
        />
      </div>
    </div>
  );
}

function RealtimeSection() {
  return (
    <section id="realtime" className="hairline-b scroll-mt-20 border-t border-border bg-surface">
      <div className="mx-auto grid w-full max-w-6xl 2xl:max-w-7xl items-center gap-12 px-5 py-24 sm:px-8 lg:grid-cols-2">
        <div>
          <SectionEyebrow id="ORB-102" label="Realtime" />
          <h2 className="landing-h2 mt-4">Change it once. It changes everywhere.</h2>
          <p className="landing-lede mt-4 text-muted">
            Every edit commits to Postgres, publishes to Redis, and fans out over WebSockets to
            every open tab. Boards reorder, counts tick, and docs update in front of you. Nobody
            refreshes, and nobody plans a sprint from a stale list.
          </p>
          <p className="mt-6 flex flex-wrap items-center gap-2 font-mono text-xs text-faint">
            <span className="rounded border border-border px-2 py-1">postgres commit</span>
            <span aria-hidden="true">→</span>
            <span className="rounded border border-border px-2 py-1">redis publish</span>
            <span aria-hidden="true">→</span>
            <span className="rounded border border-border px-2 py-1">every open screen</span>
          </p>
        </div>
        <div aria-hidden="true" className="flex select-none flex-col gap-4">
          <SyncPane owner="Mira updates the issue" />
          <SyncPane owner="You see it as it happens" you />
        </div>
      </div>
    </section>
  );
}

function Keycap({ glyph, delay, wide = false }: { glyph: string; delay: string; wide?: boolean }) {
  const style = { animationDelay: delay };
  return (
    <span className="relative inline-flex">
      <kbd
        className={cn(
          'landing-press flex h-11 items-center justify-center rounded-md border border-border bg-surface-2 font-mono text-sm text-text shadow-hairline',
          wide ? 'px-3.5' : 'w-11',
        )}
        style={style}
      >
        {glyph}
      </kbd>
      <span
        className="landing-press-glow pointer-events-none absolute inset-0 rounded-md border border-accent"
        style={style}
      />
    </span>
  );
}

const SHORTCUTS: { keys: { glyph: string; delay: string; wide?: boolean }[]; action: string }[] = [
  { keys: [{ glyph: '⌘K', delay: '0s', wide: true }], action: 'Command palette' },
  { keys: [{ glyph: 'C', delay: '1.4s' }], action: 'New issue' },
  {
    keys: [
      { glyph: 'G', delay: '2.8s' },
      { glyph: 'I', delay: '3.1s' },
    ],
    action: 'My issues',
  },
  { keys: [{ glyph: '?', delay: '4.4s' }], action: 'Every shortcut' },
];

function PaletteMock() {
  return (
    <div
      aria-hidden="true"
      className="select-none overflow-hidden rounded-xl border border-border bg-surface shadow-pop"
    >
      <div className="hairline-b flex items-center gap-2.5 px-4 py-3">
        <Search className="size-4 text-faint" strokeWidth={2} />
        <span className="text-sm">Move to cycle</span>
        <span className="landing-caret -ml-1 h-4 w-px bg-accent" />
      </div>
      <div className="p-1.5 text-sm">
        <div className="flex items-center justify-between rounded-md bg-surface-2 px-2.5 py-2">
          <span className="flex items-center gap-2.5">
            <IterationCw className="size-4 text-muted" strokeWidth={2} />
            Move to Cycle 14
          </span>
          <Kbd keys={['enter']} />
        </div>
        <div className="flex items-center gap-2.5 px-2.5 py-2 text-muted">
          <IterationCw className="size-4 text-faint" strokeWidth={2} />
          Move to Cycle 15
        </div>
        <div className="flex items-center gap-2.5 px-2.5 py-2 text-muted">
          <SignalHigh className="size-4 text-faint" strokeWidth={2} />
          Set priority to High
        </div>
      </div>
    </div>
  );
}

function KeyboardSection() {
  return (
    <section
      id="keyboard"
      className="mx-auto w-full max-w-6xl 2xl:max-w-7xl scroll-mt-20 px-5 py-24 sm:px-8"
    >
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="lg:order-2">
          <SectionEyebrow id="ORB-103" label="Keyboard first" />
          <h2 className="landing-h2 mt-4">Your hands never leave the keys.</h2>
          <p className="landing-lede mt-4 text-muted">
            Everything in Orbit has a shortcut. Open the command palette with ⌘K, file an issue with
            C, jump to your queue with G then I. Press ? once and Orbit shows you all the rest.
          </p>
          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-2">
            {SHORTCUTS.map(({ keys, action }) => (
              <li key={action} className="flex flex-col items-start gap-2">
                <span className="flex items-center gap-1.5">
                  {keys.map(({ glyph, delay, wide }) => (
                    <Keycap key={glyph} glyph={glyph} delay={delay} wide={wide ?? false} />
                  ))}
                </span>
                <span className="text-xs text-muted">{action}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:order-1">
          <PaletteMock />
        </div>
      </div>
    </section>
  );
}

const INCLUDED: string[] = [
  'Issues, boards, cycles, projects, docs',
  'Realtime sync for every teammate',
  'GitHub, Slack, and MCP included',
  'Notifications, filters, saved views',
  'No seat limits, no feature gates',
];

function GhostTier({ name }: { name: string }) {
  return (
    <div
      aria-hidden="true"
      className="hidden flex-col gap-3 rounded-xl border border-border border-dashed p-7 opacity-60 md:flex"
    >
      <span className="font-mono text-xs tracking-[0.16em] text-faint uppercase">{name}</span>
      <span className="text-sm text-faint">This tier does not exist.</span>
      <span className="mt-2 h-2 w-3/4 rounded bg-surface-2" />
      <span className="h-2 w-1/2 rounded bg-surface-2" />
      <span className="h-2 w-2/3 rounded bg-surface-2" />
    </div>
  );
}

function PricingSection() {
  return (
    <section
      id="pricing"
      className="hairline-b scroll-mt-20 border-t border-border bg-surface px-5 py-24 sm:px-8"
    >
      <div className="mx-auto w-full max-w-5xl text-center">
        <SectionEyebrow id="ORB-104" label="Pricing" className="justify-center" />
        <h2 className="landing-h2 mt-4">There is no pricing.</h2>
        <p className="landing-lede mx-auto mt-4 max-w-2xl text-muted">
          Orbit is free the way a calculator is free. No trials, no seats, no feature gates, no
          billing page hiding in settings. Everything on this page is the whole product, for every
          teammate, forever.
        </p>
        <div className="mx-auto mt-12 grid max-w-4xl items-center gap-6 md:grid-cols-3">
          <GhostTier name="Pro" />
          <div className="rounded-xl border border-border bg-bg p-7 text-left shadow-pop">
            <span className="font-mono text-xs tracking-[0.16em] text-muted uppercase">
              Everything
            </span>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="font-mono text-5xl font-semibold tracking-tight">$0</span>
              <span className="text-sm text-muted">forever</span>
            </p>
            <ul className="mt-5 flex flex-col gap-2.5">
              {INCLUDED.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-sm text-muted">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-success" strokeWidth={2.5} />
                  {line}
                </li>
              ))}
            </ul>
            <Link href={SIGN_IN_HREF} className={cn(primaryCta, 'mt-7 w-full')}>
              Sign in
            </Link>
            <p className="mt-3 text-center text-xs text-faint">
              No card. There is nowhere to enter one.
            </p>
          </div>
          <GhostTier name="Enterprise" />
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="landing-glow -bottom-[30rem] left-1/2 h-[40rem] w-[64rem] max-w-none -translate-x-1/2"
        aria-hidden="true"
      />
      <div className="relative mx-auto w-full max-w-6xl 2xl:max-w-7xl px-5 py-28 text-center sm:px-8">
        <h2 className="landing-h2">Ready when you are.</h2>
        <p className="landing-lede mx-auto mt-4 max-w-xl text-muted">
          Sign in with Google, GitHub, a passkey, or a magic link, and bring your team with you.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link href={SIGN_IN_HREF} className={primaryCta}>
            Sign in to Orbit
          </Link>
          <span className="flex items-center gap-1.5 text-sm text-muted">
            or press <Kbd keys={['enter']} />
          </span>
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl 2xl:max-w-7xl flex-col justify-between gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center">
        <div className="flex flex-col gap-2">
          <Wordmark />
          <p className="text-sm text-muted">The free, realtime, keyboard-first work tracker.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <a href="#features" className={quietLink}>
            Features
          </a>
          <a href="#realtime" className={quietLink}>
            Realtime
          </a>
          <a href="#keyboard" className={quietLink}>
            Keyboard
          </a>
          <a href="#pricing" className={quietLink}>
            Pricing
          </a>
          <a href={GITHUB_HREF} className={quietLink} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <Link href={SIGN_IN_HREF} className={quietLink}>
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <EnterToSignIn />
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <FeaturesSection />
        <RealtimeSection />
        <KeyboardSection />
        <PricingSection />
        <ClosingCta />
      </main>
      <LandingFooter />
    </div>
  );
}
