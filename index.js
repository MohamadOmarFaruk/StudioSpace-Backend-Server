
import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 5000;

const client = new MongoClient(process.env.MONGODB_URI);

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing");
if (!process.env.CLIENT_URL) throw new Error("CLIENT_URL is missing");
if (!process.env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL is missing");

const CLIENT_URL = process.env.CLIENT_URL.split(",").map(url => url.trim());
const ADMIN_EMAIL = process.env.STUDIO_ADMIN_EMAIL?.trim().toLowerCase();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || CLIENT_URL.includes(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));

app.use(express.json());

// ========================================
// MongoDB Connection
// ========================================

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("Connected to MongoDB!");
    return client;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("StudioSpace");

const studioCollection = db.collection("studios");
const legacyCollection = db.collection("Assingment");
const bookingCollection = db.collection("bookings");

// Migrate old studios
if (
  await studioCollection.estimatedDocumentCount() === 0 &&
  await legacyCollection.estimatedDocumentCount() > 0
) {
  await legacyCollection.aggregate([
    {
      $merge: {
        into: "studios",
        on: "_id",
        whenMatched: "keepExisting",
        whenNotMatched: "insert"
      }
    }
  ]).toArray();
}

await bookingCollection.createIndex({ customerId: 1, createdAt: -1 });
await bookingCollection.createIndex({ studioId: 1, startsAt: 1, status: 1 });

// ========================================
// Authentication
// ========================================

const JWKS = createRemoteJWKSet(
  new URL("/api/auth/jwks", process.env.BETTER_AUTH_URL)
);

const verifyToken = async (req, res, next) => {
  try {
    let token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null;

    if (!token && req.headers.cookie) {
      const cookies = Object.fromEntries(
        req.headers.cookie.split(";").map(cookie => {
          const [key, ...value] = cookie.trim().split("=");
          return [key, decodeURIComponent(value.join("="))];
        })
      );

      token = cookies["better-auth.session_token"] ||
              cookies["better-auth.session_token.0"];
    }

    if (!token) return res.status(401).send({ message: "Please login first" });

    const { payload } = await jwtVerify(token, JWKS);

    console.log(payload)
    if (!payload.sub) {
      return res.status(401).send({ message: "Invalid token" });
    }

    req.user = {
      sub: payload.sub,
      email: payload.email || null,
      name: payload.name || null
    };

    next();
  } catch (error) {
    console.error("Authentication error:", error.message);
    console.log(error)
    res.status(401).send({ message: "Invalid or expired token" });
  }
};

// ========================================
// Helpers
// ========================================

const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const validId = id => ObjectId.isValid(id);

const ownerFilter = user => ({
  ...(ADMIN_EMAIL && user.email?.toLowerCase() === ADMIN_EMAIL
    ? {}
    : { ownerId: user.sub })
});

const normalizeStudio = data => ({
  ...data,
  title: typeof data.title === "string" ? data.title.trim() : "",
  slug: typeof data.slug === "string" ? data.slug.trim() : "",
  description: typeof data.description === "string" ? data.description.trim() : "",
  category: typeof data.category === "string" ? data.category : "",
  categoryName: typeof data.categoryName === "string" ? data.categoryName : "",
  image: typeof data.image === "string" ? data.image.trim() : "",
  gallery: Array.isArray(data.gallery) ? data.gallery : [],
  hourlyRate: Number(data.hourlyRate),
  securityDeposit: Number(data.securityDeposit || 0),
  rating: Number(data.rating || 0),
  totalReviews: Number(data.totalReviews || 0),
  location: data.location && typeof data.location === "object" &&
    !Array.isArray(data.location) ? data.location : {},
  capacity: Number(data.capacity ?? data.maxCapacity ?? 0),
  isAvailable: data.isAvailable ?? true,
  isFeatured: data.isFeatured ?? false,
  amenities: Array.isArray(data.amenities) ? data.amenities : [],
  host: data.host || {},
  reviews: Array.isArray(data.reviews) ? data.reviews : []
});

const validStudio = data =>
  data.title && data.slug && data.description &&
  data.category && data.image &&
  Number.isFinite(data.hourlyRate) && data.hourlyRate > 0 &&
  Number.isFinite(data.securityDeposit) && data.securityDeposit >= 0 &&
  Number.isInteger(data.capacity) && data.capacity >= 1 &&
  typeof data.location.city === "string" &&
  typeof data.location.area === "string" &&
  typeof data.location.country === "string" &&
  Array.isArray(data.gallery) &&
  data.gallery.every(item => typeof item === "string") &&
  Array.isArray(data.amenities) &&
  data.amenities.every(item => typeof item === "string");

// ========================================
// Home
// ========================================

app.get("/", (req, res) => {
  res.send({ message: "StudioSpace API is running!" });
});

