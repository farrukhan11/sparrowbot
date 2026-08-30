import { MongoClient, ObjectId, type Collection } from 'mongodb';

type OrderRecord = {
  id: string;
  sessionId: string;
  productName: string;
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

  // Respect a database name already present in MONGODB_URI. If the URI has no
  // database name, the driver defaults to "test", so use a project-specific DB.
  const defaultDb = client.db();
  const db = defaultDb.databaseName === 'test' ? client.db('sparrowbot') : defaultDb;
  return db.collection<OrderDocument>('orders');
}

function serializeOrder(document: OrderDocument): OrderRecord {
  const { _id, ...order } = document;
  return {
    id: _id.toHexString(),
    ...order,
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
