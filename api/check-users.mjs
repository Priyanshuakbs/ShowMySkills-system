import "dotenv/config";
import mongoose from "mongoose";
import { User } from "./src/models/User.js";

try {
  await mongoose.connect(process.env.MONGODB_URI);

  const users = await User.find({})
    .select("name email emailVerified role")
    .lean();

  console.log("\nTotal registered users:", users.length);

  if (users.length === 0) {
    console.log("No registered users found in this database.");
  } else {
    console.table(users.map(user => ({
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role
    })));
  }
} catch (error) {
  console.error("Error:", error.message);
} finally {
  await mongoose.disconnect();
}