// ========================================
// GET ALL STUDIOS
// ========================================

app.get("/Studios", asyncHandler(async (req, res) => {
  const query = {};

  if (req.query.category) query.category = req.query.category;
  if (req.query.available === "true") query.isAvailable = { $ne: false };

  const sort = req.query.sort === "rating"
    ? { rating: -1, createdAt: -1 }
    : { createdAt: -1 };

  let cursor = studioCollection.find(query).sort(sort);

  const limit = Number(req.query.limit);
  if (Number.isInteger(limit) && limit > 0) {
    cursor = cursor.limit(Math.min(limit, 100));
  }

  const data = await cursor.toArray();
  res.send({ success: true, count: data.length, data });
}));

// ========================================
// FEATURED STUDIOS
// ========================================

app.get("/featured-studios", asyncHandler(async (req, res) => {
  const data = await studioCollection
    .find({ isFeatured: true })
    .sort({ rating: -1, createdAt: -1 })
    .limit(6)
    .toArray();

  res.send({ success: true, count: data.length, data });
}));

// ========================================
// GET SINGLE STUDIO
// ========================================

app.get("/Studio/:id", verifyToken, asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).send({ message: "Invalid studio ID" });
  }

  const data = await studioCollection.findOne({
    _id: new ObjectId(req.params.id)
  });

  if (!data) return res.status(404).send({ message: "Studio not found" });

  res.send({ success: true, data });
}));

// ========================================
// CREATE STUDIO
// ========================================

app.post("/Studios", verifyToken, asyncHandler(async (req, res) => {
  const data = normalizeStudio(req.body);

  if (!validStudio(data) ||
      (req.body.isAvailable !== undefined &&
       typeof req.body.isAvailable !== "boolean")) {
    return res.status(400).send({ message: "Invalid studio information" });
  }

  if (await studioCollection.findOne({ slug: data.slug })) {
    return res.status(409).send({ message: "Studio slug already exists" });
  }

  const newStudio = {
    ...data,
    ownerId: req.user.sub,
    ownerEmail: req.user.email,
    rating: 0,
    totalReviews: 0,
    isFeatured: false,
    reviews: [],
    host: {
      name: req.user.name || req.user.email || "Studio Host",
      email: req.user.email
    },
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await studioCollection.insertOne(newStudio);

  res.status(201).send({
    success: true,
    message: "Studio created successfully",
    data: { ...newStudio, _id: result.insertedId }
  });
}));

// ========================================
// UPDATE STUDIO
// ========================================

app.patch("/Studio/:id", verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validId(id)) {
    return res.status(400).send({ message: "Invalid studio ID" });
  }

  const fields = [
    "title", "slug", "description", "category", "categoryName",
    "image", "gallery", "hourlyRate", "securityDeposit",
    "location", "capacity", "isAvailable", "amenities"
  ];

  const data = normalizeStudio(req.body);
  const updateData = Object.fromEntries(
    fields.filter(key => Object.hasOwn(req.body, key))
      .map(key => [key, data[key]])
  );

  if (!Object.keys(updateData).length) {
    return res.status(400).send({ message: "No changes provided" });
  }

  if (
    ["title", "slug", "description", "category", "image"].some(
      key => key in updateData &&
        (typeof updateData[key] !== "string" || !updateData[key])
    ) ||
    ("gallery" in updateData &&
      (!Array.isArray(req.body.gallery) ||
       !req.body.gallery.every(item => typeof item === "string"))) ||
    ("amenities" in updateData &&
      (!Array.isArray(req.body.amenities) ||
       !req.body.amenities.every(item => typeof item === "string"))) ||
    ("location" in updateData &&
      (!data.location ||
       typeof data.location.city !== "string" ||
       typeof data.location.area !== "string" ||
       typeof data.location.country !== "string")) ||
    ("isAvailable" in updateData &&
      typeof updateData.isAvailable !== "boolean") ||
    ("hourlyRate" in updateData &&
      (!Number.isFinite(data.hourlyRate) || data.hourlyRate <= 0)) ||
    ("securityDeposit" in updateData &&
      (!Number.isFinite(data.securityDeposit) || data.securityDeposit < 0)) ||
    ("capacity" in updateData &&
      (!Number.isInteger(data.capacity) || data.capacity < 1))
  ) {
    return res.status(400).send({ message: "Invalid studio information" });
  }

  if (updateData.slug) {
    const duplicate = await studioCollection.findOne({
      slug: updateData.slug,
      _id: { $ne: new ObjectId(id) }
    });

    if (duplicate) {
      return res.status(409).send({ message: "Studio slug already exists" });
    }
  }

  const result = await studioCollection.updateOne(
    { _id: new ObjectId(id), ...ownerFilter(req.user) },
    { $set: { ...updateData, updatedAt: new Date() } }
  );

  if (!result.matchedCount) {
    return res.status(404).send({
      message: "Studio not found or you are not the owner"
    });
  }

  const updated = await studioCollection.findOne({
    _id: new ObjectId(id)
  });

  res.send({ success: true, message: "Studio updated", data: updated });
}));

