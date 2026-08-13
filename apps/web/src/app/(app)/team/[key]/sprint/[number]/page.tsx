import { permanentRedirect } from 'next/navigation';

export default function TeamSprintNumberRedirect(): never {
  permanentRedirect('/sprints');
}
