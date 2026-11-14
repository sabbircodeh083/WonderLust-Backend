import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { createRemoteJWKSet, jwtVerify } from "jose";

const CLIENT_URL = process.env.CLIENT_URL?.trim().replace(/\/+$/, "");

if (!CLIENT_URL) {
  throw new Error("CLIENT_URL is not configured");
}

const app = express();
app.use(express.json());
app.use(cors({ origin: CLIENT_URL }));

const JWKS = createRemoteJWKSet(new URL(`${CLIENT_URL}/api/auth/jwks`));

//DATA base connection
const client = new MongoClient(process.env.DB_STRING);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
const newClient = await connectToMongoDB();

const db = newClient.db("wonderlust");
const destinationsCollection = db.collection("destination");
const bookingCollection = db.collection("booking");

// Call this only when your application terminates
export async function disconnectFromMongoDB() {
  await client.close();
}
//route is start here

app.get("/", (req, res) => {
  res.send("Hello World!");
});

//check jwttoken
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).send({ msg: "Unauthorized!" });
  }

  const token = authHeader.slice("Bearer ".length);

  if (!token) {
    return res.status(401).send({ msg: "Unauthorized!" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: CLIENT_URL,
      audience: CLIENT_URL,
    });

    req.user = payload;
    next();
  } catch {
    return res.status(401).send({ msg: "Unauthorized!" });
  }
};

const isText = (min, max) => (value) =>
  typeof value === "string" &&
  value.trim().length >= min &&
  value.trim().length <= max;

const destinationFields = {
  destinationName: isText(2, 80),
  country: isText(2, 60),
  category: (value) =>
    ["beach", "mountain", "city", "adventure", "island", "desert"].includes(
      value,
    ),
  price: (value) => Number.isFinite(Number(value)) && Number(value) > 0,
  duration: isText(2, 60),
  departureDate: (value) => isText(1, 40)(value),
  imageUrl: (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  },
  description: isText(20, 2000),
};

function destinationErrors(payload, { partial = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["Request body must be an object."];
  }

  const errors = [];

  for (const [field, isValid] of Object.entries(destinationFields)) {
    if (partial && !Object.hasOwn(payload, field)) continue;
    if (!Object.hasOwn(payload, field) || !isValid(payload[field])) {
      errors.push(`"${field}" is invalid.`);
    }
  }

  return errors;
}

//insert a booking
app.post("/destination-booking", verifyToken, async (req, res) => {
  try {
    if (!req.user?.email) {
      return res.status(401).send({ msg: "Unauthorized!" });
    }

    await bookingCollection.insertOne({
      ...req.body,
      email: req.user.email,
    });

    res.status(201).json({
      message: "Destination added successfully",
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: "Failed to booking" });
  }
});
//get all booking for a user
app.get("/destination-booking", verifyToken, async (req, res) => {
  try {
    if (!req.user?.email) {
      return res.status(401).send({ msg: "Unauthorized!" });
    }

    const data = await bookingCollection
      .find({ email: req.user.email })
      .toArray();

    res.status(200).json(data);
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: "Failed to fetch booking List" });
  }
});

//delete a booking
app.delete("/destination-booking/:id", verifyToken, async (req, res) => {
  try {
    if (!req.user?.email) {
      return res.status(401).send({ msg: "Unauthorized!" });
    }

    const result = await bookingCollection.deleteOne({
      _id: req.params.id,
      email: req.user.email,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Booking not found" });
    }

    res.status(200).json({
      message: "booking is canceled",
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Cancelation was unsuccessful",
    });
  }
});

//fetch a single destination data from database
app.get("/destinations/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ message: "Destination not found" });
    }

    const destination = await destinationsCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!destination) {
      return res.status(404).send({ message: "Destination not found" });
    }
    res.status(200).send(destination);
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: "Failed to fetch destination" });
  }
});
//update destination in database
app.patch("/destinations/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ message: "Destination not found" });
    }

    const errors = destinationErrors(req.body, { partial: true });

    if (errors.length) {
      return res
        .status(400)
        .json({ message: "Invalid destination", errors });
    }

    const { _id, ...updatedData } = req.body;

    if (Object.keys(updatedData).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    const result = await destinationsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Destination not found" });
    }

    res.status(200).send({ message: "Destination is updated" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Destination value is not updated" });
  }
});

//delete a destinaiton

app.delete("/destinations/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ message: "Destination not found" });
    }

    const result = await destinationsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Destination not found" });
    }

    res.status(200).json({
      message: "destination is deleted",
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Deleting was unsuccessful",
    });
  }
});

//fetch all destination data from database
app.get("/destinations", async (req, res) => {
  try {
    const destinations = await destinationsCollection.find().toArray();
    res.status(200).send(destinations);
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: "Failed to fetch destinations" });
  }
});

//fetch first 5 destinations
app.get("/destinations-top", async (req, res) => {
  try {
    const destinations = await destinationsCollection.find().limit(5).toArray();
    res.status(200).send(destinations);
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: "Failed to fetch destinations" });
  }
});

//set destination data to database
app.post("/destinations", verifyToken, async (req, res) => {
  try {
    const errors = destinationErrors(req.body);

    if (errors.length) {
      return res
        .status(400)
        .json({ message: "Invalid destination", errors });
    }

    const { _id, ...destination } = req.body;
    const result = await destinationsCollection.insertOne(destination);

    res.status(201).json({
      message: "Destination added successfully",
      id: result.insertedId,
    });
  } catch (err) {
    console.log(err);
    res.status(500).send({ message: "Failed to add destination" });
  }
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});
