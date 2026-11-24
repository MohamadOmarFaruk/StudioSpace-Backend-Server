
import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || process.env.SERVER_PORT || 5000;

// ========================================
// Environment Variables
// ========================================

const MONGODB_URI = process.env.MONGODB_URI;
const CLIENT_URL = process.env.CLIENT_URL;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from environment variables");
}

if (!CLIENT_URL) {
  throw new Error("CLIENT_URL is missing from environment variables");
}

// ========================================
// Middleware
// ========================================

const allowedOrigins = CLIENT_URL.split(",")
  .map((url) => url.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());

// ========================================
// Better Auth JWT Configuration
// ========================================

const BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;
const STUDIO_ADMIN_EMAIL = process.env.STUDIO_ADMIN_EMAIL
  ?.trim()
  .toLowerCase();

if (!BETTER_AUTH_URL) {
  throw new Error("BETTER_AUTH_URL is missing from environment variables");
}

const JWKS = createRemoteJWKSet(
  new URL("/api/auth/jwks", BETTER_AUTH_URL)
);

// ========================================
// MongoDB Connection
// ========================================

const client = new MongoClient(MONGODB_URI);

async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    throw error;
  }
}

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("StudioSpace");
const studioCollection = db.collection("studios");
const legacyStudioCollection = db.collection("Assingment");
const [studioCount, legacyStudioCount] = await Promise.all([
  studioCollection.estimatedDocumentCount(),
  legacyStudioCollection.estimatedDocumentCount(),
]);

if (studioCount === 0 && legacyStudioCount > 0) {
  await legacyStudioCollection
    .aggregate([
      {
        $merge: {
          into: "studios",
          on: "_id",
          whenMatched: "keepExisting",
          whenNotMatched: "insert",
        },
      },
    ])
    .toArray();
}

const bookingCollection = db.collection("bookings");
await bookingCollection.createIndex({ customerId: 1, createdAt: -1 });
await bookingCollection.createIndex({ studioId: 1, startsAt: 1, status: 1 });

// ========================================
// Authentication Middleware
// ========================================

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    let token = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    // Fallback to Better Auth session cookie
    if (!token && req.headers.cookie) {
      const cookies = {};
      const cookieList = req.headers.cookie.split(";");

      for (const cookie of cookieList) {
        const [name, ...value] = cookie.trim().split("=");
        cookies[name] = decodeURIComponent(value.join("="));
      }

      token =
        cookies["better-auth.session_token"] ||
        cookies["better-auth.session_token.0"];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please login first.",
      });
    }

    const { payload } = await jwtVerify(token, JWKS);

    if (!payload.sub) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    req.user = {
      sub: payload.sub,
      email: payload.email || null,
      name: payload.name || null,
    };

    next();
  } catch (error) {
    console.error("Authentication error:", error.message);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

// ========================================
// Studio Data Normalizer
// ========================================

function normalizeStudio(data) {
  return {
    ...data,
    title: typeof data.title === "string" ? data.title.trim() : "",
    slug: typeof data.slug === "string" ? data.slug.trim() : "",
    description:
      typeof data.description === "string" ? data.description.trim() : "",
    category: typeof data.category === "string" ? data.category : "",
    categoryName:
      typeof data.categoryName === "string" ? data.categoryName : "",
    image: typeof data.image === "string" ? data.image.trim() : "",
    gallery: Array.isArray(data.gallery)
      ? data.gallery.filter((image) => typeof image === "string")
      : [],
    hourlyRate: Number(data.hourlyRate),
    securityDeposit: Number(data.securityDeposit || 0),
    rating: Number(data.rating || 0),
    totalReviews: Number(data.totalReviews || 0),
    location:
      typeof data.location === "object" &&
      data.location !== null &&
      !Array.isArray(data.location)
        ? data.location
        : {},
    capacity: Number(data.capacity ?? data.maxCapacity ?? 0),
    isAvailable: data.isAvailable ?? true,
    isFeatured: data.isFeatured ?? false,
    amenities: Array.isArray(data.amenities) ? data.amenities : [],
    host: data.host || {},
    reviews: Array.isArray(data.reviews) ? data.reviews : [],
  };
}

function isStudioAdmin(user) {
  return Boolean(
    STUDIO_ADMIN_EMAIL &&
      user.email?.trim().toLowerCase() === STUDIO_ADMIN_EMAIL,
  );
}

// ========================================
// Root Route
// ========================================

app.get("/", (req, res) => {
  res.send("StudioSpace API is running successfully");
});

// ========================================
// GET ALL STUDIOS
// ========================================

app.get("/Studios", async (req, res) => {
  try {
    const { category } = req.query;

    const query = {};

    if (category) {
      query.category = category;
    }
    if (req.query.available === "true") {
      query.isAvailable = { $ne: false };
    }

    const sort =
      req.query.sort === "rating"
        ? { rating: -1, createdAt: -1 }
        : { createdAt: -1 };
    const cursor = studioCollection.find(query).sort(sort);
    const requestedLimit = Number(req.query.limit);
    const studios = await (Number.isInteger(requestedLimit) && requestedLimit > 0
      ? cursor.limit(Math.min(requestedLimit, 100))
      : cursor)
      .toArray();

    res.status(200).json({
      success: true,
      count: studios.length,
      data: studios,
    });
  } catch (error) {
    console.error("Get studios error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch studios",
    });
  }
});