// ========================================
// DELETE STUDIO
// ========================================

app.delete("/Studio/:id", verifyToken, asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) {
    return res.status(400).send({ message: "Invalid studio ID" });
  }

  const result = await studioCollection.deleteOne({
    _id: new ObjectId(req.params.id),
    ...ownerFilter(req.user)
  });

  if (!result.deletedCount) {
    return res.status(404).send({
      message: "Studio not found or you are not the owner"
    });
  }

  res.send({ success: true, message: "Studio deleted successfully" });
}));

// ========================================
// MY STUDIOS
// ========================================

app.get("/my-studios", verifyToken, asyncHandler(async (req, res) => {
  const data = await studioCollection.find({
    ownerId: req.user.sub
  }).sort({ createdAt: -1 }).toArray();

  res.send({ success: true, count: data.length, data });
}));

// ========================================
// CREATE BOOKING
// ========================================

app.post("/Bookings", verifyToken, asyncHandler(async (req, res) => {
  const { studioId, startsAt, durationHours } = req.body;
  const duration = Number(durationHours);

  if (
    typeof studioId !== "string" || !validId(studioId) ||
    typeof startsAt !== "string" ||
    !Number.isInteger(duration) || duration < 1 || duration > 24
  ) {
    return res.status(400).send({ message: "Invalid booking information" });
  }

  const start = new Date(startsAt);

  if (!Number.isFinite(start.getTime()) || start <= new Date()) {
    return res.status(400).send({ message: "Choose a future booking time" });
  }

  const studio = await studioCollection.findOne({
    _id: new ObjectId(studioId)
  });

  if (!studio || studio.isAvailable === false) {
    return res.status(404).send({ message: "Studio is unavailable" });
  }

  const end = new Date(start.getTime() + duration * 3600000);

  const bookings = await bookingCollection.find({
    studioId,
    status: { $ne: "Cancelled" },
    startsAt: {
      $gte: new Date(start.getTime() - 86400000),
      $lt: end
    }
  }).toArray();

  const overlap = bookings.some(booking => {
    const existingStart = new Date(booking.startsAt).getTime();
    const existingEnd = existingStart +
      Number(booking.durationHours) * 3600000;

    return start.getTime() < existingEnd &&
           end.getTime() > existingStart;
  });

  if (overlap) {
    return res.status(409).send({
      message: "Studio already has a booking at this time"
    });
  }

  const booking = {
    studioId,
    title: studio.title,
    image: studio.image,
    category: studio.categoryName || studio.category,
    hourlyRate: Number(studio.hourlyRate),
    securityDeposit: Number(studio.securityDeposit || 0),
    city: studio.location?.city || "",
    area: studio.location?.area || "",
    startsAt: start,
    durationHours: duration,
    totalPrice: Number(studio.hourlyRate) * duration,
    customerId: req.user.sub,
    customerEmail: req.user.email,
    status: "Pending",
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await bookingCollection.insertOne(booking);

  res.status(201).send({
    success: true,
    message: "Booking created successfully",
    data: { ...booking, _id: result.insertedId }
  });
}));

// ========================================
// MY BOOKINGS
// ========================================

app.get("/my-bookings", verifyToken, asyncHandler(async (req, res) => {
  const data = await bookingCollection.find({
    customerId: req.user.sub
  }).sort({ createdAt: -1 }).toArray();

  res.send({ success: true, count: data.length, data });
}));

// ========================================
// CANCEL BOOKING
// ========================================

app.patch("/Bookings/:id/cancel", verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!validId(id)) {
    return res.status(400).send({ message: "Invalid booking ID" });
  }

  const result = await bookingCollection.updateOne(
    {
      _id: new ObjectId(id),
      customerId: req.user.sub,
      status: "Pending"
    },
    { $set: { status: "Cancelled", updatedAt: new Date() } }
  );

  if (!result.matchedCount) {
    const booking = await bookingCollection.findOne({
      _id: new ObjectId(id),
      customerId: req.user.sub
    });

    return res.status(booking ? 409 : 404).send({
      message: booking
        ? "Only pending bookings can be cancelled"
        : "Booking not found"
    });
  }

  res.send({ success: true, message: "Booking cancelled successfully" });
}));

// ========================================
// 404 & ERROR HANDLING
// ========================================

app.use((req, res) => {
  res.status(404).send({ message: "API endpoint not found" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send({ message: "Internal server error" });
});

// ========================================
// START SERVER
// ========================================

app.listen(PORT, () => {
  console.log(`StudioSpace server running on port ${PORT}`);
});

export default app;
