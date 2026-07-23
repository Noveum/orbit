'use client';

import { ONBOARDING_STEPS, type OnboardingStep } from '@orbit/shared/constants';
import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/cn.ts';
import { InviteStep } from './steps/invite-step.tsx';
import { ProfileStep } from './steps/profile-step.tsx';
import { ThemeStep } from './steps/theme-step.tsx';
import { WorkspaceStep } from './steps/workspace-step.tsx';
import type { OnboardingStatusView, PendingInviteView } from './types.ts';

const STEP_LABELS: Record<OnboardingStep, string> = {
  profile: 'Your profile',
  workspace: 'Workspace',
  invite: 'Teammates',
  theme: 'Preferences',
};

type StepState = 'done' | 'current' | 'todo';

function stepStateFor(index: number, currentIndex: number): StepState {
  if (index < currentIndex) return 'done';
  if (index === currentIndex) return 'current';
  return 'todo';
}

export interface OnboardingFlowProps {
  readonly initialStep: OnboardingStep;
  readonly status: OnboardingStatusView;
  readonly invites: readonly PendingInviteView[];
  readonly landingPath: string;
}

export function OnboardingFlow({ initialStep, status, invites, landingPath }: OnboardingFlowProps) {
  const [step, setStep] = useState<OnboardingStep>(initialStep);

  function onNext(next: OnboardingStatusView): void {
    if (next.completed || next.step === 'done') {
      window.location.assign(landingPath);
      return;
    }
    setStep(next.step);
  }

  const currentIndex = ONBOARDING_STEPS.indexOf(step);

  return (
    <div className="flex w-full max-w-xl flex-col gap-8">
      <ol className="flex items-center gap-2" aria-label="Onboarding progress">
        {ONBOARDING_STEPS.map((entry, index) => {
          const state = stepStateFor(index, currentIndex);
          return (
            <li key={entry} className="flex flex-1 items-center gap-2">
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border text-2xs',
                  state === 'done' && 'border-accent bg-accent text-accent-contrast',
                  state === 'current' && 'border-accent text-accent',
                  state === 'todo' && 'border-border text-faint',
                )}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                {state === 'done' ? (
                  <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn('truncate text-2xs', state === 'todo' ? 'text-faint' : 'text-muted')}
              >
                {STEP_LABELS[entry]}
              </span>
            </li>
          );
        })}
      </ol>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
        >
          {step === 'profile' ? (
            <ProfileStep
              name={status.name}
              image={status.image}
              handle={status.handle}
              onNext={onNext}
            />
          ) : null}
          {step === 'workspace' ? <WorkspaceStep invites={invites} onNext={onNext} /> : null}
          {step === 'invite' ? <InviteStep onNext={onNext} /> : null}
          {step === 'theme' ? <ThemeStep onNext={onNext} /> : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
