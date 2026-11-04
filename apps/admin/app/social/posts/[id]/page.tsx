'use client';

import { use } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import Composer from '@/components/social/Composer';

export default function SocialPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <DashboardLayout>
      <Composer key={id} postId={id} />
    </DashboardLayout>
  );
}