// ========================================
// GET FEATURED STUDIOS
// ========================================

app.get("/featured-studios", async (req, res) => {
  try {
    const studios = await studioCollection
      .find({ isFeatured: true })
      .sort({ rating: -1, createdAt: -1 })
      .limit(6)
      .toArray();

    res.status(200).json({
      success: true,
      count: studios.length,
      data: studios,
    });
  } catch (error) {
    console.error("Featured studios error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch featured studios",
    });
  }
});

// ========================================
// GET SINGLE STUDIO
// ========================================

app.get("/Studio/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio ID",
      });
    }

    const studio = await studioCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!studio) {
      return res.status(404).json({
        success: false,
        message: "Studio not found",
      });
    }

    res.status(200).json({
      success: true,
      data: studio,
    });
  } catch (error) {
    console.error("Get single studio error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch studio",
    });
  }
});

// ========================================
// CREATE STUDIO
// ========================================

app.post("/Studios", verifyToken, async (req, res) => {
  try {
    if (
      typeof req.body !== "object" ||
      req.body === null ||
      Array.isArray(req.body)
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide studio details in a JSON object.",
      });
    }
    if (
      (req.body.gallery !== undefined &&
        (!Array.isArray(req.body.gallery) ||
          !req.body.gallery.every((image) => typeof image === "string"))) ||
      (req.body.amenities !== undefined &&
        (!Array.isArray(req.body.amenities) ||
          !req.body.amenities.every(
            (amenity) => typeof amenity === "string",
          )))
    ) {
      return res.status(400).json({
        success: false,
        message: "Gallery and amenities must be arrays of text values.",
      });
    }

    const studioData = normalizeStudio(req.body);

    if (
      !studioData.title ||
      !studioData.slug ||
      !studioData.description ||
      !studioData.category ||
      !studioData.image ||
      !Number.isFinite(studioData.hourlyRate) ||
      studioData.hourlyRate <= 0 ||
      !Number.isFinite(studioData.securityDeposit) ||
      studioData.securityDeposit < 0 ||
      !Number.isInteger(studioData.capacity) ||
      studioData.capacity < 1 ||
      typeof studioData.location.city !== "string" ||
      typeof studioData.location.area !== "string" ||
      typeof studioData.location.country !== "string" ||
      (req.body.isAvailable !== undefined &&
        typeof req.body.isAvailable !== "boolean")
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide valid studio details, pricing, and guest capacity.",
      });
    }

    const existingStudio = await studioCollection.findOne({
      slug: studioData.slug,
    });

    if (existingStudio) {
      return res.status(409).json({
        success: false,
        message: "A studio with this slug already exists",
      });
    }

    const newStudio = {
      ...studioData,
      ownerId: req.user.sub,
      ownerEmail: req.user.email,
      rating: 0,
      totalReviews: 0,
      isFeatured: false,
      reviews: [],
      host: {
        name: req.user.name || req.user.email || "Studio Host",
        email: req.user.email,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await studioCollection.insertOne(newStudio);

    res.status(201).json({
      success: true,
      message: "Studio created successfully",
      data: {
        ...newStudio,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Create studio error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create studio",
    });
  }
});

