'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MapPin,
  MessageCircle,
  Minus,
  PackageCheck,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import BrandLogo from '@/components/BrandLogo';

type ProductOptionDefinition = { name: string; values: string[] };
type SelectedProductOption = { name: string; value: string };
type ProductVariant = {
  id: string;
  options: string[];
  available: boolean;
  price?: string;
  compareAtPrice?: string | null;
  sku?: string | null;
};

type ProductInfo = {
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
};

type CartItem = {
  lineId: string;
  productName: string;
  productId?: string;
  productHandle?: string;
  productUrl?: string;
  image?: string;
  variantId: string;
  selectedOptions: SelectedProductOption[];
  quantity: number;
  unitPrice?: string;
  lineTotal?: string;
};

type Message = { id: string; text: string; sender: 'user' | 'bot'; time: string };
type CustomerDetails = {
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
};
type DetailField = keyof CustomerDetails;
type OrderStep = 'idle' | 'options' | 'quantity' | 'cart' | 'name' | 'phone' | 'city' | 'address' | 'verifying' | 'review' | 'pricing_error' | 'done';

type PricingLine = {
  variantId: string;
  label?: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
};

type Pricing = {
  unitPrice: string;
  quantity: number;
  productPrice: string;
  shippingPrice: string;
  totalPrice: string;
  shippingRateName: string;
  currency: string;
  lines?: PricingLine[];
};

type ProductSuggestion = {
  title: string;
  handle: string;
  productUrl: string;
  image?: string | null;
  price?: string | null;
  available?: boolean | null;
};

type OrderData = CustomerDetails & {
  id: string;
  productName: string;
  productOptions?: SelectedProductOption[] | null;
  cartItems?: Array<{
    productName: string;
    productOptions: SelectedProductOption[];
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }> | null;
  price: string | null;
  subtotalPrice?: string | null;
  shippingPrice?: string | null;
  shippingRateName?: string | null;
  totalPrice?: string | null;
  quantity?: string | null;
  customerWhatsAppSent?: boolean;
};

const EMPTY_DETAILS: CustomerDetails = {
  customerName: '', customerPhone: '', customerCity: '', customerAddress: '',
};

const FIELD_BY_STEP: Partial<Record<OrderStep, DetailField>> = {
  name: 'customerName', phone: 'customerPhone', city: 'customerCity', address: 'customerAddress',
};

const STEP_BY_FIELD: Record<DetailField, OrderStep> = {
  customerName: 'name', customerPhone: 'phone', customerCity: 'city', customerAddress: 'address',
};

