'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
  ShoppingBag,
  User,
  MapPin,
  Phone,
  CheckCircle2,
  MessageCircle,
  Loader2,
  ShieldCheck,
  Pencil,
  SlidersHorizontal,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import BrandLogo from '@/components/BrandLogo';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  time: string;
}

interface ProductOptionDefinition {
  name: string;
  values: string[];
}

interface SelectedProductOption {
  name: string;
  value: string;
}

interface ProductVariant {
  id: string;
  options: string[];
  available: boolean;
  price?: string;
  compareAtPrice?: string | null;
  sku?: string | null;
}

interface ProductInfo {
  productName: string;
  color?: string;
  size?: string;
  price?: string;
  productId?: string;
  productHandle?: string;
  variantId?: string;
  productUrl?: string;
  image?: string;
  available?: boolean;
  options?: ProductOptionDefinition[];
  selectedOptions?: SelectedProductOption[];
  variants?: ProductVariant[];
}

interface CustomerDetails {
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
}

type DetailField = keyof CustomerDetails;

interface DetailIssue {
  field: DetailField;
  reason: string;
  suggestion?: string;
}

interface PricingInfo {
  productPrice: string;
  shippingPrice: string;
  totalPrice: string;
  shippingRateName: string;
  currency?: string;
}

interface OrderData extends CustomerDetails {
  id: string;
  productName: string;
  color: string | null;
  size: string | null;
  price: string | null;
  shippingPrice?: string | null;
  shippingRateName?: string | null;
  totalPrice?: string | null;
  productOptions?: SelectedProductOption[] | null;
  customerWhatsAppSent?: boolean;
  ownerWhatsAppSent?: boolean;
}

const emptyDetails: CustomerDetails = {
  customerName: '',
  customerPhone: '',
  customerCity: '',
  customerAddress: '',
};

function getTimeString(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function shippingAmountLabel(value?: string | null): string {
  return Number(value || 0) === 0 ? 'Free' : `Rs.${value}`;
}

function ChatHeader({ subtitle }: { subtitle: string }) {
  return (
    <header className="bg-[#075e54] text-white px-4 py-3 flex items-center gap-3 shadow-md">
      <BrandLogo size="sm" />
      <div>
        <h1 className="font-bold text-base">Sparrow Official</h1>
        <p className="text-xs text-green-200 flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-300 rounded-full inline-block" />
          {subtitle}
        </p>
      </div>
    </header>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-gray-50 p-3">
      <div className="mt-0.5 text-gray-500">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] text-gray-500">{label}</p>
        <p className="text-sm font-semibold text-gray-900 break-words">{value}</p>
      </div>
    </div>
  );
}

function PricingBreakdown({ pricing }: { pricing: PricingInfo }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-emerald-100 bg-emerald-50/50">
      <div className="flex items-center justify-between px-3 py-2.5 text-sm">
        <span className="text-gray-600">Product Price</span>
        <span className="font-semibold text-gray-900">Rs.{pricing.productPrice}</span>
      </div>
      <div className="flex items-center justify-between border-t border-emerald-100 px-3 py-2.5 text-sm">
        <div>
          <span className="text-gray-600">Shipping</span>
          {pricing.shippingRateName && (
            <span className="ml-1 text-[11px] text-gray-400">({pricing.shippingRateName})</span>
          )}
        </div>
        <span className="font-semibold text-gray-900">{shippingAmountLabel(pricing.shippingPrice)}</span>
      </div>
      <div className="flex items-center justify-between border-t border-emerald-200 bg-white/70 px-3 py-3">
        <span className="font-bold text-gray-900">Grand Total</span>
        <span className="text-lg font-extrabold text-[#075e54]">Rs.{pricing.totalPrice}</span>
      </div>
    </div>
  );
}

function buildInitialOptionValues(productInfo: ProductInfo): Record<string, string> {
  const result: Record<string, string> = {};

  for (const definition of productInfo.options || []) {
    const selected = productInfo.selectedOptions?.find(
      option => option.name.toLowerCase() === definition.name.toLowerCase()
    );
    result[definition.name] = selected?.value || (definition.values.length === 1 ? definition.values[0] : '');
  }

  return result;
}

function findMatchingVariant(
  definitions: ProductOptionDefinition[],
  variants: ProductVariant[],
  values: Record<string, string>
): ProductVariant | undefined {
  if (variants.length === 0) return undefined;

  if (definitions.some(definition => !String(values[definition.name] || '').trim())) {
    return undefined;
  }

  return variants.find(variant =>
    definitions.every((definition, index) =>
      String(variant.options?.[index] ?? '') === String(values[definition.name] ?? '')
    )
  );
}

