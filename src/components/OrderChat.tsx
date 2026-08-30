'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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

interface ProductInfo {
  productName: string;
  color?: string;
  size?: string;
  price?: string;
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

interface OrderData extends CustomerDetails {
  id: string;
  productName: string;
  color: string | null;
  size: string | null;
  price: string | null;
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

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

  // Focus only after React has re-rendered the enabled field. The old code tried
  // to focus while the input was still disabled during loading, so focus failed.
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

      if (!awaitingConfirmation) {
        inputRef.current?.focus({ preventScroll: true });
      }
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
        body: JSON.stringify({
          message: trimmed,
          sessionId,
          productInfo,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Request failed');

      appendMessage(data.reply, 'bot');
    } catch {
      appendMessage('Oops! Kuch technical issue aa gaya. Please thodi der baad try karein. 🙏', 'bot');
      toast({
        title: 'Error',
        description: 'Message send nahi ho saka. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [appendMessage, isLoading, productInfo, sessionId, toast]);

  const handleStart = () => {
    setIsStarted(true);
    setShowDetailsForm(true);
    setMessages([
      {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        time: getTimeString(),
        text: `Assalam o Alaikum! ${productInfo.productName} order karne ke liye neeche apni 4 delivery details ek hi dafa fill kar dein. Main sab details verify karke sirf agar koi cheez doubtful hui to aap se correct karwaunga.`,
      },
    ]);
  };

  const updateDetail = (field: DetailField, value: string) => {
    setDetails(prev => ({ ...prev, [field]: value }));
    setIssues(prev => prev.filter(issue => issue.field !== field));
    setVerifiedDetails(null);
  };

  const issueFor = (field: DetailField) => issues.find(issue => issue.field === field);

  const submitDetails = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setIssues([]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify_details',
          sessionId,
          productInfo,
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
        return;
      }

      if (data.detailsVerified && data.details) {
        setVerifiedDetails(data.details);
        setShowDetailsForm(false);
        setAwaitingConfirmation(true);
      }
    } catch {
      appendMessage('Details verify nahi ho sakin. Please dobara try karein.', 'bot');
      toast({
        title: 'Verification failed',
        description: 'Please details check karke dobara try karein.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const confirmOrder = async () => {
    if (!verifiedDetails || isLoading) return;
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_order',
          sessionId,
          productInfo,
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
        appendMessage(data.reply, 'bot');
        return;
      }

      if (data.orderComplete && data.order) {
        appendMessage(data.reply, 'bot');
        setOrderData(data.order);
        setAwaitingConfirmation(false);
        window.setTimeout(() => setShowOrderSummary(true), 500);
      }
    } catch {
      appendMessage('Order confirm nahi ho saka. Please dobara try karein.', 'bot');
      toast({
        title: 'Order failed',
        description: 'Please dobara confirm karein.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const editDetails = () => {
    if (verifiedDetails) setDetails(verifiedDetails);
    setAwaitingConfirmation(false);
    setShowDetailsForm(true);
    setIssues([]);
  };

  const handleNewOrder = () => window.location.reload();

  if (!isStarted) {
    return (
      <div className="min-h-screen flex flex-col bg-[#eae6df]">
        <ChatHeader subtitle="Online — Order Assistant" />

        <main className="flex-1 flex items-center justify-center px-4 py-8">
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl shadow-black/10">
            <div className="flex justify-center">
              <BrandLogo size="lg" className="ring-2 ring-[#075e54]/10" />
            </div>

            <div className="mt-5 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#075e54]">Ready to order</p>
              <h2 className="mt-2 text-xl font-bold text-gray-950">{productInfo.productName}</h2>

              {(productInfo.color || productInfo.size) && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {productInfo.color && (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{productInfo.color}</span>
                  )}
                  {productInfo.size && (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">Size {productInfo.size}</span>
                  )}
                </div>
              )}

              {productInfo.price && <p className="mt-3 text-2xl font-extrabold text-[#075e54]">Rs.{productInfo.price}</p>}
            </div>

            <div className="my-6 h-px bg-gray-100" />

            <div className="rounded-2xl bg-[#f7faf9] px-4 py-3 text-center">
              <p className="text-sm leading-5 text-gray-600">
                Apni delivery details ek hi dafa fill karein. AI verify karega aur sirf doubtful detail dobara poochega.
              </p>
            </div>

            <Button
              onClick={handleStart}
              className="mt-5 h-12 w-full rounded-xl bg-[#25d366] text-base font-bold text-white hover:bg-[#1ebe57]"
            >
              <MessageCircle className="mr-2 h-5 w-5" />
              Start Order
            </Button>

            <div className="mt-5 flex items-center justify-center gap-2 text-xs text-gray-500">
              <ShieldCheck className="h-4 w-4 text-[#075e54]" />
              <span>Cash on Delivery • Secure Order</span>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (showOrderSummary && orderData) {
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
              <DetailRow label="Product" value={orderData.productName} icon={<ShoppingBag className="h-4 w-4" />} />
              <DetailRow label="Customer" value={orderData.customerName} icon={<User className="h-4 w-4" />} />
              <DetailRow label="Phone" value={orderData.customerPhone} icon={<Phone className="h-4 w-4" />} />
              <DetailRow
                label="Delivery Address"
                value={`${orderData.customerCity} — ${orderData.customerAddress}`}
                icon={<MapPin className="h-4 w-4" />}
              />
              {orderData.price && (
                <div className="flex items-center justify-between rounded-xl border border-[#25d366]/20 bg-[#25d366]/5 p-3">
                  <span className="text-sm font-semibold text-gray-700">Total Amount</span>
                  <span className="text-lg font-bold text-[#075e54]">Rs.{orderData.price}</span>
                </div>
              )}
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
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100">
          <ShoppingBag className="h-4 w-4 text-gray-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{productInfo.productName}</p>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {productInfo.color && <span>{productInfo.color}</span>}
            {productInfo.size && <span>• {productInfo.size}</span>}
            {productInfo.price && <span className="font-bold text-[#075e54]">Rs.{productInfo.price}</span>}
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
                <h3 className="font-bold text-gray-900">Delivery Details</h3>
                <p className="mt-0.5 text-xs text-gray-500">Sab details ek hi dafa fill karein — AI ek saath verify karega.</p>
              </div>
            </div>

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

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
              disabled={isLoading}
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
                disabled={isLoading}
                className="h-11 flex-1 rounded-xl bg-[#25d366] font-bold text-white hover:bg-[#1ebe57]"
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
