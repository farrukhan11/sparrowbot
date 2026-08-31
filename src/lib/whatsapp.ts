type ProductOptionValue = { name: string; value: string };
type CartItem = {
  productName: string;
  variantId: string;
  productOptions: ProductOptionValue[];
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

type WhatsAppOrder = {
  id: string;
  productName: string;
  productOptions?: ProductOptionValue[] | null;
  cartItems?: CartItem[] | null;
  color: string | null;
  size: string | null;
  price: string | null;
  subtotalPrice?: string | null;
  shippingPrice?: string | null;
  shippingRateName?: string | null;
  totalPrice?: string | null;
  quantity?: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  customerAddress: string | null;
};

type SendResult = { sent: boolean; skipped?: boolean; error?: string };
export type OrderNotificationResult = { customerSent: boolean; ownerSent: boolean };

const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v25.0';
const META_TEST_ORDER_TEMPLATE = 'jaspers_market_order_confirmation_v1';
const SPARROW_ORDER_TEMPLATE = 'sparrow_order_confirmation';

function normalizeWhatsAppNumber(value: string | null | undefined): string {
  const digits = (value || '').replace(/\D/g, '');
  if (/^03\d{9}$/.test(digits)) return `92${digits.slice(1)}`;
  if (/^3\d{9}$/.test(digits)) return `92${digits}`;
  if (/^923\d{9}$/.test(digits)) return digits;
  return digits;
}

function shortOrderId(id: string): string { return id.slice(0, 8).toUpperCase(); }

function optionsLabel(options?: ProductOptionValue[] | null): string {
  return (options || []).filter(option => option?.name && option?.value).map(option => `${option.name}: ${option.value}`).join(', ');
}

function productLabel(order: WhatsAppOrder): string {
  const genericOptions = optionsLabel(order.productOptions);
  const legacyOptions = [order.color ? `Color: ${order.color}` : '', order.size ? `Size: ${order.size}` : ''].filter(Boolean).join(', ');
  const options = genericOptions || legacyOptions;
  return options ? `${order.productName} (${options})` : order.productName;
}

function cartLinesLabel(order: WhatsAppOrder): string {
  if (!order.cartItems?.length) return `${productLabel(order)} × ${order.quantity || '1'}`;
  return order.cartItems.map((item, index) => {
    const options = optionsLabel(item.productOptions);
    return `${index + 1}. ${item.productName}${options ? ` (${options})` : ''} × ${item.quantity} — Rs.${item.lineTotal}`;
  }).join('\n');
}

function estimatedDeliveryDate(): string {
  const delivery = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return delivery.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Karachi' });
}

function shippingLabel(order: WhatsAppOrder): string {
  if (order.shippingPrice == null) return 'Not specified';
  return Number(order.shippingPrice) === 0
    ? `FREE${order.shippingRateName ? ` (${order.shippingRateName})` : ''}`
    : `Rs.${order.shippingPrice}${order.shippingRateName ? ` (${order.shippingRateName})` : ''}`;
}

async function postWhatsAppMessage(payload: Record<string, unknown>): Promise<SendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) return { sent: false, error: 'WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is missing' };

  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    if (!response.ok) return { sent: false, error: `WhatsApp API ${response.status}: ${body}` };
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : 'Unknown WhatsApp API error' };
  }
}

async function sendText(to: string, body: string): Promise<SendResult> {
  return postWhatsAppMessage({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body } });
}

async function sendTemplate(to: string, templateName: string, parameters: string[]): Promise<SendResult> {
  const languageCode = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en_US';
  return postWhatsAppMessage({
    messaging_product: 'whatsapp', to, type: 'template',
    template: { name: templateName, language: { code: languageCode }, components: [{ type: 'body', parameters: parameters.map(text => ({ type: 'text', text })) }] },
  });
}

async function sendTemplateOrText({ to, templateName, templateParameters, text }: { to: string; templateName?: string; templateParameters: string[]; text: string }): Promise<SendResult> {
  if (templateName) {
    const result = await sendTemplate(to, templateName, templateParameters);
    if (result.sent) return result;
    console.error(`WhatsApp template ${templateName} failed:`, result.error);
    return result;
  }
  console.warn('No WhatsApp template configured. Falling back to a free-form text message, which requires an open customer service window.');
  return sendText(to, text);
}