// ========================================
// UPDATE STUDIO
// ========================================

app.patch("/Studio/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio ID",
      });
    }

    if (
      typeof req.body !== "object" ||
      req.body === null ||
      Array.isArray(req.body)
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide studio changes in a JSON object.",
      });
    }

    const normalizedData = normalizeStudio(req.body);
    const editableFields = [
      "title",
      "slug",
      "description",
      "category",
      "categoryName",
      "image",
      "gallery",
      "hourlyRate",
      "securityDeposit",
      "location",
      "capacity",
      "isAvailable",
      "amenities",
    ];
    const updateData = Object.fromEntries(
      editableFields
        .filter((field) => Object.hasOwn(req.body, field))
        .map((field) => [field, normalizedData[field]]),
    );

    if (
      ["title", "slug", "description", "category", "image"].some(
        (field) =>
          field in updateData &&
          (typeof updateData[field] !== "string" || !updateData[field]),
      ) ||
      ("gallery" in updateData &&
        (!Array.isArray(req.body.gallery) ||
          !req.body.gallery.every((image) => typeof image === "string"))) ||
      ("amenities" in updateData &&
        (!Array.isArray(req.body.amenities) ||
          !req.body.amenities.every(
            (amenity) => typeof amenity === "string",
          ))) ||
      ("location" in updateData &&
        (typeof updateData.location !== "object" ||
          updateData.location === null ||
          Array.isArray(updateData.location) ||
          typeof updateData.location.city !== "string" ||
          typeof updateData.location.area !== "string" ||
          typeof updateData.location.country !== "string")) ||
      ("isAvailable" in updateData &&
        typeof updateData.isAvailable !== "boolean")
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide valid text, gallery, and amenity values.",
      });
    }

    if (
      ("hourlyRate" in updateData &&
        (!Number.isFinite(updateData.hourlyRate) ||
          updateData.hourlyRate <= 0)) ||
      ("securityDeposit" in updateData &&
        (!Number.isFinite(updateData.securityDeposit) ||
          updateData.securityDeposit < 0)) ||
      ("capacity" in updateData &&
        (!Number.isInteger(updateData.capacity) || updateData.capacity < 1))
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide valid pricing, security deposit, and guest capacity.",
      });
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one editable studio field.",
      });
    }

    const result = await studioCollection.updateOne(
      {
        _id: new ObjectId(id),
        ...(isStudioAdmin(req.user) ? {} : { ownerId: req.user.sub }),
      },
      {
        $set: {
          ...updateData,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Studio not found or you are not the owner",
      });
    }

    const updatedStudio = await studioCollection.findOne({
      _id: new ObjectId(id),
    });

    res.status(200).json({
      success: true,
      message: "Studio updated successfully",
      data: updatedStudio,
    });
  } catch (error) {
    console.error("Update studio error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update studio",
    });
  }
});

// ========================================
// DELETE STUDIO
// ========================================

app.delete("/Studio/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio ID",
      });
    }

    const result = await studioCollection.deleteOne({
      _id: new ObjectId(id),
      ...(isStudioAdmin(req.user) ? {} : { ownerId: req.user.sub }),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Studio not found or you are not the owner",
      });
    }

    res.status(200).json({
      success: true,
      message: "Studio deleted successfully",
    });
  } catch (error) {
    console.error("Delete studio error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete studio",
    });
  }
});

