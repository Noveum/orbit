import { notFound, permanentRedirect } from 'next/navigation';

const TEAM_KEY = /^[A-Za-z0-9]{1,10}$/;

export default async function ActiveCycleRedirect({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<never> {
  const { key } = await params;
  if (!TEAM_KEY.test(key)) notFound();
  permanentRedirect(`/team/${key}/sprint/active`);
}
