'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import OrderChat from '@/components/OrderChat';

type ProductOptionDefinition = {
  name: string;
  values: string[];
};

type SelectedProductOption = {
  name: string;
  value: string;
};

type ProductVariant = {
  id: string;
  options: string[];
  available: boolean;
  price?: string;
  compareAtPrice?: string | null;
  sku?: string | null;
};

function generateSessionId(): string {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

function parseJsonParam<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default function Home() {
  const searchParams = useSearchParams();

  const productInfo = useMemo(() => {
    const options = parseJsonParam<ProductOptionDefinition[]>(searchParams.get('options'), []);
    const selectedOptions = parseJsonParam<SelectedProductOption[]>(searchParams.get('selectedOptions'), []);
    const variants = parseJsonParam<ProductVariant[]>(searchParams.get('variants'), []);

    const selectedColor = selectedOptions.find(option => /colou?r/i.test(option.name))?.value;
    const selectedSize = selectedOptions.find(option => /size/i.test(option.name))?.value;

    return {
      productName: searchParams.get('product') || searchParams.get('name') || 'Premium Polo T-shirt',
      color: searchParams.get('color') || selectedColor || undefined,
      size: searchParams.get('size') || selectedSize || undefined,
      price: searchParams.get('price') || undefined,
      productId: searchParams.get('productId') || undefined,
      productHandle: searchParams.get('handle') || undefined,
      variantId: searchParams.get('variantId') || undefined,
      productUrl: searchParams.get('productUrl') || undefined,
      image: searchParams.get('image') || undefined,
      available: searchParams.has('available') ? searchParams.get('available') === '1' : undefined,
      options,
      selectedOptions,
      variants,
    };
  }, [searchParams]);

  const sessionId = useMemo(() => generateSessionId(), []);

  return <OrderChat productInfo={productInfo} sessionId={sessionId} />;
}
