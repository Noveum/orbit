import type { Metadata } from 'next';
import { ViewsPage } from '@/features/views/views-page.tsx';

export const metadata: Metadata = { title: 'Views' };

export default function Views() {
  return <ViewsPage />;
}
