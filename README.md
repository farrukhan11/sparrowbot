# Sparrow Official — AI Order Chatbot

WhatsApp-style AI chatbot that automatically collects and verifies customer order details.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Environment variables
Create `.env` locally and add the same variables in Vercel:

```env
GROQ_API_KEY=your_groq_key
MONGODB_URI=mongodb+srv://...

# Optional: only needed if you want to override the database name in the URI
MONGODB_DB=sparrowbot

# Optional Gemini fallback
GEMINI_API_KEY_1=...
GEMINI_API_KEY_2=...
GEMINI_API_KEY_3=...
```

MongoDB collections are created automatically on first use. No database migration or schema generation command is required.

### 3. Build and run
```bash
npm run build
npm run start
```

## Shopify Setup

The current product can be passed to the chatbot using query parameters, for example:

```text
https://order.sparrowofficial.pk/?product={{product.title}}&color={{variant.title}}&size={{variant.option1}}&price={{variant.price}}
```

## AI Provider

Groq is the primary AI provider. Gemini keys are retained only as optional fallback credentials.

## Order Flow

1. Customer opens the chatbot from Shopify.
2. AI collects and validates name, mobile number, city, and delivery address.
3. The customer confirms the final details.
4. The order is stored in MongoDB in the `orders` collection.
5. The order summary is shown to the customer.