function timeNow(): string {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function buildInitialOptions(product: ProductInfo): Record<string, string> {
  const result: Record<string, string> = {};
  for (const definition of product.options || []) {
    const selected = product.selectedOptions?.find(option => option.name.toLowerCase() === definition.name.toLowerCase());
    result[definition.name] = selected?.value || (definition.values.length === 1 ? definition.values[0] : '');
  }
  return result;
}

function buildNewLineOptions(product: ProductInfo): Record<string, string> {
  const result: Record<string, string> = {};
  for (const definition of product.options || []) {
    result[definition.name] = definition.values.length === 1 ? definition.values[0] : '';
  }
  return result;
}

function matchingVariant(product: ProductInfo, values: Record<string, string>): ProductVariant | undefined {
  const definitions = product.options || [];
  const variants = product.variants || [];
  if (!variants.length || definitions.some(definition => !values[definition.name])) return undefined;
  return variants.find(variant => definitions.every((definition, index) => String(variant.options[index] || '') === String(values[definition.name] || '')));
}

function canSelect(product: ProductInfo, values: Record<string, string>, targetName: string, targetValue: string): boolean {
  const definitions = product.options || [];
  const variants = product.variants || [];
  if (!variants.length) return true;
  const targetIndex = definitions.findIndex(definition => definition.name === targetName);
  return variants.some(variant => {
    if (!variant.available || variant.options[targetIndex] !== targetValue) return false;
    return definitions.every((definition, index) => index === targetIndex || !values[definition.name] || variant.options[index] === values[definition.name]);
  });
}

function isQuestion(text: string): boolean {
  return /\?$/.test(text.trim()) || /^(kya|kia|how|what|which|delivery|shipping|exchange|return|refund|fabric|material|price|size|color|colour|stock|available|discount|cod|payment|aur product|doosra|dusra|show|dikhao)\b/i.test(text.trim());
}

function stepPrompt(step: OrderStep): string {
  if (step === 'name') return 'Apna poora naam likhein (first + last name).';
  if (step === 'phone') return 'Apna Pakistani mobile number dein, misal 03340139169.';
  if (step === 'city') return 'Delivery city ka actual naam dein, misal Karachi.';
  if (step === 'address') return 'House/flat number, street/sector aur area ke saath full address dein.';
  return '';
}

function inputPlaceholder(step: OrderStep): string {
  if (step === 'name') return 'Full name...';
  if (step === 'phone') return '03XXXXXXXXX';
  if (step === 'city') return 'City...';
  if (step === 'address') return 'Full delivery address...';
  return 'Product, size, delivery ya kisi aur cheez ka sawal poochein...';
}

function optionLabel(options: SelectedProductOption[]): string {
  return options.map(option => `${option.name}: ${option.value}`).join(' • ');
}

function money(value: string | number | undefined): string {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return String(value || '0');
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function ChatHeader({ subtitle }: { subtitle: string }) {
  return (
    <header className="flex items-center gap-3 bg-[#075e54] px-4 py-3.5 text-white shadow-md">
      <BrandLogo size="sm" />
      <div>
        <h1 className="text-lg font-bold leading-tight">Sparrow Official</h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-green-100">
          <span className="inline-block h-2 w-2 rounded-full bg-green-300" />{subtitle}
        </p>
      </div>
    </header>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-gray-50 p-3.5">
      <div className="mt-0.5 text-gray-500">{icon}</div>
      <div className="min-w-0"><p className="text-xs font-medium text-gray-500">{label}</p><p className="mt-0.5 break-words text-[15px] font-semibold text-gray-900">{value}</p></div>
    </div>
  );
}

export default function OrderChat({ productInfo, sessionId }: { productInfo: ProductInfo; sessionId: string }) {
  const [activeProduct, setActiveProduct] = useState<ProductInfo>(productInfo);
  const [optionValues, setOptionValues] = useState<Record<string, string>>(() => buildInitialOptions(productInfo));
  const [quantity, setQuantity] = useState(1);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [details, setDetails] = useState<CustomerDetails>(EMPTY_DETAILS);
  const [verifiedDetails, setVerifiedDetails] = useState<CustomerDetails | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [step, setStep] = useState<OrderStep>('idle');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [optionError, setOptionError] = useState('');
  const [messages, setMessages] = useState<Message[]>(() => [{
    id: 'welcome', sender: 'bot', time: timeNow(),
    text: `Assalam o Alaikum! Aap ${productInfo.productName} dekh rahe hain. Product, size/color, stock, delivery ya exchange ke bare mein kuch bhi pooch sakte hain. Order karna ho to “Order Karna Hai” tap karein.`,
  }]);

  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const definitions = activeProduct.options || [];
  const variants = activeProduct.variants || [];
  const variant = useMemo(() => matchingVariant(activeProduct, optionValues), [activeProduct, optionValues]);
  const selectedOptions = useMemo<SelectedProductOption[]>(() => definitions.map(definition => ({ name: definition.name, value: optionValues[definition.name] || '' })).filter(option => option.value), [definitions, optionValues]);
  const currentPrice = variant?.price || activeProduct.price;
  const allOut = variants.length ? !variants.some(item => item.available) : activeProduct.available === false;
  const cartQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const cartSubtotal = cartItems.reduce((sum, item) => sum + Number(item.unitPrice || 0) * item.quantity, 0);

  const resolvedProduct = useMemo<ProductInfo>(() => ({
    ...activeProduct,
    selectedOptions,
    variantId: variant?.id || activeProduct.variantId,
    price: currentPrice,
    available: variant ? variant.available : activeProduct.available,
    color: selectedOptions.find(option => /colou?r/i.test(option.name))?.value || activeProduct.color,
    size: selectedOptions.find(option => /size/i.test(option.name))?.value || activeProduct.size,
  }), [activeProduct, selectedOptions, variant, currentPrice]);

  const append = useCallback((text: string, sender: 'user' | 'bot') => {
    setMessages(previous => [...previous, { id: `${sender}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text, sender, time: timeNow() }]);
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, step, suggestions, cartItems.length]);
  useEffect(() => {
    if (!isLoading && step !== 'done') {
      const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 80);
      return () => window.clearTimeout(timer);
    }
  }, [isLoading, step, messages.length]);

  const resetOrderFlow = useCallback(() => {
    setStep('idle'); setQuantity(1); setCartItems([]); setDetails(EMPTY_DETAILS); setVerifiedDetails(null); setPricing(null); setOrderData(null); setOptionError('');
    setOptionValues(buildInitialOptions(activeProduct));
  }, [activeProduct]);

  const startOrder = useCallback(() => {
    if (allOut) { append('Ye product filhal out of stock hai. Aap koi doosra product pooch sakte hain.', 'bot'); return; }
    setCartItems([]);
    setQuantity(1);
    setOptionError('');
    if (definitions.length) {
      setStep('options');
      append('Bilkul. Pehli variation choose/confirm karein. Aap ek hi order mein multiple colors aur sizes, har ek ki alag quantity ke saath add kar sakte hain.', 'bot');
      return;
    }
    setStep('quantity');
    append('Bilkul. Is product ki kitni quantity chahiye?', 'bot');
  }, [allOut, definitions.length, append]);

  const sendChat = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    const trimmed = text.trim();
    append(trimmed, 'user'); setInput(''); setIsLoading(true); setSuggestions([]);
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'chat', message: trimmed, sessionId, productInfo: resolvedProduct }) });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Chat failed');
      append(data.reply, 'bot');
      if (Array.isArray(data.productSuggestions)) setSuggestions(data.productSuggestions);
      if (data.orderIntent && step === 'idle') window.setTimeout(startOrder, 200);
    } catch {
      append('Abhi jawab fetch nahi ho saka. Please dobara try karein.', 'bot');
    } finally { setIsLoading(false); }
  }, [append, isLoading, sessionId, resolvedProduct, step, startOrder]);

  const selectSuggestedProduct = async (suggestion: ProductSuggestion) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/shopify/product?handle=${encodeURIComponent(suggestion.handle)}&productUrl=${encodeURIComponent(suggestion.productUrl)}`);
      const data = await response.json();
      if (!response.ok || !data.product) throw new Error('Product load failed');
      setActiveProduct(data.product);
      setOptionValues(buildInitialOptions(data.product));
      setSuggestions([]);
      setCartItems([]); setStep('idle'); setQuantity(1); setDetails(EMPTY_DETAILS); setVerifiedDetails(null); setPricing(null); setOrderData(null); setOptionError('');
      append(`${data.product.productName} select ho gaya. Is ke bare mein sawal pooch sakte hain ya order start karein.`, 'bot');
    } catch { append('Ye product live store se load nahi ho saka.', 'bot'); }
    finally { setIsLoading(false); }
  };

  const validateOptionsAndContinue = () => {
    const missing = definitions.find(definition => !optionValues[definition.name]);
    if (missing) { setOptionError(`${missing.name} select karein.`); return; }
    if (variants.length && (!variant || !variant.available)) { setOptionError('Ye combination out of stock hai. Available option select karein.'); return; }
    setOptionError(''); setStep('quantity'); setQuantity(1);
    append(`Theek hai: ${optionLabel(selectedOptions)}${currentPrice ? ` — Rs.${currentPrice}` : ''}. Is variation ki quantity select karein.`, 'bot');
  };

  const addCurrentLineToCart = () => {
    const selectedVariantId = String(variant?.id || activeProduct.variantId || '');
    if (!selectedVariantId) { setOptionError('Variant verify nahi hua. Options dobara select karein.'); setStep('options'); return; }
    if (variants.length && (!variant || !variant.available)) { setOptionError('Ye variation out of stock hai.'); setStep('options'); return; }

    const safe = Math.max(1, Math.min(20, Math.floor(quantity || 1)));
    const lineOptions = definitions.length ? selectedOptions : (activeProduct.selectedOptions || []);
    const unitPrice = String(currentPrice || activeProduct.price || '');

    setCartItems(previous => {
      const existing = previous.find(item => item.variantId === selectedVariantId && item.productHandle === activeProduct.productHandle);
      if (existing) {
        return previous.map(item => item.lineId === existing.lineId
          ? { ...item, quantity: Math.min(20, item.quantity + safe) }
          : item);
      }
      return [...previous, {
        lineId: `${selectedVariantId}-${Date.now()}`,
        productName: activeProduct.productName,
        productId: activeProduct.productId,
        productHandle: activeProduct.productHandle,
        productUrl: activeProduct.productUrl,
        image: activeProduct.image,
        variantId: selectedVariantId,
        selectedOptions: lineOptions,
        quantity: safe,
        unitPrice,
      }];
    });

    setStep('cart');
    append(`${lineOptions.length ? optionLabel(lineOptions) : activeProduct.productName} × ${safe} cart mein add ho gaya. Aur color/size add karna ho to “Add Another Variation” choose karein.`, 'bot');
  };

  const addAnotherVariation = () => {
    setQuantity(1);
    setOptionValues(buildNewLineOptions(activeProduct));
    setOptionError('');
    if (definitions.length) setStep('options');
    else setStep('quantity');
  };

  const removeCartLine = (lineId: string) => {
    setCartItems(previous => previous.filter(item => item.lineId !== lineId));
  };

  const updateCartLineQuantity = (lineId: string, nextQuantity: number) => {
    setCartItems(previous => previous.map(item => item.lineId === lineId
      ? { ...item, quantity: Math.max(1, Math.min(20, nextQuantity)) }
      : item));
  };

  const continueFromCart = () => {
    if (!cartItems.length) { append('Cart empty hai. Pehle kam az kam ek variation add karein.', 'bot'); addAnotherVariation(); return; }
    setStep('name');
    append(`${cartQuantity} total item${cartQuantity === 1 ? '' : 's'} note kar liye. ${stepPrompt('name')}`, 'bot');
  };

  const validateAndSaveField = async (field: DetailField, rawValue: string) => {
    setIsLoading(true); append(rawValue, 'user'); setInput('');
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'validate_field', sessionId, field, value: rawValue }) });
      const data = await response.json();
      if (!response.ok || !data.valid) {
        append(data.reason || 'Ye detail verify nahi hui. Dobara check karein.', 'bot');
        return;
      }
      const nextDetails = { ...details, [field]: data.normalized };
      setDetails(nextDetails);
      if (field === 'customerName') { setStep('phone'); append(`Shukriya ${data.normalized}. ${stepPrompt('phone')}`, 'bot'); }
      else if (field === 'customerPhone') { setStep('city'); append(`Mobile number ka format valid hai: ${data.normalized}. ${stepPrompt('city')}`, 'bot'); }
      else if (field === 'customerCity') { setStep('address'); append(`${data.normalized} city verify ho gayi. ${stepPrompt('address')}`, 'bot'); }
      else await finalAudit(nextDetails);
    } catch { append('Detail validate nahi ho saki. Dobara try karein.', 'bot'); }
    finally { setIsLoading(false); }
  };

  const finalAudit = async (nextDetails: CustomerDetails) => {
    setStep('verifying'); append('Ab sari delivery details ko ek baar together audit kar raha hoon…', 'bot');
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify_order_details', sessionId, details: nextDetails }) });
      const data = await response.json();
      if (!response.ok && !data.needsCorrection) throw new Error('Audit failed');
      if (data.needsCorrection && data.issues?.length) {
        const first = data.issues[0];
        setDetails(data.details || nextDetails); setStep(STEP_BY_FIELD[first.field as DetailField] || 'address');
        append(first.reason + (first.suggestion ? ` Suggestion: ${first.suggestion}` : ''), 'bot');
        return;
      }
      const verified = data.details || nextDetails;
      setVerifiedDetails(verified); setDetails(verified);
      await quoteOrder(verified);
    } catch { setStep('address'); append('Final verification complete nahi ho saki. Address dobara confirm karein.', 'bot'); }
  };

  const quoteOrder = async (verified: CustomerDetails) => {
    setStep('verifying');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'quote_order', sessionId, productInfo: resolvedProduct, details: verified, cartItems }),
      });
      const data = await response.json();
      if (!response.ok || data.pricingUnavailable) {
        setStep('pricing_error');
        append(`Delivery details valid hain. Shopify shipping/price abhi fetch nahi hui: ${data.reason || 'temporary issue'}. City ko invalid nahi maana gaya.`, 'bot');
        return;
      }
      if (Array.isArray(data.verifiedCartItems)) {
        setCartItems(data.verifiedCartItems.map((item: any, index: number) => ({
          lineId: `${item.variantId}-${index}`,
          productName: item.productName,
          productId: item.productId || undefined,
          productHandle: item.productHandle || undefined,
          productUrl: item.productUrl || undefined,
          image: item.productImage || undefined,
          variantId: item.variantId,
          selectedOptions: item.productOptions || [],
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })));
      }
      setPricing(data.pricing); setStep('review');
      append('Live Shopify stock, har variation ki price aur shipping verify ho gayi. Final summary check karein.', 'bot');
    } catch { setStep('pricing_error'); append('Shipping/total abhi calculate nahi ho saka. Retry karein.', 'bot'); }
  };

  const confirmOrder = async () => {
    if (!verifiedDetails || isLoading) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_order', sessionId, productInfo: resolvedProduct, details: verifiedDetails, cartItems }),
      });
      const data = await response.json();
      if (!response.ok || data.pricingUnavailable) {
        setStep('pricing_error'); append(`Final Shopify check fail hui: ${data.reason || 'pricing/shipping unavailable'}. Order save nahi hua.`, 'bot'); return;
      }
      if (!data.orderComplete) throw new Error('Order incomplete');
      setOrderData(data.order); setPricing(data.pricing || pricing); setStep('done'); append(data.reply, 'bot');
    } catch { append('Order confirm nahi ho saka. Please dobara try karein.', 'bot'); }
    finally { setIsLoading(false); }
  };

  const handleSend = async () => {
    const text = input.trim(); if (!text || isLoading) return;
    const field = FIELD_BY_STEP[step];
    if (field && !isQuestion(text)) await validateAndSaveField(field, text);
    else await sendChat(text);
  };

  const productSummary = selectedOptions.map(option => `${option.name}: ${option.value}`).join(' • ');

  if (step === 'done' && orderData) {
    const finalPricing = pricing;
    const finalItems = orderData.cartItems?.length ? orderData.cartItems : cartItems;
    return (
      <div className="flex min-h-screen flex-col bg-[#eae6df]">
        <ChatHeader subtitle="Order Confirmed" />
        <main className="flex flex-1 items-center justify-center px-4 py-8">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl shadow-black/10">
            <BrandLogo size="lg" className="mx-auto" />
            <div className="mt-4 text-center"><h2 className="text-2xl font-bold">Order Confirm Ho Gaya! ✅</h2><p className="mt-1 text-sm text-gray-500">Order ID: <b>{orderData.id.slice(0, 8).toUpperCase()}</b></p></div>
            <div className="mt-5 space-y-2">
              {finalItems.map((item: any, index: number) => <div key={`${item.variantId}-${index}`} className="rounded-xl bg-gray-50 p-3.5"><div className="flex justify-between gap-3"><div><p className="text-[15px] font-bold text-gray-900">{item.productName}</p><p className="mt-1 text-sm text-gray-500">{optionLabel(item.productOptions || [])}</p><p className="mt-1 text-sm text-gray-600">Qty: {item.quantity}</p></div>{item.lineTotal && <b className="text-[15px] text-[#075e54]">Rs.{item.lineTotal}</b>}</div></div>)}
              <DetailRow label="Customer" value={orderData.customerName} icon={<User className="h-4 w-4" />} />
              <DetailRow label="Delivery" value={`${orderData.customerCity} — ${orderData.customerAddress}`} icon={<MapPin className="h-4 w-4" />} />
            </div>
            {finalPricing && <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-[15px]">
              <div className="flex justify-between"><span>Subtotal</span><b>Rs.{finalPricing.productPrice}</b></div>
              <div className="mt-2 flex justify-between"><span>Shipping</span><b>{Number(finalPricing.shippingPrice) === 0 ? 'FREE' : `Rs.${finalPricing.shippingPrice}`}</b></div>
              <div className="my-3 h-px bg-emerald-200" /><div className="flex justify-between text-lg"><b>Grand Total</b><b className="text-[#075e54]">Rs.{finalPricing.totalPrice}</b></div>
            </div>}
            {orderData.customerWhatsAppSent && <p className="mt-4 text-center text-sm font-medium text-[#075e54]">Confirmation WhatsApp par bhej di gayi hai.</p>}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#eae6df]">
      <div className="shrink-0"><ChatHeader subtitle={step === 'idle' ? 'Online — Shopping Assistant' : 'Online — Order Assistant'} /></div>

      <div className="shrink-0 border-b bg-white px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          {activeProduct.image ? <img src={activeProduct.image} alt="" className="h-12 w-12 rounded-xl object-cover ring-1 ring-gray-100" /> : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100"><ShoppingBag className="h-5 w-5" /></div>}
          <div className="min-w-0 flex-1"><p className="truncate text-base font-bold text-gray-900">{activeProduct.productName}</p><div className="mt-1 flex flex-wrap gap-x-2 text-sm text-gray-500">{productSummary && <span>{productSummary}</span>}{currentPrice && <span className="font-bold text-[#075e54]">Rs.{currentPrice}</span>}{variant && <span className={variant.available ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>{variant.available ? 'In stock' : 'Out of stock'}</span>}</div></div>
          {cartItems.length > 0 && <div className="hidden rounded-full bg-[#075e54]/10 px-3 py-1.5 text-sm font-bold text-[#075e54] sm:block">Cart: {cartQuantity}</div>}
          {step !== 'idle' && step !== 'review' && <button onClick={resetOrderFlow} className="rounded-full p-2.5 text-gray-500 hover:bg-gray-100" title="Cancel order flow"><RotateCcw className="h-4 w-4" /></button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-5" style={{ backgroundImage: 'radial-gradient(#d7d2ca 0.7px, transparent 0.7px)', backgroundSize: '18px 18px' }}>
        <div className="mx-auto w-full max-w-5xl space-y-3">
          {messages.map(message => <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[92%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[78%] ${message.sender === 'user' ? 'rounded-br-sm bg-[#dcf8c6]' : 'rounded-bl-sm bg-white'}`}><p className="whitespace-pre-wrap text-[15px] leading-6 text-gray-900 sm:text-base">{message.text}</p><p className="mt-1.5 text-right text-[11px] text-gray-400">{message.time}</p></div></div>)}

          {step === 'idle' && <div className="flex flex-wrap gap-2.5 pt-2">
            <button onClick={startOrder} className="rounded-full bg-[#25d366] px-5 py-2.5 text-[15px] font-bold text-white shadow-sm">Order Karna Hai</button>
            <button onClick={() => sendChat('Is product ke available size aur colors bata dein')} className="rounded-full border bg-white px-5 py-2.5 text-[15px] font-medium">Size / Color</button>
            <button onClick={() => sendChat('Delivery aur shipping details kya hain?')} className="rounded-full border bg-white px-5 py-2.5 text-[15px] font-medium">Delivery</button>
            <button onClick={() => sendChat('Exchange ya return policy kya hai?')} className="rounded-full border bg-white px-5 py-2.5 text-[15px] font-medium">Exchange</button>
          </div>}

          {suggestions.length > 0 && <div className="grid gap-3 pt-2 sm:grid-cols-2">{suggestions.map(product => <button key={product.handle} onClick={() => selectSuggestedProduct(product)} className="flex items-center gap-3 rounded-2xl border bg-white p-3.5 text-left shadow-sm hover:border-[#075e54]/40">{product.image ? <img src={product.image} alt="" className="h-16 w-16 rounded-xl object-cover" /> : <Search className="h-5 w-5" />}<div className="min-w-0 flex-1"><p className="line-clamp-2 text-[15px] font-bold">{product.title}</p>{product.price && <p className="mt-1 text-sm font-semibold text-[#075e54]">{product.price}</p>}</div><ChevronRight className="h-4 w-4 text-gray-400" /></button>)}</div>}

          {step === 'options' && <div className="mx-auto mt-4 max-w-2xl rounded-2xl border bg-white p-5 shadow-lg"><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-bold">Choose Color / Size</h3><p className="mt-1 text-sm text-gray-500">Har variation ki quantity alag add hogi. Out-of-stock combinations disabled hain.</p></div><ShoppingCart className="h-5 w-5 text-[#075e54]" /></div><div className="mt-5 grid gap-4 sm:grid-cols-2">{definitions.map(definition => <label key={definition.name}><span className="mb-1.5 block text-sm font-semibold">{definition.name}</span><select value={optionValues[definition.name] || ''} onChange={event => { setOptionValues(previous => ({ ...previous, [definition.name]: event.target.value })); setOptionError(''); }} className="h-12 w-full rounded-xl border bg-white px-3 text-[15px]"><option value="">Select {definition.name}</option>{definition.values.map(value => { const available = canSelect(activeProduct, optionValues, definition.name, value); return <option key={value} value={value} disabled={!available}>{value}{!available ? ' — Out of stock' : ''}</option>; })}</select></label>)}</div>{variant && <div className="mt-4 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm"><span className="font-semibold text-emerald-700">{variant.available ? 'Selected variation in stock' : 'Out of stock'}</span>{variant.price && <b className="text-[#075e54]">Rs.{variant.price}</b>}</div>}{optionError && <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-red-600"><AlertCircle className="h-4 w-4" />{optionError}</p>}<Button onClick={validateOptionsAndContinue} className="mt-5 h-12 w-full bg-[#075e54] text-[15px] font-bold text-white">Continue to Quantity</Button></div>}

          {step === 'quantity' && <div className="mx-auto mt-4 max-w-md rounded-2xl border bg-white p-5 text-center shadow-lg"><h3 className="text-lg font-bold">Quantity for this variation</h3>{selectedOptions.length > 0 && <p className="mt-1.5 text-sm font-medium text-gray-600">{optionLabel(selectedOptions)}</p>}<div className="mt-5 flex items-center justify-center gap-5"><button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="rounded-full border p-2.5"><Minus className="h-5 w-5" /></button><input type="number" min={1} max={20} value={quantity} onChange={event => setQuantity(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} className="h-12 w-24 rounded-xl border text-center text-xl font-bold" /><button onClick={() => setQuantity(Math.min(20, quantity + 1))} className="rounded-full border p-2.5"><Plus className="h-5 w-5" /></button></div>{currentPrice && <p className="mt-4 text-sm text-gray-500">Rs.{currentPrice} × {quantity} = <b className="text-[#075e54]">Rs.{money(Number(currentPrice) * quantity)}</b></p>}<Button onClick={addCurrentLineToCart} className="mt-5 h-12 w-full bg-[#25d366] text-[15px] font-bold text-white"><ShoppingCart className="mr-2 h-4 w-4" />Add Variation to Cart</Button></div>}

          {step === 'cart' && <div className="mx-auto mt-4 max-w-2xl rounded-2xl border bg-white p-5 shadow-lg"><div className="flex items-center justify-between"><div><h3 className="text-lg font-bold">Your Order Cart</h3><p className="mt-1 text-sm text-gray-500">Har color/size aur uski quantity yahan confirm karein.</p></div><div className="rounded-full bg-[#075e54]/10 px-3 py-1.5 text-sm font-bold text-[#075e54]">{cartQuantity} items</div></div><div className="mt-4 space-y-3">{cartItems.map(item => <div key={item.lineId} className="rounded-2xl border border-gray-100 bg-gray-50 p-4"><div className="flex gap-3"><div className="min-w-0 flex-1"><p className="text-[15px] font-bold text-gray-900">{item.productName}</p><p className="mt-1 text-sm text-gray-600">{optionLabel(item.selectedOptions) || 'Standard variation'}</p>{item.unitPrice && <p className="mt-1 text-sm font-semibold text-[#075e54]">Rs.{item.unitPrice} each</p>}</div><button onClick={() => removeCartLine(item.lineId)} className="h-fit rounded-full p-2 text-red-500 hover:bg-red-50" title="Remove"><Trash2 className="h-4 w-4" /></button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-2"><button onClick={() => updateCartLineQuantity(item.lineId, item.quantity - 1)} className="rounded-full border bg-white p-1.5"><Minus className="h-3.5 w-3.5" /></button><span className="min-w-8 text-center text-[15px] font-bold">{item.quantity}</span><button onClick={() => updateCartLineQuantity(item.lineId, item.quantity + 1)} className="rounded-full border bg-white p-1.5"><Plus className="h-3.5 w-3.5" /></button></div>{item.unitPrice && <b className="text-[15px] text-gray-900">Rs.{money(Number(item.unitPrice) * item.quantity)}</b>}</div></div>)}</div><div className="mt-4 flex items-center justify-between rounded-xl bg-[#075e54]/5 px-4 py-3 text-[15px]"><span>Current subtotal</span><b className="text-[#075e54]">Rs.{money(cartSubtotal)}</b></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><Button onClick={addAnotherVariation} variant="outline" className="h-12 text-[15px] font-bold"><Plus className="mr-2 h-4 w-4" />Add Another Variation</Button><Button onClick={continueFromCart} disabled={!cartItems.length} className="h-12 bg-[#25d366] text-[15px] font-bold text-white">Continue to Delivery Details<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>}

          {FIELD_BY_STEP[step] && <div className="mx-auto mt-3 flex max-w-2xl items-center gap-2.5 rounded-xl border border-[#075e54]/15 bg-white/95 px-4 py-3 text-sm text-gray-700"><ShieldCheck className="h-5 w-5 shrink-0 text-[#075e54]" /><span>{stepPrompt(step)} Product ka sawal poochna ho to question mark “?” ke saath bhej sakte hain.</span></div>}

          {step === 'verifying' && <div className="flex justify-start"><div className="rounded-2xl bg-white px-4 py-3 shadow-sm"><Loader2 className="h-5 w-5 animate-spin text-[#075e54]" /></div></div>}

          {step === 'pricing_error' && verifiedDetails && <div className="mx-auto mt-4 max-w-2xl rounded-2xl border border-amber-200 bg-white p-5 shadow-lg"><div className="flex gap-3 text-amber-700"><AlertCircle className="h-5 w-5" /><div><h3 className="text-lg font-bold">Shipping rate pending</h3><p className="mt-1 text-sm text-gray-500">Aapki city valid rehgi. Shopify shipping ko alag retry karein.</p></div></div><div className="mt-4 flex gap-2"><Button onClick={() => quoteOrder(verifiedDetails)} disabled={isLoading} className="h-11 flex-1 bg-[#075e54] text-white">Retry Shipping</Button><Button variant="outline" onClick={() => setStep('city')}><Pencil className="mr-2 h-4 w-4" />Edit Address</Button></div></div>}

          {step === 'review' && verifiedDetails && pricing && <div className="mx-auto mt-4 max-w-2xl rounded-2xl border border-emerald-200 bg-white p-5 shadow-lg"><div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" /><h3 className="text-lg font-bold">Final Order Summary</h3></div><div className="mt-4 space-y-2">{cartItems.map(item => <div key={item.lineId} className="rounded-xl bg-gray-50 p-3.5"><div className="flex justify-between gap-3"><div><p className="text-[15px] font-bold">{item.productName}</p><p className="mt-1 text-sm text-gray-500">{optionLabel(item.selectedOptions)} • Qty {item.quantity}</p></div><b className="text-[15px] text-[#075e54]">Rs.{item.lineTotal || money(Number(item.unitPrice || 0) * item.quantity)}</b></div></div>)}</div><div className="mt-3 rounded-xl border p-4 text-[15px]"><div className="flex justify-between"><span>Subtotal</span><b>Rs.{pricing.productPrice}</b></div><div className="mt-2 flex justify-between"><span>Shipping <span className="text-xs text-gray-400">({pricing.shippingRateName})</span></span><b>{Number(pricing.shippingPrice) === 0 ? 'FREE' : `Rs.${pricing.shippingPrice}`}</b></div><div className="my-3 h-px bg-gray-200" /><div className="flex justify-between text-lg"><b>Grand Total</b><b className="text-[#075e54]">Rs.{pricing.totalPrice}</b></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><DetailRow label="Name" value={verifiedDetails.customerName} icon={<User className="h-4 w-4" />} /><DetailRow label="Phone (format verified)" value={verifiedDetails.customerPhone} icon={<Phone className="h-4 w-4" />} /><DetailRow label="City" value={verifiedDetails.customerCity} icon={<MapPin className="h-4 w-4" />} /><DetailRow label="Address" value={verifiedDetails.customerAddress} icon={<MapPin className="h-4 w-4" />} /></div><p className="mt-3 text-xs text-gray-400">Phone ownership OTP se verify hoti hai; yahan number format validate kiya gaya hai.</p><div className="mt-4 flex gap-2"><Button onClick={confirmOrder} disabled={isLoading} className="h-12 flex-1 bg-[#25d366] text-[15px] font-bold text-white">{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Confirm Order</Button><Button variant="outline" onClick={() => setStep('name')} className="h-12"><Pencil className="mr-2 h-4 w-4" />Edit</Button></div></div>}

          {isLoading && step !== 'verifying' && <div className="flex justify-start"><div className="rounded-2xl bg-white px-4 py-3 shadow-sm"><Loader2 className="h-4 w-4 animate-spin text-[#075e54]" /></div></div>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="shrink-0 border-t bg-[#f0f0f0] px-3 py-3">
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          <div className="flex min-h-12 flex-1 items-center rounded-full bg-white px-4 py-2.5 shadow-sm"><MessageCircle className="mr-2 h-5 w-5 text-gray-400" /><input ref={inputRef} type={step === 'phone' ? 'tel' : 'text'} inputMode={step === 'phone' ? 'tel' : 'text'} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(); } }} disabled={isLoading || step === 'verifying' || step === 'done'} placeholder={inputPlaceholder(step)} className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-gray-400" /></div><Button onClick={handleSend} disabled={!input.trim() || isLoading || step === 'verifying'} size="icon" className="h-12 w-12 shrink-0 rounded-full bg-[#075e54] text-white"><Send className="h-5 w-5" /></Button>
        </div>
      </div>
    </div>
  );
}