type WhatsAppOrder = {
  id: string;
  productName: string;
  color: string | null;
  size: string | null;
  price: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  customerAddress: string | null;
};

type SendResult = {
  sent: boolean;
  error?: string;
};

export type OrderNotificationResult = {
  customerSent: boolean;
  ownerSent: boolean;
};

const GRAPH_API_VERSION =
  process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v23.0';

function normalizeWhatsAppNumber(value: string | null | undefined): string {
  const digits = (value || '').replace(/\D/g, '');

  if (/^03\d{9}$/.test(digits)) {
    return `92${digits.slice(1)}`;
  }

  if (/^3\d{9}$/.test(digits)) {
    return `92${digits}`;
  }

  return digits;
}

function shortOrderId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function productLabel(order: WhatsAppOrder): string {
  const options = [
    order.color ? `Color: ${order.color}` : '',
    order.size ? `Size: ${order.size}` : '',
  ].filter(Boolean);

  return options.length > 0
    ? `${order.productName} (${options.join(', ')})`
    : order.productName;
}

async function postWhatsAppMessage(payload: Record<string, unknown>): Promise<SendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();

  if (!accessToken || !phoneNumberId) {
    return {
      sent: false,
      error: 'WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is missing',
    };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        sent: false,
        error: `WhatsApp API ${response.status}: ${errorBody}`,
      };
    }

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      error: error instanceof Error ? error.message : 'Unknown WhatsApp API error',
    };
  }
}

async function sendText(to: string, body: string): Promise<SendResult> {
  return postWhatsAppMessage({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body,
    },
  });
}

async function sendTemplate(
  to: string,
  templateName: string,
  parameters: string[]
): Promise<SendResult> {
  const languageCode =
    process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en_US';

  return postWhatsAppMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [
        {
          type: 'body',
          parameters: parameters.map(text => ({ type: 'text', text })),
        },
      ],
    },
  });
}

async function sendTemplateOrText({
  to,
  templateName,
  templateParameters,
  text,
}: {
  to: string;
  templateName?: string;
  templateParameters: string[];
  text: string;
}): Promise<SendResult> {
  if (templateName) {
    const templateResult = await sendTemplate(to, templateName, templateParameters);
    if (templateResult.sent) return templateResult;

    console.error('WhatsApp template message failed:', templateResult.error);
  }

  return sendText(to, text);
}

export async function sendOrderWhatsAppNotifications(
  order: WhatsAppOrder
): Promise<OrderNotificationResult> {
  const customerNumber = normalizeWhatsAppNumber(order.customerPhone);
  const ownerNumber = normalizeWhatsAppNumber(
    process.env.WHATSAPP_ORDER_RECIPIENT
  );
  const orderId = shortOrderId(order.id);
  const product = productLabel(order);
  const amount = order.price ? `Rs.${order.price}` : 'Not specified';

  const customerText =
    `Assalam o Alaikum ${order.customerName || 'Ji'}! ✅\n\n` +
    `Aapka Sparrow Official order confirm ho gaya hai.\n` +
    `Order ID: ${orderId}\n` +
    `Product: ${product}\n` +
    `${order.price ? `Total: ${amount}\n` : ''}` +
    `Delivery City: ${order.customerCity || '-'}\n\n` +
    `Shukriya for shopping with Sparrow Official!`;

  const ownerText =
    `🛍️ NEW ORDER - Sparrow Official\n\n` +
    `Order ID: ${orderId}\n` +
    `Product: ${product}\n` +
    `${order.price ? `Amount: ${amount}\n` : ''}` +
    `Customer: ${order.customerName || '-'}\n` +
    `Phone: ${order.customerPhone || '-'}\n` +
    `City: ${order.customerCity || '-'}\n` +
    `Address: ${order.customerAddress || '-'}\n\n` +
    `Created: ${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}`;

  const customerPromise = customerNumber
    ? sendTemplateOrText({
        to: customerNumber,
        templateName: process.env.WHATSAPP_CUSTOMER_TEMPLATE_NAME?.trim(),
        templateParameters: [
          order.customerName || 'Customer',
          orderId,
          product,
          amount,
        ],
        text: customerText,
      })
    : Promise.resolve({ sent: false, error: 'Customer phone number is missing' });

  const ownerPromise = ownerNumber
    ? sendTemplateOrText({
        to: ownerNumber,
        templateName: process.env.WHATSAPP_OWNER_TEMPLATE_NAME?.trim(),
        templateParameters: [
          orderId,
          product,
          order.customerName || '-',
          order.customerPhone || '-',
          order.customerCity || '-',
          order.customerAddress || '-',
          amount,
        ],
        text: ownerText,
      })
    : Promise.resolve({ sent: false, error: 'WHATSAPP_ORDER_RECIPIENT is missing' });

  const [customerResult, ownerResult] = await Promise.all([
    customerPromise,
    ownerPromise,
  ]);

  if (!customerResult.sent) {
    console.error('Customer WhatsApp notification failed:', customerResult.error);
  }

  if (!ownerResult.sent) {
    console.error('Owner WhatsApp notification failed:', ownerResult.error);
  }

  return {
    customerSent: customerResult.sent,
    ownerSent: ownerResult.sent,
  };
}