// ========================================
// GET MY STUDIOS
// ========================================

app.get("/my-studios", verifyToken, async (req, res) => {
  try {
    const studios = await studioCollection
      .find({
        ownerId: req.user.sub,
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      count: studios.length,
      data: studios,
    });
  } catch (error) {
    console.error("My studios error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch your studios",
    });
  }
});

// ========================================
// CREATE BOOKING
// ========================================

app.post("/Bookings", verifyToken, async (req, res) => {
  try {
    if (
      typeof req.body !== "object" ||
      req.body === null ||
      Array.isArray(req.body)
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide booking details in a JSON object.",
      });
    }

    const { studioId, startsAt, durationHours } = req.body;
    const duration = Number(durationHours);

    if (
      typeof studioId !== "string" ||
      !ObjectId.isValid(studioId) ||
      typeof startsAt !== "string" ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 24
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide a valid studio, start time, and duration from 1 to 24 hours.",
      });
    }

    const start = new Date(startsAt);
    if (!Number.isFinite(start.getTime()) || start <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid future booking time.",
      });
    }

    const studio = await studioCollection.findOne({
      _id: new ObjectId(studioId),
    });

    if (!studio || studio.isAvailable === false) {
      return res.status(404).json({
        success: false,
        message: "This studio is not available for booking.",
      });
    }

    const end = new Date(start.getTime() + duration * 60 * 60 * 1000);
    const earliestOverlappingStart = new Date(
      start.getTime() - 24 * 60 * 60 * 1000,
    );
    const existingBookings = await bookingCollection
      .find({
        studioId,
        status: { $ne: "Cancelled" },
        startsAt: { $gte: earliestOverlappingStart, $lt: end },
      })
      .project({ startsAt: 1, durationHours: 1 })
      .toArray();
    const hasOverlap = existingBookings.some((booking) => {
      const existingStart = new Date(booking.startsAt).getTime();
      const existingEnd =
        existingStart + Number(booking.durationHours) * 60 * 60 * 1000;
      return start.getTime() < existingEnd && end.getTime() > existingStart;
    });

    if (hasOverlap) {
      return res.status(409).json({
        success: false,
        message: "This studio already has a booking request for that time.",
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
      updatedAt: new Date(),
    };

    const result = await bookingCollection.insertOne(booking);
    res.status(201).json({
      success: true,
      message: "Booking request created successfully",
      data: { ...booking, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Create booking error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create booking request",
    });
  }
});

// ========================================
// GET CURRENT USER BOOKINGS
// ========================================

app.get("/my-bookings", verifyToken, async (req, res) => {
  try {
    const bookings = await bookingCollection
      .find({ customerId: req.user.sub })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings,
    });
  } catch (error) {
    console.error("Get bookings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch your bookings",
    });
  }
});

// ========================================
// CANCEL CURRENT USER PENDING BOOKING
// ========================================

app.patch("/Bookings/:id/cancel", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    const result = await bookingCollection.updateOne(
      {
        _id: new ObjectId(id),
        customerId: req.user.sub,
        status: "Pending",
      },
      { $set: { status: "Cancelled", updatedAt: new Date() } },
    );

    if (result.matchedCount === 0) {
      const booking = await bookingCollection.findOne({
        _id: new ObjectId(id),
        customerId: req.user.sub,
      });
      return res.status(booking ? 409 : 404).json({
        success: false,
        message: booking
          ? "Only pending bookings can be cancelled."
          : "Booking not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Booking cancelled successfully",
    });
  } catch (error) {
    console.error("Cancel booking error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel booking",
    });
  }
});

// ========================================
// 404 Route
// ========================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found",
  });
});

// ========================================
// Global Error Handler
// ========================================

app.use((error, req, res, next) => {
  console.error("Server error:", error);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

// ========================================
// Start Server
// ========================================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
export default app
