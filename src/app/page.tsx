'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import OrderChat from '@/components/OrderChat';

function generateSessionId(): string {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

export default function Home() {
  const searchParams = useSearchParams();

  const productInfo = useMemo(() => {
    return {
      productName: searchParams.get('product') || searchParams.get('name') || 'Premium Polo T-shirt',
      color: searchParams.get('color') || undefined,
      size: searchParams.get('size') || undefined,
      price: searchParams.get('price') || undefined,
    };
  }, [searchParams]);

  const sessionId = useMemo(() => generateSessionId(), []);

  return <OrderChat productInfo={productInfo} sessionId={sessionId} />;
}
