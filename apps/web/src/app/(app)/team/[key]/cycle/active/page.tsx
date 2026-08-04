import { permanentRedirect } from 'next/navigation';

export default async function ActiveCycleRedirect({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<never> {
  const { key } = await params;
  permanentRedirect(`/team/${key}/sprint/active`);
}