function canSelectOptionValue(
  targetName: string,
  targetValue: string,
  definitions: ProductOptionDefinition[],
  variants: ProductVariant[],
  selectedValues: Record<string, string>
): boolean {
  if (variants.length === 0) return true;

  const targetIndex = definitions.findIndex(definition => definition.name === targetName);
  if (targetIndex < 0) return true;

  return variants.some(variant => {
    if (!variant.available || String(variant.options?.[targetIndex] ?? '') !== targetValue) return false;

    return definitions.every((definition, index) => {
      if (index === targetIndex) return true;
      const selected = selectedValues[definition.name];
      return !selected || String(variant.options?.[index] ?? '') === selected;
    });
  });
}

export default function OrderChat({ productInfo, sessionId }: { productInfo: ProductInfo; sessionId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [showOrderSummary, setShowOrderSummary] = useState(false);
  const [isStarted, setIsStarted] = useState(false);

  const [details, setDetails] = useState<CustomerDetails>(emptyDetails);
  const [issues, setIssues] = useState<DetailIssue[]>([]);
  const [showDetailsForm, setShowDetailsForm] = useState(false);
  const [verifiedDetails, setVerifiedDetails] = useState<CustomerDetails | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [productOptionValues, setProductOptionValues] = useState<Record<string, string>>(() =>
    buildInitialOptionValues(productInfo)
  );
  const [productOptionError, setProductOptionError] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  const optionDefinitions = productInfo.options || [];
  const variants = productInfo.variants || [];

  const selectedProductOptions = useMemo<SelectedProductOption[]>(() => {
    return optionDefinitions
      .map(definition => ({
        name: definition.name,
        value: productOptionValues[definition.name] || '',
      }))
      .filter(option => option.value);
  }, [optionDefinitions, productOptionValues]);

  const matchedVariant = useMemo(
    () => findMatchingVariant(optionDefinitions, variants, productOptionValues),
    [optionDefinitions, variants, productOptionValues]
  );

  const allVariantsOutOfStock = useMemo(() => {
    if (variants.length > 0) return !variants.some(variant => variant.available);
    return productInfo.available === false;
  }, [variants, productInfo.available]);

  const resolvedProductInfo = useMemo<ProductInfo>(() => {
    const color = selectedProductOptions.find(option => /colou?r/i.test(option.name))?.value;
    const size = selectedProductOptions.find(option => /size/i.test(option.name))?.value;

    return {
      ...productInfo,
      color: color || productInfo.color,
      size: size || productInfo.size,
      selectedOptions: selectedProductOptions,
      variantId: matchedVariant?.id || (variants.length === 0 ? productInfo.variantId : undefined),
      price: matchedVariant?.price || productInfo.price,
      available: matchedVariant ? matchedVariant.available : variants.length > 0 ? undefined : productInfo.available,
    };
  }, [productInfo, selectedProductOptions, matchedVariant, variants.length]);

  const appendMessage = useCallback((text: string, sender: 'user' | 'bot') => {
    setMessages(prev => [
      ...prev,
      {
        id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text,
        sender,
        time: getTimeString(),
      },
    ]);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, showDetailsForm, awaitingConfirmation, scrollToBottom]);

  useEffect(() => {
    if (!isStarted || isLoading || showOrderSummary) return;

    const timer = window.setTimeout(() => {
      if (showDetailsForm) {
        const firstIssue = issues[0]?.field;
        if (firstIssue === 'customerPhone') phoneRef.current?.focus();
        else if (firstIssue === 'customerCity') cityRef.current?.focus();
        else if (firstIssue === 'customerAddress') addressRef.current?.focus();
        else nameRef.current?.focus();
        return;
      }

      if (!awaitingConfirmation) inputRef.current?.focus({ preventScroll: true });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [isStarted, isLoading, showOrderSummary, showDetailsForm, awaitingConfirmation, issues, messages.length]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const trimmed = text.trim();
    appendMessage(trimmed, 'user');
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, sessionId, productInfo: resolvedProductInfo }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Request failed');
      appendMessage(data.reply, 'bot');
    } catch {
      appendMessage('Oops! Kuch technical issue aa gaya. Please thodi der baad try karein. 🙏', 'bot');
      toast({ title: 'Error', description: 'Message send nahi ho saka. Please try again.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [appendMessage, isLoading, resolvedProductInfo, sessionId, toast]);

  const handleStart = () => {
    if (allVariantsOutOfStock) {
      toast({
        title: 'Out of stock',
        description: 'Is product ka koi available variation filhal stock mein nahi hai.',
        variant: 'destructive',
      });
      return;
    }

    setIsStarted(true);
    setShowDetailsForm(true);
    setMessages([
      {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        time: getTimeString(),
        text: `Assalam o Alaikum! ${productInfo.productName} order karne ke liye available product options aur apni delivery details neeche confirm/fill kar dein. Out-of-stock variations select nahi hongi.`,
      },
    ]);
  };

  const updateDetail = (field: DetailField, value: string) => {
    setDetails(prev => ({ ...prev, [field]: value }));
    setIssues(prev => prev.filter(issue => issue.field !== field));
    setVerifiedDetails(null);
    setPricing(null);
  };

  const updateProductOption = (name: string, value: string) => {
    setProductOptionValues(prev => ({ ...prev, [name]: value }));
    setProductOptionError('');
    setVerifiedDetails(null);
    setPricing(null);
  };

  const issueFor = (field: DetailField) => issues.find(issue => issue.field === field);

  const validateProductOptions = (): boolean => {
    const missing = optionDefinitions.find(
      definition => !String(productOptionValues[definition.name] || '').trim()
    );

    if (missing) {
      const message = `Please ${missing.name} select karein.`;
      setProductOptionError(message);
      toast({ title: 'Product option required', description: message, variant: 'destructive' });
      return false;
    }

    if (variants.length > 0) {
      if (!matchedVariant) {
        const message = 'Ye product variation available nahi hai. Please doosra Size/Color select karein.';
        setProductOptionError(message);
        toast({ title: 'Invalid variation', description: message, variant: 'destructive' });
        return false;
      }

      if (!matchedVariant.available) {
        const message = 'Ye selected variation out of stock hai. Please doosra available option select karein.';
        setProductOptionError(message);
        toast({ title: 'Out of stock', description: message, variant: 'destructive' });
        return false;
      }
    } else if (productInfo.available === false) {
      const message = 'Ye product filhal out of stock hai.';
      setProductOptionError(message);
      toast({ title: 'Out of stock', description: message, variant: 'destructive' });
      return false;
    }

    return true;
  };

  const submitDetails = async () => {
    if (isLoading || !validateProductOptions()) return;
    setIsLoading(true);
    setIssues([]);
    setPricing(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify_details',
          sessionId,
          productInfo: resolvedProductInfo,
          details,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Verification failed');

      if (data.details) setDetails(data.details);
      appendMessage(data.reply, 'bot');

      if (data.needsCorrection) {
        setIssues(data.issues || []);
        setShowDetailsForm(true);
        setAwaitingConfirmation(false);
        setPricing(null);
        return;
      }

      if (data.detailsVerified && data.details) {
        setVerifiedDetails(data.details);
        setPricing(data.pricing || null);
        setShowDetailsForm(false);
        setAwaitingConfirmation(true);
      }
    } catch {
      appendMessage('Details verify nahi ho sakin. Please dobara try karein.', 'bot');
      toast({ title: 'Verification failed', description: 'Please details check karke dobara try karein.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const confirmOrder = async () => {
    if (!verifiedDetails || isLoading || !validateProductOptions()) return;
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_order',
          sessionId,
          productInfo: resolvedProductInfo,
          details: verifiedDetails,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Order failed');

      if (data.needsCorrection) {
        setDetails(data.details || verifiedDetails);
        setIssues(data.issues || []);
        setShowDetailsForm(true);
        setAwaitingConfirmation(false);
        setPricing(null);
        appendMessage(data.reply, 'bot');
        return;
      }

      if (data.orderComplete && data.order) {
        appendMessage(data.reply, 'bot');
        setOrderData(data.order);
        setPricing(data.pricing || pricing);
        setAwaitingConfirmation(false);
        window.setTimeout(() => setShowOrderSummary(true), 500);
      }
    } catch {
      appendMessage('Order confirm nahi ho saka. Please dobara try karein.', 'bot');
      toast({ title: 'Order failed', description: 'Please dobara confirm karein.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const editDetails = () => {
    if (verifiedDetails) setDetails(verifiedDetails);
    setAwaitingConfirmation(false);
    setShowDetailsForm(true);
    setIssues([]);
    setPricing(null);
  };

  const handleNewOrder = () => window.location.reload();

  const productOptionText = (orderData?.productOptions || selectedProductOptions)
    .map(option => `${option.name}: ${option.value}`)
    .join(' • ');

  const selectedStockLabel = matchedVariant
    ? matchedVariant.available ? 'In stock' : 'Out of stock'
    : variants.length > 0 && selectedProductOptions.length === optionDefinitions.length
      ? 'Variation unavailable'
      : null;

  if (!isStarted) {
    return (
      <div className="min-h-screen flex flex-col bg-[#eae6df]">
        <ChatHeader subtitle="Online — Order Assistant" />

        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl shadow-black/10">
            <div className="flex justify-center">
              <BrandLogo size="lg" className="ring-2 ring-[#075e54]/10" />
            </div>

            {productInfo.image && (
              <div className="mx-auto mt-5 h-28 w-28 overflow-hidden rounded-2xl bg-gray-50 ring-1 ring-gray-100">
                <img src={productInfo.image} alt={productInfo.productName} className="h-full w-full object-cover" />
              </div>
            )}

            <div className="mt-5 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#075e54]">Ready to order</p>
              <h2 className="mt-2 text-xl font-bold text-gray-950">{productInfo.productName}</h2>

              {selectedProductOptions.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {selectedProductOptions.map(option => (
                    <span key={option.name} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                      {option.name}: {option.value}
                    </span>
                  ))}
                </div>
              )}

              {resolvedProductInfo.price && (
                <p className="mt-3 text-2xl font-extrabold text-[#075e54]">Rs.{resolvedProductInfo.price}</p>
              )}

              {(selectedStockLabel || allVariantsOutOfStock) && (
                <p className={`mt-2 text-sm font-bold ${matchedVariant?.available && !allVariantsOutOfStock ? 'text-emerald-600' : 'text-red-600'}`}>
                  {allVariantsOutOfStock ? 'Out of stock' : selectedStockLabel}
                </p>
              )}
            </div>

            <div className="my-6 h-px bg-gray-100" />

            <div className="rounded-2xl bg-[#f7faf9] px-4 py-3 text-center">
              <p className="text-sm leading-5 text-gray-600">
                Size, Color aur doosri variations Shopify stock ke mutabiq verify hongi. Phir delivery details ek hi dafa fill karein.
              </p>
            </div>

            <Button
              onClick={handleStart}
              disabled={allVariantsOutOfStock}
              className="mt-5 h-12 w-full rounded-xl bg-[#25d366] text-base font-bold text-white hover:bg-[#1ebe57] disabled:bg-gray-300"
            >
              <MessageCircle className="mr-2 h-5 w-5" />
              {allVariantsOutOfStock ? 'Out of Stock' : 'Start Order'}
            </Button>

            <div className="mt-5 flex items-center justify-center gap-2 text-xs text-gray-500">
              <ShieldCheck className="h-4 w-4 text-[#075e54]" />
              <span>COD &amp; Advance Payment • Secure Order</span>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (showOrderSummary && orderData) {
    const finalPricing: PricingInfo | null = orderData.totalPrice
      ? {
          productPrice: orderData.price || '0',
          shippingPrice: orderData.shippingPrice || '0',
          shippingRateName: orderData.shippingRateName || 'Shipping',
          totalPrice: orderData.totalPrice,
        }
      : pricing;

    return (
      <div className="min-h-screen flex flex-col bg-[#eae6df]">
        <ChatHeader subtitle="Order Confirmed" />

        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl shadow-black/10">
            <div className="text-center">
              <BrandLogo size="lg" className="mx-auto ring-2 ring-[#25d366]/20" />
              <div className="mt-4 flex items-center justify-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-[#25d366]" />
                <h2 className="text-lg font-bold text-gray-900">Order Confirm Ho Gaya!</h2>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Order ID: <span className="font-mono font-bold text-gray-800">{orderData.id.slice(0, 8).toUpperCase()}</span>
              </p>
              {orderData.customerWhatsAppSent && (
                <p className="mt-2 text-xs font-medium text-[#075e54]">Confirmation WhatsApp par bhej di gayi hai.</p>
              )}
            </div>

            <div className="mt-5 space-y-3">
              <DetailRow
                label="Product"
                value={`${orderData.productName}${productOptionText ? ` — ${productOptionText}` : ''}`}
                icon={<ShoppingBag className="h-4 w-4" />}
              />
              <DetailRow label="Customer" value={orderData.customerName} icon={<User className="h-4 w-4" />} />
              <DetailRow label="Phone" value={orderData.customerPhone} icon={<Phone className="h-4 w-4" />} />
              <DetailRow
                label="Delivery Address"
                value={`${orderData.customerCity} — ${orderData.customerAddress}`}
                icon={<MapPin className="h-4 w-4" />}
              />
              {finalPricing && <PricingBreakdown pricing={finalPricing} />}
            </div>

            <p className="mt-5 text-center text-xs text-gray-400">Order ID save kar lein.</p>
          </div>

          <button onClick={handleNewOrder} className="absolute bottom-8 text-sm font-medium text-[#075e54] underline underline-offset-2">
            Naya order karein
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#eae6df]">
      <div className="sticky top-0 z-10">
        <ChatHeader subtitle="Online" />
      </div>

      <div className="border-b bg-white px-4 py-2.5 flex items-center gap-3">
        {productInfo.image ? (
          <img src={productInfo.image} alt="" className="h-10 w-10 rounded-xl object-cover ring-1 ring-gray-100" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
            <ShoppingBag className="h-4 w-4 text-gray-500" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{productInfo.productName}</p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            {selectedProductOptions.map(option => (
              <span key={option.name}>{option.name}: {option.value}</span>
            ))}
            {resolvedProductInfo.price && <span className="font-bold text-[#075e54]">Rs.{resolvedProductInfo.price}</span>}
            {matchedVariant && (
              <span className={matchedVariant.available ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>
                {matchedVariant.available ? 'In stock' : 'Out of stock'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-3 py-4"
        style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23d4d0c8\' fill-opacity=\'0.15\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
        }}
      >
        <div className="space-y-2">
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm ${
                  msg.sender === 'user' ? 'rounded-br-sm bg-[#dcf8c6]' : 'rounded-bl-sm bg-white'
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">{msg.text}</p>
                <p className={`mt-1 text-right text-[10px] ${msg.sender === 'user' ? 'text-green-700/60' : 'text-gray-400'}`}>{msg.time}</p>
              </div>
            </div>
          ))}
        </div>

        {showDetailsForm && (
          <div className="mx-auto mt-5 w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-5 shadow-lg shadow-black/5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-[#075e54]/10 p-2 text-[#075e54]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Complete Your Order</h3>
                <p className="mt-0.5 text-xs text-gray-500">Available variation select karein aur delivery details ek hi dafa fill karein.</p>
              </div>
            </div>

            {optionDefinitions.length > 0 && (
              <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-[#075e54]" />
                  <h4 className="text-sm font-bold text-gray-900">Product Options</h4>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {optionDefinitions.map(definition => (
                    <label key={definition.name} className="block">
                      <span className="mb-1.5 block text-xs font-semibold text-gray-700">{definition.name}</span>
                      <select
                        value={productOptionValues[definition.name] || ''}
                        onChange={event => updateProductOption(definition.name, event.target.value)}
                        disabled={isLoading}
                        className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none transition focus:ring-2 focus:ring-[#075e54]/20"
                      >
                        <option value="">Select {definition.name}</option>
                        {definition.values.map(value => {
                          const inStock = canSelectOptionValue(
                            definition.name,
                            value,
                            optionDefinitions,
                            variants,
                            productOptionValues
                          );
                          return (
                            <option key={value} value={value} disabled={!inStock}>
                              {value}{!inStock ? ' — Out of stock' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  ))}
                </div>

                {matchedVariant && (
                  <div className={`mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold ${matchedVariant.available ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    <span>{matchedVariant.available ? 'Selected variation in stock' : 'Selected variation out of stock'}</span>
                    {matchedVariant.price && <span>Rs.{matchedVariant.price}</span>}
                  </div>
                )}

                {productOptionError && (
                  <p className="mt-2 flex items-center gap-1 text-xs font-medium text-red-600">
                    <AlertCircle className="h-3.5 w-3.5" /> {productOptionError}
                  </p>
                )}
              </div>
            )}

            {issues.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-900">Please highlighted fields check karein:</p>
                <ul className="mt-1 space-y-1 text-xs text-amber-800">
                  {issues.map(issue => (
                    <li key={`${issue.field}-${issue.reason}`}>• {issue.reason}{issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">Full Name</span>
                <input
                  ref={nameRef}
                  value={details.customerName}
                  onChange={e => updateDetail('customerName', e.target.value)}
                  placeholder="e.g. Farrukh Saleem"
                  disabled={isLoading}
                  className={`h-11 w-full rounded-xl border px-3 text-sm outline-none transition focus:ring-2 focus:ring-[#075e54]/20 ${issueFor('customerName') ? 'border-amber-400 bg-amber-50/50' : 'border-gray-200'}`}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">Mobile Number</span>
                <input
                  ref={phoneRef}
                  type="tel"
                  inputMode="numeric"
                  value={details.customerPhone}
                  onChange={e => updateDetail('customerPhone', e.target.value)}
                  placeholder="03XXXXXXXXX"
                  disabled={isLoading}
                  className={`h-11 w-full rounded-xl border px-3 text-sm outline-none transition focus:ring-2 focus:ring-[#075e54]/20 ${issueFor('customerPhone') ? 'border-amber-400 bg-amber-50/50' : 'border-gray-200'}`}
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">City</span>
                <input
                  ref={cityRef}
                  value={details.customerCity}
                  onChange={e => updateDetail('customerCity', e.target.value)}
                  placeholder="e.g. Karachi"
                  disabled={isLoading}
                  className={`h-11 w-full rounded-xl border px-3 text-sm outline-none transition focus:ring-2 focus:ring-[#075e54]/20 ${issueFor('customerCity') ? 'border-amber-400 bg-amber-50/50' : 'border-gray-200'}`}
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">Full Delivery Address</span>
                <textarea
                  ref={addressRef}
                  value={details.customerAddress}
                  onChange={e => updateDetail('customerAddress', e.target.value)}
                  placeholder="House/Flat, Street/Sector, Area"
                  rows={3}
                  disabled={isLoading}
                  className={`w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-[#075e54]/20 ${issueFor('customerAddress') ? 'border-amber-400 bg-amber-50/50' : 'border-gray-200'}`}
                />
              </label>
            </div>

            <Button
              onClick={submitDetails}
              disabled={isLoading || allVariantsOutOfStock}
              className="mt-4 h-11 w-full rounded-xl bg-[#075e54] font-bold text-white hover:bg-[#064e46]"
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Verify Details
            </Button>
          </div>
        )}

        {awaitingConfirmation && verifiedDetails && (
          <div className="mx-auto mt-5 w-full max-w-xl rounded-2xl border border-emerald-200 bg-white p-5 shadow-lg shadow-black/5">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              <h3 className="font-bold">Details Verified</h3>
            </div>
            <p className="mt-1 text-xs text-gray-500">Final summary check kar lein. Sahi ho to order confirm karein.</p>

            {selectedProductOptions.length > 0 && (
              <div className="mt-4 rounded-xl bg-gray-50 p-3">
                <p className="text-[11px] text-gray-500">Product Options</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {selectedProductOptions.map(option => `${option.name}: ${option.value}`).join(' • ')}
                </p>
              </div>
            )}

            {pricing && <PricingBreakdown pricing={pricing} />}

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <DetailRow label="Name" value={verifiedDetails.customerName} icon={<User className="h-4 w-4" />} />
              <DetailRow label="Phone" value={verifiedDetails.customerPhone} icon={<Phone className="h-4 w-4" />} />
              <DetailRow label="City" value={verifiedDetails.customerCity} icon={<MapPin className="h-4 w-4" />} />
              <div className="sm:col-span-2">
                <DetailRow label="Address" value={verifiedDetails.customerAddress} icon={<MapPin className="h-4 w-4" />} />
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={confirmOrder}
                disabled={isLoading || matchedVariant?.available === false || !pricing}
                className="h-11 flex-1 rounded-xl bg-[#25d366] font-bold text-white hover:bg-[#1ebe57] disabled:bg-gray-300"
              >
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Confirm Order
              </Button>
              <Button onClick={editDetails} disabled={isLoading} variant="outline" className="h-11 rounded-xl">
                <Pencil className="mr-2 h-4 w-4" />
                Edit Details
              </Button>
            </div>
          </div>
        )}

        {isLoading && !showDetailsForm && !awaitingConfirmation && (
          <div className="mt-2 flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
                <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="sticky bottom-0 flex items-end gap-2 bg-[#f0f0f0] px-3 py-2.5">
        <div className="flex flex-1 items-center rounded-full bg-white px-4 py-2.5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder={showDetailsForm ? 'Product ya delivery ka sawal pooch sakte hain...' : 'Type a message...'}
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-50"
          />
        </div>
        <Button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isLoading}
          size="icon"
          className="h-11 w-11 flex-shrink-0 rounded-full bg-[#075e54] text-white hover:bg-[#064e46] disabled:opacity-40"
        >
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </Button>
      </div>
    </div>
  );
}
