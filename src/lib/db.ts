import { MongoClient, ObjectId, type Collection } from 'mongodb';

type ProductOptionValue = {
  name: string;
  value: string;
};

type OrderRecord = {
  id: string;
  sessionId: string;
  productName: string;
  productId: string | null;
  productHandle: string | null;
  variantId: string | null;
  productUrl: string | null;
  productImage: string | null;
  productOptions: ProductOptionValue[] | null;
  color: string | null;
  size: string | null;
  price: string | null;
  quantity: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  customerAddress: string | null;
  chatHistory: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type OrderDocument = Omit<OrderRecord, 'id'> & {
  _id: ObjectId;
};

type CreateOrderData = Partial<
  Pick<
    OrderRecord,
    | 'productId'
    | 'productHandle'
    | 'variantId'
    | 'productUrl'
    | 'productImage'
    | 'productOptions'
    | 'color'
    | 'size'
    | 'price'
    | 'quantity'
    | 'customerName'
    | 'customerPhone'
    | 'customerCity'
    | 'customerAddress'
    | 'status'
  >
> &
  Pick<OrderRecord, 'sessionId' | 'productName' | 'chatHistory'>;

const globalForMongo = globalThis as unknown as {
  mongoClientPromise?: Promise<MongoClient>;
};

function getMongoUri(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim() || '';
  const uri =
    process.env.MONGODB_URI?.trim() ||
    process.env.MONGODB_URL?.trim() ||
    (databaseUrl.startsWith('mongodb://') || databaseUrl.startsWith('mongodb+srv://')
      ? databaseUrl
      : '');

  if (!uri) {
    throw new Error(
      'MongoDB is not configured. Add MONGODB_URI to your environment variables.'
    );
  }

  return uri;
}

async function getMongoClient(): Promise<MongoClient> {
  if (!globalForMongo.mongoClientPromise) {
    const client = new MongoClient(getMongoUri(), {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });

    globalForMongo.mongoClientPromise = client.connect().catch(error => {
      globalForMongo.mongoClientPromise = undefined;
      throw error;
    });
  }

  return globalForMongo.mongoClientPromise;
}

async function getOrdersCollection(): Promise<Collection<OrderDocument>> {
  const client = await getMongoClient();
  const configuredDbName =
    process.env.MONGODB_DB?.trim() || process.env.MONGODB_DB_NAME?.trim();

  if (configuredDbName) {
    return client.db(configuredDbName).collection<OrderDocument>('orders');
  }

  const defaultDb = client.db();
  const db = defaultDb.databaseName === 'test' ? client.db('sparrowbot') : defaultDb;
  return db.collection<OrderDocument>('orders');
}

function serializeOrder(document: OrderDocument): OrderRecord {
  const { _id, ...order } = document;
  return {
    ...order,
    id: _id.toHexString(),
    productId: order.productId ?? null,
    productHandle: order.productHandle ?? null,
    variantId: order.variantId ?? null,
    productUrl: order.productUrl ?? null,
    productImage: order.productImage ?? null,
    productOptions: order.productOptions ?? null,
  };
}

export const db = {
  order: {
    async create({ data }: { data: CreateOrderData }): Promise<OrderRecord> {
      const collection = await getOrdersCollection();
      const now = new Date();

      const document: Omit<OrderDocument, '_id'> = {
        sessionId: data.sessionId,
        productName: data.productName,
        productId: data.productId ?? null,
        productHandle: data.productHandle ?? null,
        variantId: data.variantId ?? null,
        productUrl: data.productUrl ?? null,
        productImage: data.productImage ?? null,
        productOptions: data.productOptions ?? null,
        color: data.color ?? null,
        size: data.size ?? null,
        price: data.price ?? null,
        quantity: data.quantity ?? null,
        customerName: data.customerName ?? null,
        customerPhone: data.customerPhone ?? null,
        customerCity: data.customerCity ?? null,
        customerAddress: data.customerAddress ?? null,
        chatHistory: data.chatHistory,
        status: data.status ?? 'pending',
        createdAt: now,
        updatedAt: now,
      };

      const result = await collection.insertOne(document as OrderDocument);

      return serializeOrder({
        _id: result.insertedId,
        ...document,
      });
    },

    async findMany({
      where,
      take = 5,
    }: {
      where: { sessionId: string };
      orderBy?: { createdAt: 'asc' | 'desc' };
      take?: number;
    }): Promise<OrderRecord[]> {
      const collection = await getOrdersCollection();
      const documents = await collection
        .find({ sessionId: where.sessionId })
        .sort({ createdAt: -1 })
        .limit(take)
        .toArray();

      return documents.map(serializeOrder);
    },

    async update({
      where,
      data,
    }: {
      where: { id: string };
      data: { status: string };
    }): Promise<OrderRecord> {
      if (!ObjectId.isValid(where.id)) {
        throw new Error('Invalid order ID');
      }

      const collection = await getOrdersCollection();
      const _id = new ObjectId(where.id);

      await collection.updateOne(
        { _id },
        {
          $set: {
            status: data.status,
            updatedAt: new Date(),
          },
        }
      );

      const document = await collection.findOne({ _id });
      if (!document) {
        throw new Error('Order not found');
      }

      return serializeOrder(document);
    },
  },
};