export async function sendOrderWhatsAppNotifications(order: WhatsAppOrder): Promise<OrderNotificationResult> {
  const customerNumber = normalizeWhatsAppNumber(order.customerPhone);
  const ownerNumber = normalizeWhatsAppNumber(process.env.WHATSAPP_ORDER_RECIPIENT);
  const orderId = shortOrderId(order.id);
  const cartLines = cartLinesLabel(order);
  const quantity = order.quantity || '1';
  const subtotal = order.subtotalPrice ? `Rs.${order.subtotalPrice}` : order.price ? `Rs.${order.price}` : 'Not specified';
  const shipping = shippingLabel(order);
  const totalAmount = order.totalPrice ? `Rs.${order.totalPrice}` : subtotal;
  const configuredCustomerTemplate = process.env.WHATSAPP_CUSTOMER_TEMPLATE_NAME?.trim();
  const configuredOwnerTemplate = process.env.WHATSAPP_OWNER_TEMPLATE_NAME?.trim();

  const customerText =
    `Assalam o Alaikum ${order.customerName || 'Ji'}! ✅\n\n` +
    `Aapka Sparrow Official order confirm ho gaya hai.\n` +
    `Order ID: ${orderId}\n\n${cartLines}\n\nTotal Qty: ${quantity}\n` +
    `${order.subtotalPrice ? `Subtotal: ${subtotal}\n` : ''}` +
    `${order.shippingPrice != null ? `Shipping: ${shipping}\n` : ''}` +
    `${order.totalPrice ? `Grand Total: ${totalAmount}\n` : ''}` +
    `Delivery City: ${order.customerCity || '-'}\n\nShukriya for shopping with Sparrow Official!`;

  const ownerText =
    `🛍️ NEW ORDER - Sparrow Official\n\nOrder ID: ${orderId}\n\n${cartLines}\n\nTotal Qty: ${quantity}\n` +
    `${order.subtotalPrice ? `Subtotal: ${subtotal}\n` : ''}` +
    `${order.shippingPrice != null ? `Shipping: ${shipping}\n` : ''}${order.totalPrice ? `Grand Total: ${totalAmount}\n` : ''}` +
    `Customer: ${order.customerName || '-'}\nPhone: ${order.customerPhone || '-'}\nCity: ${order.customerCity || '-'}\nAddress: ${order.customerAddress || '-'}\n\nCreated: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`;

  const templateProductSummary = order.cartItems?.length
    ? order.cartItems.map(item => `${item.productName} ${optionsLabel(item.productOptions)} ×${item.quantity}`).join(' | ').slice(0, 900)
    : `${productLabel(order)} × ${quantity}`;

  const customerTemplateParameters = configuredCustomerTemplate === META_TEST_ORDER_TEMPLATE
    ? [order.customerName || 'Customer', orderId, estimatedDeliveryDate()]
    : configuredCustomerTemplate === SPARROW_ORDER_TEMPLATE
      ? [order.customerName || 'Customer', orderId, templateProductSummary, totalAmount, order.customerCity || '-']
      : [order.customerName || 'Customer', orderId, templateProductSummary, totalAmount];

  const ownerTemplateParameters = [orderId, templateProductSummary, order.customerName || '-', order.customerPhone || '-', order.customerCity || '-', order.customerAddress || '-', totalAmount];

  const customerPromise = customerNumber
    ? sendTemplateOrText({ to: customerNumber, templateName: configuredCustomerTemplate, templateParameters: customerTemplateParameters, text: customerText })
    : Promise.resolve<SendResult>({ sent: false, error: 'Customer phone number is missing' });

  const shouldSendOwner = Boolean(ownerNumber && ownerNumber !== customerNumber);
  const ownerPromise = shouldSendOwner
    ? sendTemplateOrText({ to: ownerNumber, templateName: configuredOwnerTemplate, templateParameters: ownerTemplateParameters, text: ownerText })
    : Promise.resolve<SendResult>({ sent: false, skipped: true, error: ownerNumber ? 'Owner number matches customer number; duplicate notification skipped' : 'Owner notification not configured' });

  const [customerResult, ownerResult] = await Promise.all([customerPromise, ownerPromise]);
  if (!customerResult.sent) console.error('Customer WhatsApp notification failed:', customerResult.error);
  else console.info(`Customer WhatsApp notification sent${configuredCustomerTemplate ? ` using ${configuredCustomerTemplate}` : ''}.`);

  if (ownerResult.skipped) console.info(`Owner WhatsApp notification skipped: ${ownerResult.error}`);
  else if (!ownerResult.sent) console.error('Owner WhatsApp notification failed:', ownerResult.error);
  else console.info(`Owner WhatsApp notification sent${configuredOwnerTemplate ? ` using ${configuredOwnerTemplate}` : ''}.`);

  return { customerSent: customerResult.sent, ownerSent: ownerResult.sent };
}