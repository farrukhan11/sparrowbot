'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, ShoppingBag, User, MapPin, Phone, CheckCircle2, MessageCircle, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

// Types
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

interface OrderData {
  id: string;
  customerName: string;
  customerPhone: string;
  customerCity: string;
  customerAddress: string;
  productName: string;
  color: string | null;
  size: string | null;
  price: string | null;
  whatsappLink: string;
}

function getTimeString(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function OrderChat({ productInfo, sessionId }: { productInfo: ProductInfo; sessionId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [showOrderSummary, setShowOrderSummary] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      text: text.trim(),
      sender: 'user',
      time: getTimeString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          sessionId,
          productInfo,
        }),
      });

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const botMsg: Message = {
        id: `bot-${Date.now()}`,
        text: data.reply,
        sender: 'bot',
        time: getTimeString(),
      };

      setMessages(prev => [...prev, botMsg]);

      if (data.orderComplete && data.order) {
        setOrderData(data.order);
        setTimeout(() => {
          setShowOrderSummary(true);
        }, 1500);
      }
    } catch (error) {
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        text: 'Oops! Kuch technical issue aa gaya. Please thodi der baad try karein. 🙏',
        sender: 'bot',
        time: getTimeString(),
      };
      setMessages(prev => [...prev, errorMsg]);
      toast({
        title: 'Error',
        description: 'Message send nahi ho saka. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [isLoading, sessionId, productInfo, toast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleStart = () => {
    setIsStarted(true);
    sendMessage('hi');
  };

  const handleConfirmOrder = () => {
    if (orderData) {
      window.open(orderData.whatsappLink, '_blank');
      toast({
        title: 'Order Sent! ✅',
        description: 'Aapka order WhatsApp pe store owner ko bhej diya gaya hai.',
      });
    }
  };

  const handleNewOrder = () => {
    window.location.reload();
  };

  // Initial screen - before chat starts
  if (!isStarted) {
    return (
      <div className="min-h-screen flex flex-col bg-[#eae6df]">
        {/* WhatsApp-style header */}
        <header className="bg-[#075e54] text-white px-4 py-3 flex items-center gap-3 shadow-md">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base">Sparrow Official</h1>
            <p className="text-xs text-green-200 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-300 rounded-full inline-block" />
              Online — Order Assistant
            </p>
          </div>
        </header>

        {/* Product card */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
          <div className="bg-white rounded-2xl shadow-lg p-6 max-w-sm w-full">
            {/* Product info */}
            <div className="flex items-start gap-4 mb-5">
              <div className="w-20 h-20 bg-[#f0f0f0] rounded-xl flex items-center justify-center flex-shrink-0">
                <ShoppingBag className="w-8 h-8 text-gray-400" />
              </div>
              <div className="flex-1">
                <h2 className="font-bold text-gray-900 text-sm leading-tight mb-1">
                  {productInfo.productName}
                </h2>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {productInfo.color && (
                    <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 rounded-full text-xs text-gray-600">
                      {productInfo.color}
                    </span>
                  )}
                  {productInfo.size && (
                    <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 rounded-full text-xs text-gray-600">
                      Size: {productInfo.size}
                    </span>
                  )}
                </div>
                {productInfo.price && (
                  <p className="text-[#075e54] font-bold text-lg mt-2">
                    Rs.{productInfo.price}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t pt-4 mt-2">
              <p className="text-xs text-gray-500 text-center mb-4">
                AI assistant aap se order details collect karega — bilkul WhatsApp chat jaisa!
              </p>
              <Button
                onClick={handleStart}
                className="w-full bg-[#25d366] hover:bg-[#1ebe57] text-white font-semibold py-6 text-base rounded-xl transition-all active:scale-[0.98]"
              >
                <MessageCircle className="w-5 h-5 mr-2" />
                Start Chat — Order Karein
              </Button>
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="text-xs text-gray-500">
              Cash on Delivery • Next Day Delivery
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Order Summary Screen
  if (showOrderSummary && orderData) {
    return (
      <div className="min-h-screen flex flex-col bg-[#eae6df]">
        <header className="bg-[#075e54] text-white px-4 py-3 flex items-center gap-3 shadow-md">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base">Order Confirmed!</h1>
            <p className="text-xs text-green-200">Thank you for shopping</p>
          </div>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
          <div className="bg-white rounded-2xl shadow-lg p-6 max-w-sm w-full">
            {/* Success animation area */}
            <div className="text-center mb-5">
              <div className="w-16 h-16 bg-[#25d366]/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-8 h-8 text-[#25d366]" />
              </div>
              <h2 className="font-bold text-lg text-gray-900">Order Note Ho Gaya! ✅</h2>
              <p className="text-xs text-gray-500 mt-1">
                Aapka order ID: <span className="font-mono font-bold">{orderData.id.slice(0, 8).toUpperCase()}</span>
              </p>
            </div>

            {/* Order details */}
            <div className="space-y-3 mb-5">
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                <ShoppingBag className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Product</p>
                  <p className="text-sm font-semibold text-gray-900">{orderData.productName}</p>
                  <div className="flex gap-2 mt-1">
                    {orderData.color && <span className="text-xs text-gray-600">{orderData.color}</span>}
                    {orderData.size && <span className="text-xs text-gray-600">• Size: {orderData.size}</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                <User className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Customer</p>
                  <p className="text-sm font-semibold text-gray-900">{orderData.customerName}</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                <Phone className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Phone</p>
                  <p className="text-sm font-semibold text-gray-900">{orderData.customerPhone}</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                <MapPin className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Delivery Address</p>
                  <p className="text-sm font-semibold text-gray-900">{orderData.customerCity}</p>
                  <p className="text-xs text-gray-600">{orderData.customerAddress}</p>
                </div>
              </div>

              {orderData.price && (
                <div className="flex items-center justify-between p-3 bg-[#25d366]/5 rounded-xl border border-[#25d366]/20">
                  <span className="text-sm font-semibold text-gray-700">Total Amount</span>
                  <span className="text-lg font-bold text-[#075e54]">Rs.{orderData.price}</span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
              <Button
                onClick={handleConfirmOrder}
                className="w-full bg-[#25d366] hover:bg-[#1ebe57] text-white font-semibold py-5 text-base rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                Confirm on WhatsApp
                <ChevronRight className="w-4 h-4" />
              </Button>
              <p className="text-xs text-gray-400 text-center">
                Order confirm karne ke liye WhatsApp pe bhejien
              </p>
            </div>
          </div>

          <button
            onClick={handleNewOrder}
            className="mt-6 text-sm text-[#075e54] font-medium underline underline-offset-2"
          >
            Nayi order karein
          </button>
        </div>
      </div>
    );
  }

  // Main Chat Screen
  return (
    <div className="min-h-screen flex flex-col bg-[#eae6df]">
      {/* WhatsApp-style header */}
      <header className="bg-[#075e54] text-white px-4 py-3 flex items-center gap-3 shadow-md sticky top-0 z-10">
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
          <ShoppingBag className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="font-bold text-base">Sparrow Official</h1>
          <p className="text-xs text-green-200 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green-300 rounded-full inline-block" />
            Online
          </p>
        </div>
      </header>

      {/* Product info bar */}
      <div className="bg-white border-b px-4 py-2.5 flex items-center gap-3">
        <div className="w-12 h-12 bg-[#f0f0f0] rounded-lg flex items-center justify-center flex-shrink-0">
          <ShoppingBag className="w-5 h-5 text-gray-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{productInfo.productName}</p>
          <div className="flex items-center gap-2">
            {productInfo.color && <span className="text-xs text-gray-500">{productInfo.color}</span>}
            {productInfo.size && <span className="text-xs text-gray-500">• {productInfo.size}</span>}
            {productInfo.price && <span className="text-xs font-bold text-[#075e54]">Rs.{productInfo.price}</span>}
          </div>
        </div>
      </div>

      {/* Chat messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2" style={{
        backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23d4d0c8\' fill-opacity=\'0.15\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
      }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] px-3.5 py-2 rounded-2xl shadow-sm relative ${
                msg.sender === 'user'
                  ? 'bg-[#dcf8c6] rounded-br-sm'
                  : 'bg-white rounded-bl-sm'
              }`}
            >
              <p className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">{msg.text}</p>
              <p className={`text-[10px] mt-1 text-right ${msg.sender === 'user' ? 'text-green-700/60' : 'text-gray-400'}`}>
                {msg.time}
              </p>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-sm shadow-sm">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="bg-[#f0f0f0] px-3 py-2.5 flex items-end gap-2 sticky bottom-0">
        <div className="flex-1 bg-white rounded-full px-4 py-2.5 flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Type a message..."
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none disabled:opacity-50"
          />
        </div>
        <Button
          onClick={handleSubmit}
          disabled={!input.trim() || isLoading}
          size="icon"
          className="w-11 h-11 rounded-full bg-[#075e54] hover:bg-[#064e46] text-white flex-shrink-0 transition-all active:scale-95 disabled:opacity-40"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </Button>
      </div>
    </div>
  );
}
