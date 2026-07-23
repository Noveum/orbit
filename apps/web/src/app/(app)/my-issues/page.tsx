import type { Metadata } from 'next';
import { MyIssuesView } from '@/features/issues/my-issues-view.tsx';

export const metadata: Metadata = { title: 'My issues' };

export default function MyIssuesPage() {
  return <MyIssuesView />;
}
