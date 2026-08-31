import { NextRequest, NextResponse } from 'next/server';
import { getStoreProduct } from '@/lib/shopify-store';

export async function GET(request: NextRequest) {
  const handle = request.nextUrl.searchParams.get('handle') || '';
  const productUrl = request.nextUrl.searchParams.get('productUrl') || '';

  if (!handle && !productUrl) {
    return NextResponse.json({ error: 'handle or productUrl is required' }, { status: 400 });
  }

  const product = await getStoreProduct({ handle, productUrl });
  if (!product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  }

  const firstAvailable = product.variants.find(variant => variant.available) || product.variants[0];
  const selectedOptions = firstAvailable
    ? product.options.map((option, index) => ({ name: option.name, value: firstAvailable.options[index] || '' }))
    : [];

  return NextResponse.json({
    product: {
      productName: product.title,
      productId: product.id,
      productHandle: product.handle,
      productUrl: product.productUrl,
      image: product.image || undefined,
      price: firstAvailable?.price || undefined,
      variantId: firstAvailable?.id || undefined,
      available: product.available,
      options: product.options,
      selectedOptions,
      variants: product.variants,
    },
  });
}
