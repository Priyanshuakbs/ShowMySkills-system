
import 'dotenv/config';
import mongoose from 'mongoose';
import InternshipAction from './src/models/InternshipAction.js';

const USER_ID = '6ac22048b4ea2859dac446f8';
const INTERNSHIP_ID = '6ad45791c33d3ceed90eebee';

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const result = await InternshipAction.findOneAndUpdate(
      { user: USER_ID, internship: INTERNSHIP_ID },
      { $set: { decision: null, saved: false } },
      { new: true }
    );

    if (!result) {
      console.log('No existing test action found.');
    } else {
      console.log('INT-03 test action reset successfully.');
      console.log({
        internship: result.internship.toString(),
        decision: result.decision,
        saved: result.saved,
      });
    }
  } catch (error) {
    console.error('Reset failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
