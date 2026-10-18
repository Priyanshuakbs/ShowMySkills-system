import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./src/models/User.js";
import { createInterface } from "node:readline/promises";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

try {
  await mongoose.connect(process.env.MONGODB_URI);

  const email = "auth03test@example.com";
  const user = await User.findOne({ email });

  if (!user) throw new Error("Local test account not found.");

  const password = await rl.question("Enter a NEW unique test password: ");
  const confirm = await rl.question("Confirm new password: ");

  if (password.length < 8) throw new Error("Use at least 8 characters.");
  if (password !== confirm) throw new Error("Passwords do not match.");

  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await User.collection.updateOne(
    { _id: user._id, email },
    { $set: { password: hashedPassword } }
  );

  if (result.modifiedCount !== 1) {
    throw new Error("Password was not updated.");
  }

  console.log("Local test account password reset successfully.");
  console.log("Email:", email);
} catch (error) {
  console.error("Reset failed:", error.message);
  process.exitCode = 1;
} finally {
  rl.close();
  await mongoose.disconnect();
}
