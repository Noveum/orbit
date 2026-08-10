import { permanentRedirect } from 'next/navigation';

export default function TeamSprintRedirect(): never {
  permanentRedirect('/sprints');
}
