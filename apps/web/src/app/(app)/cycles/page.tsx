import { permanentRedirect } from 'next/navigation';

export default function CyclesRedirect(): never {
  permanentRedirect('/sprints');
}
