'use client';

import React from 'react';
import { redirect } from 'next/navigation';

export default function Home() {
  // Redirect admin dashboard to /dashboard
  React.useEffect(() => {
    redirect('/dashboard');
  }, []);

  return null;
}
