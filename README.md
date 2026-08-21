# Sparrow Official — AI Order Chatbot

WhatsApp-style AI chatbot that automatically collects customer order details.
Replaces manual WhatsApp ordering with an AI-powered conversation.

## Setup on Your Server

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env and add your Gemini API key
nano .env
```

### 3. Setup Database
```bash
npx prisma db push
npx prisma generate
```

### 4. Change Your WhatsApp Number
In `src/app/api/chat/route.ts`, line 10:
```
const STORE_OWNER_WHATSAPP = '923001234567';  ← your number here (92 + number without 0)
```

### 5. Build & Start
```bash
npm run build
pm run start
# OR use PM2:
pm2 start npm --name "sparrow-order" -- start
pm2 save
```

### 6. Nginx Config (order.sparrowofficial.pk)
```nginx
server {
    listen 80;
    server_name order.sparrowofficial.pk;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 7. HTTPS (Free with Certbot)
```bash
sudo certbot --nginx -d order.sparrowofficial.pk
```

## Shopify Setup

Change "Order on WhatsApp" button URL to:
```
https://order.sparrowofficial.pk/?product={{product.title}}&color={{variant.title}}&size={{variant.option1}}&price={{variant.price}}
```

## Gemini API Key (FREE)
1. Go to: https://aistudio.google.com/apikey
2. Login with Google
3. Click "Create API Key"
4. Copy and paste in `.env` file

## How It Works
1. Customer clicks "Order on WhatsApp" on Shopify
2. Lands on AI chatbot page (WhatsApp-style UI)
3. AI collects: Name, Phone, City, Address (in Roman Urdu)
4. Order summary shown with all details
5. Customer clicks "Confirm on WhatsApp"
6. Store owner receives full order on WhatsApp

## Cost
FREE — Uses Google Gemini API (1.5M tokens/day free)
