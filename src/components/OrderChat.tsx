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
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
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

type Message = { id: string; text: string; sender: 'user' | 'bot'; time: string };
type CustomerDetails = {
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
};
type DetailField = keyof CustomerDetails;
type OrderStep = 'idle' | 'options' | 'quantity' | 'name' | 'phone' | 'city' | 'address' | 'verifying' | 'review' | 'pricing_error' | 'done';

type Pricing = {
  unitPrice: string;
  quantity: number;
  productPrice: string;
  shippingPrice: string;
  totalPrice: string;
  shippingRateName: string;
  currency: string;
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

function ChatHeader({ subtitle }: { subtitle: string }) {
  return (
    <header className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white shadow-md">
      <BrandLogo size="sm" />
      <div>
        <h1 className="text-base font-bold">Sparrow Official</h1>
        <p className="flex items-center gap-1 text-xs text-green-200">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-300" />{subtitle}
        </p>
      </div>
    </header>
  );
}

function DetailRow({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-gray-50 p-3">
      <div className="mt-0.5 text-gray-500">{icon}</div>
      <div className="min-w-0"><p className="text-[11px] text-gray-500">{label}</p><p className="break-words text-sm font-semibold text-gray-900">{value}</p></div>
    </div>
  );
}

export default function OrderChat({ productInfo, sessionId }: { productInfo: ProductInfo; sessionId: string }) {
  const [activeProduct, setActiveProduct] = useState<ProductInfo>(productInfo);
  const [optionValues, setOptionValues] = useState<Record<string, string>>(() => buildInitialOptions(productInfo));
  const [quantity, setQuantity] = useState(1);
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
    text: `Assalam o Alaikum! Aap ${productInfo.productName} dekh rahe hain. Product, size/color, delivery ya exchange ke bare mein kuch bhi pooch sakte hain. Order karna ho to “Order Karna Hai” tap karein.`,
  }]);

  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const definitions = activeProduct.options || [];
  const variants = activeProduct.variants || [];
  const variant = useMemo(() => matchingVariant(activeProduct, optionValues), [activeProduct, optionValues]);
  const selectedOptions = useMemo<SelectedProductOption[]>(() => definitions.map(definition => ({ name: definition.name, value: optionValues[definition.name] || '' })).filter(option => option.value), [definitions, optionValues]);
  const currentPrice = variant?.price || activeProduct.price;
  const allOut = variants.length ? !variants.some(item => item.available) : activeProduct.available === false;

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

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, step, suggestions]);
  useEffect(() => {
    if (!isLoading && step !== 'done') {
      const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 80);
      return () => window.clearTimeout(timer);
    }
  }, [isLoading, step, messages.length]);

  const resetOrderFlow = useCallback(() => {
    setStep('idle'); setQuantity(1); setDetails(EMPTY_DETAILS); setVerifiedDetails(null); setPricing(null); setOrderData(null); setOptionError('');
  }, []);

  const startOrder = useCallback(() => {
    if (allOut) { append('Ye product filhal out of stock hai. Aap koi doosra product pooch sakte hain.', 'bot'); return; }
    const missing = definitions.find(definition => !optionValues[definition.name]);
    if (missing || (variants.length && (!variant || !variant.available))) {
      setStep('options');
      append('Bilkul. Pehle available Size/Color ya doosri product variation select kar lein.', 'bot');
      return;
    }
    setStep('quantity');
    append(`Selected variation ${selectedOptions.map(option => `${option.name}: ${option.value}`).join(' • ') || 'ready'} hai. Kitni quantity chahiye?`, 'bot');
  }, [allOut, definitions, optionValues, variants.length, variant, selectedOptions, append]);

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
      setSuggestions([]); resetOrderFlow();
      append(`${data.product.productName} select ho gaya. Is ke bare mein sawal pooch sakte hain ya order start karein.`, 'bot');
    } catch { append('Ye product live store se load nahi ho saka.', 'bot'); }
    finally { setIsLoading(false); }
  };

  const validateOptionsAndContinue = () => {
    const missing = definitions.find(definition => !optionValues[definition.name]);
    if (missing) { setOptionError(`${missing.name} select karein.`); return; }
    if (variants.length && (!variant || !variant.available)) { setOptionError('Ye combination out of stock hai. Available option select karein.'); return; }
    setOptionError(''); setStep('quantity');
    append(`Theek hai: ${selectedOptions.map(option => `${option.name}: ${option.value}`).join(' • ')}${currentPrice ? ` — Rs.${currentPrice}` : ''}. Ab quantity batayein.`, 'bot');
  };

  const continueQuantity = () => {
    const safe = Math.max(1, Math.min(20, Math.floor(quantity || 1)));
    setQuantity(safe); setStep('name'); append(`Quantity ${safe} note kar li. ${stepPrompt('name')}`, 'bot');
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
      else if (field === 'customerPhone') { setStep('city'); append(`Number format verify ho gaya. ${stepPrompt('city')}`, 'bot'); }
      else if (field === 'customerCity') { setStep('address'); append(`${data.normalized} note kar liya. ${stepPrompt('address')}`, 'bot'); }
      else await finalAudit(nextDetails);
    } catch { append('Detail validate nahi ho saki. Dobara try karein.', 'bot'); }
    finally { setIsLoading(false); }
  };

  const finalAudit = async (nextDetails: CustomerDetails) => {
    setStep('verifying'); append('Ab main sari delivery details ko ek baar together audit kar raha hoon…', 'bot');
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
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quote_order', sessionId, productInfo: resolvedProduct, details: verified, quantity }) });
      const data = await response.json();
      if (!response.ok || data.pricingUnavailable) {
        setStep('pricing_error');
        append(`Details valid hain. Shipping rate Shopify se abhi fetch nahi hui: ${data.reason || 'temporary issue'}. City ko invalid nahi maana gaya.`, 'bot');
        return;
      }
      if (data.verifiedProductInfo) {
        setActiveProduct(previous => ({ ...previous, ...data.verifiedProductInfo }));
      }
      setPricing(data.pricing); setStep('review');
      append('Live stock, price aur shipping verify ho gayi. Final summary check karke order confirm karein.', 'bot');
    } catch { setStep('pricing_error'); append('Shipping/total abhi calculate nahi ho saka. Retry karein.', 'bot'); }
  };

  const confirmOrder = async () => {
    if (!verifiedDetails || isLoading) return;
    setIsLoading(true);
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm_order', sessionId, productInfo: resolvedProduct, details: verifiedDetails, quantity }) });
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
    return (
      <div className="flex min-h-screen flex-col bg-[#eae6df]">
        <ChatHeader subtitle="Order Confirmed" />
        <main className="flex flex-1 items-center justify-center px-4 py-8">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl shadow-black/10">
            <BrandLogo size="lg" className="mx-auto" />
            <div className="mt-4 text-center"><h2 className="text-xl font-bold">Order Confirm Ho Gaya! ✅</h2><p className="mt-1 text-xs text-gray-500">Order ID: <b>{orderData.id.slice(0, 8).toUpperCase()}</b></p></div>
            <div className="mt-5 space-y-2">
              <DetailRow label="Product" value={`${orderData.productName}${productSummary ? ` — ${productSummary}` : ''}`} icon={<ShoppingBag className="h-4 w-4" />} />
              <DetailRow label="Quantity" value={orderData.quantity || String(quantity)} icon={<PackageCheck className="h-4 w-4" />} />
              <DetailRow label="Customer" value={orderData.customerName} icon={<User className="h-4 w-4" />} />
              <DetailRow label="Delivery" value={`${orderData.customerCity} — ${orderData.customerAddress}`} icon={<MapPin className="h-4 w-4" />} />
            </div>
            {finalPricing && <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm">
              <div className="flex justify-between"><span>Rs.{finalPricing.unitPrice} × {finalPricing.quantity}</span><b>Rs.{finalPricing.productPrice}</b></div>
              <div className="mt-2 flex justify-between"><span>Shipping</span><b>{Number(finalPricing.shippingPrice) === 0 ? 'FREE' : `Rs.${finalPricing.shippingPrice}`}</b></div>
              <div className="my-3 h-px bg-emerald-200" /><div className="flex justify-between text-base"><b>Grand Total</b><b className="text-[#075e54]">Rs.{finalPricing.totalPrice}</b></div>
            </div>}
            {orderData.customerWhatsAppSent && <p className="mt-4 text-center text-xs font-medium text-[#075e54]">Confirmation WhatsApp par bhej di gayi hai.</p>}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[#eae6df]">
      <div className="shrink-0"><ChatHeader subtitle={step === 'idle' ? 'Online — Shopping Assistant' : 'Online — Order Assistant'} /></div>

      <div className="shrink-0 border-b bg-white px-4 py-2.5">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          {activeProduct.image ? <img src={activeProduct.image} alt="" className="h-11 w-11 rounded-xl object-cover ring-1 ring-gray-100" /> : <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100"><ShoppingBag className="h-4 w-4" /></div>}
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-gray-900">{activeProduct.productName}</p><div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-gray-500">{productSummary && <span>{productSummary}</span>}{currentPrice && <span className="font-bold text-[#075e54]">Rs.{currentPrice}</span>}{variant && <span className={variant.available ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>{variant.available ? 'In stock' : 'Out of stock'}</span>}</div></div>
          {step !== 'idle' && step !== 'review' && <button onClick={resetOrderFlow} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" title="Cancel order flow"><RotateCcw className="h-4 w-4" /></button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4" style={{ backgroundImage: 'radial-gradient(#d7d2ca 0.7px, transparent 0.7px)', backgroundSize: '18px 18px' }}>
        <div className="mx-auto w-full max-w-4xl space-y-2">
          {messages.map(message => <div key={message.id} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm ${message.sender === 'user' ? 'rounded-br-sm bg-[#dcf8c6]' : 'rounded-bl-sm bg-white'}`}><p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-900">{message.text}</p><p className="mt-1 text-right text-[10px] text-gray-400">{message.time}</p></div></div>)}

          {step === 'idle' && <div className="flex flex-wrap gap-2 pt-2">
            <button onClick={startOrder} className="rounded-full bg-[#25d366] px-4 py-2 text-sm font-bold text-white shadow-sm">Order Karna Hai</button>
            <button onClick={() => sendChat('Is product ke available size aur colors bata dein')} className="rounded-full border bg-white px-4 py-2 text-sm">Size / Color</button>
            <button onClick={() => sendChat('Delivery aur shipping details kya hain?')} className="rounded-full border bg-white px-4 py-2 text-sm">Delivery</button>
            <button onClick={() => sendChat('Exchange ya return policy kya hai?')} className="rounded-full border bg-white px-4 py-2 text-sm">Exchange</button>
          </div>}

          {suggestions.length > 0 && <div className="grid gap-2 pt-2 sm:grid-cols-2">{suggestions.map(product => <button key={product.handle} onClick={() => selectSuggestedProduct(product)} className="flex items-center gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm hover:border-[#075e54]/40">{product.image ? <img src={product.image} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <Search className="h-5 w-5" />}<div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-bold">{product.title}</p>{product.price && <p className="mt-1 text-xs font-semibold text-[#075e54]">{product.price}</p>}</div><ChevronRight className="h-4 w-4 text-gray-400" /></button>)}</div>}

          {step === 'options' && <div className="mx-auto mt-4 max-w-xl rounded-2xl border bg-white p-4 shadow-lg"><h3 className="font-bold">Choose Product Options</h3><p className="mt-1 text-xs text-gray-500">Out-of-stock combinations disabled hain.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{definitions.map(definition => <label key={definition.name}><span className="mb-1 block text-xs font-semibold">{definition.name}</span><select value={optionValues[definition.name] || ''} onChange={event => { setOptionValues(previous => ({ ...previous, [definition.name]: event.target.value })); setOptionError(''); }} className="h-11 w-full rounded-xl border bg-white px-3 text-sm"><option value="">Select {definition.name}</option>{definition.values.map(value => { const available = canSelect(activeProduct, optionValues, definition.name, value); return <option key={value} value={value} disabled={!available}>{value}{!available ? ' — Out of stock' : ''}</option>; })}</select></label>)}</div>{optionError && <p className="mt-3 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-4 w-4" />{optionError}</p>}<Button onClick={validateOptionsAndContinue} className="mt-4 h-11 w-full bg-[#075e54] text-white">Continue</Button></div>}

          {step === 'quantity' && <div className="mx-auto mt-4 max-w-sm rounded-2xl border bg-white p-4 text-center shadow-lg"><h3 className="font-bold">Quantity</h3><p className="mt-1 text-xs text-gray-500">Ek hi variation ki quantity select karein.</p><div className="mt-4 flex items-center justify-center gap-4"><button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="rounded-full border p-2"><Minus className="h-4 w-4" /></button><input type="number" min={1} max={20} value={quantity} onChange={event => setQuantity(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} className="h-11 w-20 rounded-xl border text-center text-lg font-bold" /><button onClick={() => setQuantity(Math.min(20, quantity + 1))} className="rounded-full border p-2"><Plus className="h-4 w-4" /></button></div><Button onClick={continueQuantity} className="mt-4 h-11 w-full bg-[#25d366] font-bold text-white">Continue with {quantity}</Button></div>}

          {FIELD_BY_STEP[step] && <div className="mx-auto mt-3 flex max-w-xl items-center gap-2 rounded-xl border border-[#075e54]/15 bg-white/90 px-3 py-2 text-xs text-gray-600"><ShieldCheck className="h-4 w-4 text-[#075e54]" /><span>{stepPrompt(step)} Aap product ka sawal bhi pooch sakte hain; “?” ke sath bhejein.</span></div>}

          {step === 'verifying' && <div className="flex justify-start"><div className="rounded-2xl bg-white px-4 py-3 shadow-sm"><Loader2 className="h-5 w-5 animate-spin text-[#075e54]" /></div></div>}

          {step === 'pricing_error' && verifiedDetails && <div className="mx-auto mt-4 max-w-xl rounded-2xl border border-amber-200 bg-white p-4 shadow-lg"><div className="flex gap-2 text-amber-700"><AlertCircle className="h-5 w-5" /><div><h3 className="font-bold">Shipping rate pending</h3><p className="text-xs text-gray-500">Aapki city valid rehgi. Shopify shipping ko alag retry karein.</p></div></div><div className="mt-3 flex gap-2"><Button onClick={() => quoteOrder(verifiedDetails)} disabled={isLoading} className="flex-1 bg-[#075e54] text-white">Retry Shipping</Button><Button variant="outline" onClick={() => setStep('city')}><Pencil className="mr-2 h-4 w-4" />Edit Address</Button></div></div>}

          {step === 'review' && verifiedDetails && pricing && <div className="mx-auto mt-4 max-w-xl rounded-2xl border border-emerald-200 bg-white p-5 shadow-lg"><div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" /><h3 className="font-bold">Final Order Summary</h3></div><div className="mt-4 rounded-xl bg-gray-50 p-3"><p className="text-sm font-bold">{activeProduct.productName}</p>{productSummary && <p className="mt-1 text-xs text-gray-500">{productSummary}</p>}<p className="mt-1 text-xs text-gray-500">Quantity: {pricing.quantity}</p></div><div className="mt-3 rounded-xl border p-3 text-sm"><div className="flex justify-between"><span>Rs.{pricing.unitPrice} × {pricing.quantity}</span><b>Rs.{pricing.productPrice}</b></div><div className="mt-2 flex justify-between"><span>Shipping <span className="text-xs text-gray-400">({pricing.shippingRateName})</span></span><b>{Number(pricing.shippingPrice) === 0 ? 'FREE' : `Rs.${pricing.shippingPrice}`}</b></div><div className="my-3 h-px bg-gray-200" /><div className="flex justify-between text-base"><b>Grand Total</b><b className="text-[#075e54]">Rs.{pricing.totalPrice}</b></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><DetailRow label="Name" value={verifiedDetails.customerName} icon={<User className="h-4 w-4" />} /><DetailRow label="Phone" value={verifiedDetails.customerPhone} icon={<Phone className="h-4 w-4" />} /><DetailRow label="City" value={verifiedDetails.customerCity} icon={<MapPin className="h-4 w-4" />} /><DetailRow label="Address" value={verifiedDetails.customerAddress} icon={<MapPin className="h-4 w-4" />} /></div><div className="mt-4 flex gap-2"><Button onClick={confirmOrder} disabled={isLoading} className="h-11 flex-1 bg-[#25d366] font-bold text-white">{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Confirm Order</Button><Button variant="outline" onClick={() => setStep('name')}><Pencil className="mr-2 h-4 w-4" />Edit</Button></div></div>}

          {isLoading && step !== 'verifying' && <div className="flex justify-start"><div className="rounded-2xl bg-white px-4 py-3 shadow-sm"><Loader2 className="h-4 w-4 animate-spin text-[#075e54]" /></div></div>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="shrink-0 border-t bg-[#f0f0f0] px-3 py-2.5">
        <div className="mx-auto flex max-w-4xl items-center gap-2">
          <div className="flex flex-1 items-center rounded-full bg-white px-4 py-2.5"><MessageCircle className="mr-2 h-4 w-4 text-gray-400" /><input ref={inputRef} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); handleSend(); } }} disabled={isLoading || step === 'verifying' || step === 'done'} placeholder={inputPlaceholder(step)} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400" /></div><Button onClick={handleSend} disabled={!input.trim() || isLoading || step === 'verifying'} size="icon" className="h-11 w-11 shrink-0 rounded-full bg-[#075e54] text-white"><Send className="h-5 w-5" /></Button>
        </div>
      </div>
    </div>
  );
}
